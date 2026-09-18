import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sellersOpenApiPaths } from "../../src/modules/sellers/sellers.routes.js";
import {
  adminSellerApplicationListQuerySchema,
  createStoreBodySchema,
  publicStoreResponseSchema,
  submitSellerApplicationBodySchema,
  suspendSellerBodySchema,
  updateSellerProfileBodySchema,
  updateStoreBodySchema,
} from "../../src/modules/sellers/sellers.schema.js";

/** Returns one valid store-create payload used by schema tests. */
function validStoreInput() {
  return {
    slug: "  My-First-Store  ",
    name: "  My Store  ",
    description: "  Seller storefront  ",
    logoFileId: null,
    defaultCurrency: " pkr ",
    supportEmail: "  SUPPORT@EXAMPLE.COM  ",
  };
}

describe("Module 4 request and response contracts", () => {
  it("normalizes seller application text and rejects server-owned fields", () => {
    expect(
      submitSellerApplicationBodySchema.parse({
        legalName: "  Example Trading Ltd  ",
        displayName: "  Example Seller  ",
        taxId: "  TAX-123  ",
      }),
    ).toEqual({
      legalName: "Example Trading Ltd",
      displayName: "Example Seller",
      taxId: "TAX-123",
    });

    expect(() =>
      submitSellerApplicationBodySchema.parse({
        legalName: "Example Trading Ltd",
        displayName: "Example Seller",
        sellerId: randomUUID(),
        status: "approved",
      }),
    ).toThrow();
  });

  it("normalizes store slug, currency and support email without accepting lifecycle ownership fields", () => {
    expect(createStoreBodySchema.parse(validStoreInput())).toMatchObject({
      slug: "my-first-store",
      name: "My Store",
      description: "Seller storefront",
      defaultCurrency: "PKR",
      supportEmail: "support@example.com",
    });

    expect(() =>
      createStoreBodySchema.parse({
        ...validStoreInput(),
        sellerId: randomUUID(),
        status: "suspended",
      }),
    ).toThrow();
  });

  it("requires one editable field and limits seller store lifecycle changes", () => {
    expect(() => updateSellerProfileBodySchema.parse({})).toThrow();
    expect(() => updateStoreBodySchema.parse({})).toThrow();

    expect(updateSellerProfileBodySchema.parse({ displayName: "  Better Name  " })).toEqual({
      displayName: "Better Name",
    });
    expect(updateStoreBodySchema.parse({ slug: "  Better-Slug  " })).toEqual({
      slug: "better-slug",
    });
    expect(updateStoreBodySchema.parse({ status: "inactive" })).toEqual({
      status: "inactive",
    });
    expect(updateStoreBodySchema.parse({ status: "active" })).toEqual({
      status: "active",
    });
    expect(() => updateStoreBodySchema.parse({ status: "suspended" })).toThrow();
  });


  it("keeps generated OpenAPI store-update input aligned with the Zod contract", () => {
    const updateSchema =
      sellersOpenApiPaths["/api/v1/sellers/me/stores/{id}"].patch.requestBody
        .content["application/json"].schema;
    const updateProperties = (updateSchema as {
      properties?: Record<string, unknown>;
    }).properties;

    expect(updateSchema).toMatchObject({ minProperties: 1 });
    expect(updateProperties?.status).toMatchObject({
      type: "string",
      enum: ["active", "inactive"],
    });

    const createSchema =
      sellersOpenApiPaths["/api/v1/sellers/me/stores"].post.requestBody
        .content["application/json"].schema;
    const createProperties = (createSchema as {
      properties?: Record<string, unknown>;
    }).properties;

    expect(createProperties).not.toHaveProperty("status");
  });

  it("applies bounded application-list defaults and rejects unknown filters", () => {
    expect(adminSellerApplicationListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: "created_desc",
    });

    expect(() =>
      adminSellerApplicationListQuerySchema.parse({ pageSize: 10000 }),
    ).toThrow();
    expect(() =>
      adminSellerApplicationListQuerySchema.parse({ unknownFilter: "x" }),
    ).toThrow();
  });

  it("keeps seller suspension input explicit and strips no unknown administrative fields", () => {
    expect(suspendSellerBodySchema.parse({ reason: "  Compliance review  " })).toEqual({
      reason: "Compliance review",
    });
    expect(() => suspendSellerBodySchema.parse({ status: "suspended" })).toThrow();
  });

  it("public store response excludes seller legal, tax and owner fields", () => {
    const publicStore = {
      id: randomUUID(),
      slug: "safe-store",
      name: "Safe Store",
      description: null,
      logoFileId: null,
      defaultCurrency: "PKR",
      supportEmail: "support@example.com",
      seller: {
        id: randomUUID(),
        displayName: "Safe Seller",
      },
    };

    expect(publicStoreResponseSchema.parse(publicStore)).toEqual(publicStore);
    expect(() =>
      publicStoreResponseSchema.parse({
        ...publicStore,
        seller: {
          ...publicStore.seller,
          legalName: "Private Legal Name",
          taxId: "PRIVATE-TAX",
          ownerUserId: randomUUID(),
        },
      }),
    ).toThrow();
  });
});
