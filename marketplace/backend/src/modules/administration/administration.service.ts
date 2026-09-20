import { AppError } from "../../common/errors/app-error.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { assertPermission, assertSellerPermission } from "../../common/policies/policy.js";
import type { PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { withTransaction } from "../../database/transaction.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { AuthRepository } from "./auth.repository.js";
import { AUTH_OUTBOX_EVENT, SESSION_REVOKE_REASON } from "./auth.constants.js";
import {
  ACCOUNT_TYPE,
  ADMIN_AUDIT_EVENT,
  ADMIN_ERROR_CODE,
  ADMIN_OUTBOX_EVENT,
  ADMIN_PERMISSION,
  PLATFORM_SETTING_KEY,
  PLATFORM_SETTING_KEYS,
  ROLE_SCOPE_TYPE,
  ROLE_STATUS,
  USER_STATUS,
} from "./administration.constants.js";
import {
  AdministrationRepository,
  type RoleWithPermissionsRecord,
  type UserWithRolesRecord,
} from "./administration.repository.js";
import type {
  ChangeUserStatusInput,
  CreateRoleInput,
  PermissionResponse,
  PlatformSettingResponse,
  PlatformSettingsResponse,
  ReplaceRolePermissionsInput,
  ReplaceUserRoleAssignmentsInput,
  RoleListQuery,
  RoleResponse,
  UpdatePlatformSettingsInput,
  UserListQuery,
  UserResponse,
} from "./administration.types.js";

export interface PaginatedServiceResult<T> {
  items: T[];
  meta: PaginationMeta;
}

export type AdministrationTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Coordinates seller_staff state without making Module 2 import Module 4. */
export interface SellerStaffLifecycleCoordinator {
  /** Verifies that newly assigned seller scopes exist and currently allow staff assignment. */
  validateAssignableSellerIds(input: {
    transaction: DatabaseTransaction;
    userId: string;
    sellerIds: string[];
  }): Promise<void>;

  /** Synchronizes seller_staff after the Module 2 role replacement succeeds in the same transaction. */
  synchronizeMemberships(input: {
    transaction: DatabaseTransaction;
    userId: string;
    addedSellerIds: string[];
    removedSellerIds: string[];
    actorId: string | null;
    actorType: RequestContext["actorType"];
    requestId: string;
  }): Promise<void>;
}

/** Input for the controlled internal customer-to-seller owner transition used by Module 4 approval. */
export interface ProvisionSellerScopedIdentityInput {
  userId: string;
  sellerId: string;
  roleCode: string;
  actorId: string | null;
  actorType: RequestContext["actorType"];
  requestId: string;
}

/** Creates one stable Administration business error. */
function adminError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through wrapped error causes when present. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Returns a normalized email only when seller staff lookup is an exact email search. */
function exactSellerStaffEmail(search: string | undefined): string | null {
  if (!search) return null;
  const email = search.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Normalizes and validates one ISO-style currency code. */
function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string") {
    throw adminError(
      ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
      "Currency settings must use a three-letter currency code.",
      400,
    );
  }

  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw adminError(
      ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
      "Currency settings must use a three-letter currency code.",
      400,
    );
  }
  return currency;
}

/** Returns true only for a Checkout-safe tax percentage with at most four decimal places. */
function isValidTaxRatePercent(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < 0 || value > 100) return false;

  const scaled = value * 10_000;
  const distanceFromInteger = Math.abs(scaled - Math.round(scaled));
  return distanceFromInteger <= Number.EPSILON * 10_000;
}

/** Validates one allow-listed platform-setting value and returns its normalized JSON value. */
function normalizePlatformSettingValue(key: string, value: unknown): unknown {
  if (key === PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "Supported currencies must be a non-empty list with at most 20 values.",
        400,
      );
    }
    return Array.from(new Set(value.map(normalizeCurrency))).sort();
  }

  if (key === PLATFORM_SETTING_KEY.DEFAULT_CURRENCY) {
    return normalizeCurrency(value);
  }

  if (key === PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT) {
    if (!isValidTaxRatePercent(value)) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "Default tax rate must be between 0 and 100 with at most four decimal places.",
        400,
      );
    }
    return value;
  }

  if (key === PLATFORM_SETTING_KEY.RETURNS_WINDOW_DAYS) {
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 365) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "Return window days must be an integer between 1 and 365.",
        400,
      );
    }
    return value;
  }

  throw adminError(
    ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
    "This platform setting is not editable.",
    400,
  );
}

/**
 * Administration/RBAC application service. It owns authorization, invariants, transaction boundaries,
 * password hashing for admin-created users, audit records and safe domain events.
 */
export class AdministrationService {
  /** Stores explicit Administration dependencies while keeping HTTP concerns outside the service. */
  constructor(
    private readonly repository = new AdministrationRepository(),
    private readonly transactionRunner: AdministrationTransactionRunner = withTransaction,
    private readonly sellerStaffLifecycle: SellerStaffLifecycleCoordinator | null = null,
  ) {}

