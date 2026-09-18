import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/common/security/password.service.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { seedAdministrationRbac } from "../../src/database/seeds/administration.seed.js";
import { createApp } from "../../src/app.js";
import {
  ACCOUNT_TYPE,
  ADMIN_ERROR_CODE,
  ADMIN_PERMISSION,
  PLATFORM_SETTING_KEY,
  SYSTEM_ROLE,
} from "../../src/modules/administration/administration.constants.js";
import { AdministrationRepository } from "../../src/modules/administration/administration.repository.js";
import { AdministrationService } from "../../src/modules/administration/administration.service.js";
import { AUTH_ERROR_CODE } from "../../src/modules/administration/auth.constants.js";
import { AuthService } from "../../src/modules/administration/auth.service.js";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "AdminPassword!123";
const SELLER_MANAGER_PASSWORD = "SellerManager!123";

interface TestAdministrator {
  id: string;
  roleId: string;
}

interface TestSellerRole {
  roleId: string;
}

/** Resets Foundation/Module 2 persistence and reseeds deterministic RBAC catalog data. */
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

/** Creates the deterministic platform administrator used by API and service tests. */
async function createPlatformAdmin(): Promise<TestAdministrator> {
  const role = await databasePool.query<{ id: string }>(
    "select id from roles where code = $1",
    [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
  );
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error("Seeded platform administrator role is missing.");

  const passwordHash = await new PasswordService().hash(ADMIN_PASSWORD);
  const user = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, $3, 'platform_admin', 'active', now())
     returning id`,
    [ADMIN_EMAIL, passwordHash, "Platform Admin"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Failed to create the test platform administrator.");

  await databasePool.query(
    `insert into user_roles (user_id, role_id, seller_id, assigned_by)
     values ($1, $2, null, $1)`,
    [userId, roleId],
  );

  return { id: userId, roleId };
}

/** Creates one active seller account directly because Seller domain onboarding belongs to Module 4. */
async function createSellerUser(
  email: string,
  password = SELLER_MANAGER_PASSWORD,
): Promise<string> {
  const passwordHash = await new PasswordService().hash(password);
  const result = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, $3, 'seller', 'active', now())
     returning id`,
    [email, passwordHash, email.split("@", 1)[0] ?? "Seller User"],
  );
  const userId = result.rows[0]?.id;
  if (!userId) throw new Error("Failed to create seller test user.");
  return userId;
}

/** Creates one active seller master used to keep seller-scoped RBAC tests valid after Module 4 adds the seller foreign key. */
async function createSellerScope(label: string): Promise<string> {
  const ownerId = await createSellerUser(
    `${label}-${randomUUID()}@example.com`,
    "SellerOwner!123",
  );
  const result = await databasePool.query<{ id: string }>(
    `insert into sellers
      (owner_user_id, legal_name, display_name, status, approval_status, approved_at)
     values ($1, $2, $3, 'active', 'approved', now())
     returning id`,
    [ownerId, `${label} Legal Name`, `${label} Seller`],
  );
  const sellerId = result.rows[0]?.id;
  if (!sellerId) throw new Error("Failed to create the seller scope fixture.");
  return sellerId;
}

/** Creates one active seller-scoped role with the requested existing permission codes. */
async function createSellerRole(
  code: string,
  permissionCodes: readonly string[] = [],
): Promise<TestSellerRole> {
  const role = await databasePool.query<{ id: string }>(
    `insert into roles (code, name, scope_type, status, is_system)
     values ($1, $2, 'seller', 'active', false)
     returning id`,
    [code, `Seller role ${code}`],
  );
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error("Failed to create seller test role.");

  if (permissionCodes.length > 0) {
    const permissions = await databasePool.query<{ id: string; code: string }>(
      "select id, code from permissions where code = any($1::text[])",
      [[...permissionCodes]],
    );
    if (permissions.rows.length !== permissionCodes.length) {
      throw new Error("One or more seller test permissions are missing.");
    }

    for (const permission of permissions.rows) {
      await databasePool.query(
        `insert into role_permissions (role_id, permission_id)
         values ($1, $2)`,
        [roleId, permission.id],
      );
    }
  }

  return { roleId };
}

/** Creates an active seller-scoped role containing the seller staff management permission. */
async function createSellerStaffRole(code: string): Promise<TestSellerRole> {
  return createSellerRole(code, [ADMIN_PERMISSION.SELLER_STAFF_MANAGE]);
}

