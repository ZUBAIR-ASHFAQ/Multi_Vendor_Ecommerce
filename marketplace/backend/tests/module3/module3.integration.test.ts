import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { CustomersRepository } from "../../src/modules/customers/customers.repository.js";
import {
  CUSTOMER_ADDRESS_STATUS,
  CUSTOMER_AUDIT_ACTION,
  CUSTOMER_ERROR_CODE,
  CUSTOMER_OUTBOX_EVENT,
} from "../../src/modules/customers/customers.constants.js";
import {
  bearer,
  countCustomerAuditActions,
  countCustomerOutboxEvents,
  createAddressViaHttp,
  createPlatformAdmin,
  loginUser,
  MODULE3_TEST_PASSWORD,
  registerCustomer,
  resetModule3Tables,
} from "./module3.test-helpers.js";

/** Reads one customer address directly for persistence assertions that the public API intentionally hides. */
async function readAddressRow(addressId: string): Promise<{
  customer_user_id: string;
  status: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
  country_code: string;
} | null> {
  const result = await databasePool.query<{
    customer_user_id: string;
    status: string;
    is_default_shipping: boolean;
    is_default_billing: boolean;
    country_code: string;
  }>(
    `select customer_user_id, status, is_default_shipping, is_default_billing, country_code
       from customer_addresses
      where id = $1`,
    [addressId],
  );
  return result.rows[0] ?? null;
}

