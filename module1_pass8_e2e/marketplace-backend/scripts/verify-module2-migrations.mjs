import { createHash } from "node:crypto";
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
  "0015_remove_unused_password_reset_tokens.sql",
  "0016_refresh_session_contract_alignment.sql",
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

/** Applies all migrations in the supported order. */
async function applyAllMigrations() {
  for (const migration of migrationFiles) {
    await applyMigration(migration);
  }
}

/** Returns whether one database column exists in the public schema. */
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

/** Throws one focused verification error when an expected database invariant is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Verifies the final Module 2 schema fields and the intentional absence of a premature sellers foreign key. */
async function verifyFinalSchema() {
  assertCondition(await columnExists("users", "account_type"), "users.account_type is missing.");
  assertCondition(await columnExists("roles", "scope_type"), "roles.scope_type is missing.");
  assertCondition(await columnExists("user_roles", "seller_id"), "user_roles.seller_id is missing.");
  assertCondition(
    await columnExists("refresh_sessions", "user_agent_hash"),
    "refresh_sessions.user_agent_hash is missing.",
  );
  assertCondition(
    !(await columnExists("refresh_sessions", "user_agent")),
    "Legacy refresh_sessions.user_agent must not remain.",
  );
  assertCondition(
    await columnExists("refresh_sessions", "token_family_hash"),
    "refresh_sessions.token_family_hash is missing.",
  );
  assertCondition(
    !(await columnExists("refresh_sessions", "family_id")),
    "Legacy refresh_sessions.family_id must not remain.",
  );

  const legacySessionTable = await pool.query(
    "select to_regclass('public.auth_sessions') as table_name",
  );
  assertCondition(
    legacySessionTable.rows[0]?.table_name === null,
    "Legacy auth_sessions table must not remain after contract alignment.",
  );

  const settingsTable = await pool.query(
    "select to_regclass('public.platform_settings') as table_name",
  );
  assertCondition(
    settingsTable.rows[0]?.table_name === "platform_settings",
    "platform_settings table is missing.",
  );

  const sellerForeignKeys = await pool.query(`
    select count(*)::int as count
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.constraint_schema = tc.constraint_schema
     where tc.table_schema = 'public'
       and tc.table_name = 'user_roles'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name = 'seller_id'
  `);
  assertCondition(
    sellerForeignKeys.rows[0]?.count === 0,
    "user_roles.seller_id must not reference sellers before Module 4 exists.",
  );

  const passwordResetTable = await pool.query(
    "select to_regclass('public.password_reset_tokens') as table_name",
  );
  assertCondition(
    passwordResetTable.rows[0]?.table_name === null,
    "Unused password_reset_tokens persistence must not remain in the current Module 2 schema.",
  );
}

/** Inserts representative rows from the previously supported Module 2 schema. */
async function seedPreviousSchemaFixture() {
  const userResult = await pool.query(`
    insert into users (email, password_hash, display_name, status)
    values ('upgrade.admin@example.test', 'not-a-real-password-hash', 'Upgrade Admin', 'active')
    returning id
  `);
  const userId = userResult.rows[0].id;

  const roleResult = await pool.query(`
    insert into roles (code, name, is_system, status)
    values ('upgrade_admin', 'Upgrade Admin', true, 'active')
    returning id
  `);
  const roleId = roleResult.rows[0].id;

  await pool.query(
    "insert into user_roles (user_id, role_id, assigned_by) values ($1, $2, $1)",
    [userId, roleId],
  );

  const rawUserAgent = "Module2-Upgrade-Fixture/1.0";
  const familyId = "20000000-0000-4000-8000-000000000001";
  await pool.query(
    `insert into auth_sessions
      (user_id, refresh_token_hash, family_id, expires_at, user_agent)
     values ($1, $2, $3, now() + interval '1 day', $4)`,
    [userId, "a".repeat(64), familyId, rawUserAgent],
  );

  return { userId, roleId, rawUserAgent, familyId };
}

/** Verifies a database on the previous Module 2 schema upgrades without losing required semantics. */
async function verifyUpgradePath() {
  await resetSchema();
  await applyMigration("0000_foundation.sql");
  await applyMigration("0001_administration_auth_rbac.sql");
  const fixture = await seedPreviousSchemaFixture();

  await applyMigration("0002_module2_remediation_persistence.sql");
  await applyMigration("0003_module2_role_assignment_identity.sql");
  await applyMigration("0015_remove_unused_password_reset_tokens.sql");
  await applyMigration("0016_refresh_session_contract_alignment.sql");
  await verifyFinalSchema();

  const user = await pool.query("select account_type from users where id = $1", [fixture.userId]);
  assertCondition(
    user.rows[0]?.account_type === "platform_admin",
    "Existing Module 2 users must retain platform administrator semantics during upgrade.",
  );

  const role = await pool.query("select scope_type from roles where id = $1", [fixture.roleId]);
  assertCondition(
    role.rows[0]?.scope_type === "platform",
    "Existing Module 2 roles must retain platform scope during upgrade.",
  );

  const session = await pool.query(
    "select user_agent_hash, token_family_hash from refresh_sessions where user_id = $1",
    [fixture.userId],
  );
  const expectedHash = createHash("sha256")
    .update(fixture.rawUserAgent, "utf8")
    .digest("hex");
  assertCondition(
    session.rows[0]?.user_agent_hash === expectedHash,
    "Existing raw user-agent metadata must be converted to its SHA-256 hash.",
  );
  const expectedFamilyHash = createHash("sha256")
    .update(fixture.familyId, "utf8")
    .digest("hex");
  assertCondition(
    session.rows[0]?.token_family_hash === expectedFamilyHash,
    "Legacy refresh-session family identity must upgrade to its SHA-256 family hash.",
  );
}

/** Verifies seller-scoped role identity supports different sellers while rejecting duplicate scope rows. */
async function verifySellerAwareRoleIdentity() {
  const userResult = await pool.query(`
    insert into users (email, password_hash, display_name, account_type, status)
    values ('seller.user@example.test', 'not-a-real-password-hash', 'Seller User', 'seller', 'active')
    returning id
  `);
  const roleResult = await pool.query(`
    insert into roles (code, name, scope_type, is_system, status)
    values ('seller_manager_final', 'Seller Manager', 'seller', false, 'active')
    returning id
  `);
  const sellerA = "10000000-0000-4000-8000-000000000001";
  const sellerB = "10000000-0000-4000-8000-000000000002";

  await pool.query(
    "insert into user_roles (user_id, role_id, seller_id) values ($1, $2, $3), ($1, $2, $4)",
    [userResult.rows[0].id, roleResult.rows[0].id, sellerA, sellerB],
  );

  let duplicateRejected = false;
  try {
    await pool.query(
      "insert into user_roles (user_id, role_id, seller_id) values ($1, $2, $3)",
      [userResult.rows[0].id, roleResult.rows[0].id, sellerA],
    );
  } catch (error) {
    duplicateRejected = error?.code === "23505";
  }
  assertCondition(
    duplicateRejected,
    "Duplicate user + role + seller assignments must be rejected.",
  );
}

/** Verifies both clean installation and supported-schema upgrade paths. */
async function main() {
  await resetSchema();
  await applyAllMigrations();
  await verifyFinalSchema();
  await verifySellerAwareRoleIdentity();
  await verifyUpgradePath();
  console.log("Module 2 migration verification passed.");
}

try {
  await main();
} finally {
  await pool.end();
}
