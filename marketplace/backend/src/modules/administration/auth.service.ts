import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { PasswordService } from "../../common/security/password.service.js";
import { RefreshTokenService } from "../../common/security/refresh-token.service.js";
import {
  ACTOR_TYPE,
  type ActorType,
  type PermissionCode,
} from "../../common/security/security.contract.js";
import { AccessTokenService } from "../../common/security/token.service.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { env } from "../../config/env.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AdministrationRepository } from "./administration.repository.js";
import {
  ACCOUNT_TYPE,
  type AccountType,
  ADMIN_AUDIT_EVENT,
  ADMIN_OUTBOX_EVENT,
  ROLE_SCOPE_TYPE,
  ROLE_STATUS,
  SYSTEM_ROLE,
  USER_STATUS,
} from "./administration.constants.js";
import type {
  RoleSummaryRecord,
  UserPermissionGrantRecord,
} from "./administration.repository.js";
import {
  AUTH_AUDIT_EVENT,
  AUTH_ERROR_CODE,
  AUTH_LIMITS,
  AUTH_OUTBOX_EVENT,
  SESSION_REVOKE_REASON,
} from "./auth.constants.js";
import { AuthRepository } from "./auth.repository.js";
import type {
  AuthClientMetadata,
  AuthenticatedUser,
  LoginInput,
  RegisterInput,
  RegisterResponse,
} from "./auth.types.js";

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresAt: Date;
  user: AuthenticatedUser;
}

export interface AuthenticatedAccess {
  context: RequestContext;
}

export interface CustomerRegistrationProvisionInput {
  transaction: DatabaseTransaction;
  userId: string;
  displayName: string;
  accountType: AccountType;
  requestId?: string;
}

/** Provisions downstream customer data while reusing the Module 2 registration transaction. */
export type CustomerRegistrationProvisioner = (
  input: CustomerRegistrationProvisionInput,
) => Promise<void>;

/** Input supplied to Module 4 after Module 2 has resolved seller-scoped role memberships. */
export interface SellerAccessScopeResolutionInput {
  userId: string;
  authorizedSellerIds: string[];
}

/** Active seller/store scopes returned by the downstream seller module. */
export interface SellerAccessScopeResolution {
  sellerIds: string[];
  storeIds: string[];
}

/** Filters seller role hints through current seller/staff/store lifecycle state. */
export type SellerAccessScopeResolver = (
  input: SellerAccessScopeResolutionInput,
) => Promise<SellerAccessScopeResolution>;

type AccessTokenActorType = Exclude<
  ActorType,
  typeof ACTOR_TYPE.SYSTEM
>;

interface ResolvedAuthenticationState {
  user: AuthenticatedUser;
  actorType: AccessTokenActorType;
  grants: UserPermissionGrantRecord[];
}

export type TransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Creates one stable authentication business error. */
function authError(code: string, message: string, statusCode = 401): AppError {
  return new AppError({ code, message, statusCode });
}

/** Returns the non-enumerating invalid-credentials error. */
function invalidCredentialsError(): AppError {
  return authError(
    AUTH_ERROR_CODE.INVALID_CREDENTIALS,
    "Email or password is incorrect.",
  );
}

/** Converts optional user-agent metadata into a fixed SHA-256 value before database persistence. */
function hashUserAgent(userAgent: string | null): string | null {
  if (!userAgent) {
    return null;
  }

  return createHash("sha256").update(userAgent, "utf8").digest("hex");
}

/** Reads a PostgreSQL error code through wrapped error causes when present. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Maps the persisted account category to the server actor category. */
function actorTypeForAccountType(
  accountType: string,
): AccessTokenActorType {
  if (accountType === ACCOUNT_TYPE.PLATFORM_ADMIN) return ACTOR_TYPE.PLATFORM_ADMIN;
  if (accountType === ACCOUNT_TYPE.SELLER) return ACTOR_TYPE.SELLER;
  if (accountType === ACCOUNT_TYPE.CUSTOMER) return ACTOR_TYPE.CUSTOMER;
  throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
}

