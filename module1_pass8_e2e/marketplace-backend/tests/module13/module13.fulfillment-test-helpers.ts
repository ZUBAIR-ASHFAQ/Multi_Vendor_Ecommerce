import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { CustomerOrderDetail } from "../../src/modules/orders/orders.schema.js";
import {
  confirmOrderPaymentViaHttp,
  getCustomerOrderViaHttp,
  prepareOrderFixture,
  type PreparedOrderFixture,
} from "../module11/module11.test-helpers.js";
import { bearer } from "./module13.test-helpers.js";

/** Real paid/accepted Seller Order fixture used by Module 13 fulfillment HTTP and PostgreSQL proof. */
export interface PreparedFulfillmentFixture {
  checkout: PreparedOrderFixture;
  order: CustomerOrderDetail;
  orderId: string;
  sellerOrderId: string;
  orderItemId: string;
  variantId: string;
  sellerToken: string;
  customerToken: string;
  adminToken: string;
  quantity: number;
}

/** Creates one Checkout Order, captures it through Module 11, then accepts its Seller Order for fulfillment. */
export async function prepareFulfillmentFixture(
  quantity = 2,
): Promise<PreparedFulfillmentFixture> {
  const checkout = await prepareOrderFixture({ sellerCount: 1, quantities: [quantity] });
  const draft = await getCustomerOrderViaHttp(checkout.customerToken, checkout.orderId);
  const sellerOrder = draft.sellerOrders[0];
  const orderItem = sellerOrder?.items[0];
  if (!sellerOrder || !orderItem) {
    throw new Error("Module 13 fulfillment fixture did not materialize a Seller Order item.");
  }

  await confirmOrderPaymentViaHttp(
    checkout.orderId,
    draft.currency,
    draft.grandTotal,
    `module13-payment-${randomUUID()}`,
  );

  const sellerToken = checkout.sellers[0]?.product.seller.ownerToken;
  const variantId = checkout.sellers[0]?.product.variant.id;
  if (!sellerToken || !variantId) {
    throw new Error("Module 13 fulfillment fixture did not expose its seller Product fixture.");
  }

  await request(createApp())
    .post(`/api/v1/seller/orders/${sellerOrder.id}/accept`)
    .set(bearer(sellerToken))
    .send({})
    .expect(200);

  const order = await getCustomerOrderViaHttp(checkout.customerToken, checkout.orderId);
  return {
    checkout,
    order,
    orderId: checkout.orderId,
    sellerOrderId: sellerOrder.id,
    orderItemId: orderItem.id,
    variantId,
    sellerToken,
    customerToken: checkout.customerToken,
    adminToken: checkout.adminToken,
    quantity,
  };
}
