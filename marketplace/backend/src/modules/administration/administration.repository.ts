import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  permissions,
  platformSettings,
  rolePermissions,
  roles,
  userRoles,
  users,
  type NewRoleRow,
  type NewUserRow,
  type PermissionRow,
  type PlatformSettingRow,
  type RoleRow,
  type UserRow,
} from "../../database/schema/administration.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import type { RoleListQuery, UserListQuery } from "./administration.types.js";

const safeUserColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  accountType: users.accountType,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  passwordChangedAt: users.passwordChangedAt,
  lastLoginAt: users.lastLoginAt,
  failedLoginAttempts: users.failedLoginAttempts,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

type SafeUserRecord = Omit<UserRow, "passwordHash">;

export interface RoleSummaryRecord {
  id: string;
  code: string;
  name: string;
  scopeType: string;
  sellerId: string | null;
  isSystem: boolean;
  status: string;
}

export interface UserWithRolesRecord extends SafeUserRecord {
  roles: RoleSummaryRecord[];
}

export interface RoleWithPermissionsRecord extends RoleRow {
  permissions: PermissionRow[];
}

export interface UserPermissionGrantRecord {
  roleId: string;
  roleCode: string;
  roleStatus: string;
  roleScopeType: string;
  sellerId: string | null;
  permission: PermissionRow;
}

interface UserRoleAssignmentRecordInput {
  roleId: string;
  sellerId: string | null;
}

interface PlatformSettingRecordInput {
  key: string;
  valueJson: PlatformSettingRow["valueJson"];
}

interface PaginatedRepositoryResult<T> {
  items: T[];
  totalItems: number;
}

/** Combines only the filters that were actually supplied by the caller. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Maps the validated user sort key to deterministic SQL ordering. */
function userOrder(sort: UserListQuery["sort"]): SQL[] {
  switch (sort) {
    case "created_asc":
      return [asc(users.createdAt), asc(users.id)];
    case "name_asc":
      return [asc(users.displayName), asc(users.id)];
    case "name_desc":
      return [desc(users.displayName), desc(users.id)];
    case "created_desc":
    default:
      return [desc(users.createdAt), desc(users.id)];
  }
}

/** Maps the validated role sort key to deterministic SQL ordering. */
function roleOrder(sort: RoleListQuery["sort"]): SQL[] {
  switch (sort) {
    case "created_asc":
      return [asc(roles.createdAt), asc(roles.id)];
    case "created_desc":
      return [desc(roles.createdAt), desc(roles.id)];
    case "name_desc":
      return [desc(roles.name), desc(roles.id)];
    case "name_asc":
    default:
      return [asc(roles.name), asc(roles.id)];
  }
}

/**
 * Persistence-only Administration/RBAC data access.
 * Authorization decisions, system-role protection, validation and transaction boundaries belong to services.
 */
export class AdministrationRepository {
  /** Creates a repository that can use either the root DB client or a transaction client. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Lists users without ever selecting password hashes. */
  async listUsers(
    query: UserListQuery,
  ): Promise<PaginatedRepositoryResult<UserWithRolesRecord>> {
    const { limit, offset } = toLimitOffset(query);
    const search = query.search ? `%${query.search}%` : undefined;
    const roleMembership = query.roleId
      ? exists(
          this.executor
            .select({ userId: userRoles.userId })
            .from(userRoles)
            .where(
              and(
                eq(userRoles.userId, users.id),
                eq(userRoles.roleId, query.roleId),
              ),
            ),
        )
      : undefined;

    const where = combineConditions([
      query.status ? eq(users.status, query.status) : undefined,
      search
        ? or(ilike(users.email, search), ilike(users.displayName, search))
        : undefined,
      roleMembership,
    ]);

    const rows = await this.executor
      .select(safeUserColumns)
      .from(users)
      .where(where)
      .orderBy(...userOrder(query.sort))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(users)
      .where(where);

    return {
      items: await this.attachRoles(rows),
      totalItems: Number(totalRow?.value ?? 0),
    };
  }

  /** Finds one user by normalized email while excluding the password hash. */
  async findUserByEmail(email: string): Promise<UserWithRolesRecord | null> {
    const [row] = await this.executor
      .select(safeUserColumns)
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!row) {
      return null;
    }

