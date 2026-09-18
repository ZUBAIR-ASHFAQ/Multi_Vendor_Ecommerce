import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  refreshSessions,
  users,
  type RefreshSessionRow,
  type NewRefreshSessionRow,
  type UserRow,
} from "../../database/schema/administration.js";
import type { DatabaseExecutor } from "../../database/types.js";

interface RotateSessionInput {
  currentSessionId: string;
  currentSessionRevokedAt: Date;
  currentSessionLastUsedAt: Date;
  revokeReason: string;
  replacement: NewRefreshSessionRow;
}

interface LoginFailureStateInput {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Persistence-only access for authentication identities and refresh sessions.
 * Authentication policy, token generation, authorization and transaction boundaries belong to services.
 */
export class AuthRepository {
  /** Creates a repository that can use either the root DB client or a transaction client. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Resolves a user by normalized email for credential verification. */
  async findUserByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.executor
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return row ?? null;
  }

  /** Resolves a user by immutable identifier. */
  async findUserById(userId: string): Promise<UserRow | null> {
    const [row] = await this.executor
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row ?? null;
  }

  /** Persists a refresh-token session. Only the already-derived token hash is accepted. */
  async createSession(input: NewRefreshSessionRow): Promise<RefreshSessionRow> {
    const [row] = await this.executor
      .insert(refreshSessions)
      .values(input)
      .returning();

    if (!row) {
      throw new Error("Failed to create authentication session.");
    }

    return row;
  }

  /** Finds a refresh-token session by its hash, never by a raw token. */
  async findSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<RefreshSessionRow | null> {
    const [row] = await this.executor
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);

    return row ?? null;
  }

  /** Finds a session by its internal identifier. */
  async findSessionById(sessionId: string): Promise<RefreshSessionRow | null> {
    const [row] = await this.executor
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.id, sessionId))
      .limit(1);

    return row ?? null;
  }

  /** Revokes one still-active session and preserves its history. */
  async revokeSession(
    sessionId: string,
    revokedAt: Date,
    revokeReason: string,
  ): Promise<RefreshSessionRow | null> {
    const [row] = await this.executor
      .update(refreshSessions)
      .set({
        revokedAt,
        revokeReason,
        lastUsedAt: revokedAt,
      })
      .where(and(eq(refreshSessions.id, sessionId), isNull(refreshSessions.revokedAt)))
      .returning();

    return row ?? null;
  }

  /** Revokes every active session for a user. */
  async revokeAllUserSessions(
    userId: string,
    revokedAt: Date,
    revokeReason: string,
    exceptSessionId?: string,
  ): Promise<RefreshSessionRow[]> {
    return this.executor
      .update(refreshSessions)
      .set({ revokedAt, revokeReason, lastUsedAt: revokedAt })
      .where(
        and(
          eq(refreshSessions.userId, userId),
          isNull(refreshSessions.revokedAt),
          exceptSessionId ? ne(refreshSessions.id, exceptSessionId) : undefined,
        ),
      )
      .returning();
  }

  /** Revokes every active session in one refresh-token family. */
  async revokeSessionFamily(
    tokenFamilyHash: string,
    revokedAt: Date,
    revokeReason: string,
  ): Promise<RefreshSessionRow[]> {
    return this.executor
      .update(refreshSessions)
      .set({ revokedAt, revokeReason, lastUsedAt: revokedAt })
      .where(
        and(
          eq(refreshSessions.tokenFamilyHash, tokenFamilyHash),
          isNull(refreshSessions.revokedAt),
        ),
      )
      .returning();
  }

  /**
   * Marks the current refresh session rotated and inserts its replacement.
   * Services must call this method through a transaction-bound repository for atomic rotation.
   */
  async rotateSession(input: RotateSessionInput): Promise<RefreshSessionRow> {
    const [revoked] = await this.executor
      .update(refreshSessions)
      .set({
        revokedAt: input.currentSessionRevokedAt,
        revokeReason: input.revokeReason,
        lastUsedAt: input.currentSessionLastUsedAt,
      })
      .where(
        and(
          eq(refreshSessions.id, input.currentSessionId),
          isNull(refreshSessions.revokedAt),
        ),
      )
      .returning({ id: refreshSessions.id });

    if (!revoked) {
      throw new Error("Current authentication session could not be rotated.");
    }

    return this.createSession(input.replacement);
  }

  /** Records a successful login and clears temporary credential-failure state. */
  async recordSuccessfulLogin(
    userId: string,
    lastLoginAt: Date,
  ): Promise<UserRow | null> {
    const [row] = await this.executor
      .update(users)
      .set({
        lastLoginAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: lastLoginAt,
      })
      .where(eq(users.id, userId))
      .returning();

    return row ?? null;
  }

  /** Persists service-calculated failed-login/temporary-lock state. */
  async updateLoginFailureState(
    userId: string,
    input: LoginFailureStateInput,
    updatedAt: Date,
  ): Promise<UserRow | null> {
    const [row] = await this.executor
      .update(users)
      .set({
        failedLoginAttempts: input.failedLoginAttempts,
        lockedUntil: input.lockedUntil,
        updatedAt,
      })
      .where(eq(users.id, userId))
      .returning();

    return row ?? null;
  }
}
