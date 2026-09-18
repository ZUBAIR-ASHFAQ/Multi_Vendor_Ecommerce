import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { ProductsRepository } from "../../src/modules/products/products.repository.js";
import {
  createCategoryViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createProductViaHttp,
  createVariantViaHttp,
  loginUser,
  resetModule6Tables,
} from "./module6.test-helpers.js";

beforeEach(async () => {
  await resetModule6Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 6 repository persistence and scope", () => {
  it("finds global slug conflicts and allows excluding the Product being edited", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "SlugRepo");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "slug-repo-category",
      name: "Slug Repo Category",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "global-slug",
      name: "Global Slug",
      description: "Repository test",
    });
    const repository = new ProductsRepository();

    expect(await repository.findProductIdBySlug("global-slug")).toBe(product.id);
    expect(await repository.findProductIdBySlug("global-slug", product.id)).toBeNull();
    expect(await repository.findProductIdBySlug("missing-slug")).toBeNull();
  });

  it("keeps private Product reads inside the exact seller/store scope", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "RepoA");
    const sellerB = await createProductSellerFixture(adminToken, "RepoB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "repo-scope-category",
      name: "Repo Scope Category",
    });
    const product = await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "repo-private-product",
      name: "Private Product",
      description: "Seller scope test",
    });
    const repository = new ProductsRepository();

    await expect(
      repository.findProductByIdInSellerScope(product.id, {
        sellerIds: [sellerA.sellerId],
        storeIds: [sellerA.storeId],
      }),
    ).resolves.toMatchObject({ id: product.id });
    await expect(
      repository.findProductByIdInSellerScope(product.id, {
        sellerIds: [sellerB.sellerId],
        storeIds: [sellerB.storeId],
      }),
    ).resolves.toBeNull();
  });

  it("finds SKU conflicts only inside the same seller/store commerce scope", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "SkuRepoA");
    const sellerB = await createProductSellerFixture(adminToken, "SkuRepoB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "sku-repo-category",
      name: "SKU Repo Category",
    });
    const productA = await createProductViaHttp(sellerA.ownerToken, {
      storeId: sellerA.storeId,
      categoryId: category.id,
      slug: "sku-repo-a",
      name: "SKU A",
      description: "SKU repository test",
    });
    const variantA = await createVariantViaHttp(sellerA.ownerToken, productA.id, {
      sku: "SHARED-SKU",
      title: "Variant A",
      price: "10.00",
      currency: "PKR",
    });
    const repository = new ProductsRepository();

    expect(
      await repository.findVariantIdBySkuInSellerStore(
        sellerA.sellerId,
        sellerA.storeId,
        "SHARED-SKU",
      ),
    ).toBe(variantA.id);
    expect(
      await repository.findVariantIdBySkuInSellerStore(
        sellerB.sellerId,
        sellerB.storeId,
        "SHARED-SKU",
      ),
    ).toBeNull();
    expect(
      await repository.findVariantIdBySkuInSellerStore(
        sellerA.sellerId,
        sellerA.storeId,
        "SHARED-SKU",
        variantA.id,
      ),
    ).toBeNull();
  });

  it("replaces attributes for one exact variant without deleting another variant's values", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "AttrRepo");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "attr-repo-category",
      name: "Attribute Repo Category",
    });
    const attributeResult = await databasePool.query<{ id: string }>(
      `insert into attributes (code, name, data_type, is_variant_axis, status)
       values ($1, $2, 'text', false, 'active') returning id`,
      [`material-${randomUUID()}`, "Material"],
    );
    const attributeId = attributeResult.rows[0]?.id;
    if (!attributeId) throw new Error("Attribute insert did not return an id.");
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "attr-repo-product",
      name: "Attribute Product",
      description: "Attribute replacement test",
    });
    const first = await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "ATTR-1",
      title: "First",
      price: "10.00",
      currency: "PKR",
    });
    const second = await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "ATTR-2",
      title: "Second",
      price: "11.00",
      currency: "PKR",
    });
    const repository = new ProductsRepository();

    await repository.replaceVariantAttributeValues(product.id, first.id, [
      { attributeId, valueText: "Cotton" },
    ]);
    await repository.replaceVariantAttributeValues(product.id, second.id, [
      { attributeId, valueText: "Leather" },
    ]);
    await repository.replaceVariantAttributeValues(product.id, first.id, [
      { attributeId, valueText: "Wool" },
    ]);

    const values = await repository.listAttributeValuesByProductId(product.id);
    expect(values.filter((value) => value.variantId === first.id)).toHaveLength(1);
    expect(values.find((value) => value.variantId === first.id)?.valueText).toBe("Wool");
    expect(values.find((value) => value.variantId === second.id)?.valueText).toBe("Leather");
  });

  it("keeps price history append-only at the database boundary", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "HistoryRepo");
    const category = await createCategoryViaHttp(adminToken, {
      slug: "history-repo-category",
      name: "History Repo Category",
    });
    const product = await createProductViaHttp(seller.ownerToken, {
      storeId: seller.storeId,
      categoryId: category.id,
      slug: "history-repo-product",
      name: "History Product",
      description: "Price history test",
    });
    const variant = await createVariantViaHttp(seller.ownerToken, product.id, {
      sku: "HISTORY-1",
      title: "History Variant",
      price: "10.00",
      currency: "PKR",
    });
    const repository = new ProductsRepository();
    const history = await repository.createPriceHistory({
      variantId: variant.id,
      oldPrice: "10.00",
      newPrice: "12.00",
      changedBy: seller.owner.id,
    });

    await expect(
      databasePool.query("update product_price_history set new_price = 13 where id = $1", [history.id]),
    ).rejects.toThrow();
    await expect(
      databasePool.query("delete from product_price_history where id = $1", [history.id]),
    ).rejects.toThrow();
    expect(await repository.listPriceHistoryByProductId(product.id)).toHaveLength(1);
  });
});
