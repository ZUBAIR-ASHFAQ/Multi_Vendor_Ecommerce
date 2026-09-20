import { randomUUID } from "node:crypto";
import request from "supertest";
import { PasswordService } from "../../src/common/security/password.service.js";
import { databasePool } from "../../src/database/db.js";
import { seedPlatformRbac } from "../../src/database/seeds/platform-rbac.seed.js";
import { createApp } from "../../src/app.js";
import {
  ACCOUNT_TYPE,
  SYSTEM_ROLE,
} from "../../src/modules/administration/administration.constants.js";
import {
  AuthService,
  type CustomerRegistrationProvisionInput,
} from "../../src/modules/administration/auth.service.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";

export const MODULE3_TEST_PASSWORD = "Module3Password!123";

export interface Module3TestUser {
  id: string;
  email: string;
  password: string;
}

/** Provisions Module 3 data while preserving the real Module 2 registration transaction in tests. */
async function provisionCustomerRegistration(
  input: CustomerRegistrationProvisionInput,
): Promise<void> {
  await CustomersService.using(input.transaction).provisionRegisteredCustomer({
    userId: input.userId,
    displayName: input.displayName,
    accountType: input.accountType,
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
}

/** Clears Module 3 plus its prerequisite state and restores the deterministic RBAC catalog. */
export async function resetModule3Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      customer_addresses,
      customer_profiles,
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
  await seedPlatformRbac();
}

/** Registers a real customer through Module 2 so role/profile provisioning is exercised. */
export async function registerCustomer(
  email: string,
  displayName = "Module 3 Customer",
): Promise<Module3TestUser> {
  const authService = new AuthService(provisionCustomerRegistration);
  const result = await authService.registerCustomer(
    {
      email,
      displayName,
      password: MODULE3_TEST_PASSWORD,
    },
    randomUUID(),
  );

  return {
    id: result.id,
    email: result.email,
    password: MODULE3_TEST_PASSWORD,
  };
}

/** Creates one platform administrator with the protected super-admin role. */
export async function createPlatformAdmin(
  email = "module3-admin@example.com",
): Promise<Module3TestUser> {
  const passwordHash = await new PasswordService().hash(MODULE3_TEST_PASSWORD);
  const userResult = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, 'Module 3 Admin', $3, 'active', now())
     returning id`,
    [email, passwordHash, ACCOUNT_TYPE.PLATFORM_ADMIN],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("Module 3 test administrator insert did not return an id.");

  const roleResult = await databasePool.query<{ id: string }>(
    "select id from roles where code = $1",
    [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
  );
  const roleId = roleResult.rows[0]?.id;
  if (!roleId) throw new Error("Seeded platform super-admin role was not found.");

  await databasePool.query(
    `insert into user_roles (user_id, role_id, assigned_by)
     values ($1, $2, $1)`,
    [userId, roleId],
  );

  return { id: userId, email, password: MODULE3_TEST_PASSWORD };
}

/** Logs in through the real Module 2 service and returns a bearer-ready access token. */
export async function loginUser(user: Module3TestUser): Promise<string> {
  const result = await new AuthService().login(
    { email: user.email, password: user.password },
    { ipAddress: "127.0.0.1", userAgent: "module3-vitest" },
    randomUUID(),
  );
  return result.accessToken;
}

/** Creates a standard bearer header accepted by the real authentication middleware. */
export function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Creates one customer address through the real HTTP contract and returns its response data. */
export async function createAddressViaHttp(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post("/api/v1/customers/me/addresses")
    .set(bearer(accessToken))
    .send({
      label: "Home",
      recipientName: "Module 3 Customer",
      phone: "+92 300 1234567",
      line1: "123 Test Street",
      city: "Lahore",
      region: "Punjab",
      postalCode: "54000",
      countryCode: "PK",
      isDefaultShipping: false,
      isDefaultBilling: false,
      ...overrides,
    })
    .expect(201);

  return response.body.data as Record<string, unknown>;
}

/** Counts one durable outbox event type without reading unrelated event payloads. */
export async function countCustomerOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts one customer audit action without coupling tests to audit row ordering. */
export async function countCustomerAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
