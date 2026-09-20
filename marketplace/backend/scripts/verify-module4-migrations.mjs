import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const migrationsDirectory = path.resolve("drizzle");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const prerequisiteMigrations = [
  "0000_foundation.sql",
  "0001_administration_auth_rbac.sql",
  "0002_module2_remediation_persistence.sql",
  "0003_module2_role_assignment_identity.sql",
  "0004_documents_audit_core.sql",
  "0005_documents_audit_integrity.sql",
  "0006_customer_management.sql",
];
const module4Migration = "0007_seller_store_management.sql";

/** Resets only the disposable public schema used by destructive migration verification. */
async function resetSchema() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Applies one committed SQL migration exactly as stored in append-only history. */
async function applyMigration(name) {
  const sqlText = await readFile(path.join(migrationsDirectory, name), "utf8");
  await pool.query(sqlText);
}

/** Applies all previously supported migrations through Module 3. */
async function applyPrerequisiteMigrations() {
  for (const migration of prerequisiteMigrations) {
    await applyMigration(migration);
  }
}

/** Throws one focused verification error when a required schema invariant is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one public table exists. */
async function tableExists(tableName) {
  const result = await pool.query("select to_regclass($1) as table_name", [
    `public.${tableName}`,
  ]);
  return result.rows[0]?.table_name === tableName;
}

/** Returns whether one column exists on one public table. */
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

/** Returns whether one named public index exists. */
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

/** Returns whether one named table constraint exists. */
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