/** Builds the Authorization header expected by protected Module 2 endpoints. */
function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Logs in the seeded platform administrator and returns its access token. */
async function loginAsAdmin(): Promise<string> {
  const response = await request(createApp())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(200);

  return response.body.data.accessToken as string;
}

/** Logs in an arbitrary test user through the real AuthService. */
async function loginDirect(email: string, password: string) {
  return new AuthService().login(
    { email, password },
    { ipAddress: "127.0.0.1", userAgent: "module2-business-rules" },
    randomUUID(),
  );
}

beforeEach(async () => {
  await resetModule2Tables();
  await createPlatformAdmin();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 2 registration and error contracts", () => {
  it("registers only a customer identity and never creates client-selected RBAC ownership", async () => {
    const response = await request(createApp())
      .post("/api/v1/auth/register")
      .send({
        email: " New.Customer@Example.COM ",
        displayName: " New Customer ",
        password: "CustomerPassword!123",
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      email: "new.customer@example.com",
      displayName: "New Customer",
      accountType: ACCOUNT_TYPE.CUSTOMER,
      status: "active",
    });

    const stored = await databasePool.query<{
      id: string;
      account_type: string;
      role_count: number;
    }>(
      `select u.id, u.account_type,
        (select count(*)::int from user_roles ur where ur.user_id = u.id) as role_count
       from users u
       where u.email = $1`,
      ["new.customer@example.com"],
    );

    expect(stored.rows[0]).toMatchObject({
      account_type: ACCOUNT_TYPE.CUSTOMER,
      role_count: 0,
    });
  });

  it("rejects client-supplied account type and role ownership with fieldErrors", async () => {
    const response = await request(createApp())
      .post("/api/v1/auth/register")
      .send({
        email: "malicious@example.com",
        displayName: "Malicious",
        password: "CustomerPassword!123",
        accountType: ACCOUNT_TYPE.PLATFORM_ADMIN,
        roleIds: [randomUUID()],
      })
      .expect(422);

    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.fieldErrors).toEqual(expect.any(Array));
    expect(response.body.error).not.toHaveProperty("fields");

    const stored = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from users where email = $1",
      ["malicious@example.com"],
    );
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("returns the stable registration conflict for a normalized duplicate email", async () => {
    await request(createApp())
      .post("/api/v1/auth/register")
      .send({
        email: "duplicate.customer@example.com",
        displayName: "First Customer",
        password: "CustomerPassword!123",
      })
      .expect(201);

    const duplicate = await request(createApp())
      .post("/api/v1/auth/register")
      .send({
        email: " DUPLICATE.CUSTOMER@EXAMPLE.COM ",
        displayName: "Second Customer",
        password: "OtherCustomer!123",
      })
      .expect(409);

    expect(duplicate.body.error.code).toBe(AUTH_ERROR_CODE.REGISTRATION_EMAIL_TAKEN);
  });
});