  /** Creates the root Administration service with the downstream seller_staff callback supplied by application composition. */
  static withSellerStaffLifecycle(
    sellerStaffLifecycle: SellerStaffLifecycleCoordinator,
  ): AdministrationService {
    return new AdministrationService(
      new AdministrationRepository(),
      withTransaction,
      sellerStaffLifecycle,
    );
  }

  /** Creates an Administration service bound to an existing cross-module transaction. */
  static using(
    transaction: DatabaseTransaction,
    sellerStaffLifecycle: SellerStaffLifecycleCoordinator | null = null,
  ): AdministrationService {
    return new AdministrationService(
      new AdministrationRepository(transaction),
      async (work) => work(transaction),
      sellerStaffLifecycle,
    );
  }

  /** Resolves the minimum persisted identity needed by downstream notification delivery without exposing credentials or roles. */
  async resolveNotificationRecipient(
    userId: string,
  ): Promise<{ id: string; email: string } | null> {
    const user = await this.repository.findUserById(userId);
    return user ? { id: user.id, email: user.email } : null;
  }

  /** Returns the normalized Administration-owned currency allow-list for seller-facing configuration. */
  async getSupportedCurrencies(): Promise<string[]> {
    const rows = await this.repository.findPlatformSettingsByKeys([
      PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
    ]);
    const value = rows[0]?.valueJson;
    if (!Array.isArray(value)) return [];

    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toUpperCase())
          .filter((entry) => /^[A-Z]{3}$/.test(entry)),
      ),
    ).sort();
  }

  /** Returns true only when the normalized currency exists in the Administration-supported currency setting. */
  async isSupportedCurrency(currency: string): Promise<boolean> {
    const normalized = currency.trim().toUpperCase();
    return (await this.getSupportedCurrencies()).includes(normalized);
  }

  /** Returns the marketplace default currency used by downstream empty commerce views. */
  async getDefaultCurrency(): Promise<string> {
    const rows = await this.repository.findPlatformSettingsByKeys([
      PLATFORM_SETTING_KEY.DEFAULT_CURRENCY,
    ]);
    const value = rows[0]?.valueJson;

    if (value === undefined) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "The marketplace default currency is not configured.",
        500,
      );
    }

    return normalizeCurrency(value);
  }

  /** Returns the configured Checkout tax percentage as a canonical non-exponent decimal string. */
  async getDefaultTaxRatePercent(): Promise<string> {
    const rows = await this.repository.findPlatformSettingsByKeys([
      PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT,
    ]);
    const value = rows[0]?.valueJson;
    if (!isValidTaxRatePercent(value)) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "The marketplace default tax rate is missing or invalid.",
        500,
      );
    }

    return value.toFixed(4).replace(/\.?0+$/, "");
  }

  /** Returns the configured Return window in days, using the approved Module 14 default when unset. */
  async getReturnWindowDays(): Promise<number> {
    const rows = await this.repository.findPlatformSettingsByKeys([
      PLATFORM_SETTING_KEY.RETURNS_WINDOW_DAYS,
    ]);
    const value = rows[0]?.valueJson;
    if (value === undefined) return 30;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 365) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "The Return window setting is invalid.",
        500,
      );
    }
    return value as number;
  }

  /** Converts one existing active identity into the approved seller owner account and protected seller role. */
  async provisionSellerScopedIdentity(
    input: ProvisionSellerScopedIdentityInput,
  ): Promise<void> {
    await this.transactionRunner(async (tx) => {
      const repository = new AdministrationRepository(tx);
      const existing = await repository.findUserById(input.userId);
      if (!existing) throw this.userNotFound();
      if (existing.status !== USER_STATUS.ACTIVE) {
        throw adminError(
          ADMIN_ERROR_CODE.USER_STATUS_INVALID,
          "Only an active user can become an approved seller owner.",
          409,
        );
      }
      if (existing.accountType !== ACCOUNT_TYPE.CUSTOMER) {
        throw adminError(
          ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
          "Only a customer account can be converted into an approved seller owner.",
          409,
        );
      }

      const role = await repository.findRoleByCode(input.roleCode);
      if (
        !role ||
        role.status !== ROLE_STATUS.ACTIVE ||
        role.scopeType !== ROLE_SCOPE_TYPE.SELLER ||
        !role.isSystem
      ) {
        throw new Error("The protected seller-owner role is missing or invalid.");
      }

      const beforeAssignments = existing.roles.map((membership) => ({
        roleId: membership.id,
        sellerId: membership.sellerId,
      }));
      await repository.updateUserAccountType(input.userId, ACCOUNT_TYPE.SELLER);
      await repository.replaceUserRoleAssignments(
        input.userId,
        [{ roleId: role.id, sellerId: input.sellerId }],
        input.actorId,
      );

      const now = new Date();
      await AuditService.using(tx).record({
        actorId: input.actorId,
        actorType: input.actorType,
        action: ADMIN_AUDIT_EVENT.USER_ROLES_CHANGED,
        entityType: "user",
        entityId: input.userId,
        requestId: input.requestId,
        before: {
          accountType: existing.accountType,
          assignments: beforeAssignments,
        },
        after: {
          accountType: ACCOUNT_TYPE.SELLER,
          assignments: [{ roleId: role.id, sellerId: input.sellerId }],
        },
      });
      await OutboxService.using(tx).enqueue({
        eventType: ADMIN_OUTBOX_EVENT.USER_ROLES_CHANGED,
        aggregateType: "user",
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          assignments: [{ roleId: role.id, sellerId: input.sellerId }],
          changedAt: now.toISOString(),
        },
      });
    });
  }

  /** Lists platform users for admins or one exact-email staff candidate for seller owners. */
  async listUsers(
    context: RequestContext,
    query: UserListQuery,
  ): Promise<PaginatedServiceResult<UserResponse>> {
    if (context.actorType === "seller") {
      assertPermission(context, ADMIN_PERMISSION.SELLER_STAFF_MANAGE);
      const email = exactSellerStaffEmail(query.search);
      if (!email) {
        return { items: [], meta: paginationMeta(query, 0) };
      }

      const candidate = await this.repository.findUserByEmail(email);
      if (!candidate || candidate.accountType === ACCOUNT_TYPE.PLATFORM_ADMIN) {
        return { items: [], meta: paginationMeta(query, 0) };
      }

      const items = query.page === 1
        ? [this.toSellerStaffUserResponse(candidate, context.sellerIds)]
        : [];
      return { items, meta: paginationMeta(query, 1) };
    }

    this.requirePermission(context, ADMIN_PERMISSION.USERS_READ);
    const result = await this.repository.listUsers(query);
    return {
      items: result.items.map((user) => this.toUserResponse(user)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Applies a controlled status transition and revokes sessions when the account stops being active. */
  async changeUserStatus(
    context: RequestContext,
    userId: string,
    input: ChangeUserStatusInput,
  ): Promise<UserResponse> {
    this.requirePermission(context, ADMIN_PERMISSION.USERS_STATUS_MANAGE);
    const existing = await this.repository.findUserById(userId);
    if (!existing) throw this.userNotFound();

    if (context.actorId === userId && input.status !== USER_STATUS.ACTIVE) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_STATUS_INVALID,
        "You cannot deactivate or lock your own account.",
        409,
      );
    }
    if (existing.status === input.status) return this.toUserResponse(existing);

    const now = new Date();
    return this.transactionRunner(async (tx) => {
      const repository = new AdministrationRepository(tx);
      const authRepository = new AuthRepository(tx);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      const updated = await repository.updateUserStatus(
        userId,
        {
          status: input.status,
          ...(input.status === USER_STATUS.ACTIVE ? { lockedUntil: null } : {}),
        },
        now,
      );
      if (!updated) throw this.userNotFound();

      let revokedSessionCount = 0;
      if (input.status !== USER_STATUS.ACTIVE) {
        const revoked = await authRepository.revokeAllUserSessions(
          userId,
          now,
          SESSION_REVOKE_REASON.USER_DEACTIVATED,
        );
        revokedSessionCount = revoked.length;
        for (const session of revoked) {
          await outbox.enqueue({
            eventType: AUTH_OUTBOX_EVENT.SESSION_REVOKED,
            aggregateType: "auth_session",
            aggregateId: session.id,
            payload: {
              sessionId: session.id,
              userId,
              reason: SESSION_REVOKE_REASON.USER_DEACTIVATED,
              revokedAt: now.toISOString(),
            },
          });
        }
      }

      const before = this.toUserResponse(existing);
      const after = this.toUserResponse(updated);
      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: ADMIN_AUDIT_EVENT.USER_STATUS_CHANGED,
        entityType: "user",
        entityId: userId,
        requestId: context.requestId,
        before: { status: before.status },
        after: { status: after.status },
        metadata: {
          reason: input.reason ?? null,
          revokedSessionCount,
        },
      });
      await outbox.enqueue({
        eventType: ADMIN_OUTBOX_EVENT.USER_STATUS_CHANGED,
        aggregateType: "user",
        aggregateId: userId,
        payload: {
          userId,
          previousStatus: before.status,
          status: after.status,
          changedAt: now.toISOString(),
        },
      });
      return after;
    });
  }

  /** Replaces seller-aware user role memberships without allowing one seller manager to alter another seller. */
  async replaceUserRoleAssignments(
    context: RequestContext,
    userId: string,
    input: ReplaceUserRoleAssignmentsInput,
  ): Promise<UserResponse> {
    const sellerActor = context.actorType === "seller";
    const managedSellerIds = new Set<string>();

    if (sellerActor) {
      assertPermission(context, ADMIN_PERMISSION.SELLER_STAFF_MANAGE);
      for (const assignment of input.assignments) {
        if (!assignment.sellerId) {
          throw adminError(
            ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
            "Seller staff managers can only change seller-scoped role assignments.",
            403,
          );
        }
        this.requireSellerStaffPermission(context, assignment.sellerId);
        managedSellerIds.add(assignment.sellerId);
      }

      if (managedSellerIds.size === 0) {
        if (context.sellerIds.size !== 1) {
          throw adminError(
            ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
            "An empty seller-role replacement is ambiguous across multiple seller scopes.",
            400,
          );
        }
        const onlySellerId = context.sellerIds.values().next().value as string | undefined;
        if (!onlySellerId) {
          throw adminError(
            ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
            "A seller scope is required to manage seller staff.",
            403,
          );
        }
        this.requireSellerStaffPermission(context, onlySellerId);
        managedSellerIds.add(onlySellerId);
      }
    } else {
      this.requirePermission(context, ADMIN_PERMISSION.USERS_ROLES_MANAGE);
    }

    const existing = await this.repository.findUserById(userId);
    if (!existing) throw this.userNotFound();
    if (sellerActor && existing.accountType === ACCOUNT_TYPE.PLATFORM_ADMIN) {
      throw adminError(
        ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
        "Seller staff managers cannot change platform administrator access.",
        403,
      );
    }
    if (sellerActor && context.actorId === userId) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
        "Seller staff managers cannot change their own role assignments.",
        409,
      );
    }

    return this.transactionRunner(async (tx) => {
      const repository = new AdministrationRepository(tx);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      const preservedAssignments = sellerActor
        ? existing.roles
            .filter(
              (role) =>
                role.sellerId !== null && !managedSellerIds.has(role.sellerId),
            )
            .map((role) => ({ roleId: role.id, sellerId: role.sellerId }))
        : [];
      const finalAssignments = [...preservedAssignments, ...input.assignments];
      const requestedSellerIds = Array.from(
        new Set(
          input.assignments.flatMap((assignment) =>
            assignment.sellerId ? [assignment.sellerId] : [],
          ),
        ),
      );

      if (this.sellerStaffLifecycle && requestedSellerIds.length > 0) {
        await this.sellerStaffLifecycle.validateAssignableSellerIds({
          transaction: tx,
          userId,
          sellerIds: requestedSellerIds,
        });
      }

      let targetAccountType = existing.accountType;
      if (
        this.sellerStaffLifecycle &&
        requestedSellerIds.length > 0 &&
        targetAccountType === ACCOUNT_TYPE.CUSTOMER
      ) {
        await repository.updateUserAccountType(userId, ACCOUNT_TYPE.SELLER);
        targetAccountType = ACCOUNT_TYPE.SELLER;
      }

      const proposedPermissions = await this.validateRoleAssignments(
        context,
        targetAccountType,
        input.assignments,
        repository,
        context.actorId === userId && context.actorType === "platform_admin",
      );

      await repository.replaceUserRoleAssignments(
        userId,
        finalAssignments,
        context.actorId,
      );

      if (this.sellerStaffLifecycle) {
        const beforeSellerIds = new Set(
          existing.roles.flatMap((role) => (role.sellerId ? [role.sellerId] : [])),
        );
        const afterSellerIds = new Set(
          finalAssignments.flatMap((assignment) =>
            assignment.sellerId ? [assignment.sellerId] : [],
          ),
        );
        const addedSellerIds = [...afterSellerIds].filter(
          (sellerId) => !beforeSellerIds.has(sellerId),
        );
        const removedSellerIds = [...beforeSellerIds].filter(
          (sellerId) => !afterSellerIds.has(sellerId),
        );

        if (addedSellerIds.length > 0 || removedSellerIds.length > 0) {
          await this.sellerStaffLifecycle.synchronizeMemberships({
            transaction: tx,
            userId,
            addedSellerIds,
            removedSellerIds,
            actorId: context.actorId,
            actorType: context.actorType,
            requestId: context.requestId,
          });
        }
      }

      const updated = await repository.findUserById(userId);
      if (!updated) throw this.userNotFound();

      const beforeAssignments = existing.roles.map((role) => ({
        roleId: role.id,
        sellerId: role.sellerId,
      }));
      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: ADMIN_AUDIT_EVENT.USER_ROLES_CHANGED,
        entityType: "user",
        entityId: userId,
        requestId: context.requestId,
        before: {
          accountType: existing.accountType,
          assignments: beforeAssignments,
        },
        after: {
          accountType: updated.accountType,
          assignments: finalAssignments,
        },
      });
      await outbox.enqueue({
        eventType: ADMIN_OUTBOX_EVENT.USER_ROLES_CHANGED,
        aggregateType: "user",
        aggregateId: userId,
        payload: {
          userId,
          assignments: finalAssignments,
          permissionCodes: Array.from(proposedPermissions).sort(),
          changedAt: new Date().toISOString(),
        },
      });
      return this.toUserResponse(updated);
    });
  }

  /** Lists all roles for admins or only safe seller-staff roles for seller owners. */
  async listRoles(
    context: RequestContext,
    query: RoleListQuery,
  ): Promise<PaginatedServiceResult<RoleResponse>> {
    if (context.actorType === "seller") {
      assertPermission(context, ADMIN_PERMISSION.SELLER_STAFF_MANAGE);
      return this.listSellerAssignableRoles(context, query);
    }

    this.requirePermission(context, ADMIN_PERMISSION.ROLES_READ);
    const result = await this.repository.listRoles(query);
    const items = await Promise.all(
      result.items.map(async (role) => {
        const detail = await this.repository.findRoleById(role.id);
        if (!detail) throw this.roleNotFound();
        return this.toRoleResponse(detail);
      }),
    );
    return { items, meta: paginationMeta(query, result.totalItems) };
  }

  /** Creates a non-system role with an immutable normalized code. */
  async createRole(
    context: RequestContext,
    input: CreateRoleInput,
  ): Promise<RoleResponse> {
    this.requirePermission(context, ADMIN_PERMISSION.ROLES_CREATE);
    const code = input.code.trim().toLowerCase();
    if (await this.repository.findRoleByCode(code)) {
      throw adminError(
        ADMIN_ERROR_CODE.DUPLICATE_ROLE_CODE,
        "A role with this code already exists.",
        409,
      );
    }

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new AdministrationRepository(tx);
        const audit = AuditService.using(tx);
        const outbox = OutboxService.using(tx);
        const created = await repository.createRole({
          code,
          name: input.name.trim(),
          description: input.description ?? null,
          scopeType: input.scopeType,
          status: input.status,
          isSystem: false,
        });
        const detail = await repository.findRoleById(created.id);
        if (!detail) throw this.roleNotFound();
        const safe = this.toRoleResponse(detail);

        await audit.record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: ADMIN_AUDIT_EVENT.ROLE_CREATED,
          entityType: "role",
          entityId: created.id,
          requestId: context.requestId,
          after: safe,
        });
        await outbox.enqueue({
          eventType: ADMIN_OUTBOX_EVENT.ROLE_CREATED,
          aggregateType: "role",
          aggregateId: created.id,
          payload: {
            roleId: created.id,
            code: created.code,
            status: created.status,
          },
        });
        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw adminError(
          ADMIN_ERROR_CODE.DUPLICATE_ROLE_CODE,
          "A role with this code already exists.",
          409,
        );
      }
      throw error;
    }
  }

  /** Replaces a non-system role's permission set with anti-privilege-escalation checks. */
  async replaceRolePermissions(
    context: RequestContext,
    roleId: string,
    input: ReplaceRolePermissionsInput,
  ): Promise<RoleResponse> {
    this.requirePermission(context, ADMIN_PERMISSION.ROLES_PERMISSIONS_MANAGE);
    const existing = await this.repository.findRoleById(roleId);
    if (!existing) throw this.roleNotFound();
    this.assertRoleMutable(existing);

    return this.transactionRunner(async (tx) => {
      const repository = new AdministrationRepository(tx);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);
      const permissionRows = await repository.findPermissionsByIds(
        input.permissionIds,
      );
      if (permissionRows.length !== input.permissionIds.length) {
        throw adminError(
          ADMIN_ERROR_CODE.PERMISSION_NOT_FOUND,
          "One or more permissions do not exist.",
          400,
        );
      }

      for (const permission of permissionRows) {
        this.assertPermissionMatchesRoleScope(existing.scopeType, permission.code);
        if (!context.permissions.has(permission.code as PermissionCode)) {
          throw adminError(
            ADMIN_ERROR_CODE.ROLE_PERMISSION_ASSIGNMENT_INVALID,
            "You cannot assign a permission that you do not currently hold.",
            403,
          );
        }
      }

      await repository.replaceRolePermissions(
        roleId,
        input.permissionIds,
        context.actorId,
      );
      const updated = await repository.findRoleById(roleId);
      if (!updated) throw this.roleNotFound();
      const after = this.toRoleResponse(updated);

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: ADMIN_AUDIT_EVENT.ROLE_PERMISSIONS_CHANGED,
        entityType: "role",
        entityId: roleId,
        requestId: context.requestId,
        before: { permissionCodes: existing.permissions.map((p) => p.code) },
        after: { permissionCodes: updated.permissions.map((p) => p.code) },
      });
      const changedAt = new Date().toISOString();
      const permissionCodes = permissionRows.map((permission) => permission.code);

      // Keep the existing granular event for current consumers.
      await outbox.enqueue({
        eventType: ADMIN_OUTBOX_EVENT.ROLE_PERMISSIONS_CHANGED,
        aggregateType: "role",
        aggregateId: roleId,
        payload: {
          roleId,
          permissionIds: input.permissionIds,
          permissionCodes,
          changedAt,
        },
      });

      // Emit the broader contract event required whenever an existing role changes.
      await outbox.enqueue({
        eventType: ADMIN_OUTBOX_EVENT.ROLE_UPDATED,
        aggregateType: "role",
        aggregateId: roleId,
        payload: {
          roleId,
          changedFields: ["permissions"],
          permissionCodes,
          changedAt,
        },
      });
      return after;
    });
  }

  /** Reads the current allow-listed non-secret platform settings. */
  async getPlatformSettings(
    context: RequestContext,
  ): Promise<PlatformSettingsResponse> {
    this.requirePermission(context, ADMIN_PERMISSION.SETTINGS_MANAGE);
    const rows = await this.repository.findPlatformSettingsByKeys([
      ...PLATFORM_SETTING_KEYS,
    ]);
    return { settings: rows.map((row) => this.toPlatformSettingResponse(row)) };
  }

  /** Validates and updates allow-listed platform settings in one transaction. */
  async updatePlatformSettings(
    context: RequestContext,
    input: UpdatePlatformSettingsInput,
  ): Promise<PlatformSettingsResponse> {
    this.requirePermission(context, ADMIN_PERMISSION.SETTINGS_MANAGE);

    const normalized = input.settings.map((setting) => ({
      key: setting.key,
      value: normalizePlatformSettingValue(setting.key, setting.value),
    }));
    const currentRows = await this.repository.findPlatformSettingsByKeys([
      ...PLATFORM_SETTING_KEYS,
    ]);
    const resultingValues = new Map<string, unknown>(
      currentRows.map((row) => [row.key, row.valueJson]),
    );
    for (const setting of normalized) {
      resultingValues.set(setting.key, setting.value);
    }
    this.assertCurrencySettingsConsistent(resultingValues);

    const now = new Date();
    return this.transactionRunner(async (tx) => {
      const repository = new AdministrationRepository(tx);
      const audit = AuditService.using(tx);
      const updated = await repository.upsertPlatformSettings(
        normalized.map((setting) => ({
          key: setting.key,
          valueJson: setting.value,
        })),
        context.actorId,
        now,
      );

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: ADMIN_AUDIT_EVENT.PLATFORM_SETTINGS_UPDATED,
        entityType: "platform_settings",
        requestId: context.requestId,
        before: {
          settings: currentRows
            .filter((row) => normalized.some((setting) => setting.key === row.key))
            .map((row) => ({ key: row.key, value: row.valueJson })),
        },
        after: {
          settings: updated.map((row) => ({ key: row.key, value: row.valueJson })),
        },
      });

      const allRows = await repository.findPlatformSettingsByKeys([
        ...PLATFORM_SETTING_KEYS,
      ]);
      return {
        settings: allRows.map((row) => this.toPlatformSettingResponse(row)),
      };
    });
  }

  /** Rechecks one global permission inside sensitive Administration service methods. */
  private requirePermission(
    context: RequestContext,
    permission: PermissionCode,
  ): void {
    assertPermission(context, permission);
  }

  /** Enforces seller staff permission while preserving the Module 2 seller-scope error code. */
  private requireSellerStaffPermission(
    context: RequestContext,
    sellerId: string,
  ): void {
    if (context.actorType !== "platform_admin" && !context.sellerIds.has(sellerId)) {
      throw adminError(
        ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
        "The requested seller scope is not assigned to this user.",
        403,
      );
    }

    assertSellerPermission(
      context,
      sellerId,
      ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    );
  }

  /** Stops seller actors from delegating the permission that grants staff-management authority. */
  private assertSellerPermissionDelegationAllowed(
    context: RequestContext,
    permission: PermissionCode,
  ): void {
    if (
      context.actorType !== "platform_admin" &&
      permission === ADMIN_PERMISSION.SELLER_STAFF_MANAGE
    ) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
        "Seller users cannot delegate seller staff-management authority.",
        403,
      );
    }
  }

  /**
   * Validates role scope, target account type and anti-escalation rules before a membership replacement.
   * Seller-scoped permissions are checked against the same seller ID instead of the union permission set.
   */
  private async validateRoleAssignments(
    context: RequestContext,
    targetAccountType: string,
    assignments: ReplaceUserRoleAssignmentsInput["assignments"],
    repository: AdministrationRepository,
    preservePlatformSelfManagement: boolean,
  ): Promise<Set<PermissionCode>> {
    if (assignments.length === 0) {
      if (preservePlatformSelfManagement) {
        throw adminError(
          ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
          "You cannot remove your own role-management access.",
          409,
        );
      }
      return new Set();
    }

    const roleIds = Array.from(new Set(assignments.map((assignment) => assignment.roleId)));
    const roles = await repository.findRolesByIds(roleIds);
    if (
      roles.length !== roleIds.length ||
      roles.some((role) => role.status !== ROLE_STATUS.ACTIVE)
    ) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
        "Every assigned role must exist and be active.",
        400,
      );
    }

    const roleById = new Map(roles.map((role) => [role.id, role]));
    const proposedPermissions = new Set<PermissionCode>();

    for (const assignment of assignments) {
      const role = roleById.get(assignment.roleId);
      if (!role) {
        throw adminError(
          ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
          "Every assigned role must exist and be active.",
          400,
        );
      }

      this.assertAssignmentMatchesAccountType(
        targetAccountType,
        role.scopeType,
        assignment.sellerId,
      );
      const detail = await repository.findRoleById(role.id);
      if (!detail) throw this.roleNotFound();
      for (const permission of detail.permissions) {
        this.assertPermissionMatchesRoleScope(role.scopeType, permission.code);
      }

      if (role.scopeType === ROLE_SCOPE_TYPE.SELLER) {
        const sellerId = assignment.sellerId;
        if (!sellerId) {
          throw adminError(
            ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
            "Seller-scoped roles require a seller ID.",
            400,
          );
        }

        if (context.actorType === "platform_admin") {
          this.requirePermission(context, ADMIN_PERMISSION.USERS_ROLES_MANAGE);
        } else {
          this.requireSellerStaffPermission(context, sellerId);
        }

        const scopedPermissions = context.sellerPermissions.get(sellerId);
        for (const permission of detail.permissions) {
          const code = permission.code as PermissionCode;
          this.assertSellerPermissionDelegationAllowed(context, code);
          proposedPermissions.add(code);
          const actorHasPermission =
            context.actorType === "platform_admin"
              ? context.permissions.has(code)
              : scopedPermissions?.has(code) === true;
          if (!actorHasPermission) {
            throw adminError(
              ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
              "You cannot assign a role containing permissions you do not hold in this seller scope.",
              403,
            );
          }
        }
        continue;
      }

      this.requirePermission(context, ADMIN_PERMISSION.USERS_ROLES_MANAGE);
      for (const permission of detail.permissions) {
        const code = permission.code as PermissionCode;
        proposedPermissions.add(code);
        if (!context.permissions.has(code)) {
          throw adminError(
            ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
            "You cannot assign a role containing permissions that you do not hold.",
            403,
          );
        }
      }
    }

    if (
      preservePlatformSelfManagement &&
      !proposedPermissions.has(ADMIN_PERMISSION.USERS_ROLES_MANAGE)
    ) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
        "You cannot remove your own role-management access.",
        409,
      );
    }

    return proposedPermissions;
  }

  /** Ensures the assigned role scope belongs to the target account category. */
  private assertAssignmentMatchesAccountType(
    accountType: string,
    roleScopeType: string,
    sellerId: string | null,
  ): void {
    const platformMatch =
      accountType === ACCOUNT_TYPE.PLATFORM_ADMIN &&
      roleScopeType === ROLE_SCOPE_TYPE.PLATFORM &&
      sellerId === null;
    const customerMatch =
      accountType === ACCOUNT_TYPE.CUSTOMER &&
      roleScopeType === ROLE_SCOPE_TYPE.CUSTOMER &&
      sellerId === null;
    const sellerMatch =
      accountType === ACCOUNT_TYPE.SELLER &&
      roleScopeType === ROLE_SCOPE_TYPE.SELLER &&
      sellerId !== null;

    if (!platformMatch && !customerMatch && !sellerMatch) {
      throw adminError(
        ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
        "The role scope does not match the target account type.",
        400,
      );
    }
  }

  /** Prevents platform-only permission namespaces from being placed on seller/customer roles. */
  private assertPermissionMatchesRoleScope(
    roleScopeType: string,
    permissionCode: string,
  ): void {
    const platformOnlyPermission = permissionCode.startsWith("admin.");
    const sellerOnlyPermission = permissionCode.startsWith("seller.");
    const invalidForSeller =
      roleScopeType === ROLE_SCOPE_TYPE.SELLER && platformOnlyPermission;
    const invalidForCustomer =
      roleScopeType === ROLE_SCOPE_TYPE.CUSTOMER &&
      (platformOnlyPermission || sellerOnlyPermission);

    if (invalidForSeller || invalidForCustomer) {
      throw adminError(
        ADMIN_ERROR_CODE.ROLE_PERMISSION_ASSIGNMENT_INVALID,
        "The permission namespace is not valid for this role scope.",
        400,
      );
    }
  }

  /** Loads seller-scoped roles that a seller owner may safely delegate to staff. */
  private async listSellerAssignableRoles(
    context: RequestContext,
    query: RoleListQuery,
  ): Promise<PaginatedServiceResult<RoleResponse>> {
    const roleIds: string[] = [];
    let sourcePage = 1;

    while (true) {
      const result = await this.repository.listRoles({
        ...query,
        page: sourcePage,
        pageSize: 100,
        status: ROLE_STATUS.ACTIVE,
      });
      roleIds.push(...result.items.map((role) => role.id));
      if (sourcePage * 100 >= result.totalItems) break;
      sourcePage += 1;
    }

    const details = await Promise.all(
      roleIds.map((roleId) => this.repository.findRoleById(roleId)),
    );
    const assignable = details
      .filter((role): role is RoleWithPermissionsRecord => Boolean(role))
      .filter((role) => role.scopeType === ROLE_SCOPE_TYPE.SELLER)
      .filter(
        (role) =>
          !role.permissions.some(
            (permission) => permission.code === ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
          ),
      )
      .filter((role) =>
        role.permissions.every((permission) => context.permissions.has(permission.code)),
      )
      .map((role) => this.toRoleResponse(role));

    const start = (query.page - 1) * query.pageSize;
    return {
      items: assignable.slice(start, start + query.pageSize),
      meta: paginationMeta(query, assignable.length),
    };
  }

  /** Ensures default currency remains inside the configured supported-currency list. */
  private assertCurrencySettingsConsistent(values: Map<string, unknown>): void {
    const supported = values.get(PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES);
    const defaultCurrency = values.get(PLATFORM_SETTING_KEY.DEFAULT_CURRENCY);
    if (defaultCurrency === undefined) return;

    if (
      !Array.isArray(supported) ||
      !supported.includes(defaultCurrency)
    ) {
      throw adminError(
        ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID,
        "Default currency must be included in supported currencies.",
        400,
      );
    }
  }

  /** Prevents normal commands from mutating protected system roles. */
  private assertRoleMutable(role: RoleWithPermissionsRecord): void {
    if (role.isSystem) {
      throw adminError(
        ADMIN_ERROR_CODE.SYSTEM_ROLE_PROTECTED,
        "System roles cannot be modified through normal Administration commands.",
        409,
      );
    }
  }

  /** Returns the stable user-not-found business error. */
  private userNotFound(): AppError {
    return adminError(
      ADMIN_ERROR_CODE.USER_NOT_FOUND,
      "User not found.",
      404,
    );
  }

  /** Returns the stable role-not-found business error. */
  private roleNotFound(): AppError {
    return adminError(
      ADMIN_ERROR_CODE.ROLE_NOT_FOUND,
      "Role not found.",
      404,
    );
  }

  /** Hides unrelated role memberships from seller staff managers during exact-email lookup. */
  private toSellerStaffUserResponse(
    user: UserWithRolesRecord,
    sellerIds: ReadonlySet<string>,
  ): UserResponse {
    const safe = this.toUserResponse(user);
    return {
      ...safe,
      roles: safe.roles.filter(
        (role) => role.sellerId !== null && sellerIds.has(role.sellerId),
      ),
    };
  }

  /** Converts one persisted user aggregate into the safe Administration response shape. */
  private toUserResponse(user: UserWithRolesRecord): UserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accountType: user.accountType as UserResponse["accountType"],
      status: user.status as UserResponse["status"],
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      roles: user.roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        scopeType: role.scopeType as UserResponse["roles"][number]["scopeType"],
        sellerId: role.sellerId,
        isSystem: role.isSystem,
        status: role.status as UserResponse["roles"][number]["status"],
      })),
    };
  }

  /** Converts one persisted role aggregate into the safe Administration response shape. */
  private toRoleResponse(role: RoleWithPermissionsRecord): RoleResponse {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      scopeType: role.scopeType as RoleResponse["scopeType"],
      description: role.description,
      isSystem: role.isSystem,
      status: role.status as RoleResponse["status"],
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
      permissions: role.permissions.map((permission) =>
        this.toPermissionResponse(permission),
      ),
    };
  }

  /** Converts one permission row into the safe Administration response shape. */
  private toPermissionResponse(permission: {
    id: string;
    code: string;
    domain: string;
    description: string;
  }): PermissionResponse {
    return {
      id: permission.id,
      code: permission.code,
      domain: permission.domain,
      description: permission.description,
    };
  }

  /** Converts one persisted non-secret platform setting into the public Administration response shape. */
  private toPlatformSettingResponse(setting: {
    key: string;
    valueJson: unknown;
    updatedBy: string | null;
    updatedAt: Date;
  }): PlatformSettingResponse {
    return {
      key: setting.key,
      value: setting.valueJson,
      updatedBy: setting.updatedBy,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }
}