/**
 * Authentication application service. It owns credential/session policy and transaction orchestration;
 * controllers own cookies/HTTP and repositories own persistence only.
 */
export class AuthService {
  private readonly dummyPasswordHash: Promise<string>;

  /** Stores authentication dependencies without importing downstream business modules. */
  constructor(
    private readonly customerRegistrationProvisioner: CustomerRegistrationProvisioner | null = null,
    private readonly sellerAccessScopeResolver: SellerAccessScopeResolver | null = null,
    private readonly authRepository = new AuthRepository(),
    private readonly administrationRepository = new AdministrationRepository(),
    private readonly passwordService = new PasswordService(),
    private readonly accessTokenService = new AccessTokenService(),
    private readonly refreshTokenService = new RefreshTokenService(),
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {
    // A valid hash makes unknown-user login verification follow the same expensive primitive as known users.
    this.dummyPasswordHash = this.passwordService.hash(
      "module2-login-timing-equalizer-not-a-user-credential",
    );
  }

  /** Registers a customer identity and provisions its Module 3 commerce profile in the same transaction. */
  async registerCustomer(
    input: RegisterInput,
    requestId?: string,
  ): Promise<RegisterResponse> {
    const email = input.email.trim().toLowerCase();
    if (await this.administrationRepository.findUserByEmail(email)) {
      throw authError(
        AUTH_ERROR_CODE.REGISTRATION_EMAIL_TAKEN,
        "An account with this email already exists.",
        409,
      );
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const now = new Date();

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new AdministrationRepository(tx);
        const audit = AuditService.using(tx);
        const outbox = OutboxService.using(tx);
        const created = await repository.createUser({
          email,
          displayName: input.displayName.trim(),
          passwordHash,
          accountType: ACCOUNT_TYPE.CUSTOMER,
          status: USER_STATUS.ACTIVE,
          passwordChangedAt: now,
        });

        await audit.record({
          actorType: ACTOR_TYPE.SYSTEM,
          action: ADMIN_AUDIT_EVENT.USER_CREATED,
          entityType: "user",
          entityId: created.id,
          ...(requestId !== undefined ? { requestId } : {}),
          after: {
            id: created.id,
            email: created.email,
            accountType: ACCOUNT_TYPE.CUSTOMER,
            status: created.status,
          },
        });
        await outbox.enqueue({
          eventType: ADMIN_OUTBOX_EVENT.USER_CREATED,
          aggregateType: "user",
          aggregateId: created.id,
          payload: {
            userId: created.id,
            accountType: ACCOUNT_TYPE.CUSTOMER,
            status: created.status,
            createdAt: now.toISOString(),
          },
        });

        // Every registered customer receives the protected self-service role in the same transaction.
        const customerRole = await repository.findRoleByCode(
          SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.code,
        );
        if (
          !customerRole ||
          customerRole.scopeType !== SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.scopeType ||
          !customerRole.isSystem
        ) {
          throw new Error(
            "The customer_self_service system role is missing or has an invalid scope.",
          );
        }
        await repository.replaceUserRoleAssignments(
          created.id,
          [{ roleId: customerRole.id, sellerId: null }],
          null,
        );

        // Application composition supplies the downstream Module 3 provisioner.
        // AuthService knows only this callback contract and keeps the registration transaction atomic.
        if (!this.customerRegistrationProvisioner) {
          throw new Error("Customer registration provisioning is not configured.");
        }
        await this.customerRegistrationProvisioner({
          transaction: tx,
          userId: created.id,
          displayName: created.displayName,
          accountType: ACCOUNT_TYPE.CUSTOMER,
          ...(requestId !== undefined ? { requestId } : {}),
        });

        return {
          id: created.id,
          email: created.email,
          displayName: created.displayName,
          accountType: ACCOUNT_TYPE.CUSTOMER,
          status: created.status as RegisterResponse["status"],
        };
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw authError(
          AUTH_ERROR_CODE.REGISTRATION_EMAIL_TAKEN,
          "An account with this email already exists.",
          409,
        );
      }
      throw error;
    }
  }