describe("Module 2 platform settings", () => {
  it("normalizes allow-listed settings and updates each key without duplicate rows", async () => {
    const accessToken = await loginAsAdmin();

    const updated = await request(createApp())
      .patch("/api/v1/admin/settings")
      .set(bearer(accessToken))
      .send({
        settings: [
          {
            key: PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
            value: ["usd", "EUR", "USD"],
          },
          { key: PLATFORM_SETTING_KEY.DEFAULT_CURRENCY, value: "usd" },
          { key: PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT, value: 7.5 },
        ],
      })
      .expect(200);

    expect(updated.body.data.settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
          value: ["EUR", "USD"],
        }),
        expect.objectContaining({
          key: PLATFORM_SETTING_KEY.DEFAULT_CURRENCY,
          value: "USD",
        }),
        expect.objectContaining({
          key: PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT,
          value: 7.5,
        }),
      ]),
    );

    await request(createApp())
      .patch("/api/v1/admin/settings")
      .set(bearer(accessToken))
      .send({
        settings: [
          { key: PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT, value: 8.25 },
        ],
      })
      .expect(200);

    const stored = await databasePool.query<{ key: string; value_json: unknown }>(
      "select key, value_json from platform_settings order by key",
    );
    expect(stored.rows).toHaveLength(3);
    expect(
      stored.rows.find((row) => row.key === PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT)
        ?.value_json,
    ).toBe(8.25);
  });

  it("rejects unknown settings and inconsistent currency configuration", async () => {
    const accessToken = await loginAsAdmin();

    const unknown = await request(createApp())
      .patch("/api/v1/admin/settings")
      .set(bearer(accessToken))
      .send({ settings: [{ key: "commerce.secret_key", value: "never-store-secrets" }] })
      .expect(400);
    expect(unknown.body.error.code).toBe(ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID);

    const inconsistent = await request(createApp())
      .patch("/api/v1/admin/settings")
      .set(bearer(accessToken))
      .send({
        settings: [
          { key: PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES, value: ["USD"] },
          { key: PLATFORM_SETTING_KEY.DEFAULT_CURRENCY, value: "EUR" },
        ],
      })
      .expect(400);
    expect(inconsistent.body.error.code).toBe(ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID);

    const overPreciseTax = await request(createApp())
      .patch("/api/v1/admin/settings")
      .set(bearer(accessToken))
      .send({
        settings: [
          { key: PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT, value: 7.12345 },
        ],
      })
      .expect(400);
    expect(overPreciseTax.body.error.code).toBe(ADMIN_ERROR_CODE.PLATFORM_SETTING_INVALID);

    const count = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from platform_settings",
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it("denies platform settings to an authenticated user without settings permission", async () => {
    const limitedPassword = "LimitedPassword!123";
    const passwordHash = await new PasswordService().hash(limitedPassword);
    await databasePool.query(
      `insert into users
        (email, password_hash, display_name, account_type, status, password_changed_at)
       values ('limited-settings@example.com', $1, 'Limited Settings', 'platform_admin', 'active', now())`,
      [passwordHash],
    );

    const limited = await loginDirect("limited-settings@example.com", limitedPassword);
    const response = await request(createApp())
      .get("/api/v1/admin/settings")
      .set(bearer(limited.accessToken))
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

describe("Module 2 seller-scope isolation", () => {
  it("allows seller staff management inside Seller A without delegating staff-management authority", async () => {
    const sellerA = await createSellerScope("module2-seller-a");
    const sellerB = await createSellerScope("module2-seller-b");
    const { roleId: staffManagerRoleId } = await createSellerStaffRole(
      "seller_staff_manager",
    );
    const { roleId: basicStaffRoleId } = await createSellerRole(
      "seller_staff_basic",
    );
    const managerId = await createSellerUser("manager-a@example.com");
    const targetId = await createSellerUser(
      "staff-target@example.com",
      "TargetPassword!123",
    );
    const adminToken = await loginAsAdmin();

    await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId: staffManagerRoleId, sellerId: sellerA }] })
      .expect(200);

    const manager = await loginDirect(
      "manager-a@example.com",
      SELLER_MANAGER_PASSWORD,
    );
    expect(manager.user.accountType).toBe(ACCOUNT_TYPE.SELLER);
    expect(manager.user.scopes).toEqual({ sellerIds: [sellerA], storeIds: [] });
    expect(manager.user.permissions).toContain(ADMIN_PERMISSION.SELLER_STAFF_MANAGE);

    await request(createApp())
      .put(`/api/v1/admin/users/${targetId}/roles`)
      .set(bearer(manager.accessToken))
      .send({ assignments: [{ roleId: basicStaffRoleId, sellerId: sellerA }] })
      .expect(200);

    const crossSeller = await request(createApp())
      .put(`/api/v1/admin/users/${targetId}/roles`)
      .set(bearer(manager.accessToken))
      .send({ assignments: [{ roleId: basicStaffRoleId, sellerId: sellerB }] })
      .expect(403);
    expect(crossSeller.body.error.code).toBe(ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN);

    const memberships = await databasePool.query<{ seller_id: string | null }>(
      "select seller_id::text as seller_id from user_roles where user_id = $1 and seller_id is not null order by seller_id",
      [targetId],
    );
    expect(memberships.rows).toEqual([{ seller_id: sellerA }]);
  });

  it("lets seller staff managers search one exact email and read only safe assignable seller roles", async () => {
    const sellerA = await createSellerScope("module2-staff-read-a");
    const sellerB = await createSellerScope("module2-staff-read-b");
    const { roleId: managerRoleId } = await createSellerStaffRole(
      "seller_staff_read_manager",
    );
    const { roleId: basicRoleId } = await createSellerRole(
      "seller_staff_read_basic",
    );
    const managerId = await createSellerUser("manager-read@example.com");
    const targetId = await createSellerUser(
      "staff-read-target@example.com",
      "TargetPassword!123",
    );
    const adminToken = await loginAsAdmin();

    await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId: managerRoleId, sellerId: sellerA }] })
      .expect(200);
    await request(createApp())
      .put(`/api/v1/admin/users/${targetId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId: basicRoleId, sellerId: sellerB }] })
      .expect(200);

    const manager = await loginDirect(
      "manager-read@example.com",
      SELLER_MANAGER_PASSWORD,
    );

    const noEnumeration = await request(createApp())
      .get("/api/v1/admin/users")
      .set(bearer(manager.accessToken))
      .expect(200);
    expect(noEnumeration.body.data).toEqual([]);

    const lookup = await request(createApp())
      .get("/api/v1/admin/users")
      .query({ search: "STAFF-READ-TARGET@EXAMPLE.COM", page: 1, pageSize: 20 })
      .set(bearer(manager.accessToken))
      .expect(200);
    expect(lookup.body.data).toHaveLength(1);
    expect(lookup.body.data[0]).toMatchObject({
      id: targetId,
      email: "staff-read-target@example.com",
    });
    expect(lookup.body.data[0].roles).toEqual([]);

    const rolesResponse = await request(createApp())
      .get("/api/v1/admin/roles")
      .query({ page: 1, pageSize: 100, status: "active" })
      .set(bearer(manager.accessToken))
      .expect(200);
    const roleIds = rolesResponse.body.data.map((role: { id: string }) => role.id);
    expect(roleIds).toContain(basicRoleId);
    expect(roleIds).not.toContain(managerRoleId);
  });

  it("rejects seller staff attempts to delegate seller.staff.manage", async () => {
    const sellerA = await createSellerScope("module2-delegation-a");
    const { roleId } = await createSellerStaffRole("seller_staff_delegation_guard");
    const managerId = await createSellerUser("manager-delegation@example.com");
    const targetId = await createSellerUser(
      "delegation-target@example.com",
      "TargetPassword!123",
    );
    const adminToken = await loginAsAdmin();

    await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId, sellerId: sellerA }] })
      .expect(200);

    const manager = await loginDirect(
      "manager-delegation@example.com",
      SELLER_MANAGER_PASSWORD,
    );
    const forbidden = await request(createApp())
      .put(`/api/v1/admin/users/${targetId}/roles`)
      .set(bearer(manager.accessToken))
      .send({ assignments: [{ roleId, sellerId: sellerA }] })
      .expect(403);
    expect(forbidden.body.error.code).toBe(
      ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
    );

    const persisted = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from user_roles where user_id = $1",
      [targetId],
    );
    expect(persisted.rows[0]?.count).toBe(0);
  });

  it("rejects seller staff attempts to assign platform roles or change their own role assignments", async () => {
    const sellerA = await createSellerScope("module2-scope-guard-a");
    const { roleId } = await createSellerStaffRole("seller_staff_scope_guard");
    const managerId = await createSellerUser("manager-scope@example.com");
    const targetId = await createSellerUser(
      "scope-target@example.com",
      "TargetPassword!123",
    );
    const adminToken = await loginAsAdmin();

    await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId, sellerId: sellerA }] })
      .expect(200);

    const manager = await loginDirect(
      "manager-scope@example.com",
      SELLER_MANAGER_PASSWORD,
    );

    const systemRole = await databasePool.query<{ id: string }>(
      "select id from roles where code = $1",
      [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
    );
    const platformRoleId = systemRole.rows[0]?.id;
    if (!platformRoleId) throw new Error("System role missing.");

    const platformAttempt = await request(createApp())
      .put(`/api/v1/admin/users/${targetId}/roles`)
      .set(bearer(manager.accessToken))
      .send({ assignments: [{ roleId: platformRoleId, sellerId: null }] })
      .expect(403);
    expect(platformAttempt.body.error.code).toBe(
      ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
    );

    const selfAttempt = await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(manager.accessToken))
      .send({ assignments: [{ roleId, sellerId: sellerA }] })
      .expect(409);
    expect(selfAttempt.body.error.code).toBe(
      ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
    );
  });
});

describe("Module 2 repository and service behavior", () => {
  it("persists the same seller role for two seller scopes and keeps permission grants isolated by seller", async () => {
    const repository = new AdministrationRepository();
    const { roleId } = await createSellerStaffRole("multi_seller_membership");
    const userId = await createSellerUser("multi-seller@example.com");
    const sellerA = await createSellerScope("module2-repository-a");
    const sellerB = await createSellerScope("module2-repository-b");

    await repository.replaceUserRoleAssignments(
      userId,
      [
        { roleId, sellerId: sellerA },
        { roleId, sellerId: sellerB },
      ],
      null,
    );

    const user = await repository.findUserById(userId);
    expect(user?.roles.map((role) => role.sellerId).sort()).toEqual(
      [sellerA, sellerB].sort(),
    );

    const grants = await repository.getUserPermissions(userId);
    expect(grants.map((grant) => grant.sellerId).sort()).toEqual(
      [sellerA, sellerB].sort(),
    );
    expect(
      grants.every(
        (grant) => grant.permission.code === ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
      ),
    ).toBe(true);
  });

  it("service-level seller isolation fails before persistence and returns SELLER_SCOPE_FORBIDDEN", async () => {
    const sellerA = await createSellerScope("module2-service-a");
    const sellerB = await createSellerScope("module2-service-b");
    const { roleId } = await createSellerStaffRole("service_scope_guard");
    const managerId = await createSellerUser("service-manager@example.com");
    const targetId = await createSellerUser("service-target@example.com", "TargetPassword!123");
    const adminToken = await loginAsAdmin();

    await request(createApp())
      .put(`/api/v1/admin/users/${managerId}/roles`)
      .set(bearer(adminToken))
      .send({ assignments: [{ roleId, sellerId: sellerA }] })
      .expect(200);

    const issued = await loginDirect("service-manager@example.com", SELLER_MANAGER_PASSWORD);
    const authenticated = await new AuthService().authenticateAccessToken(
      issued.accessToken,
      randomUUID(),
    );

    await expect(
      new AdministrationService().replaceUserRoleAssignments(
        authenticated.context,
        targetId,
        { assignments: [{ roleId, sellerId: sellerB }] },
      ),
    ).rejects.toMatchObject({
      code: ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
      statusCode: 403,
    });

    const persisted = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from user_roles where user_id = $1",
      [targetId],
    );
    expect(persisted.rows[0]?.count).toBe(0);
  });
});

describe("Module 2 domain event names", () => {
  it("writes role.updated together with the compatibility permission-change event", async () => {
    const adminToken = await loginAsAdmin();
    const roleResponse = await request(createApp())
      .post("/api/v1/admin/roles")
      .set(bearer(adminToken))
      .send({ code: "event_role", name: "Event Role" })
      .expect(201);
    const roleId = roleResponse.body.data.id as string;

    const permission = await databasePool.query<{ id: string }>(
      "select id from permissions where code = $1",
      [ADMIN_PERMISSION.USERS_READ],
    );
    const permissionId = permission.rows[0]?.id;
    if (!permissionId) throw new Error("admin.users.read permission is missing.");

    await request(createApp())
      .put(`/api/v1/admin/roles/${roleId}/permissions`)
      .set(bearer(adminToken))
      .send({ permissionIds: [permissionId] })
      .expect(200);

    const events = await databasePool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `select event_type, payload
       from outbox_events
       where aggregate_type = 'role'
         and aggregate_id = $1
         and event_type in ('role.permissions_changed', 'role.updated')
       order by event_type`,
      [roleId],
    );

    expect(events.rows.map((row) => row.event_type)).toEqual([
      "role.permissions_changed",
      "role.updated",
    ]);
    expect(events.rows.find((row) => row.event_type === "role.updated")?.payload).toMatchObject({
      roleId,
      changedFields: ["permissions"],
      permissionCodes: [ADMIN_PERMISSION.USERS_READ],
    });
  });

  it("writes the required user.created and auth.session_revoked outbox event names", async () => {
    await request(createApp())
      .post("/api/v1/auth/register")
      .send({
        email: "event-customer@example.com",
        displayName: "Event Customer",
        password: "CustomerPassword!123",
      })
      .expect(201);

    const adminLogin = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const refreshCookie = (adminLogin.headers["set-cookie"] as string[] | undefined)?.find(
      (cookie) => cookie.startsWith("marketplace_refresh="),
    );
    if (!refreshCookie) throw new Error("Admin refresh cookie missing.");

    await request(createApp())
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshCookie.split(";", 1)[0] ?? refreshCookie)
      .send({})
      .expect(200);

    const events = await databasePool.query<{ event_type: string }>(
      `select event_type
       from outbox_events
       where event_type in ('user.created', 'auth.session_revoked')
       order by event_type`,
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "auth.session_revoked",
      "user.created",
    ]);
  });
});
