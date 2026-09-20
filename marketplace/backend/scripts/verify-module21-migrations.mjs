import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const migrationsDirectory = path.resolve("drizzle");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const migrationFiles = [
  "0000_foundation.sql",
  "0001_administration_auth_rbac.sql",
  "0002_module2_remediation_persistence.sql",
  "0003_module2_role_assignment_identity.sql",
  "0004_documents_audit_core.sql",
  "0005_documents_audit_integrity.sql",
];

/** Resets only the dedicated test schema used by destructive migration verification. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed SQL migration exactly as stored in the append-only history. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  await pool.query(sqlText);
}

/** Applies the full supported migration history through Module 21. */
async function applyAllMigrations() {
  for (const migration of migrationFiles) {
    await applyMigration(migration);
  }
}

/** Throws a focused verification error when one database invariant is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one table exists in the public schema. */
async function tableExists(tableName) {
  const result = await pool.query("select to_regclass($1) as table_name", [
    `public.${tableName}`,
  ]);
  return result.rows[0]?.table_name === tableName;
}

/** Returns whether one column exists on a public table. */
async function columnExists(tableName, columnName) {
  const result = await pool.query(
    `select 1
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2`,
    [tableName, columnName],
  );
  return result.rowCount === 1;
}

/** Returns whether one public-schema index exists. */
async function indexExists(indexName) {
  const result = await pool.query(
    `select 1
       from pg_indexes
      where schemaname = 'public'
        and indexname = $1`,
    [indexName],
  );
  return result.rowCount === 1;
}

/** Returns whether one named table constraint exists in the public schema. */
async function constraintExists(tableName, constraintName) {
  const result = await pool.query(
    `select 1
       from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = $1
        and constraint_name = $2`,
    [tableName, constraintName],
  );
  return result.rowCount === 1;
}