    const [result] = await this.attachRoles([row]);
    return result ?? null;
  }

  /** Finds one user with role summaries while excluding the password hash. */
  async findUserById(userId: string): Promise<UserWithRolesRecord | null> {
    const [row] = await this.executor
      .select(safeUserColumns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      return null;
    }

    const [result] = await this.attachRoles([row]);
    return result ?? null;
  }

  /** Inserts a user row. The password value supplied here must already be a service-derived hash. */
  async createUser(input: NewUserRow): Promise<UserWithRolesRecord> {
    const [row] = await this.executor
      .insert(users)
      .values(input)
      .returning(safeUserColumns);

    if (!row) {
      throw new Error("Failed to create user.");
    }

    return { ...row, roles: [] };
  }

  /** Persists a service-approved internal account-type transition without exposing a public mutation API. */
  async updateUserAccountType(
    userId: string,
    accountType: UserRow["accountType"],
    updatedAt: Date = new Date(),
  ): Promise<UserWithRolesRecord | null> {
    const [row] = await this.executor
      .update(users)
      .set({ accountType, updatedAt })
      .where(eq(users.id, userId))
      .returning(safeUserColumns);

    if (!row) {
      return null;
    }

    const [result] = await this.attachRoles([row]);
    return result ?? null;
  }

  /** Persists a service-approved user status/lock transition. */
  async updateUserStatus(
    userId: string,
    values: { status: string; lockedUntil?: Date | null },
    updatedAt: Date = new Date(),
  ): Promise<UserWithRolesRecord | null> {
    const [row] = await this.executor
      .update(users)
      .set({
        status: values.status,
        ...(values.lockedUntil !== undefined
          ? { lockedUntil: values.lockedUntil }
          : {}),
        updatedAt,
      })
      .where(eq(users.id, userId))
      .returning(safeUserColumns);

    if (!row) {
      return null;
    }

    const [result] = await this.attachRoles([row]);
    return result ?? null;
  }

  /** Resolves a set of role IDs for service-level assignment validation. */
  async findRolesByIds(roleIds: string[]): Promise<RoleRow[]> {
    if (roleIds.length === 0) {
      return [];
    }

    return this.executor.select().from(roles).where(inArray(roles.id, roleIds));
  }

  /**
   * Replaces all seller-aware role memberships for a user.
   * The caller must use a transaction-bound repository when this write is part of a larger command.
   */
  async replaceUserRoleAssignments(
    userId: string,
    assignments: UserRoleAssignmentRecordInput[],
    assignedBy: string | null,
  ): Promise<void> {
    await this.executor.delete(userRoles).where(eq(userRoles.userId, userId));

    if (assignments.length === 0) {
      return;
    }

    await this.executor.insert(userRoles).values(
      assignments.map((assignment) => ({
        userId,
        roleId: assignment.roleId,
        sellerId: assignment.sellerId,
        assignedBy,
      })),
    );
  }

  /** Returns raw role-to-permission grants with the membership scope needed for seller-aware authorization. */
  async getUserPermissions(userId: string): Promise<UserPermissionGrantRecord[]> {
    const rows = await this.executor
      .select({
        roleId: roles.id,
        roleCode: roles.code,
        roleStatus: roles.status,
        roleScopeType: roles.scopeType,
        sellerId: userRoles.sellerId,
        permissionId: permissions.id,
        permissionCode: permissions.code,
        permissionDomain: permissions.domain,
        permissionDescription: permissions.description,
        permissionCreatedAt: permissions.createdAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(permissions.code), asc(roles.code), asc(userRoles.sellerId));

    return rows.map((row) => ({
      roleId: row.roleId,
      roleCode: row.roleCode,
      roleStatus: row.roleStatus,
      roleScopeType: row.roleScopeType,
      sellerId: row.sellerId,
      permission: {
        id: row.permissionId,
        code: row.permissionCode,
        domain: row.permissionDomain,
        description: row.permissionDescription,
        createdAt: row.permissionCreatedAt,
      },
    }));
  }

  /** Lists roles without mutating or interpreting system-role policy. */
  async listRoles(
    query: RoleListQuery,
  ): Promise<PaginatedRepositoryResult<RoleRow>> {
    const { limit, offset } = toLimitOffset(query);
    const search = query.search ? `%${query.search}%` : undefined;
    const where = combineConditions([
      query.status ? eq(roles.status, query.status) : undefined,
      query.system !== undefined ? eq(roles.isSystem, query.system) : undefined,
      search
        ? or(
            ilike(roles.code, search),
            ilike(roles.name, search),
            ilike(roles.description, search),
          )
        : undefined,
    ]);

    const rows = await this.executor
      .select()
      .from(roles)
      .where(where)
      .orderBy(...roleOrder(query.sort))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(roles)
      .where(where);

    return {
      items: rows,
      totalItems: Number(totalRow?.value ?? 0),
    };
  }

  /** Finds one role by stable normalized code. */
  async findRoleByCode(code: string): Promise<RoleRow | null> {
    const [row] = await this.executor
      .select()
      .from(roles)
      .where(eq(roles.code, code))
      .limit(1);

    return row ?? null;
  }

  /** Finds one role and its assigned permission catalog rows. */
  async findRoleById(roleId: string): Promise<RoleWithPermissionsRecord | null> {
    const [role] = await this.executor
      .select()
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) {
      return null;
    }

    const permissionRows = await this.executor
      .select({
        id: permissions.id,
        code: permissions.code,
        domain: permissions.domain,
        description: permissions.description,
        createdAt: permissions.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(asc(permissions.code));

    return { ...role, permissions: permissionRows };
  }

  /** Inserts a role row; service owns role-code/system-role policy. */
  async createRole(input: NewRoleRow): Promise<RoleRow> {
    const [row] = await this.executor.insert(roles).values(input).returning();

    if (!row) {
      throw new Error("Failed to create role.");
    }

    return row;
  }

  /** Resolves permission IDs before a service-approved assignment replacement. */
  async findPermissionsByIds(permissionIds: string[]): Promise<PermissionRow[]> {
    if (permissionIds.length === 0) {
      return [];
    }

    return this.executor
      .select()
      .from(permissions)
      .where(inArray(permissions.id, permissionIds));
  }

  /** Replaces all permission assignments for a role. Caller supplies a transaction-bound repository for atomic use. */
  async replaceRolePermissions(
    roleId: string,
    permissionIds: string[],
    assignedBy: string | null,
  ): Promise<void> {
    await this.executor
      .delete(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    if (permissionIds.length === 0) {
      return;
    }

    await this.executor.insert(rolePermissions).values(
      permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
        assignedBy,
      })),
    );
  }

  /** Reads only the allow-listed platform-setting keys supplied by the service. */
  async findPlatformSettingsByKeys(keys: string[]): Promise<PlatformSettingRow[]> {
    if (keys.length === 0) {
      return [];
    }

    return this.executor
      .select()
      .from(platformSettings)
      .where(inArray(platformSettings.key, keys))
      .orderBy(asc(platformSettings.key));
  }

  /**
   * Inserts or updates a validated batch of non-secret platform settings.
   * Key allow-listing and value validation stay in the service layer.
   */
  async upsertPlatformSettings(
    settings: PlatformSettingRecordInput[],
    updatedBy: string | null,
    updatedAt: Date = new Date(),
  ): Promise<PlatformSettingRow[]> {
    if (settings.length === 0) {
      return [];
    }

    const rows = await this.executor
      .insert(platformSettings)
      .values(
        settings.map((setting) => ({
          key: setting.key,
          valueJson: setting.valueJson,
          updatedBy,
          updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          valueJson: sql`excluded.value_json`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning();

    return rows.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** Attaches persisted role membership scope to safe user rows without exposing password data. */
  private async attachRoles(
    userRows: SafeUserRecord[],
  ): Promise<UserWithRolesRecord[]> {
    if (userRows.length === 0) {
      return [];
    }

    const userIds = userRows.map((row) => row.id);
    const memberships = await this.executor
      .select({
        userId: userRoles.userId,
        id: roles.id,
        code: roles.code,
        name: roles.name,
        scopeType: roles.scopeType,
        sellerId: userRoles.sellerId,
        isSystem: roles.isSystem,
        status: roles.status,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(inArray(userRoles.userId, userIds))
      .orderBy(asc(roles.name), asc(roles.id), asc(userRoles.sellerId));

    const rolesByUser = new Map<string, RoleSummaryRecord[]>();
    for (const membership of memberships) {
      const current = rolesByUser.get(membership.userId) ?? [];
      current.push({
        id: membership.id,
        code: membership.code,
        name: membership.name,
        scopeType: membership.scopeType,
        sellerId: membership.sellerId,
        isSystem: membership.isSystem,
        status: membership.status,
      });
      rolesByUser.set(membership.userId, current);
    }

    return userRows.map((row) => ({
      ...row,
      roles: rolesByUser.get(row.id) ?? [],
    }));
  }
}