  /** Verifies credentials, applies temporary-lock policy and creates one refresh session atomically. */
  async login(
    input: LoginInput,
    metadata: AuthClientMetadata,
    requestId?: string,
  ): Promise<IssuedAuthSession> {
    const now = new Date();
    const user = await this.authRepository.findUserByEmail(input.email);

    if (!user) {
      await this.passwordService.verify(await this.dummyPasswordHash, input.password);
      await this.recordUnknownLoginFailure(requestId);
      throw invalidCredentialsError();
    }

    const passwordMatches = await this.passwordService.verify(
      user.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      const temporaryLockActive =
        user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
      if (user.status === USER_STATUS.ACTIVE && !temporaryLockActive) {
        await this.recordFailedLogin(user.id, requestId, now);
      } else {
        await this.recordKnownLoginFailureWithoutStateChange(user.id, requestId);
      }
      throw invalidCredentialsError();
    }

    // Account status is disclosed only after valid credential proof.
    this.assertUserMayAuthenticate(user.status, user.lockedUntil, now);

    const state = await this.resolveAuthenticationState(user.id);
    const resolved = state.user;
    const sessionId = randomUUID();
    const tokenFamilyHash = this.refreshTokenService.generateFamilyHash();
    const refreshToken = this.refreshTokenService.generate();
    const refreshExpiresAt = this.addSeconds(now, env.REFRESH_TOKEN_TTL_SECONDS);
    const accessToken = await this.accessTokenService.sign({
      sub: user.id,
      sessionId,
      actorType: state.actorType,
      sellerId: this.singleSellerId(resolved),
      permissions: resolved.permissions,
    });

    await this.transactionRunner(async (tx) => {
      const authRepository = new AuthRepository(tx);
      const audit = AuditService.using(tx);

      await authRepository.createSession({
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.refreshTokenService.hash(refreshToken),
        tokenFamilyHash,
        expiresAt: refreshExpiresAt,
        lastUsedAt: now,
        ipAddress: metadata.ipAddress,
        userAgentHash: hashUserAgent(metadata.userAgent),
      });
      await authRepository.recordSuccessfulLogin(user.id, now);
      await audit.record({
        actorId: user.id,
        actorType: state.actorType,
        action: AUTH_AUDIT_EVENT.LOGIN_SUCCEEDED,
        entityType: "auth_session",
        entityId: sessionId,
        ...(requestId !== undefined ? { requestId } : {}),
        metadata: {
          tokenFamilyHash,
          ipAddress: metadata.ipAddress,
        },
      });
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshExpiresAt,
      user: resolved,
    };
  }

  /** Rotates a refresh credential, detecting replay of an already-rotated token family. */
  async refresh(
    rawRefreshToken: string,
    metadata: AuthClientMetadata,
    requestId?: string,
  ): Promise<IssuedAuthSession> {
    const now = new Date();
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);
    const current = await this.authRepository.findSessionByRefreshTokenHash(tokenHash);

    if (!current) {
      throw authError(
        AUTH_ERROR_CODE.SESSION_NOT_FOUND,
        "The refresh session is invalid.",
      );
    }

    if (current.revokedAt) {
      if (current.revokeReason === SESSION_REVOKE_REASON.ROTATED) {
        await this.handleRefreshReuse(current.tokenFamilyHash, current.userId, requestId, now);
        throw authError(
          AUTH_ERROR_CODE.REFRESH_REUSE_DETECTED,
          "Refresh-token reuse was detected. Sign in again.",
        );
      }

      throw authError(
        AUTH_ERROR_CODE.SESSION_REVOKED,
        "The refresh session has been revoked.",
      );
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      throw authError(
        AUTH_ERROR_CODE.SESSION_EXPIRED,
        "The refresh session has expired.",
      );
    }

    const user = await this.authRepository.findUserById(current.userId);
    if (!user) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }
    this.assertUserMayAuthenticate(user.status, user.lockedUntil, now);

