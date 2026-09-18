import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type { CheckoutAttemptContract, CheckoutQuoteWithLinesContract } from "../../src/modules/checkout/checkout.schema.js";
import type { CustomerOrderDetail, SellerOrderDetail } from "../../src/modules/orders/orders.schema.js";
import {
  addCartItemViaHttp,
  bearer,
  confirmCheckoutQuoteViaHttp,
  createAddressViaHttp,
  createCheckoutQuoteViaHttp,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  insertShippingMethod,
  loginUser,
  readInventoryQuantities,
  registerCustomer,
  resetModule10Tables,
  updateVariantViaHttp,
  type Module4TestUser,
  type PublishedCartWishlistFixture,
} from "../module10/module10.test-helpers.js";
import { internalApiKey } from "../module7/module7.test-helpers.js";

export {
  bearer,
  internalApiKey,
  readInventoryQuantities,
  updateVariantViaHttp,
};

/** One seller/Product/Shipping group participating in a Module 11 Checkout fixture. */
export interface PreparedOrderSeller {
  product: PublishedCartWishlistFixture;
  quantity: number;
  shippingMethodId: string;
}

/** Real Checkout-created Order fixture reused by Module 11 backend integration tests. */
export interface PreparedOrderFixture {
  adminToken: string;
  customer: Module4TestUser;
  customerToken: string;
  addressId: string;
  sellers: PreparedOrderSeller[];
  quote: CheckoutQuoteWithLinesContract;
  attempt: CheckoutAttemptContract;
  orderId: string;
}

/** Clears Module 11 and every released prerequisite table, then restores deterministic platform RBAC/settings. */
export async function resetModule11Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      order_status_history,
      order_addresses,
      order_items,
      seller_orders,
      orders
    RESTART IDENTITY CASCADE
  `);
  await resetModule10Tables();
}

/** Builds and confirms a real one- or two-seller Checkout so Orders is materialized through the production boundary. */
export async function prepareOrderFixture(
  options: {
    sellerCount?: 1 | 2;
    quantities?: number[];
    prices?: string[];
    shippingRates?: string[];
  } = {},
): Promise<PreparedOrderFixture> {
  const sellerCount = options.sellerCount ?? 1;
  const quantities = options.quantities ?? [2, 1];
  const prices = options.prices ?? ["100.00", "50.00"];
  const shippingRates = options.shippingRates ?? ["10.0000", "20.0000"];
  const admin = await createPlatformAdmin(`module11-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const customer = await registerCustomer(`module11-customer-${randomUUID()}@example.com`);
  const customerToken = await loginUser(customer);
  const address = await createAddressViaHttp(customerToken, {
    isDefaultShipping: true,
    isDefaultBilling: true,
  });
  const addressId = String(address.id);
  const sellers: PreparedOrderSeller[] = [];

  for (let index = 0; index < sellerCount; index += 1) {
    const product = await createPublishedCartWishlistFixture(adminToken, `Orders${index + 1}`, {
      currency: "PKR",
      price: prices[index] ?? "100.00",
      onHandQty: 20,
    });
    const quantity = quantities[index] ?? 1;
    await addCartItemViaHttp(customerToken, product.variant.id, quantity);
    const shipping = await insertShippingMethod({
      ownerType: "seller",
      sellerId: product.seller.sellerId,
      code: `ORDERS-${index + 1}-${randomUUID()}`,
      name: `Orders Shipping ${index + 1}`,
      baseRate: shippingRates[index] ?? "10.0000",
      currency: "PKR",
      status: "active",
    });
    sellers.push({ product, quantity, shippingMethodId: shipping.id });
  }

  const quote = await createCheckoutQuoteViaHttp(customerToken, {
    shippingAddressId: addressId,
    shippingSelections: sellers.map((seller) => ({
      storeId: seller.product.seller.storeId,
      shippingMethodId: seller.shippingMethodId,
    })),
  });
  const attempt = await confirmCheckoutQuoteViaHttp(
    customerToken,
    quote.id,
    quote.stateHash,
    `module11-checkout-${randomUUID()}`,
  );
  if (!attempt.orderId) throw new Error("Checkout confirmation did not materialize a Module 11 Order.");

  return {
    adminToken,
    customer,
    customerToken,
    addressId,
    sellers,
    quote,
    attempt,
    orderId: attempt.orderId,
  };
}

/** Reads one customer-owned Order detail through the published Module 11 HTTP contract. */
export async function getCustomerOrderViaHttp(
  customerToken: string,
  orderId: string,
): Promise<CustomerOrderDetail> {
  const response = await request(createApp())
    .get(`/api/v1/orders/${orderId}`)
    .set(bearer(customerToken))
    .expect(200);
  return response.body.data as CustomerOrderDetail;
}

/** Reads one seller-scoped Seller Order detail through the published Module 11 HTTP contract. */
export async function getSellerOrderViaHttp(
  sellerToken: string,
  sellerOrderId: string,
): Promise<SellerOrderDetail> {
  const response = await request(createApp())
    .get(`/api/v1/seller/orders/${sellerOrderId}`)
    .set(bearer(sellerToken))
    .expect(200);
  return response.body.data as SellerOrderDetail;
}

/** Applies the trusted Payment-confirmed transition through the internal Module 11 HTTP boundary. */
export async function confirmOrderPaymentViaHttp(
  orderId: string,
  currency: string,
  capturedAmount: string,
  sourceKey: string,
  identity: { paymentId: string; paymentTransactionId: string; capturedAt: string } = {
    paymentId: randomUUID(),
    paymentTransactionId: randomUUID(),
    capturedAt: new Date().toISOString(),
  },
): Promise<CustomerOrderDetail> {
  const response = await request(createApp())
    .post(`/api/v1/internal/orders/${orderId}/payment-confirmed`)
    .set(internalApiKey())
    .send({
      ...identity,
      sourceKey,
      currency,
      capturedAmount,
    })
    .expect(200);
  return response.body.data as CustomerOrderDetail;
}

/** Counts durable Module 11 outbox rows by stable event type. */
export async function countOrderOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Customer Orders linked to one Checkout attempt to prove the one-attempt/one-order source invariant. */
export async function countOrdersForAttempt(checkoutAttemptId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from orders where checkout_attempt_id = $1",
    [checkoutAttemptId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads reservation state for one Order Item without exposing it through the public Orders API. */
export async function readOrderItemReservations(orderId: string): Promise<
  Array<{ orderItemId: string; reservationId: string; status: string }>
> {
  const result = await databasePool.query<{
    order_item_id: string;
    reservation_id: string;
    status: string;
  }>(
    `select item.id as order_item_id,
            reservation.id as reservation_id,
            reservation.status
       from order_items item
       join stock_reservations reservation on reservation.id = item.inventory_reservation_id
      where item.order_id = $1
      order by item.id asc`,
    [orderId],
  );
  return result.rows.map((row) => ({
    orderItemId: row.order_item_id,
    reservationId: row.reservation_id,
    status: row.status,
  }));
}
