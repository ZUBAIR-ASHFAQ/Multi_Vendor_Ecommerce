import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  ACCOUNT_TYPE,
  ADMIN_ERROR_CODE,
} from "../../src/modules/administration/administration.constants.js";
import {
  DOCUMENT_AUDIT_ERROR_CODE,
  DOCUMENT_PURPOSE,
} from "../../src/modules/documents-audit/documents-audit.constants.js";
import {
  SELLER_APPLICATION_STATUS,
  SELLER_AUDIT_ACTION,
  SELLER_ERROR_CODE,
  SELLER_OUTBOX_EVENT,
  SELLER_STATUS,
  STORE_STATUS,
} from "../../src/modules/sellers/sellers.constants.js";
import { SellersRepository } from "../../src/modules/sellers/sellers.repository.js";
import {
  approveSellerApplicationViaHttp,
  bearer,
  countAuditActions,
  countOutboxEvents,
  createApprovedSeller,
  createConfirmedFile,
  createPlatformAdmin,
  createStoreViaHttp,
  loginUser,
  registerCustomer,
  resetModule4Tables,
  sellerManagerRoleId,
  sellerOwnerRoleId,
  submitSellerApplicationViaHttp,
} from "./module4.test-helpers.js";

/** Returns the HTTP methods documented for one OpenAPI path in stable order. */
function openApiMethods(pathItem: Record<string, unknown> | undefined): string[] {
  const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  return Object.keys(pathItem ?? {})
    .filter((key) => methods.has(key))
    .sort();
}

