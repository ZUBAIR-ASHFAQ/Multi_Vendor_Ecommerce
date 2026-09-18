import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { PasswordService } from "../../src/common/security/password.service.js";
import { RefreshTokenService } from "../../src/common/security/refresh-token.service.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { seedAdministrationRbac } from "../../src/database/seeds/administration.seed.js";
import { createApp } from "../../src/app.js";
import {
  ACCOUNT_TYPE,
  ADMIN_ERROR_CODE,
  ADMIN_PERMISSION,
  SYSTEM_ROLE,
  USER_STATUS,
} from "../../src/modules/administration/administration.constants.js";
import { AUTH_ERROR_CODE, AUTH_LIMITS } from "../../src/modules/administration/auth.constants.js";
import { AuthService } from "../../src/modules/administration/auth.service.js";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "AdminPassword!123";

interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Clears Module 2 state and restores the deterministic Administration RBAC catalog. */
async function resetModule2Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      refresh_sessions,
      user_roles,
      role_permissions,
      platform_settings,
      users,
      permissions,
      roles,
      audit_logs,
      outbox_events,
      idempotency_keys
    RESTART IDENTITY CASCADE
  `);
  await seedAdministrationRbac();
}

/** Creates one active user directly because the removed generic admin-create-user API is outside the approved contract. */
async function createTestUser(
  email: string,
  password: string,
  accountType: string = ACCOUNT_TYPE.PLATFORM_ADMIN,
): Promise<TestUser> {
  const passwordHash = await new PasswordService().hash(password);
  const result = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, $3, $4, 'active', now())
     returning id`,
    [email, passwordHash, email.split("@", 1)[0] ?? "Test User", accountType],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Failed to create Module 2 test user.");
  return { id, email, password };
}

