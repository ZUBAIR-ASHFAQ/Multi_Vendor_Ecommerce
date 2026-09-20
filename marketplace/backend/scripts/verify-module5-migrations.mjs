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
  "0007_seller_store_management.sql",
];
const module5Migration = "0008_catalog_taxonomy.sql";

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

/** Applies all previously supported migrations through Module 4. */
async function applyPrerequisiteMigrations() {
  for (const migration of prerequisiteMigrations) {
    await applyMigration(migration);
  }
}

/** Throws one focused verification error when a required database invariant is false. */
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

/** Returns the database definition for one public table column. */
async function getColumnDefinition(tableName, columnName) {
  const result = await pool.query(
    `select data_type, udt_name, is_nullable, column_default, character_maximum_length
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2`,
    [tableName, columnName],
  );

  return result.rows[0] ?? null;
}

/** Returns PostgreSQL's delete action code for one foreign-key constraint. */
async function getForeignKeyDeleteAction(constraintName) {
  const result = await pool.query(
    `select confdeltype
       from pg_constraint
      where conname = $1
        and contype = 'f'`,
    [constraintName],
  );

  return result.rows[0]?.confdeltype ?? null;
}

/** Verifies one column's type, nullability, length, and default contract. */
async function verifyColumnDefinition(tableName, columnName, expected) {
  const definition = await getColumnDefinition(tableName, columnName);
  assertCondition(Boolean(definition), `${tableName}.${columnName} is missing.`);

  if (expected.dataType) {
    assertCondition(
      definition.data_type === expected.dataType,
      `${tableName}.${columnName} has unexpected data type ${definition.data_type}.`,
    );
  }
  if (expected.udtName) {
    assertCondition(
      definition.udt_name === expected.udtName,
      `${tableName}.${columnName} has unexpected PostgreSQL type ${definition.udt_name}.`,
    );
  }
  if (expected.nullable !== undefined) {
    const actualNullable = definition.is_nullable === "YES";
    assertCondition(
      actualNullable === expected.nullable,
      `${tableName}.${columnName} nullability does not match the Drizzle contract.`,
    );
  }
  if (expected.maxLength !== undefined) {
    assertCondition(
      Number(definition.character_maximum_length) === expected.maxLength,
      `${tableName}.${columnName} has unexpected varchar length.`,
    );
  }
  if (expected.defaultIncludes !== undefined) {
    const actualDefault = definition.column_default ?? "";
    assertCondition(
      actualDefault.includes(expected.defaultIncludes),
      `${tableName}.${columnName} has unexpected default ${actualDefault || "<none>"}.`,
    );
  }
  if (expected.noDefault === true) {
    assertCondition(
      definition.column_default === null,
      `${tableName}.${columnName} must not have a database default.`,
    );
  }
}

