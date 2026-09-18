import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import {
  ACTOR_TYPE,
  type PermissionCode,
} from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { SellerRow } from "../../src/database/schema/sellers.js";
import {
  SELLER_APPROVAL_STATUS,
  SELLER_ERROR_CODE,
  SELLER_PERMISSION,
  SELLER_STATUS,
  STORE_STATUS,
} from "../../src/modules/sellers/sellers.constants.js";
import { SellersRepository } from "../../src/modules/sellers/sellers.repository.js";
import { SellersService } from "../../src/modules/sellers/sellers.service.js";

/** Builds one active approved seller row for service-policy tests. */
function sellerRow(overrides: Partial<SellerRow> = {}): SellerRow {
  const now = new Date();
  return {
    id: randomUUID(),
    ownerUserId: randomUUID(),
    legalName: "Example Legal Name",
    displayName: "Example Seller",
    taxId: null,
    status: SELLER_STATUS.ACTIVE,
    approvalStatus: SELLER_APPROVAL_STATUS.APPROVED,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Builds one server-derived request context with optional seller-scoped permissions. */
function testContext(input: {
  actorId?: string;
  actorType?: RequestContext["actorType"];
  permissions?: readonly PermissionCode[];
  sellerIds?: readonly string[];
  sellerPermissions?: Map<string, Set<PermissionCode>>;
} = {}): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: input.actorId ?? randomUUID(),
    actorType: input.actorType ?? ACTOR_TYPE.CUSTOMER,
    permissions: new Set(input.permissions ?? []),
    sellerIds: new Set(input.sellerIds ?? []),
    storeIds: new Set(),
    sellerPermissions: input.sellerPermissions ?? new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates a repository-shaped test double without adding test-only production branches. */
function repositoryStub(
  overrides: Partial<Record<keyof SellersRepository, unknown>> = {},
): SellersRepository {
  return {
    findSellerByOwnerUserId: vi.fn().mockResolvedValue(null),
    findSellerByIdForUpdate: vi.fn().mockResolvedValue(null),
    findOpenSellerApplicationByApplicantUserId: vi.fn().mockResolvedValue(null),
    listSellerApplications: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findPublicStoreBySlug: vi.fn().mockResolvedValue(null),
    listActiveSellerIdsForUser: vi.fn().mockResolvedValue([]),
    listActiveStoreIdsForUser: vi.fn().mockResolvedValue([]),
    findSellerApplicationDocumentScope: vi.fn().mockResolvedValue(null),
    findSellerDocumentScope: vi.fn().mockResolvedValue(null),
    findStoreDocumentScope: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SellersRepository;
}

describe("Module 4 service authorization and cross-module policy", () => {
  it("allows only customer actors to submit seller applications", async () => {
    const repository = repositoryStub();
    const service = new SellersService({ repository });
    const context = testContext({ actorType: ACTOR_TYPE.SELLER });

    await expect(
      service.submitApplication(context, {
        legalName: "Example Legal Name",
        displayName: "Example Seller",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.FORBIDDEN, statusCode: 403 });
    expect(repository.findSellerByOwnerUserId).not.toHaveBeenCalled();
  });

  it("checks admin review permission before reading the seller-application queue", async () => {
    const repository = repositoryStub();
    const service = new SellersService({ repository });
    const context = testContext({ actorType: ACTOR_TYPE.PLATFORM_ADMIN });

    await expect(
      service.listApplications(context, {
        page: 1,
        pageSize: 20,
        sort: "created_desc",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.FORBIDDEN, statusCode: 403 });
    expect(repository.listSellerApplications).not.toHaveBeenCalled();
  });

  it("rejects unsupported store currency before opening the create-store transaction", async () => {
    const seller = sellerRow();
    const repository = repositoryStub({
      findSellerByOwnerUserId: vi.fn().mockResolvedValue(seller),
    });
    const transactionRunner = vi.fn();
    const service = new SellersService({
      repository,
      transactionRunner,
      administration: {
        provisionApprovedSellerOwner: vi.fn(),
        isSupportedCurrency: vi.fn().mockResolvedValue(false),
      },
    });
    const context = testContext({
      actorId: seller.ownerUserId,
      actorType: ACTOR_TYPE.SELLER,
      permissions: [SELLER_PERMISSION.STORE_MANAGE],
      sellerIds: [seller.id],
      sellerPermissions: new Map([
        [seller.id, new Set<PermissionCode>([SELLER_PERMISSION.STORE_MANAGE])],
      ]),
    });

    await expect(
      service.createStore(context, {
        slug: "example-store",
        name: "Example Store",
        defaultCurrency: "EUR",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.INVALID_REQUEST, statusCode: 400 });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("hides public stores when either the store or seller lifecycle is not active", async () => {
    const repository = repositoryStub({
      findPublicStoreBySlug: vi.fn().mockResolvedValue({
        id: randomUUID(),
        sellerId: randomUUID(),
        slug: "hidden-store",
        name: "Hidden Store",
        description: null,
        logoFileId: null,
        defaultCurrency: "PKR",
        supportEmail: null,
        storeStatus: STORE_STATUS.SUSPENDED,
        sellerStatus: SELLER_STATUS.ACTIVE,
        sellerApprovalStatus: SELLER_APPROVAL_STATUS.APPROVED,
        sellerDisplayName: "Hidden Seller",
      }),
    });
    const service = new SellersService({ repository });

    await expect(service.getPublicStore("hidden-store")).rejects.toMatchObject({
      code: SELLER_ERROR_CODE.STORE_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("resolves authentication scopes only from repository-approved active seller and store memberships", async () => {
    const userId = randomUUID();
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const storeA = randomUUID();
    const listActiveSellerIdsForUser = vi.fn().mockResolvedValue([sellerA]);
    const listActiveStoreIdsForUser = vi.fn().mockResolvedValue([storeA]);
    const repository = repositoryStub({
      listActiveSellerIdsForUser,
      listActiveStoreIdsForUser,
    });
    const service = new SellersService({ repository });

    await expect(service.resolveAccessScopes(userId, [sellerA, sellerB])).resolves.toEqual({
      sellerIds: [sellerA],
      storeIds: [storeA],
    });
    expect(listActiveSellerIdsForUser).toHaveBeenCalledWith(userId, [sellerA, sellerB]);
    expect(listActiveStoreIdsForUser).toHaveBeenCalledWith(userId, [sellerA]);
  });

  it("locks each assignable seller scope once in stable order before staff assignment", async () => {
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const rows = new Map<string, SellerRow>([
      [sellerA, sellerRow({ id: sellerA })],
      [sellerB, sellerRow({ id: sellerB })],
    ]);
    const findSellerByIdForUpdate = vi.fn(async (sellerId: string) =>
      rows.get(sellerId) ?? null,
    );
    const repository = repositoryStub({ findSellerByIdForUpdate });
    const service = new SellersService({ repository });

    await expect(
      service.validateAssignableSellerIds([sellerB, sellerA, sellerB]),
    ).resolves.toBeUndefined();
    expect(findSellerByIdForUpdate.mock.calls.map(([sellerId]) => sellerId)).toEqual(
      [sellerA, sellerB].sort(),
    );
  });

  it("rejects seller staff assignment when the requested seller is suspended", async () => {
    const sellerId = randomUUID();
    const repository = repositoryStub({
      findSellerByIdForUpdate: vi
        .fn()
        .mockResolvedValue(
          sellerRow({ id: sellerId, status: SELLER_STATUS.SUSPENDED }),
        ),
    });
    const service = new SellersService({ repository });

    await expect(service.validateAssignableSellerIds([sellerId])).rejects.toMatchObject({
      code: SELLER_ERROR_CODE.SELLER_NOT_APPROVED,
      statusCode: 409,
    });
  });

  it("authorizes seller application documents only for the applicant or platform admin", async () => {
    const applicantUserId = randomUUID();
    const applicationId = randomUUID();
    const repository = repositoryStub({
      findSellerApplicationDocumentScope: vi.fn().mockResolvedValue({
        applicationId,
        applicantUserId,
      }),
    });
    const service = new SellersService({ repository });

    await expect(
      service.authorizeDocumentResource(
        testContext({ actorId: applicantUserId }),
        "seller_application",
        applicationId,
        "link",
      ),
    ).resolves.toEqual({ sellerId: null });

    await expect(
      service.authorizeDocumentResource(
        testContext({ actorId: randomUUID() }),
        "seller_application",
        applicationId,
        "link",
      ),
    ).resolves.toBeNull();

    await expect(
      service.authorizeDocumentResource(
        testContext({ actorType: ACTOR_TYPE.PLATFORM_ADMIN }),
        "seller_application",
        applicationId,
        "read",
      ),
    ).resolves.toEqual({ sellerId: null });
  });

  it("keeps seller and store document resources inside server-derived seller scope", async () => {
    const sellerId = randomUUID();
    const otherSellerId = randomUUID();
    const sellerResourceId = sellerId;
    const storeResourceId = randomUUID();
    const repository = repositoryStub({
      findSellerDocumentScope: vi.fn().mockResolvedValue({ sellerId }),
      findStoreDocumentScope: vi.fn().mockResolvedValue({
        storeId: storeResourceId,
        sellerId,
      }),
    });
    const service = new SellersService({ repository });
    const allowed = testContext({
      actorType: ACTOR_TYPE.SELLER,
      sellerIds: [sellerId],
    });
    const denied = testContext({
      actorType: ACTOR_TYPE.SELLER,
      sellerIds: [otherSellerId],
    });

    await expect(
      service.authorizeDocumentResource(allowed, "seller", sellerResourceId, "read"),
    ).resolves.toEqual({ sellerId });
    await expect(
      service.authorizeDocumentResource(allowed, "store", storeResourceId, "link"),
    ).resolves.toEqual({ sellerId });
    await expect(
      service.authorizeDocumentResource(denied, "seller", sellerResourceId, "read"),
    ).resolves.toBeNull();
    await expect(
      service.authorizeDocumentResource(denied, "store", storeResourceId, "link"),
    ).resolves.toBeNull();
  });

  it("resolves the stable seller owner used by Notification policy without exposing seller persistence", async () => {
    const seller = sellerRow();
    const findSellerById = vi
      .fn()
      .mockResolvedValueOnce(seller)
      .mockResolvedValueOnce(null);
    const service = new SellersService({
      repository: repositoryStub({ findSellerById }),
    });

    await expect(service.resolveNotificationOwnerUserId(seller.id)).resolves.toBe(
      seller.ownerUserId,
    );
    await expect(service.resolveNotificationOwnerUserId(randomUUID())).resolves.toBeNull();
    expect(findSellerById).toHaveBeenCalledTimes(2);
  });

  it("rejects ambiguous /sellers/me access when staff holds more than one seller scope", async () => {
    const repository = repositoryStub({
      findSellerByOwnerUserId: vi.fn().mockResolvedValue(null),
    });
    const service = new SellersService({ repository });
    const context = testContext({
      actorType: ACTOR_TYPE.SELLER,
      sellerIds: [randomUUID(), randomUUID()],
      permissions: [SELLER_PERMISSION.PROFILE_READ],
    });

    await expect(service.getMySeller(context)).rejects.toMatchObject({
      code: SELLER_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
  });
});
