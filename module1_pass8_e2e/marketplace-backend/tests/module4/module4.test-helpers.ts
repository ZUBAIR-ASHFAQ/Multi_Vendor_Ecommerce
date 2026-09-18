import { randomUUID } from "node:crypto";
import request from "supertest";
import { PasswordService } from "../../src/common/security/password.service.js";
import { databasePool } from "../../src/database/db.js";
import { seedPlatformRbac } from "../../src/database/seeds/platform-rbac.seed.js";
import { createApp } from "../../src/app.js";
import {
  ACCOUNT_TYPE,
  PLATFORM_SETTING_KEY,
  SYSTEM_ROLE,
} from "../../src/modules/administration/administration.constants.js";
import {
  AuthService,
  type CustomerRegistrationProvisionInput,
} from "../../src/modules/administration/auth.service.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";
import { DOCUMENT_FILE_STATUS } from "../../src/modules/documents-audit/documents-audit.constants.js";

export const MODULE4_TEST_PASSWORD = "Module4Password!123";

export interface Module4TestUser {
  id: string;
  email: string;
  password: string;
}

export interface ApprovedSellerFixture {
  owner: Module4TestUser;
  ownerToken: string;
  applicationId: string;
  sellerId: string;
}

/** Provisions the Module 3 customer profile inside the real Module 2 registration transaction. */
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

/** Clears Module 4 and prerequisite state, then restores deterministic RBAC and currency settings. */
export async function resetModule4Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      file_links,
      files,
      seller_staff,
      stores,
      sellers,
      seller_applications,
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
  await databasePool.query(
    `insert into platform_settings (key, value_json)
     values ($1, $2::jsonb), ($3, $4::jsonb)`,
    [
      PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
      JSON.stringify(["PKR", "USD"]),
      PLATFORM_SETTING_KEY.DEFAULT_CURRENCY,
      JSON.stringify("PKR"),
    ],
  );
}

/** Registers a real customer so seller onboarding starts from the released Module 2/3 flow. */
export async function registerCustomer(
  email: string,
  displayName = "Module 4 Customer",
): Promise<Module4TestUser> {
  const authService = new AuthService(provisionCustomerRegistration);
  const result = await authService.registerCustomer(
    {
      email,
      displayName,
      password: MODULE4_TEST_PASSWORD,
    },
    randomUUID(),
  );

  return {
    id: result.id,
    email: result.email,
    password: MODULE4_TEST_PASSWORD,
  };
}

/** Creates one platform administrator with the protected super-admin role. */
export async function createPlatformAdmin(
  email = `module4-admin-${randomUUID()}@example.com`,
): Promise<Module4TestUser> {
  const passwordHash = await new PasswordService().hash(MODULE4_TEST_PASSWORD);
  const userResult = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, 'Module 4 Admin', $3, 'active', now())
     returning id`,
    [email, passwordHash, ACCOUNT_TYPE.PLATFORM_ADMIN],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("Module 4 test administrator insert did not return an id.");

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

  return { id: userId, email, password: MODULE4_TEST_PASSWORD };
}

/** Logs in through the real composed application so Module 4 seller/store scopes are resolved. */
export async function loginUser(user: Module4TestUser): Promise<string> {
  const response = await request(createApp())
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: user.password })
    .expect(200);
  return response.body.data.accessToken as string;
}

/** Creates the standard Authorization header accepted by the authentication middleware. */
export function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Submits one seller application through the exact public Module 4 contract. */
export async function submitSellerApplicationViaHttp(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post("/api/v1/sellers/applications")
    .set(bearer(accessToken))
    .send({
      legalName: "Module 4 Trading Private Limited",
      displayName: "Module 4 Store Group",
      taxId: "NTN-1234567",
      ...overrides,
    })
    .expect(201);
  return response.body.data as Record<string, unknown>;
}

/** Approves one seller application through the privileged explicit command endpoint. */
export async function approveSellerApplicationViaHttp(
  adminToken: string,
  applicationId: string,
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post(`/api/v1/admin/seller-applications/${applicationId}/approve`)
    .set(bearer(adminToken))
    .send({})
    .expect(200);
  return response.body.data as Record<string, unknown>;
}

/** Builds a fully approved seller fixture using registration, application and admin approval APIs. */
export async function createApprovedSeller(
  adminToken: string,
  label: string,
): Promise<ApprovedSellerFixture> {
  const owner = await registerCustomer(
    `module4-${label}-${randomUUID()}@example.com`,
    `${label} Owner`,
  );
  const customerToken = await loginUser(owner);
  const application = await submitSellerApplicationViaHttp(customerToken, {
    legalName: `${label} Legal Name`,
    displayName: `${label} Seller`,
    taxId: `${label.toUpperCase()}-TAX`,
  });
  const applicationId = String(application.id);
  const approved = await approveSellerApplicationViaHttp(adminToken, applicationId);
  const seller = approved.seller as Record<string, unknown>;
  const sellerId = String(seller.id);
  const ownerToken = await loginUser(owner);

  return { owner, ownerToken, applicationId, sellerId };
}

/** Creates one seller-owned store through the exact authenticated Module 4 route. */
export async function createStoreViaHttp(
  ownerToken: string,
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request(createApp())
    .post("/api/v1/sellers/me/stores")
    .set(bearer(ownerToken))
    .send({
      slug,
      name: `${slug} Store`,
      description: "Module 4 integration store",
      defaultCurrency: "PKR",
      supportEmail: `${slug}@example.com`,
      ...overrides,
    })
    .expect(201);
  return response.body.data as Record<string, unknown>;
}

/** Returns one seeded protected seller role ID by stable role code. */
async function sellerSystemRoleId(code: "seller_owner" | "seller_manager"): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    "select id from roles where code = $1",
    [code],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Seeded ${code} role was not found.`);
  return id;
}

/** Returns the seeded protected seller-manager role ID. */
export async function sellerManagerRoleId(): Promise<string> {
  return sellerSystemRoleId("seller_manager");
}

/** Returns the seeded protected seller-owner role ID. */
export async function sellerOwnerRoleId(): Promise<string> {
  return sellerSystemRoleId("seller_owner");
}

/** Inserts a confirmed file owned by one user without contacting object storage. */
export async function createConfirmedFile(
  ownerUserId: string,
  purpose: "seller_verification" | "store_asset",
): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into files
      (object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      `module4-tests/${randomUUID()}`,
      purpose,
      purpose === "store_asset" ? "logo.png" : "verification.pdf",
      purpose === "store_asset" ? "image/png" : "application/pdf",
      1024,
      ownerUserId,
      DOCUMENT_FILE_STATUS.CONFIRMED,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 4 test file insert did not return an id.");
  return id;
}

/** Counts one durable outbox event without coupling tests to event ordering. */
export async function countOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts one audit action without coupling tests to audit row ordering. */
export async function countAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}
