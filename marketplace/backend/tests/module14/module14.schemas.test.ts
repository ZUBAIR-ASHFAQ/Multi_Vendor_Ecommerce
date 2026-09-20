import { describe, expect, it } from "vitest";
import {
  adminReturnListQuerySchema,
  approveReturnBodySchema,
  createReturnRequestBodySchema,
  customerReturnListQuerySchema,
  issueReturnRefundBodySchema,
  receiveReturnBodySchema,
  rejectReturnBodySchema,
  returnCurrencySchema,
  returnMoneySchema,
  returnRequestResponseSchema,
  returnRequestStatusSchema,
  returnStatusHistoryResponseSchema,
  sellerReturnListQuerySchema,
} from "../../src/modules/returns-refunds/returns-refunds.schema.js";
import {
  RETURN_ITEM_RESOLUTION,
  RETURN_REASON_CODE,
  RETURN_REQUEST_STATUS,
  RETURNS_ERROR_CODE,
  RETURNS_PATH,
  RETURNS_PERMISSION,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";

const ORDER_ID = "00000000-0000-4000-8000-000000000001";
const SELLER_ORDER_ID = "00000000-0000-4000-8000-000000000002";
const ORDER_ITEM_ID = "00000000-0000-4000-8000-000000000003";
const RETURN_ITEM_ID = "00000000-0000-4000-8000-000000000004";

describe("Module 14 constants", () => {
  it("freezes the five approved Return lifecycle states", () => {
    expect(Object.values(RETURN_REQUEST_STATUS)).toEqual([
      "requested",
      "approved",
      "rejected",
      "received",
      "closed",
    ]);
  });

  it("keeps the exact eight required HTTP paths", () => {
    expect(Object.values(RETURNS_PATH)).toHaveLength(8);
    expect(new Set(Object.values(RETURNS_PATH)).size).toBe(8);
  });

  it("keeps the five required permissions and stable base-guide errors", () => {
    expect(Object.values(RETURNS_PERMISSION)).toEqual([
      "returns.create_own",
      "returns.read_own",
      "seller.returns.manage",
      "admin.returns.manage",
      "admin.refunds.issue",
    ]);
    expect(Object.values(RETURNS_ERROR_CODE)).toEqual([
      "RETURN_NOT_ELIGIBLE",
      "RETURN_WINDOW_EXPIRED",
      "RETURN_STATUS_INVALID",
      "REFUND_DUPLICATE",
      "RETURN_SCOPE_FORBIDDEN",
    ]);
  });
});

describe("Module 14 create/list contracts", () => {
  it("accepts one strict customer Return request with no client financial fields", () => {
    const parsed = createReturnRequestBodySchema.parse({
      sellerOrderId: SELLER_ORDER_ID,
      reasonCode: RETURN_REASON_CODE.DAMAGED,
      items: [{ orderItemId: ORDER_ITEM_ID, quantity: 1 }],
    });

    expect(parsed.items).toHaveLength(1);
  });

  it("rejects duplicate Order Items and client-supplied refund money", () => {
    expect(() =>
      createReturnRequestBodySchema.parse({
        sellerOrderId: SELLER_ORDER_ID,
        reasonCode: RETURN_REASON_CODE.DEFECTIVE,
        items: [
          { orderItemId: ORDER_ITEM_ID, quantity: 1 },
          { orderItemId: ORDER_ITEM_ID, quantity: 1 },
        ],
      }),
    ).toThrow();

    expect(() =>
      createReturnRequestBodySchema.parse({
        sellerOrderId: SELLER_ORDER_ID,
        reasonCode: RETURN_REASON_CODE.DEFECTIVE,
        items: [{ orderItemId: ORDER_ITEM_ID, quantity: 1, refundAmount: "9.0000" }],
      }),
    ).toThrow();
  });

  it("keeps customer and seller identity out of owned list filters", () => {
    expect(() => customerReturnListQuerySchema.parse({ sellerId: ORDER_ID })).toThrow();
    expect(() => sellerReturnListQuerySchema.parse({ customerUserId: ORDER_ID })).toThrow();
    expect(adminReturnListQuerySchema.parse({ sellerId: ORDER_ID }).sellerId).toBe(ORDER_ID);
  });
});

describe("Module 14 lifecycle command contracts", () => {
  it("keeps approve and refund bodies free from status and money ownership", () => {
    expect(approveReturnBodySchema.parse({})).toEqual({});
    expect(issueReturnRefundBodySchema.parse({ note: "Approved by finance." })).toEqual({
      note: "Approved by finance.",
    });
    expect(() => issueReturnRefundBodySchema.parse({ amount: "1.0000" })).toThrow();
  });

  it("requires a rejection reason", () => {
    expect(rejectReturnBodySchema.parse({ reason: "Outside policy." }).reason).toBe(
      "Outside policy.",
    );
    expect(() => rejectReturnBodySchema.parse({})).toThrow();
  });

  it("accepts inspection decisions but never accepts a client restock quantity", () => {
    const parsed = receiveReturnBodySchema.parse({
      items: [
        {
          returnItemId: RETURN_ITEM_ID,
          itemCondition: "opened",
          resolution: RETURN_ITEM_RESOLUTION.REFUND_RESTOCK,
        },
      ],
    });

    expect(parsed.items[0]?.resolution).toBe("refund_restock");
    expect(() =>
      receiveReturnBodySchema.parse({
        items: [
          {
            returnItemId: RETURN_ITEM_ID,
            itemCondition: "opened",
            resolution: "refund_restock",
            restockQty: 1,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("Module 14 additive history contract", () => {
  it("accepts append-only lifecycle history on the existing Return response without changing route identity", () => {
    const history = returnStatusHistoryResponseSchema.parse({
      id: "00000000-0000-4000-8000-000000000005",
      fromStatus: "requested",
      toStatus: "approved",
      changedBy: "00000000-0000-4000-8000-000000000006",
      reason: "Seller approved the Return.",
      changedAt: "2026-09-15T10:00:00.000Z",
    });

    const parsed = returnRequestResponseSchema.parse({
      id: "00000000-0000-4000-8000-000000000007",
      returnNo: "RET-0001",
      orderId: ORDER_ID,
      sellerOrderId: SELLER_ORDER_ID,
      customerUserId: "00000000-0000-4000-8000-000000000008",
      status: "approved",
      reasonCode: "damaged",
      requestedAt: "2026-09-15T09:00:00.000Z",
      approvedAt: "2026-09-15T10:00:00.000Z",
      items: [
        {
          id: RETURN_ITEM_ID,
          orderItemId: ORDER_ITEM_ID,
          quantity: 1,
          itemCondition: null,
          resolution: null,
          refundAmount: "0.0000",
          restockQty: 0,
        },
      ],
      history: [history],
    });

    expect(parsed.history).toEqual([history]);
  });
});

describe("Module 14 primitive contracts", () => {
  it("requires exact scale-4 money", () => {
    expect(returnMoneySchema.parse("10.2500")).toBe("10.2500");
    expect(() => returnMoneySchema.parse("10.25")).toThrow();
  });

  it("normalizes ISO-style currency and rejects unknown lifecycle values", () => {
    expect(returnCurrencySchema.parse("usd")).toBe("USD");
    expect(() => returnRequestStatusSchema.parse("refunding")).toThrow();
  });
});