/** Verifies the exact Module 5 column shapes expected by the committed Drizzle schema. */
async function verifyColumnDefinitions() {
  const definitions = {
    categories: {
      id: { dataType: "uuid", nullable: false, defaultIncludes: "gen_random_uuid" },
      parent_id: { dataType: "uuid", nullable: true, noDefault: true },
      slug: { dataType: "character varying", nullable: false, maxLength: 160, noDefault: true },
      name: { dataType: "character varying", nullable: false, maxLength: 200, noDefault: true },
      status: { dataType: "character varying", nullable: false, maxLength: 20, defaultIncludes: "active" },
      sort_order: { dataType: "integer", nullable: false, defaultIncludes: "0" },
    },
    brands: {
      id: { dataType: "uuid", nullable: false, defaultIncludes: "gen_random_uuid" },
      slug: { dataType: "character varying", nullable: false, maxLength: 160, noDefault: true },
      name: { dataType: "character varying", nullable: false, maxLength: 200, noDefault: true },
      status: { dataType: "character varying", nullable: false, maxLength: 20, defaultIncludes: "active" },
    },
    attributes: {
      id: { dataType: "uuid", nullable: false, defaultIncludes: "gen_random_uuid" },
      code: { dataType: "character varying", nullable: false, maxLength: 120, noDefault: true },
      name: { dataType: "character varying", nullable: false, maxLength: 200, noDefault: true },
      data_type: { dataType: "character varying", nullable: false, maxLength: 40, noDefault: true },
      is_variant_axis: { dataType: "boolean", nullable: false, defaultIncludes: "false" },
      status: { dataType: "character varying", nullable: false, maxLength: 20, defaultIncludes: "active" },
    },
    attribute_values: {
      id: { dataType: "uuid", nullable: false, defaultIncludes: "gen_random_uuid" },
      attribute_id: { dataType: "uuid", nullable: false, noDefault: true },
      value: { dataType: "character varying", nullable: false, maxLength: 240, noDefault: true },
      sort_order: { dataType: "integer", nullable: false, defaultIncludes: "0" },
      status: { dataType: "character varying", nullable: false, maxLength: 20, defaultIncludes: "active" },
    },
    category_attributes: {
      category_id: { dataType: "uuid", nullable: false, noDefault: true },
      attribute_id: { dataType: "uuid", nullable: false, noDefault: true },
      is_required: { dataType: "boolean", nullable: false, defaultIncludes: "false" },
      is_filterable: { dataType: "boolean", nullable: false, defaultIncludes: "false" },
      sort_order: { dataType: "integer", nullable: false, defaultIncludes: "0" },
    },
  };

  for (const [tableName, columns] of Object.entries(definitions)) {
    for (const [columnName, expected] of Object.entries(columns)) {
      await verifyColumnDefinition(tableName, columnName, expected);
    }
  }
}

/** Verifies taxonomy foreign keys preserve referenced history instead of cascading deletes. */
async function verifyForeignKeyDeleteRules() {
  for (const constraintName of [
    "categories_parent_id_categories_id_fk",
    "attribute_values_attribute_id_attributes_id_fk",
    "category_attributes_category_id_categories_id_fk",
    "category_attributes_attribute_id_attributes_id_fk",
  ]) {
    assertCondition(
      (await getForeignKeyDeleteAction(constraintName)) === "r",
      `${constraintName} must use ON DELETE RESTRICT.`,
    );
  }
}