beforeEach(async () => {
  await resetModule4Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 4 repository/service/API integration", () => {
  it("submits one seller application, preserves one open application, and records durable side effects", async () => {
    const customer = await registerCustomer(
      `module4-application-${randomUUID()}@example.com`,
      "Applicant Customer",
    );
    const token = await loginUser(customer);
    const app = createApp();

    const created = await request(app)
      .post("/api/v1/sellers/applications")
      .set(bearer(token))
      .send({
        legalName: "  Applicant Trading Ltd  ",
        displayName: "  Applicant Seller  ",
        taxId: "  TAX-001  ",
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      applicantUserId: customer.id,
      businessProfile: {
        legalName: "Applicant Trading Ltd",
        displayName: "Applicant Seller",
        taxId: "TAX-001",
      },
      status: SELLER_APPLICATION_STATUS.SUBMITTED,
      reviewedBy: null,
      reviewedAt: null,
      reason: null,
    });

    const duplicate = await request(app)
      .post("/api/v1/sellers/applications")
      .set(bearer(token))
      .send({
        legalName: "Another Legal Name",
        displayName: "Another Seller",
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe("CONFLICT");

    const persisted = await databasePool.query<{ count: number }>(
      `select count(*)::int as count
         from seller_applications
        where applicant_user_id = $1 and status = 'submitted'`,
      [customer.id],
    );
    expect(persisted.rows[0]?.count).toBe(1);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.APPLICATION_SUBMITTED)).toBe(1);
    expect(await countAuditActions(SELLER_AUDIT_ACTION.APPLICATION_SUBMITTED)).toBe(1);
  });

  it("rejects privileged seller review and suspension routes without the required admin permissions", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createApprovedSeller(adminToken, "permission-guard");
    const customer = await registerCustomer(
      `module4-permission-guard-${randomUUID()}@example.com`,
      "Permission Guard Customer",
    );
    const customerToken = await loginUser(customer);
    const app = createApp();

    const reviewQueue = await request(app)
      .get("/api/v1/admin/seller-applications")
      .set(bearer(customerToken))
      .expect(403);
    expect(reviewQueue.body.error.code).toBe("FORBIDDEN");

    const sellerSuspension = await request(app)
      .post(`/api/v1/admin/sellers/${seller.sellerId}/suspend`)
      .set(bearer(seller.ownerToken))
      .send({ reason: "Seller cannot suspend itself through admin command" })
      .expect(403);
    expect(sellerSuspension.body.error.code).toBe("FORBIDDEN");

    const unchanged = await databasePool.query<{ status: string }>(
      "select status from sellers where id = $1",
      [seller.sellerId],
    );
    expect(unchanged.rows[0]?.status).toBe(SELLER_STATUS.ACTIVE);
  });

  it("approves an application atomically into seller owner identity, seller staff and active authentication scope", async () => {
    const applicant = await registerCustomer(
      `module4-approve-${randomUUID()}@example.com`,
      "Approval Applicant",
    );
    const applicantToken = await loginUser(applicant);
    const application = await submitSellerApplicationViaHttp(applicantToken, {
      legalName: "Approval Legal Ltd",
      displayName: "Approval Seller",
    });
    const applicationId = String(application.id);
    const app = createApp();

    const forbiddenReview = await request(app)
      .post(`/api/v1/admin/seller-applications/${applicationId}/approve`)
      .set(bearer(applicantToken))
      .send({})
      .expect(403);
    expect(forbiddenReview.body.error.code).toBe("FORBIDDEN");

    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const approved = await approveSellerApplicationViaHttp(adminToken, applicationId);
    const seller = approved.seller as Record<string, unknown>;
    const sellerId = String(seller.id);
    expect(approved.application).toMatchObject({
      id: applicationId,
      status: SELLER_APPLICATION_STATUS.APPROVED,
      reviewedBy: admin.id,
      reason: null,
    });
    expect(seller).toMatchObject({
      id: sellerId,
      ownerUserId: applicant.id,
      status: SELLER_STATUS.ACTIVE,
      approvalStatus: "approved",
    });

    const identity = await databasePool.query<{
      account_type: string;
      role_code: string;
      seller_id: string;
      staff_status: string;
    }>(
      `select u.account_type,
              r.code as role_code,
              ur.seller_id::text as seller_id,
              ss.status as staff_status
         from users u
         join user_roles ur on ur.user_id = u.id
         join roles r on r.id = ur.role_id
         join seller_staff ss on ss.user_id = u.id and ss.seller_id = ur.seller_id
        where u.id = $1`,
      [applicant.id],
    );
    expect(identity.rows).toContainEqual({
      account_type: ACCOUNT_TYPE.SELLER,
      role_code: "seller_owner",
      seller_id: sellerId,
      staff_status: "active",
    });

    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_APPROVED)).toBe(1);
    expect(await countAuditActions(SELLER_AUDIT_ACTION.APPLICATION_APPROVED)).toBe(1);

    const duplicateApproval = await request(app)
      .post(`/api/v1/admin/seller-applications/${applicationId}/approve`)
      .set(bearer(adminToken))
      .send({})
      .expect(409);
    expect(duplicateApproval.body.error.code).toBe("CONFLICT");
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_APPROVED)).toBe(1);

    const sellerToken = await loginUser(applicant);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(sellerToken))
      .expect(200);
    expect(me.body.data.accountType).toBe(ACCOUNT_TYPE.SELLER);
    expect(me.body.data.scopes.sellerIds).toEqual([sellerId]);
    expect(me.body.data.scopes.storeIds).toEqual([]);

    const sellerProfile = await request(app)
      .get("/api/v1/sellers/me")
      .set(bearer(sellerToken))
      .expect(200);
    expect(sellerProfile.body.data.seller.id).toBe(sellerId);
    expect(sellerProfile.body.data.staffSummary).toEqual({
      totalCount: 1,
      activeCount: 1,
      inactiveCount: 0,
    });
  });

  it("rolls back seller approval when downstream protected-role provisioning fails", async () => {
    const applicant = await registerCustomer(
      `module4-rollback-${randomUUID()}@example.com`,
      "Rollback Applicant",
    );
    const applicantToken = await loginUser(applicant);
    const application = await submitSellerApplicationViaHttp(applicantToken);
    const applicationId = String(application.id);
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();

    await databasePool.query("delete from roles where code = 'seller_owner'");

    await request(app)
      .post(`/api/v1/admin/seller-applications/${applicationId}/approve`)
      .set(bearer(adminToken))
      .send({})
      .expect(500);

    const state = await databasePool.query<{
      application_status: string;
      account_type: string;
      seller_count: number;
      staff_count: number;
    }>(
      `select sa.status as application_status,
              u.account_type,
              (select count(*)::int from sellers s where s.owner_user_id = u.id) as seller_count,
              (select count(*)::int from seller_staff ss where ss.user_id = u.id) as staff_count
         from seller_applications sa
         join users u on u.id = sa.applicant_user_id
        where sa.id = $1`,
      [applicationId],
    );
    expect(state.rows[0]).toEqual({
      application_status: SELLER_APPLICATION_STATUS.SUBMITTED,
      account_type: ACCOUNT_TYPE.CUSTOMER,
      seller_count: 0,
      staff_count: 0,
    });
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_APPROVED)).toBe(0);
    expect(await countAuditActions(SELLER_AUDIT_ACTION.APPLICATION_APPROVED)).toBe(0);
  });

  it("rejects an application with immutable reason and does not create seller identity", async () => {
    const applicant = await registerCustomer(
      `module4-reject-${randomUUID()}@example.com`,
      "Rejected Applicant",
    );
    const applicantToken = await loginUser(applicant);
    const application = await submitSellerApplicationViaHttp(applicantToken);
    const applicationId = String(application.id);
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const app = createApp();

    const rejected = await request(app)
      .post(`/api/v1/admin/seller-applications/${applicationId}/reject`)
      .set(bearer(adminToken))
      .send({ reason: "  Verification documents are incomplete.  " })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      id: applicationId,
      status: SELLER_APPLICATION_STATUS.REJECTED,
      reviewedBy: admin.id,
      reason: "Verification documents are incomplete.",
    });

    const sellerCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from sellers where owner_user_id = $1",
      [applicant.id],
    );
    const user = await databasePool.query<{ account_type: string }>(
      "select account_type from users where id = $1",
      [applicant.id],
    );
    expect(sellerCount.rows[0]?.count).toBe(0);
    expect(user.rows[0]?.account_type).toBe(ACCOUNT_TYPE.CUSTOMER);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_REJECTED)).toBe(1);
    expect(await countAuditActions(SELLER_AUDIT_ACTION.APPLICATION_REJECTED)).toBe(1);

    await request(app)
      .post(`/api/v1/admin/seller-applications/${applicationId}/reject`)
      .set(bearer(adminToken))
      .send({ reason: "Second review must not replace history" })
      .expect(409);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_REJECTED)).toBe(1);
  });

  it("creates and updates stores with supported currency, global slug uniqueness and public-safe projection", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const firstSeller = await createApprovedSeller(adminToken, "first");
    const secondSeller = await createApprovedSeller(adminToken, "second");
    const app = createApp();

    const unsupported = await request(app)
      .post("/api/v1/sellers/me/stores")
      .set(bearer(firstSeller.ownerToken))
      .send({
        slug: "unsupported-currency",
        name: "Unsupported Currency",
        defaultCurrency: "EUR",
      })
      .expect(400);
    expect(unsupported.body.error.code).toBe("INVALID_REQUEST");

    const logoFileId = await createConfirmedFile(firstSeller.owner.id, "store_asset");
    const store = await createStoreViaHttp(firstSeller.ownerToken, "first-store", {
      logoFileId,
      supportEmail: "  STORE@EXAMPLE.COM  ",
    });
    const storeId = String(store.id);
    expect(store).toMatchObject({
      sellerId: firstSeller.sellerId,
      slug: "first-store",
      logoFileId,
      defaultCurrency: "PKR",
      supportEmail: "store@example.com",
      status: STORE_STATUS.ACTIVE,
    });

    const authMe = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(firstSeller.ownerToken))
      .expect(200);
    expect(authMe.body.data.scopes.storeIds).toContain(storeId);

    const duplicateSlug = await request(app)
      .post("/api/v1/sellers/me/stores")
      .set(bearer(secondSeller.ownerToken))
      .send({
        slug: "FIRST-STORE",
        name: "Duplicate Store",
        defaultCurrency: "PKR",
      })
      .expect(409);
    expect(duplicateSlug.body.error.code).toBe(SELLER_ERROR_CODE.STORE_SLUG_TAKEN);

    const updated = await request(app)
      .patch(`/api/v1/sellers/me/stores/${storeId}`)
      .set(bearer(firstSeller.ownerToken))
      .send({
        slug: "  first-store-renamed  ",
        name: "Renamed Store",
        defaultCurrency: "usd",
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      id: storeId,
      slug: "first-store-renamed",
      name: "Renamed Store",
      defaultCurrency: "USD",
    });

    const publicStore = await request(app)
      .get("/api/v1/stores/first-store-renamed")
      .expect(200);
    expect(publicStore.body.data).toMatchObject({
      id: storeId,
      slug: "first-store-renamed",
      name: "Renamed Store",
      seller: {
        id: firstSeller.sellerId,
        displayName: "first Seller",
      },
    });
    expect(publicStore.body.data.seller).not.toHaveProperty("legalName");
    expect(publicStore.body.data.seller).not.toHaveProperty("taxId");
    expect(publicStore.body.data.seller).not.toHaveProperty("ownerUserId");

    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.STORE_CREATED)).toBe(1);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.STORE_UPDATED)).toBe(1);
  });

  it("moves an approved seller store between active and inactive while keeping inactive stores private", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createApprovedSeller(adminToken, "store-lifecycle");
    const store = await createStoreViaHttp(seller.ownerToken, "store-lifecycle");
    const storeId = String(store.id);
    const app = createApp();

    const inactive = await request(app)
      .patch(`/api/v1/sellers/me/stores/${storeId}`)
      .set(bearer(seller.ownerToken))
      .send({ status: STORE_STATUS.INACTIVE })
      .expect(200);
    expect(inactive.body.data.status).toBe(STORE_STATUS.INACTIVE);

    const hidden = await request(app)
      .get("/api/v1/stores/store-lifecycle")
      .expect(404);
    expect(hidden.body.error.code).toBe(SELLER_ERROR_CODE.STORE_NOT_FOUND);

    const privateProfile = await request(app)
      .get("/api/v1/sellers/me")
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(
      privateProfile.body.data.stores.find(
        (item: { id: string }) => item.id === storeId,
      )?.status,
    ).toBe(STORE_STATUS.INACTIVE);

    const reactivated = await request(app)
      .patch(`/api/v1/sellers/me/stores/${storeId}`)
      .set(bearer(seller.ownerToken))
      .send({ status: STORE_STATUS.ACTIVE })
      .expect(200);
    expect(reactivated.body.data.status).toBe(STORE_STATUS.ACTIVE);

    const publicStore = await request(app)
      .get("/api/v1/stores/store-lifecycle")
      .expect(200);
    expect(publicStore.body.data.id).toBe(storeId);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.STORE_UPDATED)).toBe(2);
  });

  it("prevents Seller B from reading or updating Seller A private store state", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createApprovedSeller(adminToken, "seller-a");
    const sellerB = await createApprovedSeller(adminToken, "seller-b");
    const storeA = await createStoreViaHttp(sellerA.ownerToken, "seller-a-store");
    const storeId = String(storeA.id);
    const app = createApp();

    const foreignUpdate = await request(app)
      .patch(`/api/v1/sellers/me/stores/${storeId}`)
      .set(bearer(sellerB.ownerToken))
      .send({ name: "Stolen Store" })
      .expect(404);
    expect(foreignUpdate.body.error.code).toBe(SELLER_ERROR_CODE.STORE_NOT_FOUND);

    const repository = new SellersRepository();
    expect(
      (await repository.findStoreByIdForSeller(storeId, sellerA.sellerId))?.id,
    ).toBe(storeId);
    expect(
      await repository.findStoreByIdForSeller(storeId, sellerB.sellerId),
    ).toBeNull();

    const sellerBProfile = await request(app)
      .get("/api/v1/sellers/me")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBProfile.body.data.seller.id).toBe(sellerB.sellerId);
    expect(
      sellerBProfile.body.data.stores.map((item: { id: string }) => item.id),
    ).not.toContain(storeId);

    const persisted = await databasePool.query<{ name: string }>(
      "select name from stores where id = $1",
      [storeId],
    );
    expect(persisted.rows[0]?.name).toBe("seller-a-store Store");
  });

  it("synchronizes seller-manager RBAC with seller_staff and current seller/store authentication scopes", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createApprovedSeller(adminToken, "scope-a");
    const sellerB = await createApprovedSeller(adminToken, "scope-b");
    const storeA = await createStoreViaHttp(sellerA.ownerToken, "scope-a-store");
    const storeB = await createStoreViaHttp(sellerB.ownerToken, "scope-b-store");
    const manager = await registerCustomer(
      `module4-manager-${randomUUID()}@example.com`,
      "Seller Manager",
    );
    const managerRoleId = await sellerManagerRoleId();
    const app = createApp();

    const invalidScope = await request(app)
      .put(`/api/v1/admin/users/${manager.id}/roles`)
      .set(bearer(adminToken))
      .send({
        assignments: [{ roleId: managerRoleId, sellerId: randomUUID() }],
      })
      .expect(404);
    expect(invalidScope.body.error.code).toBe(SELLER_ERROR_CODE.SELLER_NOT_FOUND);

    const accountBeforeValidAssignment = await databasePool.query<{ account_type: string }>(
      "select account_type from users where id = $1",
      [manager.id],
    );
    expect(accountBeforeValidAssignment.rows[0]?.account_type).toBe(ACCOUNT_TYPE.CUSTOMER);

    const assigned = await request(app)
      .put(`/api/v1/admin/users/${manager.id}/roles`)
      .set(bearer(adminToken))
      .send({
        assignments: [
          { roleId: managerRoleId, sellerId: sellerA.sellerId },
          { roleId: managerRoleId, sellerId: sellerB.sellerId },
        ],
      })
      .expect(200);
    expect(assigned.body.data.accountType).toBe(ACCOUNT_TYPE.SELLER);

    const memberships = await databasePool.query<{
      seller_id: string;
      status: string;
    }>(
      `select seller_id::text as seller_id, status
         from seller_staff
        where user_id = $1
        order by seller_id`,
      [manager.id],
    );
    expect(memberships.rows).toEqual(
      expect.arrayContaining([
        { seller_id: sellerA.sellerId, status: "active" },
        { seller_id: sellerB.sellerId, status: "active" },
      ]),
    );

    const managerToken = await loginUser(manager);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(managerToken))
      .expect(200);
    expect(me.body.data.scopes.sellerIds.sort()).toEqual(
      [sellerA.sellerId, sellerB.sellerId].sort(),
    );
    expect(me.body.data.scopes.storeIds.sort()).toEqual(
      [String(storeA.id), String(storeB.id)].sort(),
    );

    const ambiguousProfile = await request(app)
      .get("/api/v1/sellers/me")
      .set(bearer(managerToken))
      .expect(403);
    expect(ambiguousProfile.body.error.code).toBe(
      SELLER_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
    );

    await request(app)
      .patch(`/api/v1/sellers/me/stores/${String(storeA.id)}`)
      .set(bearer(managerToken))
      .send({ name: "Manager Updated Store A" })
      .expect(200);

    await request(app)
      .put(`/api/v1/admin/users/${manager.id}/roles`)
      .set(bearer(adminToken))
      .send({
        assignments: [{ roleId: managerRoleId, sellerId: sellerB.sellerId }],
      })
      .expect(200);

    const afterRemoval = await databasePool.query<{
      seller_id: string;
      status: string;
    }>(
      `select seller_id::text as seller_id, status
         from seller_staff
        where user_id = $1
        order by seller_id`,
      [manager.id],
    );
    expect(afterRemoval.rows).toEqual(
      expect.arrayContaining([
        { seller_id: sellerA.sellerId, status: "inactive" },
        { seller_id: sellerB.sellerId, status: "active" },
      ]),
    );

    const refreshedToken = await loginUser(manager);
    const refreshedMe = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(refreshedToken))
      .expect(200);
    expect(refreshedMe.body.data.scopes.sellerIds).toEqual([sellerB.sellerId]);
    expect(refreshedMe.body.data.scopes.storeIds).toEqual([String(storeB.id)]);
  });

  it("lets a seller owner assign the normal seller-manager role inside only their seller scope", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createApprovedSeller(adminToken, "staff-owner-a");
    const sellerB = await createApprovedSeller(adminToken, "staff-owner-b");
    const target = await registerCustomer(
      `module4-owner-assigned-manager-${randomUUID()}@example.com`,
      "Owner Assigned Manager",
    );
    const managerRoleId = await sellerManagerRoleId();
    const app = createApp();

    const assigned = await request(app)
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set(bearer(sellerA.ownerToken))
      .send({
        assignments: [{ roleId: managerRoleId, sellerId: sellerA.sellerId }],
      })
      .expect(200);
    expect(assigned.body.data.accountType).toBe(ACCOUNT_TYPE.SELLER);

    const managerToken = await loginUser(target);
    const managerMe = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(managerToken))
      .expect(200);
    expect(managerMe.body.data.scopes.sellerIds).toEqual([sellerA.sellerId]);
    expect(managerMe.body.data.permissions).toContain("seller.store.manage");
    expect(managerMe.body.data.permissions).not.toContain("seller.staff.manage");

    const crossSeller = await registerCustomer(
      `module4-cross-seller-staff-${randomUUID()}@example.com`,
      "Cross Seller Staff",
    );
    const forbidden = await request(app)
      .put(`/api/v1/admin/users/${crossSeller.id}/roles`)
      .set(bearer(sellerA.ownerToken))
      .send({
        assignments: [{ roleId: managerRoleId, sellerId: sellerB.sellerId }],
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe(ADMIN_ERROR_CODE.SELLER_SCOPE_FORBIDDEN);

    const crossSellerState = await databasePool.query<{
      account_type: string;
      seller_role_count: number;
      staff_count: number;
    }>(
      `select u.account_type,
              (select count(*)::int from user_roles ur where ur.user_id = u.id and ur.seller_id is not null) as seller_role_count,
              (select count(*)::int from seller_staff ss where ss.user_id = u.id) as staff_count
         from users u
        where u.id = $1`,
      [crossSeller.id],
    );
    expect(crossSellerState.rows[0]).toEqual({
      account_type: ACCOUNT_TYPE.CUSTOMER,
      seller_role_count: 0,
      staff_count: 0,
    });
  });

  it("prevents a seller owner from delegating seller-owner or staff-management authority", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createApprovedSeller(adminToken, "staff-delegation");
    const target = await registerCustomer(
      `module4-owner-delegation-${randomUUID()}@example.com`,
      "Delegation Target",
    );
    const ownerRoleId = await sellerOwnerRoleId();
    const app = createApp();

    const forbidden = await request(app)
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set(bearer(seller.ownerToken))
      .send({
        assignments: [{ roleId: ownerRoleId, sellerId: seller.sellerId }],
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe(
      ADMIN_ERROR_CODE.USER_ROLE_ASSIGNMENT_INVALID,
    );

    const persisted = await databasePool.query<{
      account_type: string;
      role_count: number;
      staff_count: number;
    }>(
      `select u.account_type,
              (select count(*)::int from user_roles ur where ur.user_id = u.id) as role_count,
              (select count(*)::int from seller_staff ss where ss.user_id = u.id) as staff_count
         from users u
        where u.id = $1`,
      [target.id],
    );
    expect(persisted.rows[0]).toEqual({
      account_type: ACCOUNT_TYPE.CUSTOMER,
      role_count: 1,
      staff_count: 0,
    });
  });

  it("serializes concurrent seller suspension commands and blocks seller store reactivation", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createApprovedSeller(adminToken, "suspend");
    const store = await createStoreViaHttp(seller.ownerToken, "suspend-store");
    const storeId = String(store.id);
    const app = createApp();

    const [firstSuspension, repeatedSuspension] = await Promise.all([
      request(app)
        .post(`/api/v1/admin/sellers/${seller.sellerId}/suspend`)
        .set(bearer(adminToken))
        .send({ reason: "Compliance hold" }),
      request(app)
        .post(`/api/v1/admin/sellers/${seller.sellerId}/suspend`)
        .set(bearer(adminToken))
        .send({ reason: "Repeated concurrent command" }),
    ]);
    expect(firstSuspension.status).toBe(200);
    expect(repeatedSuspension.status).toBe(200);
    expect(firstSuspension.body.data.status).toBe(SELLER_STATUS.SUSPENDED);
    expect(repeatedSuspension.body.data.status).toBe(SELLER_STATUS.SUSPENDED);

    const persisted = await databasePool.query<{
      seller_status: string;
      store_status: string;
      staff_count: number;
      application_count: number;
    }>(
      `select s.status as seller_status,
              st.status as store_status,
              (select count(*)::int from seller_staff ss where ss.seller_id = s.id) as staff_count,
              (select count(*)::int from seller_applications sa where sa.applicant_user_id = s.owner_user_id) as application_count
         from sellers s
         join stores st on st.seller_id = s.id
        where s.id = $1 and st.id = $2`,
      [seller.sellerId, storeId],
    );
    expect(persisted.rows[0]).toEqual({
      seller_status: SELLER_STATUS.SUSPENDED,
      store_status: STORE_STATUS.SUSPENDED,
      staff_count: 1,
      application_count: 1,
    });

    await request(app).get("/api/v1/stores/suspend-store").expect(404);

    const noSellerScope = await request(app)
      .get("/api/v1/auth/me")
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(noSellerScope.body.data.scopes.sellerIds).toEqual([]);
    expect(noSellerScope.body.data.scopes.storeIds).toEqual([]);

    const sellerReactivation = await request(app)
      .patch(`/api/v1/sellers/me/stores/${storeId}`)
      .set(bearer(seller.ownerToken))
      .send({ status: STORE_STATUS.ACTIVE })
      .expect(403);
    expect(sellerReactivation.body.error.code).toBe("FORBIDDEN");

    const unchangedStore = await databasePool.query<{ status: string }>(
      "select status from stores where id = $1",
      [storeId],
    );
    expect(unchangedStore.rows[0]?.status).toBe(STORE_STATUS.SUSPENDED);
    expect(await countOutboxEvents(SELLER_OUTBOX_EVENT.SELLER_SUSPENDED)).toBe(1);
    expect(await countAuditActions(SELLER_AUDIT_ACTION.SELLER_SUSPENDED)).toBe(1);
  });

  it("keeps Module 21 seller-verification and store-asset links inside applicant/seller resource scope", async () => {
    const applicant = await registerCustomer(
      `module4-doc-applicant-${randomUUID()}@example.com`,
      "Document Applicant",
    );
    const otherCustomer = await registerCustomer(
      `module4-doc-other-${randomUUID()}@example.com`,
      "Other Applicant",
    );
    const applicantToken = await loginUser(applicant);
    const otherCustomerToken = await loginUser(otherCustomer);
    const application = await submitSellerApplicationViaHttp(applicantToken);
    const applicationId = String(application.id);
    const app = createApp();

    const verificationFileId = await createConfirmedFile(
      applicant.id,
      "seller_verification",
    );
    await request(app)
      .post(`/api/v1/documents/${verificationFileId}/link`)
      .set(bearer(applicantToken))
      .send({
        resourceType: "seller_application",
        resourceId: applicationId,
        purpose: DOCUMENT_PURPOSE.SELLER_VERIFICATION,
      })
      .expect(201);

    const otherVerificationFileId = await createConfirmedFile(
      otherCustomer.id,
      "seller_verification",
    );
    const foreignApplicationLink = await request(app)
      .post(`/api/v1/documents/${otherVerificationFileId}/link`)
      .set(bearer(otherCustomerToken))
      .send({
        resourceType: "seller_application",
        resourceId: applicationId,
        purpose: DOCUMENT_PURPOSE.SELLER_VERIFICATION,
      })
      .expect(404);
    expect(foreignApplicationLink.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
    );

    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const approved = await approveSellerApplicationViaHttp(adminToken, applicationId);
    const sellerId = String((approved.seller as Record<string, unknown>).id);
    const sellerToken = await loginUser(applicant);
    const storeAssetFileId = await createConfirmedFile(applicant.id, "store_asset");
    const store = await createStoreViaHttp(sellerToken, "document-store", {
      logoFileId: storeAssetFileId,
    });
    const storeId = String(store.id);

    await request(app)
      .post(`/api/v1/documents/${storeAssetFileId}/link`)
      .set(bearer(sellerToken))
      .send({
        resourceType: "store",
        resourceId: storeId,
        purpose: DOCUMENT_PURPOSE.STORE_ASSET,
      })
      .expect(201);

    const otherSeller = await createApprovedSeller(adminToken, "doc-other-seller");
    const otherAssetFileId = await createConfirmedFile(otherSeller.owner.id, "store_asset");
    const foreignStoreLink = await request(app)
      .post(`/api/v1/documents/${otherAssetFileId}/link`)
      .set(bearer(otherSeller.ownerToken))
      .send({
        resourceType: "store",
        resourceId: storeId,
        purpose: DOCUMENT_PURPOSE.STORE_ASSET,
      })
      .expect(404);
    expect(foreignStoreLink.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
    );

    const linkRows = await databasePool.query<{ resource_type: string; resource_id: string }>(
      `select resource_type, resource_id::text as resource_id
         from file_links
        where resource_id in ($1, $2)
        order by resource_type`,
      [applicationId, storeId],
    );
    expect(linkRows.rows).toEqual(
      expect.arrayContaining([
        { resource_type: "seller_application", resource_id: applicationId },
        { resource_type: "store", resource_id: storeId },
      ]),
    );

    expect(sellerId).toBeTruthy();
  });

  it("publishes exactly the ten approved Module 4 OpenAPI operations with no generic CRUD additions", async () => {
    const response = await request(createApp()).get("/openapi.json").expect(200);
    const paths = response.body.paths as Record<string, Record<string, unknown>>;
    const expected: Record<string, string[]> = {
      "/api/v1/sellers/applications": ["post"],
      "/api/v1/admin/seller-applications": ["get"],
      "/api/v1/admin/seller-applications/{id}/approve": ["post"],
      "/api/v1/admin/seller-applications/{id}/reject": ["post"],
      "/api/v1/sellers/me": ["get", "patch"],
      "/api/v1/sellers/me/stores": ["post"],
      "/api/v1/stores/{slug}": ["get"],
      "/api/v1/sellers/me/stores/{id}": ["patch"],
      "/api/v1/admin/sellers/{id}/suspend": ["post"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      expect(openApiMethods(paths[path])).toEqual(methods.sort());
    }

    const module4Operations = Object.entries(paths)
      .flatMap(([path, pathItem]) =>
        openApiMethods(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .filter((operation) =>
        operation.includes("/api/v1/sellers") ||
        operation.includes("/api/v1/stores") ||
        operation.includes("/api/v1/admin/seller"),
      )
      .sort();

    const expectedOperations = Object.entries(expected)
      .flatMap(([path, methods]) => methods.map((method) => `${method.toUpperCase()} ${path}`))
      .sort();
    expect(module4Operations).toEqual(expectedOperations);

    const app = createApp();
    await request(app).get("/api/v1/admin/sellers").expect(404);
    await request(app).delete(`/api/v1/admin/sellers/${randomUUID()}`).expect(404);
    await request(app).delete(`/api/v1/sellers/me/stores/${randomUUID()}`).expect(404);
  });
});