    const state = await this.resolveAuthenticationState(user.id);
    const resolved = state.user;
    const replacementSessionId = randomUUID();
    const replacementRefreshToken = this.refreshTokenService.generate();
    const refreshExpiresAt = this.addSeconds(now, env.REFRESH_TOKEN_TTL_SECONDS);
    const accessToken = await this.accessTokenService.sign({
      sub: user.id,
      sessionId: replacementSessionId,
      actorType: state.actorType,
      sellerId: this.singleSellerId(resolved),
      permissions: resolved.permissions,
    });

    try {
      await this.transactionRunner(async (tx) => {
        const authRepository = new AuthRepository(tx);
        const audit = AuditService.using(tx);

        await authRepository.rotateSession({
          currentSessionId: current.id,
          currentSessionRevokedAt: now,
          currentSessionLastUsedAt: now,
          revokeReason: SESSION_REVOKE_REASON.ROTATED,
          replacement: {
            id: replacementSessionId,
            userId: user.id,
            refreshTokenHash: this.refreshTokenService.hash(
              replacementRefreshToken,
            ),
            tokenFamilyHash: current.tokenFamilyHash,
            expiresAt: refreshExpiresAt,
            lastUsedAt: now,
            ipAddress: metadata.ipAddress,
            userAgentHash: hashUserAgent(metadata.userAgent),
          },
        });
        await audit.record({
          actorId: user.id,
          actorType: state.actorType,
          action: AUTH_AUDIT_EVENT.REFRESH_ROTATED,
          entityType: "auth_session",
          entityId: replacementSessionId,
          ...(requestId !== undefined ? { requestId } : {}),
          metadata: {
            previousSessionId: current.id,
            tokenFamilyHash: current.tokenFamilyHash,
          },
        });
      });
    } catch (error) {
      // A concurrent replay can lose the conditional rotate after the initial read.
      const latest = await this.authRepository.findSessionById(current.id);
      if (latest?.revokedAt && latest.revokeReason === SESSION_REVOKE_REASON.ROTATED) {
        await this.handleRefreshReuse(current.tokenFamilyHash, current.userId, requestId, now);
        throw authError(
          AUTH_ERROR_CODE.REFRESH_REUSE_DETECTED,
          "Refresh-token reuse was detected. Sign in again.",
        );
      }
      throw error;
    }