beforeEach(async () => {
  await resetModule3Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 3 repository/service/API integration", () => {
  it("registers a customer with one profile and the protected self-service role", async () => {
    const email = `module3-register-${randomUUID()}@example.com`;
    const app = createApp();

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        displayName: "Registered Customer",
        password: MODULE3_TEST_PASSWORD,
      })
      .expect(201);

    const userId = registered.body.data.id as string;
    const profile = await databasePool.query<{
      user_id: string;
      display_name: string;
      marketing_opt_in: boolean;
    }>(
      "select user_id, display_name, marketing_opt_in from customer_profiles where user_id = $1",
      [userId],
    );
    expect(profile.rows[0]).toEqual({
      user_id: userId,
      display_name: "Registered Customer",
      marketing_opt_in: false,
    });

    const role = await databasePool.query<{ code: string }>(
      `select r.code
         from user_roles ur
         join roles r on r.id = ur.role_id
        where ur.user_id = $1`,
      [userId],
    );
    expect(role.rows.map((row) => row.code)).toContain("customer_self_service");

    expect(
      await countCustomerOutboxEvents(CUSTOMER_OUTBOX_EVENT.CUSTOMER_CREATED),
    ).toBe(1);
    expect(await countCustomerAuditActions(CUSTOMER_AUDIT_ACTION.PROFILE_CREATED)).toBe(1);

    const duplicate = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: email.toUpperCase(),
        displayName: "Duplicate Customer",
        password: MODULE3_TEST_PASSWORD,
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe("AUTH_REGISTRATION_EMAIL_TAKEN");

    const profileCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from customer_profiles where user_id = $1",
      [userId],
    );
    expect(profileCount.rows[0]?.count).toBe(1);
    expect(
      await countCustomerOutboxEvents(CUSTOMER_OUTBOX_EVENT.CUSTOMER_CREATED),
    ).toBe(1);
  });

  it("reads and updates only the authenticated customer profile and skips no-op side effects", async () => {
    const customer = await registerCustomer(
      `module3-profile-${randomUUID()}@example.com`,
      "Profile Customer",
    );
    const token = await loginUser(customer);
    const app = createApp();

    const me = await request(app)
      .get("/api/v1/customers/me")
      .set(bearer(token))
      .expect(200);
    expect(me.body.data.userId).toBe(customer.id);
    expect(me.body.data.displayName).toBe("Profile Customer");
    expect(me.body.requestId).toEqual(expect.any(String));

    const beforeEvents = await countCustomerOutboxEvents(
      CUSTOMER_OUTBOX_EVENT.CUSTOMER_UPDATED,
    );
    const beforeAudits = await countCustomerAuditActions(
      CUSTOMER_AUDIT_ACTION.PROFILE_UPDATED,
    );

    const updated = await request(app)
      .patch("/api/v1/customers/me")
      .set(bearer(token))
      .send({
        displayName: "  Updated Customer  ",
        phone: "+92 301 7654321",
        marketingOptIn: true,
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      userId: customer.id,
      displayName: "Updated Customer",
      phone: "+92 301 7654321",
      marketingOptIn: true,
    });

    expect(
      await countCustomerOutboxEvents(CUSTOMER_OUTBOX_EVENT.CUSTOMER_UPDATED),
    ).toBe(beforeEvents + 1);
    expect(await countCustomerAuditActions(CUSTOMER_AUDIT_ACTION.PROFILE_UPDATED)).toBe(
      beforeAudits + 1,
    );

    await request(app)
      .patch("/api/v1/customers/me")
      .set(bearer(token))
      .send({ displayName: "Updated Customer" })
      .expect(200);

    expect(
      await countCustomerOutboxEvents(CUSTOMER_OUTBOX_EVENT.CUSTOMER_UPDATED),
    ).toBe(beforeEvents + 1);
    expect(await countCustomerAuditActions(CUSTOMER_AUDIT_ACTION.PROFILE_UPDATED)).toBe(
      beforeAudits + 1,
    );
  });

  it("creates, switches, lists, updates, and archives default addresses without hard deletion", async () => {
    const customer = await registerCustomer(
      `module3-address-${randomUUID()}@example.com`,
    );
    const token = await loginUser(customer);
    const app = createApp();

    const first = await createAddressViaHttp(token, {
      label: "Home",
      countryCode: "pk",
      isDefaultShipping: true,
    });
    expect(first.countryCode).toBe("PK");

    const second = await createAddressViaHttp(token, {
      label: "Office",
      line1: "55 Office Road",
      isDefaultShipping: true,
      isDefaultBilling: true,
    });

    const listAfterSecond = await request(app)
      .get("/api/v1/customers/me/addresses")
      .set(bearer(token))
      .expect(200);
    const firstAfterSwitch = listAfterSecond.body.data.find(
      (address: { id: string }) => address.id === first.id,
    );
    const secondAfterSwitch = listAfterSecond.body.data.find(
      (address: { id: string }) => address.id === second.id,
    );
    expect(firstAfterSwitch.isDefaultShipping).toBe(false);
    expect(secondAfterSwitch.isDefaultShipping).toBe(true);
    expect(secondAfterSwitch.isDefaultBilling).toBe(true);

    const secondAudit = await databasePool.query<{
      metadata: {
        clearedDefaultShippingAddressIds?: string[];
        clearedDefaultBillingAddressIds?: string[];
      } | null;
    }>(
      `select metadata
         from audit_logs
        where action = $1 and resource_id = $2
        order by created_at desc
        limit 1`,
      [CUSTOMER_AUDIT_ACTION.ADDRESS_CREATED, String(second.id)],
    );
    expect(secondAudit.rows[0]?.metadata?.clearedDefaultShippingAddressIds).toContain(
      String(first.id),
    );

    const updatedFirst = await request(app)
      .patch(`/api/v1/customers/me/addresses/${String(first.id)}`)
      .set(bearer(token))
      .send({ isDefaultBilling: true, label: "Primary Home" })
      .expect(200);
    expect(updatedFirst.body.data).toMatchObject({
      label: "Primary Home",
      isDefaultBilling: true,
    });

    const listAfterUpdate = await request(app)
      .get("/api/v1/customers/me/addresses")
      .set(bearer(token))
      .expect(200);
    const secondAfterBillingSwitch = listAfterUpdate.body.data.find(
      (address: { id: string }) => address.id === second.id,
    );
    expect(secondAfterBillingSwitch.isDefaultBilling).toBe(false);

    const firstUpdateAudit = await databasePool.query<{
      metadata: { clearedDefaultBillingAddressIds?: string[] } | null;
    }>(
      `select metadata
         from audit_logs
        where action = $1 and resource_id = $2
        order by created_at desc
        limit 1`,
      [CUSTOMER_AUDIT_ACTION.ADDRESS_UPDATED, String(first.id)],
    );
    expect(firstUpdateAudit.rows[0]?.metadata?.clearedDefaultBillingAddressIds).toContain(
      String(second.id),
    );

    const beforeArchiveEvents = await countCustomerOutboxEvents(
      CUSTOMER_OUTBOX_EVENT.CUSTOMER_ADDRESS_CHANGED,
    );
    const beforeArchiveAudits = await countCustomerAuditActions(
      CUSTOMER_AUDIT_ACTION.ADDRESS_ARCHIVED,
    );

    await request(app)
      .delete(`/api/v1/customers/me/addresses/${String(first.id)}`)
      .set(bearer(token))
      .expect(200);

    const archivedRow = await readAddressRow(String(first.id));
    expect(archivedRow).toMatchObject({
      customer_user_id: customer.id,
      status: CUSTOMER_ADDRESS_STATUS.ARCHIVED,
      is_default_shipping: false,
      is_default_billing: false,
      country_code: "PK",
    });

    const activeList = await request(app)
      .get("/api/v1/customers/me/addresses")
      .set(bearer(token))
      .expect(200);
    expect(activeList.body.data.map((address: { id: string }) => address.id)).not.toContain(
      first.id,
    );

    await request(app)
      .delete(`/api/v1/customers/me/addresses/${String(first.id)}`)
      .set(bearer(token))
      .expect(200);

    expect(
      await countCustomerOutboxEvents(CUSTOMER_OUTBOX_EVENT.CUSTOMER_ADDRESS_CHANGED),
    ).toBe(beforeArchiveEvents + 1);
    expect(await countCustomerAuditActions(CUSTOMER_AUDIT_ACTION.ADDRESS_ARCHIVED)).toBe(
      beforeArchiveAudits + 1,
    );
  });

  it("keeps private address reads and writes inside the authenticated customer scope", async () => {
    const owner = await registerCustomer(`module3-owner-${randomUUID()}@example.com`);
    const other = await registerCustomer(`module3-other-${randomUUID()}@example.com`);
    const ownerToken = await loginUser(owner);
    const otherToken = await loginUser(other);
    const app = createApp();

    const ownedAddress = await createAddressViaHttp(ownerToken, {
      label: "Owner Address",
      isDefaultShipping: true,
    });
    const addressId = String(ownedAddress.id);

    const repository = new CustomersRepository();
    expect((await repository.findAddressByIdForCustomer(addressId, owner.id))?.id).toBe(
      addressId,
    );
    expect(await repository.findAddressByIdForCustomer(addressId, other.id)).toBeNull();

    const otherList = await request(app)
      .get("/api/v1/customers/me/addresses")
      .set(bearer(otherToken))
      .expect(200);
    expect(otherList.body.data.map((address: { id: string }) => address.id)).not.toContain(
      addressId,
    );

    const foreignUpdate = await request(app)
      .patch(`/api/v1/customers/me/addresses/${addressId}`)
      .set(bearer(otherToken))
      .send({ label: "Stolen" })
      .expect(404);
    expect(foreignUpdate.body.error.code).toBe(CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND);

    const missingUpdate = await request(app)
      .patch(`/api/v1/customers/me/addresses/${randomUUID()}`)
      .set(bearer(otherToken))
      .send({ label: "Missing" })
      .expect(404);
    expect(missingUpdate.body.error.code).toBe(CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND);
    expect(missingUpdate.body.error.message).toBe(foreignUpdate.body.error.message);

    const foreignArchive = await request(app)
      .delete(`/api/v1/customers/me/addresses/${addressId}`)
      .set(bearer(otherToken))
      .expect(404);
    expect(foreignArchive.body.error.code).toBe(CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND);

    const persisted = await readAddressRow(addressId);
    expect(persisted).toMatchObject({
      customer_user_id: owner.id,
      status: CUSTOMER_ADDRESS_STATUS.ACTIVE,
    });
  });

  it("protects customer routes with authentication, actor type, RBAC, and strict validation", async () => {
    const app = createApp();

    await request(app).get("/api/v1/customers/me").expect(401);

    const admin = await createPlatformAdmin(`module3-admin-self-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const adminSelfService = await request(app)
      .get("/api/v1/customers/me")
      .set(bearer(adminToken))
      .expect(403);
    expect(adminSelfService.body.error.code).toBe("FORBIDDEN");

    const customer = await registerCustomer(`module3-validation-${randomUUID()}@example.com`);
    const token = await loginUser(customer);

    const invalidBody = await request(app)
      .post("/api/v1/customers/me/addresses")
      .set(bearer(token))
      .send({
        label: "Bad",
        recipientName: "Bad Address",
        phone: "+92 300 1234567",
        line1: "1 Bad Road",
        city: "Lahore",
        region: "Punjab",
        countryCode: "Pakistan",
        customerUserId: randomUUID(),
      })
      .expect(422);
    expect(invalidBody.body.error.code).toBe("VALIDATION_FAILED");

    await request(app)
      .patch("/api/v1/customers/me/addresses/not-a-uuid")
      .set(bearer(token))
      .send({ label: "Invalid" })
      .expect(422);
  });

  it("allows privileged admin search/detail while ordinary customers cannot call admin customer APIs", async () => {
    const first = await registerCustomer(
      `module3-admin-list-a-${randomUUID()}@example.com`,
      "Alice Customer",
    );
    const second = await registerCustomer(
      `module3-admin-list-b-${randomUUID()}@example.com`,
      "Bob Customer",
    );
    const firstToken = await loginUser(first);
    const firstAddress = await createAddressViaHttp(firstToken, {
      label: "Archived Evidence",
    });
    await request(createApp())
      .delete(`/api/v1/customers/me/addresses/${String(firstAddress.id)}`)
      .set(bearer(firstToken))
      .expect(200);

    const admin = await createPlatformAdmin(`module3-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const app = createApp();

    const list = await request(app)
      .get("/api/v1/admin/customers")
      .query({ search: "Alice", page: 1, pageSize: 10, sort: "name_asc" })
      .set(bearer(adminToken))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      userId: first.id,
      displayName: "Alice Customer",
      addressCount: 0,
    });
    expect(list.body.meta.totalItems).toBe(1);
    expect(list.body.data[0]).not.toHaveProperty("passwordHash");
    expect(list.body.data[0]).not.toHaveProperty("orders");

    const detail = await request(app)
      .get(`/api/v1/admin/customers/${first.id}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(detail.body.data.customer.userId).toBe(first.id);
    expect(detail.body.data.addresses).toHaveLength(1);
    expect(detail.body.data.addresses[0].status).toBe(CUSTOMER_ADDRESS_STATUS.ARCHIVED);
    expect(detail.body.data).not.toHaveProperty("orders");

    const customerToken = await loginUser(second);
    const forbidden = await request(app)
      .get("/api/v1/admin/customers")
      .set(bearer(customerToken))
      .expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    await request(app)
      .get("/api/v1/admin/customers/not-a-uuid")
      .set(bearer(adminToken))
      .expect(422);
  });

  it("publishes all eight approved customer operations in OpenAPI without generic CRUD additions", async () => {
    const openApi = await request(createApp()).get("/openapi.json").expect(200);
    const paths = openApi.body.paths as Record<string, Record<string, unknown>>;

    expect(paths["/api/v1/customers/me"]).toHaveProperty("get");
    expect(paths["/api/v1/customers/me"]).toHaveProperty("patch");
    expect(paths["/api/v1/customers/me/addresses"]).toHaveProperty("get");
    expect(paths["/api/v1/customers/me/addresses"]).toHaveProperty("post");
    expect(paths["/api/v1/customers/me/addresses/{id}"]).toHaveProperty("patch");
    expect(paths["/api/v1/customers/me/addresses/{id}"]).toHaveProperty("delete");
    expect(paths["/api/v1/admin/customers"]).toHaveProperty("get");
    expect(paths["/api/v1/admin/customers/{id}"]).toHaveProperty("get");

    expect(paths).not.toHaveProperty("/api/v1/customers/{id}");
    expect(paths["/api/v1/admin/customers"]).not.toHaveProperty("post");
  });
});
