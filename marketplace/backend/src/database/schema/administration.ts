import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sellers } from "./sellers.js";

/**
 * Platform user identity used by Administration/Auth. Seller/customer domain profiles are introduced by later modules.
 * Email is required to be persisted in normalized lowercase/trimmed form so uniqueness is deterministic.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    accountType: varchar("account_type", { length: 30 }).notNull().default("customer"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    passwordChangedAt: timestamp("password_changed_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_uq").on(table.email),
    index("users_status_locked_idx").on(table.status, table.lockedUntil),
    index("users_account_type_status_idx").on(table.accountType, table.status),
    check(
      "users_account_type_check",
      sql`${table.accountType} in ('platform_admin', 'seller', 'customer')`,
    ),
    check(
      "users_status_check",
      sql`${table.status} in ('active', 'inactive', 'locked', 'pending')`,
    ),
    check(
      "users_failed_login_attempts_check",
      sql`${table.failedLoginAttempts} >= 0`,
    ),
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email})) and length(${table.email}) between 3 and 320`,
    ),
    check(
      "users_display_name_not_blank_check",
      sql`length(btrim(${table.displayName})) > 0`,
    ),
  ],
);

/** Stable RBAC role master. System roles cannot be treated like ordinary user-created roles. */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 100 }).notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    description: text("description"),
    scopeType: varchar("scope_type", { length: 30 }).notNull().default("platform"),
    isSystem: boolean("is_system").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("roles_code_uq").on(table.code),
    index("roles_status_system_idx").on(table.status, table.isSystem),
    index("roles_scope_status_idx").on(table.scopeType, table.status),
    check(
      "roles_scope_type_check",
      sql`${table.scopeType} in ('platform', 'seller', 'customer')`,
    ),
    check("roles_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "roles_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check("roles_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
  ],
);

/** Permission catalog. Permission codes are application-controlled and follow domain.resource.action semantics. */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 100 }).notNull(),
    domain: varchar("domain", { length: 50 }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("permissions_code_uq").on(table.code),
    index("permissions_domain_idx").on(table.domain, table.code),
    check(
      "permissions_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`,
    ),
    check(
      "permissions_domain_normalized_check",
      sql`${table.domain} = lower(btrim(${table.domain})) and ${table.domain} ~ '^[a-z][a-z0-9_]*$'`,
    ),
  ],
);

/** Many-to-many mapping from roles to permissions. */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "role_permissions_pk",
      columns: [table.roleId, table.permissionId],
    }),
    index("role_permissions_permission_idx").on(table.permissionId, table.roleId),
  ],
);

/** User-to-role memberships. Seller-scoped memberships keep seller_id on the assignment row. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id").references((): AnyPgColumn => sellers.id, {
      onDelete: "restrict",
    }),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_roles_platform_role_uq")
      .on(table.userId, table.roleId)
      .where(sql`${table.sellerId} is null`),
    uniqueIndex("user_roles_seller_role_uq")
      .on(table.userId, table.roleId, table.sellerId)
      .where(sql`${table.sellerId} is not null`),
    index("user_roles_role_idx").on(table.roleId, table.userId),
    index("user_roles_seller_idx").on(table.sellerId, table.userId),
  ],
);

/**
 * Persistent rotating refresh-token session.
 * Only SHA-256 refresh-token and token-family hashes are stored so raw credentials never enter PostgreSQL.
 */
export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),
    tokenFamilyHash: varchar("token_family_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokeReason: varchar("revoke_reason", { length: 200 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgentHash: varchar("user_agent_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("refresh_sessions_refresh_token_hash_uq").on(table.refreshTokenHash),
    index("refresh_sessions_user_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("refresh_sessions_token_family_hash_idx").on(
      table.tokenFamilyHash,
      table.createdAt,
    ),
    check(
      "refresh_sessions_refresh_hash_check",
      sql`length(${table.refreshTokenHash}) = 64 and ${table.refreshTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "refresh_sessions_token_family_hash_check",
      sql`length(${table.tokenFamilyHash}) = 64 and ${table.tokenFamilyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "refresh_sessions_user_agent_hash_check",
      sql`${table.userAgentHash} is null or (length(${table.userAgentHash}) = 64 and ${table.userAgentHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "refresh_sessions_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "refresh_sessions_revoke_reason_check",
      sql`${table.revokedAt} is not null or ${table.revokeReason} is null`,
    ),
  ],
);

/**
 * Allow-listed platform configuration values. Secrets do not belong in this table.
 * The service layer decides which keys may be read or changed.
 */
export const platformSettings = pgTable(
  "platform_settings",
  {
    key: varchar("key", { length: 120 }).primaryKey(),
    valueJson: jsonb("value_json").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("platform_settings_updated_at_idx").on(table.updatedAt),
    check(
      "platform_settings_key_normalized_check",
      sql`${table.key} = lower(btrim(${table.key})) and ${table.key} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
export type PermissionRow = typeof permissions.$inferSelect;
export type RefreshSessionRow = typeof refreshSessions.$inferSelect;
export type NewRefreshSessionRow = typeof refreshSessions.$inferInsert;
export type PlatformSettingRow = typeof platformSettings.$inferSelect;
