import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import { COMMISSION_ENTRY_TYPE } from "../../src/modules/commissions/commissions.constants.js";
import {
  CommissionsRepository,
  type CreateCommissionRuleRecordInput,
} from "../../src/modules/commissions/commissions.repository.js";
import {
  prepareOrderFixture,
  resetModule11Tables,
} from "../module11/module11.test-helpers.js";

/** Clears Commission rows before resetting all released prerequisite data. */
async function resetModule16Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      commission_entries,
      commission_rule_snapshots,
      commission_rules
    RESTART IDENTITY CASCADE
  `);
  await resetModule11Tables();
}

/** Builds one persistence-ready Commission rule without encoding rule-winner precedence. */
function ruleInput(
  overrides: Partial<CreateCommissionRuleRecordInput> = {},
): CreateCommissionRuleRecordInput {
  return {
    priority: 10,
    scopeType: "default",
    scopeId: null,
    ratePercent: "10.000000",
    fixedFee: "1.0000",
    fundingRulesJson: null,
    startAt: new Date("2026-09-01T00:00:00.000Z"),
    endAt: null,
    status: "active",
    ...overrides,
  };
}

/** Reads immutable Order Item identities needed by Commission snapshot/ledger repository tests. */
async function readOrderItems(orderId: string): Promise<
  Array<{ orderItemId: string; sellerOrderId: string; sellerId: string }>
> {
  const result = await databasePool.query<{
    order_item_id: string;
    seller_order_id: string;
    seller_id: string;
  }>(
    `select item.id as order_item_id,
            item.seller_order_id,
            seller_order.seller_id
       from order_items item
       join seller_orders seller_order on seller_order.id = item.seller_order_id
      where item.order_id = $1
      order by item.id asc`,
    [orderId],
  );

  return result.rows.map((row) => ({
    orderItemId: row.order_item_id,
    sellerOrderId: row.seller_order_id,
    sellerId: row.seller_id,
  }));
}

beforeEach(async () => {
  await resetModule16Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 16 Commissions repository boundaries", () => {
  it("returns all effective matching rule candidates without deciding which rule wins", async () => {
    const repository = new CommissionsRepository();
    const sellerId = randomUUID();
    const categoryId = randomUUID();
    const productId = randomUUID();
    const otherSellerId = randomUUID();

    const defaultRule = await repository.createRule(ruleInput({ priority: 100 }));
    const sellerRule = await repository.createRule(
      ruleInput({ scopeType: "seller", scopeId: sellerId, priority: -50 }),
    );
    const categoryRule = await repository.createRule(
      ruleInput({ scopeType: "category", scopeId: categoryId, priority: 20 }),
    );
    const productRule = await repository.createRule(
      ruleInput({ scopeType: "product", scopeId: productId, priority: 1 }),
    );
    const unrelatedRule = await repository.createRule(
      ruleInput({ scopeType: "seller", scopeId: otherSellerId, priority: 999 }),
    );

    const candidates = await repository.findApplicableRuleCandidates({
      effectiveAt: new Date("2026-09-14T12:00:00.000Z"),
      status: "active",
      sellerId,
      categoryId,
      productId,
    });

    expect(candidates.map((rule) => rule.id).sort()).toEqual(
      [defaultRule.id, sellerRule.id, categoryRule.id, productRule.id].sort(),
    );
    expect(candidates.map((rule) => rule.id)).not.toContain(unrelatedRule.id);

    const sellerRules = await repository.listAdminRules({
      page: 1,
      pageSize: 20,
      scopeType: "seller",
      scopeId: sellerId,
      status: "active",
      sort: "createdAt",
      order: "desc",
    });
    expect(sellerRules.totalItems).toBe(1);
    expect(sellerRules.items[0]?.id).toBe(sellerRule.id);
  });

  it("supports transaction-bound rule locking and persists only service-approved rule updates", async () => {
    const repository = new CommissionsRepository();
    const rule = await repository.createRule(ruleInput());

    await db.transaction(async (transaction) => {
      const scoped = repository.using(transaction);
      await expect(scoped.findRuleByIdForUpdate(rule.id)).resolves.toMatchObject({
        id: rule.id,
        ratePercent: "10.000000",
      });
      await expect(
        scoped.updateRule(rule.id, {
          ratePercent: "12.500000",
          fixedFee: "2.0000",
        }),
      ).resolves.toMatchObject({
        id: rule.id,
        ratePercent: "12.500000",
        fixedFee: "2.0000",
      });
    });

  });

  it("creates one immutable Order Item rule snapshot when concurrent requests race", async () => {
    const fixture = await prepareOrderFixture();
    const [item] = await readOrderItems(fixture.orderId);
    if (!item) throw new Error("Expected one Order Item for the Commission snapshot test.");

    const repository = new CommissionsRepository();
    const input = {
      orderItemId: item.orderItemId,
      ruleId: null,
      ratePercent: "10.000000",
      fixedFee: "1.0000",
      basisJson: {
        source: "module16-pass3-test",
        note: "Persistence fact only; fee basis interpretation belongs to Pass 4 service.",
      },
    } as const;

    const [first, second] = await Promise.all([
      repository.createRuleSnapshotIfMissing(input),
      repository.createRuleSnapshotIfMissing(input),
    ]);
    const created = [first, second].filter((snapshot) => snapshot !== null);
    const conflicted = [first, second].filter((snapshot) => snapshot === null);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    await expect(repository.findSnapshotByOrderItemId(item.orderItemId)).resolves.toMatchObject({
      id: created[0]?.id,
      orderItemId: item.orderItemId,
      ratePercent: "10.000000",
    });
  });

  it("keeps source-key replay safe and seller statements isolated by mandatory seller scope", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2 });
    const items = await readOrderItems(fixture.orderId);
    if (items.length < 2) throw new Error("Expected two seller Order Items for isolation proof.");

    const repository = new CommissionsRepository();
    const firstItem = items[0];
    const secondItem = items.find((item) => item.sellerId !== firstItem?.sellerId);
    if (!firstItem || !secondItem) {
      throw new Error("Expected Order Items owned by two different sellers.");
    }

    const firstSourceKey = `commission:sale:${randomUUID()}`;
    const firstInput = {
      sellerId: firstItem.sellerId,
      sellerOrderId: firstItem.sellerOrderId,
      orderItemId: firstItem.orderItemId,
      type: COMMISSION_ENTRY_TYPE.SALE,
      grossAmount: "200.0000",
      commissionAmount: "20.0000",
      sellerNetAmount: "180.0000",
      currency: "PKR",
      sourceKey: firstSourceKey,
      occurredAt: new Date("2026-09-14T12:00:00.000Z"),
    } as const;

    const firstEntry = await repository.createEntryIfMissing(firstInput);
    if (!firstEntry) throw new Error("Expected the first Commission entry to be inserted.");
    await expect(repository.createEntryIfMissing(firstInput)).resolves.toBeNull();

    const secondEntry = await repository.createEntryIfMissing({
      sellerId: secondItem.sellerId,
      sellerOrderId: secondItem.sellerOrderId,
      orderItemId: secondItem.orderItemId,
      type: COMMISSION_ENTRY_TYPE.SALE,
      grossAmount: "50.0000",
      commissionAmount: "5.0000",
      sellerNetAmount: "45.0000",
      currency: "PKR",
      sourceKey: `commission:sale:${randomUUID()}`,
      occurredAt: new Date("2026-09-14T12:01:00.000Z"),
    });
    if (!secondEntry) throw new Error("Expected the second seller Commission entry to be inserted.");

    await expect(repository.findEntryBySourceKey(firstSourceKey)).resolves.toMatchObject({
      id: firstEntry.id,
      sellerId: firstItem.sellerId,
    });
    await expect(repository.listEntriesByOrderItemId(firstItem.orderItemId)).resolves.toHaveLength(1);

    const firstSellerStatement = await repository.listEntriesForSeller(firstItem.sellerId, {
      page: 1,
      pageSize: 20,
      sort: "occurredAt",
      order: "desc",
    });
    expect(firstSellerStatement.totalItems).toBe(1);
    expect(firstSellerStatement.items[0]).toMatchObject({
      id: firstEntry.id,
      sellerId: firstItem.sellerId,
    });
    expect(firstSellerStatement.items.some((entry) => entry.sellerId === secondItem.sellerId)).toBe(
      false,
    );

    const secondSellerAdminRead = await repository.listAdminEntries({
      page: 1,
      pageSize: 20,
      sellerId: secondItem.sellerId,
      sort: "occurredAt",
      order: "desc",
    });
    expect(secondSellerAdminRead.totalItems).toBe(1);
    expect(secondSellerAdminRead.items[0]?.id).toBe(secondEntry.id);
  });
});
