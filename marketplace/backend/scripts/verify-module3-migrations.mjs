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
  "0006_customer_management.sql",
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

/** Applies the complete supported migration history through Module 3. */
async function applyAllMigrations() {
  for (const migration of migrationFiles) {
    await applyMigration(migration);
  }
}

/** Throws a focused verification error when one required database invariant is false. */
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

/** Verifies the final Module 3 customer/profile and address schema contract. */
async function verifyFinalSchema() {
  assertCondition(await tableExists("customer_profiles"), "customer_profiles table is missing.");
  assertCondition(await tableExists("customer_addresses"), "customer_addresses table is missing.");

  for (const column of [
    "user_id",
    "display_name",
    "phone",
    "status",
    "marketing_opt_in",
    "created_at",
    "updated_at",
  ]) {
    assertCondition(
      await columnExists("customer_profiles", column),
      `customer_profiles.${column} is missing.`,
    );
  }

  for (const column of [
    "id",
    "customer_user_id",
    "label",
    "recipient_name",
    "phone",
    "line1",
    "line2",
    "city",
    "region",
    "postal_code",
    "country_code",
    "is_default_shipping",
    "is_default_billing",
    "status",
    "created_at",
    "updated_at",
  ]) {
    assertCondition(
      await columnExists("customer_addresses", column),
      `customer_addresses.${column} is missing.`,
    );
  }

  for (const indexName of [
    "customer_profiles_status_created_idx",
    "customer_addresses_customer_status_idx",
    "customer_addresses_default_shipping_uq",
    "customer_addresses_default_billing_uq",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["customer_profiles", "customer_profiles_user_id_users_id_fk"],
    ["customer_profiles", "customer_profiles_status_check"],
    ["customer_profiles", "customer_profiles_display_name_not_blank_check"],
    [
      "customer_addresses",
      "customer_addresses_customer_profile_fk",
    ],
    ["customer_addresses", "customer_addresses_status_check"],
    ["customer_addresses", "customer_addresses_archived_defaults_check"],
    ["customer_addresses", "customer_addresses_country_code_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  const profilePrimaryKey = await pool.query(`
    select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.constraint_schema = tc.constraint_schema
     where tc.table_schema = 'public'
       and tc.table_name = 'customer_profiles'
       and tc.constraint_type = 'PRIMARY KEY'
  `);
  assertCondition(
    profilePrimaryKey.rows.length === 1 && profilePrimaryKey.rows[0]?.column_name === "user_id",
    "customer_profiles.user_id must be the one-to-one primary key.",
  );
}

/** Seeds the previously-supported 0005 schema with identities that exercise the customer backfill. */
async function seedPreviousSchemaUsers() {
  const result = await pool.query(`
    insert into users (email, password_hash, display_name, account_type, status)
    values
      ('module3.customer.active@example.test', 'not-a-real-password-hash', 'Active Customer', 'customer', 'active'),
      ('module3.customer.pending@example.test', 'not-a-real-password-hash', 'Pending Customer', 'customer', 'pending'),
      ('module3.admin@example.test', 'not-a-real-password-hash', 'Platform Admin', 'platform_admin', 'active'),
      ('module3.seller@example.test', 'not-a-real-password-hash', 'Seller User', 'seller', 'active')
    returning id, email, account_type
  `);
  return result.rows;
}

/** Verifies that upgrading from 0005 backfills only existing customer identities exactly once. */
async function verifyModule21UpgradePath() {
  await resetSchema();
  for (const migration of migrationFiles.slice(0, 6)) {
    await applyMigration(migration);
  }
  const users = await seedPreviousSchemaUsers();
  await applyMigration("0006_customer_management.sql");
  await verifyFinalSchema();

  const profiles = await pool.query(`
    select cp.user_id, cp.display_name, cp.status, cp.marketing_opt_in, u.email, u.account_type
      from customer_profiles cp
      join users u on u.id = cp.user_id
     order by u.email
  `);

  const expectedCustomerIds = new Set(
    users.filter((user) => user.account_type === "customer").map((user) => user.id),
  );
  assertCondition(
    profiles.rowCount === expectedCustomerIds.size,
    "0006 must backfill exactly one profile for each existing customer identity.",
  );
  for (const row of profiles.rows) {
    assertCondition(
      expectedCustomerIds.has(row.user_id),
      "0006 created a customer profile for a non-customer identity.",
    );
    assertCondition(row.status === "active", "Backfilled customer profiles must start active.");
    assertCondition(
      row.marketing_opt_in === false,
      "Backfilled customer profiles must not opt customers into marketing.",
    );
  }
}

/** Inserts one active saved address for database-constraint verification. */
async function insertAddress(customerUserId, overrides = {}) {
  const values = {
    label: "Home",
    recipientName: "Customer Fixture",
    phone: "+15550101010",
    line1: "1 Test Street",
    line2: null,
    city: "Test City",
    region: "Test Region",
    postalCode: "10001",
    countryCode: "US",
    isDefaultShipping: false,
    isDefaultBilling: false,
    status: "active",
    ...overrides,
  };

  return pool.query(
    `insert into customer_addresses
      (customer_user_id, label, recipient_name, phone, line1, line2, city, region,
       postal_code, country_code, is_default_shipping, is_default_billing, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      customerUserId,
      values.label,
      values.recipientName,
      values.phone,
      values.line1,
      values.line2,
      values.city,
      values.region,
      values.postalCode,
      values.countryCode,
      values.isDefaultShipping,
      values.isDefaultBilling,
      values.status,
    ],
  );
}

/** Verifies history-preserving foreign keys, archive guards, default uniqueness, and normalized country storage. */
async function verifyDatabaseGuards() {
  const user = await pool.query(`
    insert into users (email, password_hash, display_name, account_type, status)
    values ('module3.database.guard@example.test', 'not-a-real-password-hash', 'Database Guard', 'customer', 'active')
    returning id
  `);
  const userId = user.rows[0]?.id;
  assertCondition(Boolean(userId), "Failed to create the Module 3 database-guard user.");

  await pool.query(
    `insert into customer_profiles (user_id, display_name)
     values ($1, 'Database Guard')`,
    [userId],
  );

  let duplicateProfileRejected = false;
  try {
    await pool.query(
      `insert into customer_profiles (user_id, display_name)
       values ($1, 'Duplicate Profile')`,
      [userId],
    );
  } catch (error) {
    duplicateProfileRejected = error?.code === "23505";
  }
  assertCondition(duplicateProfileRejected, "A user must not receive more than one customer profile.");

  await insertAddress(userId, { isDefaultShipping: true, isDefaultBilling: true });

  let secondShippingDefaultRejected = false;
  try {
    await insertAddress(userId, { label: "Work", isDefaultShipping: true });
  } catch (error) {
    secondShippingDefaultRejected = error?.code === "23505";
  }
  assertCondition(
    secondShippingDefaultRejected,
    "A customer must not have two active default shipping addresses.",
  );

  let secondBillingDefaultRejected = false;
  try {
    await insertAddress(userId, { label: "Office", isDefaultBilling: true });
  } catch (error) {
    secondBillingDefaultRejected = error?.code === "23505";
  }
  assertCondition(
    secondBillingDefaultRejected,
    "A customer must not have two active default billing addresses.",
  );

  let archivedDefaultRejected = false;
  try {
    await insertAddress(userId, {
      label: "Archived",
      status: "archived",
      isDefaultShipping: true,
    });
  } catch (error) {
    archivedDefaultRejected = error?.code === "23514";
  }
  assertCondition(archivedDefaultRejected, "Archived addresses must not remain default addresses.");

  let lowercaseCountryRejected = false;
  try {
    await insertAddress(userId, { label: "Lowercase Country", countryCode: "us" });
  } catch (error) {
    lowercaseCountryRejected = error?.code === "23514";
  }
  assertCondition(lowercaseCountryRejected, "Country codes must be stored as normalized uppercase codes.");

  let userDeleteRejected = false;
  try {
    await pool.query("delete from users where id = $1", [userId]);
  } catch (error) {
    userDeleteRejected = error?.code === "23503";
  }
  assertCondition(
    userDeleteRejected,
    "Deleting a user must not cascade-delete persisted customer history.",
  );

  let profileDeleteRejected = false;
  try {
    await pool.query("delete from customer_profiles where user_id = $1", [userId]);
  } catch (error) {
    profileDeleteRejected = error?.code === "23503";
  }
  assertCondition(
    profileDeleteRejected,
    "Deleting a customer profile must not cascade-delete saved address history.",
  );
}

/** Verifies clean installation and the supported upgrade from the final Module 21 schema. */
async function main() {
  await resetSchema();
  await applyAllMigrations();
  await verifyFinalSchema();
  await verifyDatabaseGuards();
  await verifyModule21UpgradePath();
  console.log("Module 3 migration verification passed.");
}

try {
  await main();
} finally {
  await pool.end();
}