/** Verifies the final Module 4 seller/store database contract. */
async function verifyFinalSchema() {
  for (const tableName of ["seller_applications", "sellers", "stores", "seller_staff"]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const [tableName, columns] of Object.entries({
    seller_applications: [
      "id",
      "applicant_user_id",
      "payload_json",
      "status",
      "reviewed_by",
      "reviewed_at",
      "reason",
      "created_at",
      "updated_at",
    ],
    sellers: [
      "id",
      "owner_user_id",
      "legal_name",
      "display_name",
      "tax_id",
      "status",
      "approval_status",
      "approved_at",
      "created_at",
      "updated_at",
    ],
    stores: [
      "id",
      "seller_id",
      "slug",
      "name",
      "description",
      "logo_file_id",
      "status",
      "default_currency",
      "support_email",
      "created_at",
      "updated_at",
    ],
    seller_staff: [
      "id",
      "seller_id",
      "user_id",
      "status",
      "joined_at",
      "updated_at",
    ],
  })) {
    for (const column of columns) {
      assertCondition(
        await columnExists(tableName, column),
        `${tableName}.${column} is missing.`,
      );
    }
  }

  for (const indexName of [
    "seller_applications_open_applicant_uq",
    "seller_applications_status_created_idx",
    "seller_applications_applicant_created_idx",
    "seller_applications_reviewer_idx",
    "sellers_owner_user_uq",
    "sellers_status_approval_idx",
    "stores_slug_uq",
    "stores_seller_status_idx",
    "stores_logo_file_idx",
    "seller_staff_seller_user_uq",
    "seller_staff_user_status_idx",
    "seller_staff_seller_status_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["seller_applications", "seller_applications_applicant_user_id_users_id_fk"],
    ["seller_applications", "seller_applications_reviewed_by_users_id_fk"],
    ["seller_applications", "seller_applications_status_check"],
    ["seller_applications", "seller_applications_payload_object_check"],
    ["seller_applications", "seller_applications_review_state_check"],
    ["sellers", "sellers_owner_user_id_users_id_fk"],
    ["sellers", "sellers_status_check"],
    ["sellers", "sellers_approval_status_check"],
    ["sellers", "sellers_legal_name_not_blank_check"],
    ["sellers", "sellers_display_name_not_blank_check"],
    ["sellers", "sellers_tax_id_not_blank_check"],
    ["stores", "stores_seller_id_sellers_id_fk"],
    ["stores", "stores_logo_file_id_files_id_fk"],
    ["stores", "stores_status_check"],
    ["stores", "stores_slug_normalized_check"],
    ["stores", "stores_name_not_blank_check"],
    ["stores", "stores_description_not_blank_check"],
    ["stores", "stores_currency_check"],
    ["stores", "stores_support_email_normalized_check"],
    ["seller_staff", "seller_staff_seller_id_sellers_id_fk"],
    ["seller_staff", "seller_staff_user_id_users_id_fk"],
    ["seller_staff", "seller_staff_status_check"],
    ["user_roles", "user_roles_seller_id_sellers_id_fk"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const filePurpose = await pool.query(
    `select pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conname = 'files_purpose_check'`,
  );
  const linkPurpose = await pool.query(
    `select pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conname = 'file_links_purpose_check'`,
  );
  assertCondition(
    String(filePurpose.rows[0]?.definition ?? "").includes("store_asset"),
    "files_purpose_check must allow store_asset.",
  );
  assertCondition(
    String(linkPurpose.rows[0]?.definition ?? "").includes("store_asset"),
    "file_links_purpose_check must allow store_asset.",
  );
}

/** Verifies Module 4 upgrades an existing Module 3 customer without rewriting prerequisite data. */
async function verifyModule3UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();

  const userId = randomUUID();
  await pool.query(
    `insert into users (id, email, password_hash, display_name, account_type, status)
     values ($1, 'module4-upgrade@example.test', 'not-a-real-password-hash', 'Upgrade Customer', 'customer', 'active')`,
    [userId],
  );
  await pool.query(
    `insert into customer_profiles (user_id, display_name, status)
     values ($1, 'Upgrade Customer', 'active')`,
    [userId],
  );

  await applyMigration(module4Migration);
  await verifyFinalSchema();

  const preserved = await pool.query(
    `select u.account_type, cp.display_name
       from users u
       join customer_profiles cp on cp.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  assertCondition(preserved.rowCount === 1, "Module 3 customer data was not preserved.");
  assertCondition(
    preserved.rows[0]?.account_type === "customer" &&
      preserved.rows[0]?.display_name === "Upgrade Customer",
    "Module 4 migration changed existing customer identity/profile data.",
  );
}

/** Verifies placeholder pre-Module-4 seller scopes fail closed instead of receiving a fake seller FK. */
async function verifyPlaceholderSellerScopeGuard() {
  await resetSchema();
  await applyPrerequisiteMigrations();

  const userId = randomUUID();
  const roleId = randomUUID();
  await pool.query(
    `insert into users (id, email, password_hash, display_name, account_type, status)
     values ($1, 'module4-placeholder@example.test', 'not-a-real-password-hash', 'Placeholder Seller', 'seller', 'active')`,
    [userId],
  );
  await pool.query(
    `insert into roles (id, code, name, scope_type, is_system, status)
     values ($1, 'placeholder_seller_role', 'Placeholder Seller Role', 'seller', false, 'active')`,
    [roleId],
  );
  await pool.query(
    `insert into user_roles (user_id, role_id, seller_id)
     values ($1, $2, $3)`,
    [userId, roleId, randomUUID()],
  );

  let rejected = false;
  try {
    await applyMigration(module4Migration);
  } catch (error) {
    rejected = String(error).includes("pre-Module-4 seller scopes");
  }
  assertCondition(
    rejected,
    "Module 4 migration must reject placeholder user_roles.seller_id values.",
  );
}

/** Runs clean-schema, supported-upgrade and placeholder-scope migration verification. */
async function main() {
  try {
    await resetSchema();
    await applyPrerequisiteMigrations();
    await applyMigration(module4Migration);
    await verifyFinalSchema();
    await verifyModule3UpgradePath();
    await verifyPlaceholderSellerScopeGuard();
    console.log("Module 4 migration verification completed successfully.");
  } finally {
    await pool.end();
  }
}

await main();