/** Verifies all Module 5 tables, columns, indexes, and database constraints exist. */
async function verifyFinalSchema() {
  for (const tableName of [
    "categories",
    "brands",
    "attributes",
    "attribute_values",
    "category_attributes",
  ]) {
    assertCondition(await tableExists(tableName), `${tableName} table is missing.`);
  }

  for (const [tableName, columns] of Object.entries({
    categories: ["id", "parent_id", "slug", "name", "status", "sort_order"],
    brands: ["id", "slug", "name", "status"],
    attributes: ["id", "code", "name", "data_type", "is_variant_axis", "status"],
    attribute_values: ["id", "attribute_id", "value", "sort_order", "status"],
    category_attributes: [
      "category_id",
      "attribute_id",
      "is_required",
      "is_filterable",
      "sort_order",
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
    "categories_slug_uq",
    "categories_parent_status_sort_idx",
    "brands_slug_uq",
    "brands_status_name_idx",
    "attributes_code_uq",
    "attributes_status_name_idx",
    "attribute_values_attribute_status_sort_idx",
    "category_attributes_attribute_idx",
  ]) {
    assertCondition(await indexExists(indexName), `${indexName} is missing.`);
  }

  for (const [tableName, constraintName] of [
    ["categories", "categories_pkey"],
    ["brands", "brands_pkey"],
    ["attributes", "attributes_pkey"],
    ["attribute_values", "attribute_values_pkey"],
    ["categories", "categories_parent_id_categories_id_fk"],
    ["categories", "categories_status_check"],
    ["categories", "categories_slug_normalized_check"],
    ["categories", "categories_name_not_blank_check"],
    ["categories", "categories_not_own_parent_check"],
    ["categories", "categories_sort_order_check"],
    ["brands", "brands_status_check"],
    ["brands", "brands_slug_normalized_check"],
    ["brands", "brands_name_not_blank_check"],
    ["attributes", "attributes_status_check"],
    ["attributes", "attributes_code_normalized_check"],
    ["attributes", "attributes_name_not_blank_check"],
    ["attributes", "attributes_data_type_not_blank_check"],
    ["attribute_values", "attribute_values_attribute_id_attributes_id_fk"],
    ["attribute_values", "attribute_values_status_check"],
    ["attribute_values", "attribute_values_value_not_blank_check"],
    ["attribute_values", "attribute_values_sort_order_check"],
    ["category_attributes", "category_attributes_pk"],
    ["category_attributes", "category_attributes_category_id_categories_id_fk"],
    ["category_attributes", "category_attributes_attribute_id_attributes_id_fk"],
    ["category_attributes", "category_attributes_sort_order_check"],
  ]) {
    assertCondition(
      await constraintExists(tableName, constraintName),
      `${tableName}.${constraintName} is missing.`,
    );
  }

  await verifyColumnDefinitions();
  await verifyForeignKeyDeleteRules();
}

/** Seeds one existing Module 4 seller/store row before the Module 5 upgrade. */
async function seedModule4BusinessData() {
  const ownerUserId = randomUUID();
  const sellerId = randomUUID();
  const storeId = randomUUID();

  await pool.query(
    `insert into users (id, email, password_hash, display_name, account_type, status)
     values ($1, 'module5-upgrade-owner@example.test', 'not-a-real-password-hash', 'Module 5 Upgrade Owner', 'seller', 'active')`,
    [ownerUserId],
  );
  await pool.query(
    `insert into sellers
      (id, owner_user_id, legal_name, display_name, status, approval_status, approved_at)
     values ($1, $2, 'Existing Seller LLC', 'Existing Seller', 'active', 'approved', now())`,
    [sellerId, ownerUserId],
  );
  await pool.query(
    `insert into stores
      (id, seller_id, slug, name, status, default_currency)
     values ($1, $2, 'existing-store', 'Existing Store', 'active', 'USD')`,
    [storeId, sellerId],
  );

  return { ownerUserId, sellerId, storeId };
}

/** Verifies Module 5 upgrades the supported Module 4 schema without rewriting seller/store data. */
async function verifyModule4UpgradePath() {
  await resetSchema();
  await applyPrerequisiteMigrations();
  const fixture = await seedModule4BusinessData();

  await applyMigration(module5Migration);
  await verifyFinalSchema();

  const preserved = await pool.query(
    `select s.display_name as seller_name, st.name as store_name, st.default_currency
       from sellers s
       join stores st on st.seller_id = s.id
      where s.id = $1 and st.id = $2`,
    [fixture.sellerId, fixture.storeId],
  );
  assertCondition(preserved.rowCount === 1, "Existing Module 4 seller/store data was not preserved.");
  assertCondition(
    preserved.rows[0]?.seller_name === "Existing Seller" &&
      preserved.rows[0]?.store_name === "Existing Store" &&
      preserved.rows[0]?.default_currency === "USD",
    "Module 5 migration changed existing Module 4 seller/store data.",
  );
}

/** Verifies the row-local guards that belong in the Module 5 database layer. */
async function verifyDatabaseGuards() {
  const category = await pool.query(
    `insert into categories (slug, name, sort_order)
     values ('electronics', 'Electronics', 0)
     returning id`,
  );
  const categoryId = category.rows[0]?.id;
  assertCondition(Boolean(categoryId), "Failed to create the Module 5 category fixture.");

  let duplicateCategorySlugRejected = false;
  try {
    await pool.query(
      `insert into categories (slug, name) values ('electronics', 'Duplicate Electronics')`,
    );
  } catch (error) {
    duplicateCategorySlugRejected = error?.code === "23505";
  }
  assertCondition(duplicateCategorySlugRejected, "Category slugs must be unique.");

  let nonNormalizedCategorySlugRejected = false;
  try {
    await pool.query(`insert into categories (slug, name) values ('Phones', 'Phones')`);
  } catch (error) {
    nonNormalizedCategorySlugRejected = error?.code === "23514";
  }
  assertCondition(
    nonNormalizedCategorySlugRejected,
    "Category slugs must be stored in normalized lowercase form.",
  );

  let ownParentRejected = false;
  try {
    await pool.query(`update categories set parent_id = id where id = $1`, [categoryId]);
  } catch (error) {
    ownParentRejected = error?.code === "23514";
  }
  assertCondition(ownParentRejected, "A category must not be its own direct parent.");

  let invalidCategoryStatusRejected = false;
  try {
    await pool.query(`update categories set status = 'deleted' where id = $1`, [categoryId]);
  } catch (error) {
    invalidCategoryStatusRejected = error?.code === "23514";
  }
  assertCondition(invalidCategoryStatusRejected, "Category status must be active or inactive.");

  await pool.query(`insert into brands (slug, name) values ('acme', 'Acme')`);
  let duplicateBrandSlugRejected = false;
  try {
    await pool.query(`insert into brands (slug, name) values ('acme', 'Acme Duplicate')`);
  } catch (error) {
    duplicateBrandSlugRejected = error?.code === "23505";
  }
  assertCondition(duplicateBrandSlugRejected, "Brand slugs must be unique.");

  const attribute = await pool.query(
    `insert into attributes (code, name, data_type, is_variant_axis)
     values ('color', 'Color', 'text', true)
     returning id`,
  );
  const attributeId = attribute.rows[0]?.id;
  assertCondition(Boolean(attributeId), "Failed to create the Module 5 attribute fixture.");

  let duplicateAttributeCodeRejected = false;
  try {
    await pool.query(
      `insert into attributes (code, name, data_type) values ('color', 'Duplicate Color', 'text')`,
    );
  } catch (error) {
    duplicateAttributeCodeRejected = error?.code === "23505";
  }
  assertCondition(duplicateAttributeCodeRejected, "Attribute codes must be unique.");

  let unknownAttributeValueRejected = false;
  try {
    await pool.query(
      `insert into attribute_values (attribute_id, value) values ($1, 'Blue')`,
      [randomUUID()],
    );
  } catch (error) {
    unknownAttributeValueRejected = error?.code === "23503";
  }
  assertCondition(
    unknownAttributeValueRejected,
    "Attribute values must reference an existing attribute.",
  );

  await pool.query(
    `insert into attribute_values (attribute_id, value, sort_order)
     values ($1, 'Blue', 0)`,
    [attributeId],
  );
  await pool.query(
    `insert into category_attributes
      (category_id, attribute_id, is_required, is_filterable, sort_order)
     values ($1, $2, true, true, 0)`,
    [categoryId, attributeId],
  );

  let duplicateMappingRejected = false;
  try {
    await pool.query(
      `insert into category_attributes (category_id, attribute_id)
       values ($1, $2)`,
      [categoryId, attributeId],
    );
  } catch (error) {
    duplicateMappingRejected = error?.code === "23505";
  }
  assertCondition(
    duplicateMappingRejected,
    "A category must not contain the same attribute mapping twice.",
  );

  let referencedCategoryDeleteRejected = false;
  try {
    await pool.query(`delete from categories where id = $1`, [categoryId]);
  } catch (error) {
    referencedCategoryDeleteRejected = error?.code === "23503";
  }
  assertCondition(
    referencedCategoryDeleteRejected,
    "Referenced taxonomy must be preserved instead of hard-deleted.",
  );
}

/** Runs clean-schema, supported-upgrade, and database-guard verification for Module 5. */
async function main() {
  try {
    await resetSchema();
    await applyPrerequisiteMigrations();
    await applyMigration(module5Migration);
    await verifyFinalSchema();
    await verifyDatabaseGuards();
    await verifyModule4UpgradePath();
    console.log("Module 5 migration verification completed successfully.");
  } finally {
    await pool.end();
  }
}

await main();