/** Verifies the Module 21 schema contract and intentional future-module boundaries. */
async function verifyFinalSchema() {
  assertCondition(await tableExists("files"), "files table is missing.");
  assertCondition(await tableExists("file_links"), "file_links table is missing.");
  assertCondition(await tableExists("audit_logs"), "audit_logs table is missing.");
  assertCondition(!(await tableExists("audit_events")), "Legacy audit_events table must be renamed.");

  for (const column of [
    "storage_provider",
    "object_key",
    "purpose",
    "original_name",
    "mime_type",
    "size_bytes",
    "checksum",
    "owner_user_id",
    "status",
    "created_at",
  ]) {
    assertCondition(await columnExists("files", column), `files.${column} is missing.`);
  }

  for (const column of [
    "file_id",
    "resource_type",
    "resource_id",
    "purpose",
    "created_by",
    "created_at",
  ]) {
    assertCondition(await columnExists("file_links", column), `file_links.${column} is missing.`);
  }

  for (const column of [
    "actor_user_id",
    "action",
    "resource_type",
    "resource_id",
    "seller_id",
    "request_id",
    "before_json_redacted",
    "after_json_redacted",
    "created_at",
  ]) {
    assertCondition(await columnExists("audit_logs", column), `audit_logs.${column} is missing.`);
  }

  for (const indexName of [
    "files_object_key_uq",
    "file_links_resource_idx",
    "audit_logs_resource_idx",
    "audit_logs_actor_idx",
    "audit_logs_request_idx",
    "audit_logs_seller_idx",
    "audit_logs_action_idx",
    "audit_logs_created_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["files", "files_purpose_check"],
    ["file_links", "file_links_purpose_check"],
    ["audit_logs", "audit_logs_actor_type_check"],
    ["audit_logs", "audit_logs_action_not_blank_check"],
    ["audit_logs", "audit_logs_resource_type_not_blank_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const sellerForeignKeys = await pool.query(`
    select count(*)::int as count
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.constraint_schema = tc.constraint_schema
     where tc.table_schema = 'public'
       and tc.table_name = 'audit_logs'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name = 'seller_id'
  `);
  assertCondition(
    sellerForeignKeys.rows[0]?.count === 0,
    "audit_logs.seller_id must not reference sellers before Module 4 exists.",
  );
}

/** Seeds one historical Foundation audit row before the Module 21 rename migration runs. */
async function seedPreviousAuditFixture() {
  const result = await pool.query(`
    insert into audit_events
      (actor_type, action, entity_type, entity_id, request_id, before, after, metadata)
    values
      ('system', 'module21.upgrade_fixture', 'fixture', 'fixture-1', 'request-upgrade-1',
       '{"status":"before"}'::jsonb, '{"status":"after"}'::jsonb, '{"source":"module2"}'::jsonb)
    returning id
  `);
  return result.rows[0]?.id;
}

/** Verifies the supported Module 2 schema upgrades through both Module 21 database migrations without losing audit history. */
async function verifyModule2UpgradePath() {
  await resetSchema();
  for (const migration of migrationFiles.slice(0, 4)) {
    await applyMigration(migration);
  }
  const auditId = await seedPreviousAuditFixture();
  assertCondition(Boolean(auditId), "Failed to create the pre-Module 21 audit fixture.");

  await applyMigration("0004_documents_audit_core.sql");
  await applyMigration("0005_documents_audit_integrity.sql");
  await verifyFinalSchema();

  const preserved = await pool.query(
    `select action, resource_type, resource_id, request_id,
            before_json_redacted, after_json_redacted, metadata
       from audit_logs
      where id = $1`,
    [auditId],
  );
  assertCondition(preserved.rowCount === 1, "Existing audit history was not preserved by the Module 21 migrations.");
  assertCondition(
    preserved.rows[0]?.resource_type === "fixture" &&
      preserved.rows[0]?.resource_id === "fixture-1" &&
      preserved.rows[0]?.before_json_redacted?.status === "before" &&
      preserved.rows[0]?.after_json_redacted?.status === "after",
    "Existing audit values were not preserved under the Module 21 audit columns.",
  );
}

/** Creates one pre-Pass-1 file row so the new purpose column must be backfilled from its server-generated key. */
async function seedModule21CoreFileFixture() {
  const user = await pool.query(`
    insert into users (email, password_hash, display_name, account_type, status)
    values ('module21.upgrade@example.test', 'not-a-real-password-hash', 'Module 21 Upgrade', 'customer', 'active')
    returning id
  `);
  const userId = user.rows[0]?.id;
  assertCondition(Boolean(userId), "Failed to create the Module 21 upgrade user.");

  const file = await pool.query(
    `insert into files
      (storage_provider, object_key, original_name, mime_type, size_bytes, owner_user_id, status)
     values ('s3_compatible', 'operational_evidence/2026-09-03/pass1-upgrade.pdf',
             'pass1-upgrade.pdf', 'application/pdf', 128, $1, 'confirmed')
     returning id`,
    [userId],
  );
  return file.rows[0]?.id;
}

/** Verifies upgrade from the previously-supported 0004 Module 21 schema and checks deterministic purpose backfill. */
async function verifyModule21CoreUpgradePath() {
  await resetSchema();
  for (const migration of migrationFiles.slice(0, 5)) {
    await applyMigration(migration);
  }
  const fileId = await seedModule21CoreFileFixture();
  assertCondition(Boolean(fileId), "Failed to create the pre-Pass-1 file fixture.");

  await applyMigration("0005_documents_audit_integrity.sql");
  await verifyFinalSchema();

  const result = await pool.query("select purpose from files where id = $1", [fileId]);
  assertCondition(
    result.rows[0]?.purpose === "operational_evidence",
    "0005 did not preserve the signed upload purpose from the existing object-key namespace.",
  );
}

/** Verifies database constraints for file identity/link identity and append-only audit behavior. */
async function verifyDatabaseGuards() {
  const user = await pool.query(`
    insert into users (email, password_hash, display_name, account_type, status)
    values ('module21.file.owner@example.test', 'not-a-real-password-hash', 'File Owner', 'customer', 'active')
    returning id
  `);
  const userId = user.rows[0]?.id;
  assertCondition(Boolean(userId), "Failed to create file-owner fixture.");

  const file = await pool.query(
    `insert into files
      (storage_provider, object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
     values ('s3_compatible', 'operational_evidence/documents/fixture-1', 'operational_evidence', 'fixture.pdf', 'application/pdf', 128, $1, 'confirmed')
     returning id`,
    [userId],
  );
  const fileId = file.rows[0]?.id;
  assertCondition(Boolean(fileId), "Failed to create file fixture.");

  let duplicateObjectKeyRejected = false;
  try {
    await pool.query(
      `insert into files
        (storage_provider, object_key, purpose, original_name, mime_type, size_bytes, owner_user_id)
       values ('s3_compatible', 'operational_evidence/documents/fixture-1', 'operational_evidence', 'duplicate.pdf', 'application/pdf', 64, $1)`,
      [userId],
    );
  } catch (error) {
    duplicateObjectKeyRejected = error?.code === "23505";
  }
  assertCondition(duplicateObjectKeyRejected, "Duplicate storage object keys must be rejected.");

  const resourceId = "20000000-0000-4000-8000-000000000001";
  await pool.query(
    `insert into file_links (file_id, resource_type, resource_id, purpose, created_by)
     values ($1, 'verification_case', $2, 'operational_evidence', $3)`,
    [fileId, resourceId, userId],
  );

  let duplicateLinkRejected = false;
  try {
    await pool.query(
      `insert into file_links (file_id, resource_type, resource_id, purpose, created_by)
       values ($1, 'verification_case', $2, 'operational_evidence', $3)`,
      [fileId, resourceId, userId],
    );
  } catch (error) {
    duplicateLinkRejected = error?.code === "23505";
  }
  assertCondition(duplicateLinkRejected, "Duplicate file/resource/purpose links must be rejected.");

  let invalidFilePurposeRejected = false;
  try {
    await pool.query(
      `insert into files
        (storage_provider, object_key, purpose, original_name, mime_type, size_bytes, owner_user_id)
       values ('s3_compatible', 'unexpected/purpose.pdf', 'unexpected', 'purpose.pdf', 'application/pdf', 64, $1)`,
      [userId],
    );
  } catch (error) {
    invalidFilePurposeRejected = error?.code === "23514";
  }
  assertCondition(invalidFilePurposeRejected, "Unsupported file purposes must be rejected by the database.");

  let invalidLinkPurposeRejected = false;
  try {
    await pool.query(
      `insert into file_links (file_id, resource_type, resource_id, purpose, created_by)
       values ($1, 'verification_case', $2, 'unexpected', $3)`,
      [fileId, "20000000-0000-4000-8000-000000000002", userId],
    );
  } catch (error) {
    invalidLinkPurposeRejected = error?.code === "23514";
  }
  assertCondition(invalidLinkPurposeRejected, "Unsupported file-link purposes must be rejected by the database.");

  let invalidActorTypeRejected = false;
  try {
    await pool.query(`
      insert into audit_logs (actor_type, action, resource_type, resource_id)
      values ('unknown_actor', 'module21.invalid_actor_fixture', 'fixture', 'invalid-actor')
    `);
  } catch (error) {
    invalidActorTypeRejected = error?.code === "23514";
  }
  assertCondition(invalidActorTypeRejected, "Unsupported audit actor types must be rejected by the database.");

  const audit = await pool.query(`
    insert into audit_logs (actor_type, action, resource_type, resource_id)
    values ('system', 'module21.append_only_fixture', 'fixture', 'append-only')
    returning id
  `);
  const auditId = audit.rows[0]?.id;
  assertCondition(Boolean(auditId), "Failed to create audit append-only fixture.");

  let updateRejected = false;
  try {
    await pool.query("update audit_logs set action = 'mutated' where id = $1", [auditId]);
  } catch (error) {
    updateRejected = String(error?.message ?? "").includes("append-only");
  }
  assertCondition(updateRejected, "audit_logs updates must be rejected by the database guard.");

  let deleteRejected = false;
  try {
    await pool.query("delete from audit_logs where id = $1", [auditId]);
  } catch (error) {
    deleteRejected = String(error?.message ?? "").includes("append-only");
  }
  assertCondition(deleteRejected, "audit_logs deletes must be rejected by the database guard.");
}

/** Verifies clean installation plus both supported Module 2 and Module 21 upgrade paths. */
async function main() {
  await resetSchema();
  await applyAllMigrations();
  await verifyFinalSchema();
  await verifyDatabaseGuards();
  await verifyModule2UpgradePath();
  await verifyModule21CoreUpgradePath();
  console.log("Module 21 migration verification passed.");
}

try {
  await main();
} finally {
  await pool.end();
}
