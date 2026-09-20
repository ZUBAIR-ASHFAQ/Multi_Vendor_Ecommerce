import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  CUSTOMER_ERROR_CODE,
  CUSTOMER_PERMISSION,
} from "../../src/modules/customers/customers.constants.js";
import { CustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";

/** Builds a small server-derived customer request context for service-policy tests. */
function customerContext(permissions: readonly PermissionCode[]): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates a repository-shaped test double without adding test-only behavior to production code. */
function repositoryStub(
  overrides: Partial<Record<keyof CustomersRepository, unknown>> = {},
): CustomersRepository {
  return {
    findProfileByUserId: vi.fn().mockResolvedValue(null),
    listCustomersForAdmin: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findCustomerSummaryForAdmin: vi.fn().mockResolvedValue(null),
    listAllAddressesByCustomerUserId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CustomersRepository;
}

describe("Module 3 service authorization and error policy", () => {
  it("rejects self-service reads when the required permission is absent", async () => {
    const service = new CustomersService({ repository: repositoryStub() });
    const context = customerContext([]);

    await expect(service.getMyProfile(context)).rejects.toMatchObject({
      code: ERROR_CODE.FORBIDDEN,
      statusCode: 403,
    });
  });

  it("rejects non-customer actors even when their RBAC role contains a customer permission", async () => {
    const repository = repositoryStub();
    const service = new CustomersService({ repository });
    const context: RequestContext = {
      ...customerContext([CUSTOMER_PERMISSION.PROFILE_READ_OWN]),
      actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    };

    await expect(service.getMyProfile(context)).rejects.toMatchObject({
      code: ERROR_CODE.FORBIDDEN,
      statusCode: 403,
    });
    expect(repository.findProfileByUserId).not.toHaveBeenCalled();
  });

  it("returns the stable customer-not-found error when the authenticated profile is missing", async () => {
    const service = new CustomersService({ repository: repositoryStub() });
    const context = customerContext([CUSTOMER_PERMISSION.PROFILE_READ_OWN]);

    await expect(service.getMyProfile(context)).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODE.CUSTOMER_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("maps a database default-address race to a safe retryable conflict", async () => {
    const duplicate = Object.assign(new Error("unique violation"), { code: "23505" });
    const service = new CustomersService({
      transactionRunner: async () => {
        throw duplicate;
      },
    });
    const context = customerContext([CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN]);

    await expect(
      service.createMyAddress(context, {
        label: "Home",
        recipientName: "Customer One",
        phone: "+92 300 1234567",
        line1: "123 Main Street",
        city: "Lahore",
        region: "Punjab",
        postalCode: "54000",
        countryCode: "PK",
        isDefaultShipping: true,
        isDefaultBilling: false,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.CONFLICT,
      statusCode: 409,
    });
  });

  it("requires the privileged customer-read permission before admin repository access", async () => {
    const repository = repositoryStub();
    const service = new CustomersService({ repository });
    const context: RequestContext = {
      ...customerContext([]),
      actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    };

    await expect(
      service.searchCustomersForAdmin(context, {
        page: 1,
        pageSize: 20,
        sort: "created_desc",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.FORBIDDEN, statusCode: 403 });
    expect(repository.listCustomersForAdmin).not.toHaveBeenCalled();
  });
});