/** Creates the platform administrator used by protected Module 2 HTTP tests. */
async function createPlatformAdmin(): Promise<TestUser> {
  const admin = await createTestUser(ADMIN_EMAIL, ADMIN_PASSWORD);
  const role = await databasePool.query<{ id: string }>(
    "select id from roles where code = $1",
    [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
  );
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error("Seeded platform_super_admin role was not found.");

  await databasePool.query(
    "insert into user_roles (user_id, role_id, assigned_by) values ($1, $2, $1)",
    [admin.id, roleId],
  );
  return admin;
}

/** Builds the bearer header used by authenticated Supertest requests. */
function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Extracts the HttpOnly refresh-cookie pair from one login/refresh response. */
function refreshCookiePair(
  setCookie: string | string[] | undefined,
): string {
  const values = typeof setCookie === "string" ? [setCookie] : setCookie;
  const cookie = values?.find((value) =>
    value.startsWith("marketplace_refresh="),
  );
  if (!cookie) throw new Error("Refresh cookie was not issued.");
  return cookie.split(";", 1)[0] ?? cookie;
}

/** Logs in the seeded platform administrator through the real HTTP boundary. */
async function httpLoginAsAdmin() {
  const response = await request(createApp())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(200);

  return {
    accessToken: response.body.data.accessToken as string,
    refreshCookie: refreshCookiePair(response.headers["set-cookie"]),
    response,
  };
}

/** Logs in the seeded platform administrator through the service for service-oriented setup. */
async function issueAdminSession() {
  return new AuthService().login(
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { ipAddress: "127.0.0.1", userAgent: "module2-vitest" },
    randomUUID(),
  );
}

/** Returns the methods documented for one OpenAPI path in stable alphabetical order. */
function documentedMethods(pathItem: Record<string, unknown> | undefined): string[] {
  if (!pathItem) return [];
  const methods = ["delete", "get", "patch", "post", "put"];
  return methods.filter((method) => Object.hasOwn(pathItem, method)).sort();
}

beforeEach(async () => {
  await resetModule2Tables();
  await createPlatformAdmin();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 2 approved Auth + Administration integration", () => {
  it("logs in, stores only a refresh hash, and derives the current RBAC context from persistence", async () => {
    const { accessToken, refreshCookie, response } = await httpLoginAsAdmin();

    expect(response.body.data.user.email).toBe(ADMIN_EMAIL);
    expect(response.body.data.user.permissions).toContain(ADMIN_PERMISSION.USERS_READ);
    expect(response.body.data).not.toHaveProperty("refreshToken");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const rawRefreshToken = decodeURIComponent(refreshCookie.split("=", 2)[1] ?? "");
    const session = await databasePool.query<{
      refresh_token_hash: string;
      token_family_hash: string;
      revoked_at: Date | null;
    }>(
      "select refresh_token_hash, token_family_hash, revoked_at from refresh_sessions limit 1",
    );

    expect(session.rows[0]?.refresh_token_hash).toHaveLength(64);
    expect(session.rows[0]?.refresh_token_hash).not.toBe(rawRefreshToken);
    expect(session.rows[0]?.refresh_token_hash).toBe(
      new RefreshTokenService().hash(rawRefreshToken),
    );
    expect(session.rows[0]?.token_family_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.rows[0]?.revoked_at).toBeNull();

    const me = await request(createApp())
      .get("/api/v1/auth/me")
      .set(bearer(accessToken))
      .expect(200);
    expect(me.body.data.email).toBe(ADMIN_EMAIL);
    expect(me.body.data.permissions).toContain(ADMIN_PERMISSION.ROLES_PERMISSIONS_MANAGE);
  });

  it("publishes exactly the approved Module 2 OpenAPI operations and omits removed operations", async () => {
    const response = await request(createApp()).get("/openapi.json").expect(200);
    const paths = response.body.paths as Record<string, Record<string, unknown>>;

    const expected: Record<string, string[]> = {
      "/api/v1/auth/register": ["post"],
      "/api/v1/auth/login": ["post"],
      "/api/v1/auth/refresh": ["post"],
      "/api/v1/auth/logout": ["post"],
      "/api/v1/auth/me": ["get"],
      "/api/v1/admin/users": ["get"],
      "/api/v1/admin/users/{id}/status": ["patch"],
      "/api/v1/admin/users/{id}/roles": ["put"],
      "/api/v1/admin/roles": ["get", "post"],
      "/api/v1/admin/roles/{id}/permissions": ["put"],
      "/api/v1/admin/settings": ["get", "patch"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      expect(documentedMethods(paths[path])).toEqual([...methods].sort());
    }

    for (const removedPath of [
      "/api/v1/auth/logout-all",
      "/api/v1/auth/change-password",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/reset-password",
      "/api/v1/admin/users/{id}",
      "/api/v1/admin/roles/{id}",
      "/api/v1/admin/permissions",
    ]) {
      expect(paths).not.toHaveProperty(removedPath);
    }

    expect(response.body.components.securitySchemes).toHaveProperty("bearerAuth");
    expect(response.body.components.securitySchemes).toHaveProperty("refreshCookie");
  });

  it("returns the standard 404 envelope for all ten removed Module 2 HTTP operations", async () => {
    const { accessToken } = await httpLoginAsAdmin();
    const testId = randomUUID();
    const removedOperations = [
      { method: "post", path: "/api/v1/auth/logout-all" },
      { method: "post", path: "/api/v1/auth/change-password" },
      { method: "post", path: "/api/v1/auth/forgot-password" },
      { method: "post", path: "/api/v1/auth/reset-password" },
      { method: "post", path: "/api/v1/admin/users" },
      { method: "get", path: `/api/v1/admin/users/${testId}` },
      { method: "patch", path: `/api/v1/admin/users/${testId}` },
      { method: "get", path: `/api/v1/admin/roles/${testId}` },
      { method: "patch", path: `/api/v1/admin/roles/${testId}` },
      { method: "get", path: "/api/v1/admin/permissions" },
    ] as const;

    for (const operation of removedOperations) {
      const call = request(createApp())[operation.method](operation.path);
      if (operation.path.startsWith("/api/v1/admin/")) call.set(bearer(accessToken));
      const response = await call.send({}).expect(404);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: ERROR_CODE.RESOURCE_NOT_FOUND },
      });
      expect(response.body.requestId).toEqual(expect.any(String));
    }
  });

  it("rotates refresh tokens and treats reuse of the previous token as a family compromise", async () => {
    const first = await httpLoginAsAdmin();

    const rotated = await request(createApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", first.refreshCookie)
      .send({})
      .expect(200);
    const replacementCookie = refreshCookiePair(rotated.headers["set-cookie"]);
    expect(replacementCookie).not.toBe(first.refreshCookie);

    const replay = await request(createApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", first.refreshCookie)
      .send({})
      .expect(401);
    expect(replay.body.error.code).toBe(AUTH_ERROR_CODE.REFRESH_REUSE_DETECTED);

    const activeSessions = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from refresh_sessions where revoked_at is null",
    );
    expect(activeSessions.rows[0]?.count).toBe(0);

    await request(createApp())
      .get("/api/v1/auth/me")
      .set(bearer(rotated.body.data.accessToken as string))
      .expect(401);
  });

  it("keeps logout retry-safe when the same refresh credential is submitted more than once", async () => {
    const { refreshCookie } = await httpLoginAsAdmin();

    const first = await request(createApp())
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshCookie)
      .send({})
      .expect(200);
    expect(first.body.data).toEqual({ loggedOut: true });

    const repeated = await request(createApp())
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshCookie)
      .send({})
      .expect(200);
    expect(repeated.body.data).toEqual({ loggedOut: true });

    const activeSessions = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from refresh_sessions where revoked_at is null",
    );
    expect(activeSessions.rows[0]?.count).toBe(0);
  });

  it("applies failed-login locking without changing the permanent user status", async () => {
    const service = new AuthService();

    for (let attempt = 0; attempt < AUTH_LIMITS.FAILED_LOGIN_LOCK_THRESHOLD; attempt += 1) {
      await expect(
        service.login(
          { email: ADMIN_EMAIL, password: "WrongPassword!123" },
          { ipAddress: "127.0.0.1", userAgent: "module2-vitest" },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: AUTH_ERROR_CODE.INVALID_CREDENTIALS,
        statusCode: 401,
      });
    }

    const state = await databasePool.query<{
      status: string;
      failed_login_attempts: number;
      locked_until: Date | null;
    }>(
      "select status, failed_login_attempts, locked_until from users where email = $1",
      [ADMIN_EMAIL],
    );
    expect(state.rows[0]?.status).toBe(USER_STATUS.ACTIVE);
    expect(state.rows[0]?.failed_login_attempts).toBe(
      AUTH_LIMITS.FAILED_LOGIN_LOCK_THRESHOLD,
    );
    expect(state.rows[0]?.locked_until).toBeTruthy();

    await expect(
      service.login(
        { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        { ipAddress: "127.0.0.1", userAgent: "module2-vitest" },
      ),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODE.USER_LOCKED, statusCode: 423 });
  });

  it("enforces RBAC on approved routes even when a limited user calls the API directly", async () => {
    const admin = await issueAdminSession();
    const limited = await createTestUser("limited@example.com", "LimitedPassword!123");

    const permission = await databasePool.query<{ id: string }>(
      "select id from permissions where code = $1",
      [ADMIN_PERMISSION.USERS_READ],
    );
    const permissionId = permission.rows[0]?.id;
    if (!permissionId) throw new Error("admin.users.read permission is missing.");

    const roleResponse = await request(createApp())
      .post("/api/v1/admin/roles")
      .set(bearer(admin.accessToken))
      .send({ code: "readonly_users", name: "Read-only Users" })
      .expect(201);
    const roleId = roleResponse.body.data.id as string;

    await request(createApp())
      .put(`/api/v1/admin/roles/${roleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionIds: [permissionId] })
      .expect(200);

    await request(createApp())
      .put(`/api/v1/admin/users/${limited.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ assignments: [{ roleId, sellerId: null }] })
      .expect(200);

    const limitedLogin = await new AuthService().login(
      { email: limited.email, password: limited.password },
      { ipAddress: "127.0.0.1", userAgent: "module2-limited" },
      randomUUID(),
    );

    await request(createApp())
      .get("/api/v1/admin/users")
      .set(bearer(limitedLogin.accessToken))
      .expect(200);

    const forbidden = await request(createApp())
      .patch(`/api/v1/admin/users/${limited.id}/status`)
      .set(bearer(limitedLogin.accessToken))
      .send({ status: USER_STATUS.INACTIVE })
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const stored = await databasePool.query<{ status: string }>(
      "select status from users where id = $1",
      [limited.id],
    );
    expect(stored.rows[0]?.status).toBe(USER_STATUS.ACTIVE);
  });

  it("protects system roles through the approved permission-replacement command", async () => {
    const admin = await issueAdminSession();
    const role = await databasePool.query<{ id: string }>(
      "select id from roles where code = $1",
      [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error("System role is missing.");

    const response = await request(createApp())
      .put(`/api/v1/admin/roles/${roleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionIds: [] })
      .expect(409);
    expect(response.body.error.code).toBe(ADMIN_ERROR_CODE.SYSTEM_ROLE_PROTECTED);
  });

  it("rolls back role-permission replacement when any requested permission does not exist", async () => {
    const admin = await issueAdminSession();
    const roleResponse = await request(createApp())
      .post("/api/v1/admin/roles")
      .set(bearer(admin.accessToken))
      .send({ code: "rollback_role", name: "Rollback Role" })
      .expect(201);
    const roleId = roleResponse.body.data.id as string;

    const valid = await databasePool.query<{ id: string }>(
      "select id from permissions where code = $1",
      [ADMIN_PERMISSION.USERS_READ],
    );
    const validId = valid.rows[0]?.id;
    if (!validId) throw new Error("admin.users.read permission is missing.");

    await request(createApp())
      .put(`/api/v1/admin/roles/${roleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionIds: [validId] })
      .expect(200);

    const invalid = await request(createApp())
      .put(`/api/v1/admin/roles/${roleId}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionIds: [validId, randomUUID()] })
      .expect(400);
    expect(invalid.body.error.code).toBe(ADMIN_ERROR_CODE.PERMISSION_NOT_FOUND);

    const rows = await databasePool.query<{ permission_id: string }>(
      "select permission_id from role_permissions where role_id = $1",
      [roleId],
    );
    expect(rows.rows).toEqual([{ permission_id: validId }]);

    const events = await databasePool.query<{ event_type: string; count: number }>(
      `select event_type, count(*)::int as count
       from outbox_events
       where aggregate_type = 'role'
         and aggregate_id = $1
         and event_type in ('role.permissions_changed', 'role.updated')
       group by event_type
       order by event_type`,
      [roleId],
    );
    expect(events.rows).toEqual([
      { event_type: "role.permissions_changed", count: 1 },
      { event_type: "role.updated", count: 1 },
    ]);
  });

  it("deactivates a user through the approved status command and revokes active sessions", async () => {
    const admin = await issueAdminSession();
    const target = await createTestUser("target@example.com", "TargetPassword!123");
    const targetLogin = await new AuthService().login(
      { email: target.email, password: target.password },
      { ipAddress: "127.0.0.1", userAgent: "module2-target" },
      randomUUID(),
    );

    const changed = await request(createApp())
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: USER_STATUS.INACTIVE, reason: "integration test" })
      .expect(200);
    expect(changed.body.data.status).toBe(USER_STATUS.INACTIVE);

    await request(createApp())
      .get("/api/v1/auth/me")
      .set(bearer(targetLogin.accessToken))
      .expect(401);

    await expect(
      new AuthService().login(
        { email: target.email, password: target.password },
        { ipAddress: "127.0.0.1", userAgent: "module2-target" },
      ),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODE.USER_INACTIVE, statusCode: 403 });
  });

  it("rolls back customer identity, RBAC, audit, and outbox writes when downstream registration provisioning fails", async () => {
    const email = `rollback-${randomUUID()}@example.com`;
    const service = new AuthService(async () => {
      throw new Error("test downstream provisioning failure");
    });

    await expect(
      service.registerCustomer(
        {
          email,
          displayName: "Rollback Customer",
          password: "CustomerPassword!123",
        },
        randomUUID(),
      ),
    ).rejects.toThrow("test downstream provisioning failure");

    const user = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from users where email = $1",
      [email],
    );
    const userEvents = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from outbox_events where event_type = 'user.created'",
    );
    const userAudits = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from audit_logs where action = 'admin.user_created'",
    );

    expect(user.rows[0]?.count).toBe(0);
    expect(userEvents.rows[0]?.count).toBe(0);
    expect(userAudits.rows[0]?.count).toBe(0);
  });
});