    return {
      accessToken,
      refreshToken: replacementRefreshToken,
      expiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshExpiresAt,
      user: resolved,
    };
  }

  /** Idempotently revokes the refresh session represented by a cookie value. */
  async logout(rawRefreshToken: string | null, requestId?: string): Promise<void> {
    if (!rawRefreshToken) return;

    const current = await this.authRepository.findSessionByRefreshTokenHash(
      this.refreshTokenService.hash(rawRefreshToken),
    );
    if (!current || current.revokedAt) return;

    const user = await this.authRepository.findUserById(current.userId);
    const auditActorType = user
      ? actorTypeForAccountType(user.accountType)
      : ACTOR_TYPE.SYSTEM;
    const now = new Date();
    await this.transactionRunner(async (tx) => {
      const authRepository = new AuthRepository(tx);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);
      const revoked = await authRepository.revokeSession(
        current.id,
        now,
        SESSION_REVOKE_REASON.LOGOUT,
      );
      if (!revoked) return;

      await audit.record({
        actorId: current.userId,
        actorType: auditActorType,
        action: AUTH_AUDIT_EVENT.LOGOUT,
        entityType: "auth_session",
        entityId: current.id,
        ...(requestId !== undefined ? { requestId } : {}),
      });
      await this.enqueueSessionRevokedEvents(
        outbox,
        [revoked],
        SESSION_REVOKE_REASON.LOGOUT,
        now,
      );
    });
  }

  /** Verifies an access token against current session/user/RBAC state and builds DB-derived request context. */
  async authenticateAccessToken(
    rawAccessToken: string,
    requestId: string,
  ): Promise<AuthenticatedAccess> {
    let claims;
    try {
      claims = await this.accessTokenService.verify(rawAccessToken);
    } catch {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }

    const now = new Date();
    const session = await this.authRepository.findSessionById(claims.sessionId);
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }

    const persistedUser = await this.authRepository.findUserById(claims.sub);
    if (!persistedUser) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }
    this.assertUserMayAuthenticate(
      persistedUser.status,
      persistedUser.lockedUntil,
      now,
    );

    // Database state is authoritative. JWT permission/seller claims are never reused as current authorization state.
    const state = await this.resolveAuthenticationState(persistedUser.id);
    if (claims.actorType !== state.actorType) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }

    const sellerPermissions = new Map<string, Set<PermissionCode>>();
    for (const grant of state.grants) {
      if (
        grant.roleStatus !== ROLE_STATUS.ACTIVE ||
        grant.roleScopeType !== ROLE_SCOPE_TYPE.SELLER ||
        !grant.sellerId
      ) {
        continue;
      }
      const scoped = sellerPermissions.get(grant.sellerId) ?? new Set<PermissionCode>();
      scoped.add(grant.permission.code as PermissionCode);
      sellerPermissions.set(grant.sellerId, scoped);
    }

    const context: RequestContext = {
      requestId,
      actorId: persistedUser.id,
      actorType: state.actorType,
      permissions: new Set(state.user.permissions),
      sellerIds: new Set(state.user.scopes.sellerIds),
      // Store scope is resolved from current Module 4 seller/store state, never from client/JWT claims.
      storeIds: new Set(state.user.scopes.storeIds),
      sellerPermissions,
      sessionId: session.id,
    };

    return { context };
  }

  /** Returns the current safe identity using an already-authenticated server request context. */
  async me(context: RequestContext): Promise<AuthenticatedUser> {
    return this.resolveAuthenticatedUser(this.requireActorId(context));
  }

  /** Resolves active and scope-valid roles into the frontend-safe authenticated-user model. */
  async resolveAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    return (await this.resolveAuthenticationState(userId)).user;
  }

  /** Resolves the persisted identity, actor type and scope-aware grants in one reusable read. */
  private async resolveAuthenticationState(
    userId: string,
  ): Promise<ResolvedAuthenticationState> {
    const persistedUser = await this.administrationRepository.findUserById(userId);
    if (!persistedUser) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }

    const actorType = actorTypeForAccountType(persistedUser.accountType);
    const accountMatchedRoles = persistedUser.roles.filter(
      (role) =>
        role.status === ROLE_STATUS.ACTIVE &&
        this.roleMatchesAccountType(
          persistedUser.accountType,
          role.scopeType,
          role.sellerId,
        ),
    );
    const roleSellerIds = Array.from(
      new Set(
        accountMatchedRoles.flatMap((role) =>
          role.sellerId ? [role.sellerId] : [],
        ),
      ),
    ).sort();
    const resolvedScopes = this.sellerAccessScopeResolver
      ? await this.sellerAccessScopeResolver({
          userId,
          authorizedSellerIds: roleSellerIds,
        })
      : { sellerIds: roleSellerIds, storeIds: [] };
    const roleSellerIdSet = new Set(roleSellerIds);
    const activeSellerIds = new Set(
      resolvedScopes.sellerIds.filter((sellerId) => roleSellerIdSet.has(sellerId)),
    );
    const roles = accountMatchedRoles.filter(
      (role) =>
        role.scopeType !== ROLE_SCOPE_TYPE.SELLER ||
        (role.sellerId !== null && activeSellerIds.has(role.sellerId)),
    );
    const allowedMemberships = new Set(
      roles.map((role) => `${role.id}:${role.sellerId ?? "global"}`),
    );
    const grants = (await this.administrationRepository.getUserPermissions(userId)).filter(
      (grant) =>
        grant.roleStatus === ROLE_STATUS.ACTIVE &&
        allowedMemberships.has(`${grant.roleId}:${grant.sellerId ?? "global"}`) &&
        this.permissionMatchesRoleScope(
          grant.roleScopeType,
          grant.permission.code,
        ),
    );
    const permissions = Array.from(
      new Set(grants.map((grant) => grant.permission.code as PermissionCode)),
    ).sort();

    return {
      actorType,
      grants,
      user: {
        id: persistedUser.id,
        email: persistedUser.email,
        displayName: persistedUser.displayName,
        accountType: persistedUser.accountType as AuthenticatedUser["accountType"],
        status: persistedUser.status as AuthenticatedUser["status"],
        roles: roles.map(this.toAuthenticatedRole),
        permissions,
        scopes: {
          sellerIds: [...activeSellerIds].sort(),
          storeIds: Array.from(new Set(resolvedScopes.storeIds)).sort(),
        },
      },
    };
  }

  /** Returns true only when a role membership has a valid scope for the persisted account category. */
  private roleMatchesAccountType(
    accountType: string,
    roleScopeType: string,
    sellerId: string | null,
  ): boolean {
    if (accountType === ACCOUNT_TYPE.PLATFORM_ADMIN) {
      return roleScopeType === ROLE_SCOPE_TYPE.PLATFORM && sellerId === null;
    }
    if (accountType === ACCOUNT_TYPE.CUSTOMER) {
      return roleScopeType === ROLE_SCOPE_TYPE.CUSTOMER && sellerId === null;
    }
    if (accountType === ACCOUNT_TYPE.SELLER) {
      return roleScopeType === ROLE_SCOPE_TYPE.SELLER && sellerId !== null;
    }
    return false;
  }

  /** Returns true when a permission namespace is safe for the role scope that granted it. */
  private permissionMatchesRoleScope(
    roleScopeType: string,
    permissionCode: string,
  ): boolean {
    if (roleScopeType === ROLE_SCOPE_TYPE.SELLER) {
      return !permissionCode.startsWith("admin.");
    }
    if (roleScopeType === ROLE_SCOPE_TYPE.CUSTOMER) {
      return (
        !permissionCode.startsWith("admin.") &&
        !permissionCode.startsWith("seller.")
      );
    }
    return roleScopeType === ROLE_SCOPE_TYPE.PLATFORM;
  }

  /** Converts one persisted role membership into the safe authentication response shape. */
  private readonly toAuthenticatedRole = (role: RoleSummaryRecord) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    scopeType: role.scopeType as AuthenticatedUser["roles"][number]["scopeType"],
    sellerId: role.sellerId,
  });

  /** Rejects disabled, locked or temporarily locked identities. */
  private assertUserMayAuthenticate(
    status: string,
    lockedUntil: Date | null,
    now: Date,
  ): void {
    if (status === USER_STATUS.LOCKED) {
      throw authError(AUTH_ERROR_CODE.USER_LOCKED, "The account is locked.", 423);
    }
    if (status !== USER_STATUS.ACTIVE) {
      throw authError(
        AUTH_ERROR_CODE.USER_INACTIVE,
        "The account is not active.",
        403,
      );
    }
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
      throw authError(
        AUTH_ERROR_CODE.USER_LOCKED,
        "The account is temporarily locked.",
        423,
      );
    }
  }

  /** Audits a failed login without exposing whether the email exists. */
  private async recordUnknownLoginFailure(requestId?: string): Promise<void> {
    await this.transactionRunner(async (tx) => {
      await AuditService.using(tx).record({
        actorType: ACTOR_TYPE.SYSTEM,
        action: AUTH_AUDIT_EVENT.LOGIN_FAILED,
        entityType: "authentication",
        ...(requestId !== undefined ? { requestId } : {}),
        metadata: { reason: "invalid_credentials" },
      });
    });
  }

  /** Audits a known-user failed login when account state must not change. */
  private async recordKnownLoginFailureWithoutStateChange(
    userId: string,
    requestId?: string,
  ): Promise<void> {
    await this.transactionRunner(async (tx) => {
      await AuditService.using(tx).record({
        actorId: userId,
        actorType: ACTOR_TYPE.SYSTEM,
        action: AUTH_AUDIT_EVENT.LOGIN_FAILED,
        entityType: "user",
        entityId: userId,
        ...(requestId !== undefined ? { requestId } : {}),
        metadata: { reason: "invalid_credentials" },
      });
    });
  }

  /** Applies the failed-login counter/temporary lock policy and records the security audit. */
  private async recordFailedLogin(
    userId: string,
    requestId: string | undefined,
    now: Date,
  ): Promise<void> {
    const lockUntil = new Date(
      now.getTime() + AUTH_LIMITS.FAILED_LOGIN_LOCK_MINUTES * 60_000,
    );

    await this.transactionRunner(async (tx) => {
      const authRepository = new AuthRepository(tx);
      const audit = AuditService.using(tx);
      const updatedUser = await authRepository.recordFailedLoginAttempt(
        userId,
        AUTH_LIMITS.FAILED_LOGIN_LOCK_THRESHOLD,
        lockUntil,
        now,
      );
      const currentUser = updatedUser ?? (await authRepository.findUserById(userId));
      await audit.record({
        actorId: userId,
        actorType: ACTOR_TYPE.SYSTEM,
        action: AUTH_AUDIT_EVENT.LOGIN_FAILED,
        entityType: "user",
        entityId: userId,
        ...(requestId !== undefined ? { requestId } : {}),
        metadata: {
          reason: "invalid_credentials",
          ...(currentUser
            ? {
                failedLoginAttempts: currentUser.failedLoginAttempts,
                lockedUntil: currentUser.lockedUntil?.toISOString() ?? null,
              }
            : {}),
        },
      });
    });
  }

  /** Revokes a replayed refresh-token family and emits durable revocation events. */
  private async handleRefreshReuse(
    tokenFamilyHash: string,
    userId: string,
    requestId: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.transactionRunner(async (tx) => {
      const authRepository = new AuthRepository(tx);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);
      const revoked = await authRepository.revokeSessionFamily(
        tokenFamilyHash,
        now,
        SESSION_REVOKE_REASON.REFRESH_REUSE_DETECTED,
      );
      await this.enqueueSessionRevokedEvents(
        outbox,
        revoked,
        SESSION_REVOKE_REASON.REFRESH_REUSE_DETECTED,
        now,
      );
      await audit.record({
        actorId: userId,
        actorType: ACTOR_TYPE.SYSTEM,
        action: AUTH_AUDIT_EVENT.REFRESH_REUSE_DETECTED,
        entityType: "auth_session_family",
        ...(requestId !== undefined ? { requestId } : {}),
        metadata: { tokenFamilyHash, revokedSessionCount: revoked.length },
      });
    });
  }

  /** Emits one durable auth.session_revoked event per session changed by a command. */
  private async enqueueSessionRevokedEvents(
    outbox: OutboxService,
    sessions: Array<{ id: string; userId: string }>,
    reason: string,
    revokedAt: Date,
  ): Promise<void> {
    for (const session of sessions) {
      await outbox.enqueue({
        eventType: AUTH_OUTBOX_EVENT.SESSION_REVOKED,
        aggregateType: "auth_session",
        aggregateId: session.id,
        payload: {
          sessionId: session.id,
          userId: session.userId,
          reason,
          revokedAt: revokedAt.toISOString(),
        },
      });
    }
  }

  /** Returns the actor ID for any authenticated account category. */
  private requireActorId(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw authError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.");
    }
    return context.actorId;
  }

  /** Returns the only seller scope for the compact JWT hint, otherwise null. */
  private singleSellerId(user: AuthenticatedUser): string | null {
    return user.scopes.sellerIds.length === 1 ? user.scopes.sellerIds[0] ?? null : null;
  }

  /** Adds whole seconds to a Date without mutating the original value. */
  private addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1_000);
  }
}
