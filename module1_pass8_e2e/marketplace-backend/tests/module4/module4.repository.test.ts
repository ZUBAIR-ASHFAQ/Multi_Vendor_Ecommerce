import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import { SellersRepository } from "../../src/modules/sellers/sellers.repository.js";
import {
  createApprovedSeller,
  createPlatformAdmin,
  createStoreViaHttp,
  loginUser,
  resetModule4Tables,
} from "./module4.test-helpers.js";

beforeEach(async () => {
  await resetModule4Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 4 repository seller/store scope", () => {
  it("keeps private seller and store reads inside the exact seller ownership scope", async () => {
    const admin = await createPlatformAdmin(
      `module4-repo-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const sellerA = await createApprovedSeller(adminToken, "RepoA");
    const sellerB = await createApprovedSeller(adminToken, "RepoB");
    const storeA = await createStoreViaHttp(
      sellerA.ownerToken,
      `repo-a-${randomUUID()}`,
    );
    await createStoreViaHttp(
      sellerB.ownerToken,
      `repo-b-${randomUUID()}`,
    );
    const storeAId = String(storeA.id);
    const repository = new SellersRepository();

    await expect(
      repository.findStoreByIdForSeller(storeAId, sellerB.sellerId),
    ).resolves.toBeNull();
    await expect(
      repository.findStoreByIdForSeller(storeAId, sellerA.sellerId),
    ).resolves.toMatchObject({ id: storeAId, sellerId: sellerA.sellerId });

    await expect(
      repository.findSellerByIdForStaffUser(sellerA.sellerId, sellerB.owner.id),
    ).resolves.toBeNull();
    await expect(
      repository.findSellerByIdForStaffUser(sellerA.sellerId, sellerA.owner.id),
    ).resolves.toMatchObject({ id: sellerA.sellerId });

    const sellerAStores = await repository.listStoresBySellerId(sellerA.sellerId);
    expect(sellerAStores).toHaveLength(1);
    expect(sellerAStores[0]).toMatchObject({ id: storeAId, sellerId: sellerA.sellerId });
  });
});
