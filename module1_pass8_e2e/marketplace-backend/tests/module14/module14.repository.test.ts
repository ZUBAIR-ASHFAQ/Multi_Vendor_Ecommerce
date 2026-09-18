import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import {
  RETURN_ITEM_RESOLUTION,
  RETURN_REQUEST_STATUS,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import {
  ReturnsRefundsRepository,
  type ReturnSellerScope,
} from "../../src/modules/returns-refunds/returns-refunds.repository.js";
import {
  customerReturnListQuerySchema,
  sellerReturnListQuerySchema,
} from "../../src/modules/returns-refunds/returns-refunds.schema.js";
import { prepareOrderFixture } from "../module11/module11.test-helpers.js";
import { createPersistedPaymentForFixture } from "../module12/module12.test-helpers.js";
import { resetModule14Tables } from "./module14.test-helpers.js";

/** Creates one deterministic human-readable Return number for repository fixtures. */
function returnNumber(id: string): string {
  return `RET-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Converts one prepared seller fixture into the exact repository seller/store scope shape. */
function sellerScope(sellerId: string, storeId: string): ReturnSellerScope {
  return { sellerIds: [sellerId], storeIds: [storeId] };
}

/** Reads seller/order-item identities created by one real Checkout/Orders fixture. */
async function readOrderRows(orderId: string) {
  const result = await databasePool.query<{
    seller_order_id: string;
    seller_id: string;
    store_id: string;
    order_item_id: string;
  }>(
    `select so.id as seller_order_id,
            so.seller_id,
            so.store_id,
            oi.id as order_item_id
       from seller_orders so
       join order_items oi on oi.seller_order_id = so.id
      where so.order_id = $1
      order by so.id, oi.id`,
    [orderId],
  );
  return result.rows;
}

beforeEach(async () => {
  await resetModule14Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 14 Returns repository boundaries", () => {
  it("keeps customer reads and seller locks inside their exact persisted ownership scopes", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2, quantities: [1, 1] });
    const rows = await readOrderRows(fixture.orderId);
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    const second = rows[1]!;
    const repository = new ReturnsRefundsRepository();

    const firstId = randomUUID();
    const secondId = randomUUID();
    await repository.createReturnRequest({
      id: firstId,
      returnNo: returnNumber(firstId),
      orderId: fixture.orderId,
      sellerOrderId: first.seller_order_id,
      customerUserId: fixture.customer.id,
      status: RETURN_REQUEST_STATUS.REQUESTED,
      reasonCode: "damaged",
    });
    await repository.createReturnItems(firstId, [
      { orderItemId: first.order_item_id, quantity: 1 },
    ]);
    await repository.createReturnRequest({
      id: secondId,
      returnNo: returnNumber(secondId),
      orderId: fixture.orderId,
      sellerOrderId: second.seller_order_id,
      customerUserId: fixture.customer.id,
      status: RETURN_REQUEST_STATUS.REQUESTED,
      reasonCode: "defective",
    });
    await repository.createReturnItems(secondId, [
      { orderItemId: second.order_item_id, quantity: 1 },
    ]);

    const customerQuery = customerReturnListQuerySchema.parse({ page: 1, pageSize: 20 });
    const customerList = await repository.listCustomerReturns(fixture.customer.id, customerQuery);
    expect(customerList.totalItems).toBe(2);
    expect(new Set(customerList.items.map((row) => row.id))).toEqual(new Set([firstId, secondId]));

    const sellerQuery = sellerReturnListQuerySchema.parse({ page: 1, pageSize: 20 });
    const firstSellerList = await repository.listSellerReturns(
      sellerScope(first.seller_id, first.store_id),
      sellerQuery,
    );
    expect(firstSellerList.totalItems).toBe(1);
    expect(firstSellerList.items[0]?.id).toBe(firstId);

    await expect(
      db.transaction(async (transaction) =>
        new ReturnsRefundsRepository(transaction).lockReturnInSellerScope(
          secondId,
          sellerScope(first.seller_id, first.store_id),
        ),
      ),
    ).resolves.toBeNull();
  });

  it("serializes allocation reads and excludes rejected Return Requests from reserved quantity", async () => {
    const fixture = await prepareOrderFixture({ quantities: [3] });
    const [row] = await readOrderRows(fixture.orderId);
    if (!row) throw new Error("Expected one Order Item for Return-allocation proof.");
    const repository = new ReturnsRefundsRepository();
    const requestedId = randomUUID();
    const rejectedId = randomUUID();

    await repository.createReturnRequest({
      id: requestedId,
      returnNo: returnNumber(requestedId),
      orderId: fixture.orderId,
      sellerOrderId: row.seller_order_id,
      customerUserId: fixture.customer.id,
      status: RETURN_REQUEST_STATUS.REQUESTED,
      reasonCode: "damaged",
    });
    await repository.createReturnItems(requestedId, [
      { orderItemId: row.order_item_id, quantity: 2 },
    ]);
    await repository.createReturnRequest({
      id: rejectedId,
      returnNo: returnNumber(rejectedId),
      orderId: fixture.orderId,
      sellerOrderId: row.seller_order_id,
      customerUserId: fixture.customer.id,
      status: RETURN_REQUEST_STATUS.REJECTED,
      reasonCode: "other",
    });
    await repository.createReturnItems(rejectedId, [
      { orderItemId: row.order_item_id, quantity: 1 },
    ]);

    await db.transaction(async (transaction) => {
      const scoped = new ReturnsRefundsRepository(transaction);
      await scoped.lockReturnAllocations([row.order_item_id, row.order_item_id]);
      await expect(scoped.sumNonRejectedReturnQuantities([row.order_item_id])).resolves.toEqual([
        { orderItemId: row.order_item_id, reservedQuantity: 2 },
      ]);
    });
  });

  it("keeps Refund identity unique and lets PostgreSQL reject impossible restock quantities", async () => {
    const fixture = await prepareOrderFixture({ quantities: [1] });
    const [row] = await readOrderRows(fixture.orderId);
    if (!row) throw new Error("Expected one Order Item for Refund repository proof.");
    const payment = await createPersistedPaymentForFixture(fixture, {
      providerPaymentId: `pi_module14_repo_${randomUUID().replaceAll("-", "")}`,
      status: "captured",
      amountAuthorized: fixture.quote.grandTotal,
      amountCaptured: fixture.quote.grandTotal,
    });
    const repository = new ReturnsRefundsRepository();
    const returnRequestId = randomUUID();
    await repository.createReturnRequest({
      id: returnRequestId,
      returnNo: returnNumber(returnRequestId),
      orderId: fixture.orderId,
      sellerOrderId: row.seller_order_id,
      customerUserId: fixture.customer.id,
      status: RETURN_REQUEST_STATUS.APPROVED,
      reasonCode: "damaged",
      approvedAt: new Date(),
    });
    const [item] = await repository.createReturnItems(returnRequestId, [
      { orderItemId: row.order_item_id, quantity: 1 },
    ]);
    if (!item) throw new Error("Expected one Return Item repository fixture.");

    const key = `module14-refund-${randomUUID()}`;
    const firstRefund = await repository.createRefundIfMissing({
      returnRequestId,
      orderId: fixture.orderId,
      paymentId: payment.id,
      amount: "50.0000",
      currency: "PKR",
      status: "pending",
      idempotencyKey: key,
    });
    expect(firstRefund).not.toBeNull();
    await expect(
      repository.createRefundIfMissing({
        returnRequestId,
        orderId: fixture.orderId,
        paymentId: payment.id,
        amount: "50.0000",
        currency: "PKR",
        status: "pending",
        idempotencyKey: key,
      }),
    ).resolves.toBeNull();

    await expect(
      repository.updateReturnItemResolution(returnRequestId, item.id, {
        itemCondition: "opened",
        resolution: RETURN_ITEM_RESOLUTION.REFUND_RESTOCK,
        restockQty: 2,
      }),
    ).rejects.toThrow();
  });
});
