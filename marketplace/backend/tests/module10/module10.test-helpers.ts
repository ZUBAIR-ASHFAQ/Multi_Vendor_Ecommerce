import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import { PLATFORM_SETTING_KEY } from "../../src/modules/administration/administration.constants.js";
import type { CheckoutAttemptContract, CheckoutQuoteWithLinesContract } from "../../src/modules/checkout/checkout.schema.js";
import { createAddressViaHttp } from "../module3/module3.test-helpers.js";
import { adjustInventoryViaHttp } from "../module7/module7.test-helpers.js";
import {
  bearer,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  loginUser,
  readInventoryQuantities,
  registerCustomer,
  unpublishProductViaHttp,
  updateVariantViaHttp,
  type Module4TestUser,
  type PublishedCartWishlistFixture,
} from "../module8/module8.test-helpers.js";
import {
  addCartItemViaHttp,
  resetModule9Tables,
} from "../module9/module9.test-helpers.js";
import { insertShippingMethod } from "../module13/module13.test-helpers.js";

export {
  addCartItemViaHttp,
  adjustInventoryViaHttp,
  bearer,
  createAddressViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  insertShippingMethod,
  loginUser,
  readInventoryQuantities,
  registerCustomer,
  unpublishProductViaHttp,
  updateVariantViaHttp,
};
export type { Module4TestUser, PublishedCartWishlistFixture };

/** Clears Checkout persistence before restoring deterministic released prerequisite fixtures and tax config. */
export async function resetModule10Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      checkout_attempts,
      checkout_quote_shipping_selections,
      checkout_quote_lines,
      checkout_quotes
    RESTART IDENTITY CASCADE
  `);
  await resetModule9Tables();
  await setCheckoutTaxRate(0);
}

/** Creates one active customer-owned address for low-level Checkout persistence tests. */
export async function createCheckoutCustomerAddress(customerUserId: string): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into customer_addresses (
       customer_user_id, label, recipient_name, phone, line1, city, region,
       country_code, is_default_shipping, is_default_billing, status
     ) values ($1, 'Checkout', 'Checkout Customer', '+92 300 0000000',
               '1 Checkout Road', 'Karachi', 'Sindh', 'PK', true, true, 'active')
     returning id`,
    [customerUserId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Checkout test address insert did not return an ID.");
  return id;
}

/** Creates one active seller-owned flat-rate Shipping Core method for low-level persistence tests. */
export async function createCheckoutShippingMethod(
  sellerId: string,
  currency = "PKR",
): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into shipping_methods (
       owner_type, seller_id, code, name, pricing_type, base_rate, currency, status
     ) values ('seller', $1, $2, 'Checkout Standard', 'flat', 15.0000, $3, 'active')
     returning id`,
    [sellerId, `CHECKOUT-${randomUUID()}`, currency],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Checkout test Shipping method insert did not return an ID.");
  return id;
}

/** Returns a future expiry timestamp for persistence tests without invoking Checkout service policy. */
export function futureCheckoutExpiry(minutes = 30): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** Upserts the Administration-owned tax percentage used by authoritative Checkout calculations. */
export async function setCheckoutTaxRate(ratePercent: number): Promise<void> {
  await databasePool.query(
    `insert into platform_settings (key, value_json)
     values ($1, $2::jsonb)
     on conflict (key) do update set value_json = excluded.value_json, updated_at = now()`,
    [PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT, JSON.stringify(ratePercent)],
  );
}

/** Replaces the supported-currency setting so tests can prove Checkout fails closed for unsupported currencies. */
export async function setSupportedCurrencies(currencies: string[]): Promise<void> {
  await databasePool.query(
    `insert into platform_settings (key, value_json)
     values ($1, $2::jsonb)
     on conflict (key) do update set value_json = excluded.value_json, updated_at = now()`,
    [PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES, JSON.stringify(currencies)],
  );
}

/** Creates one authoritative Checkout quote through the published Module 10 HTTP contract. */
export async function createCheckoutQuoteViaHttp(
  customerToken: string,
  input: Record<string, unknown>,
): Promise<CheckoutQuoteWithLinesContract> {
  const response = await request(createApp())
    .post("/api/v1/checkout/quote")
    .set(bearer(customerToken))
    .send(input)
    .expect(201);
  return response.body.data as CheckoutQuoteWithLinesContract;
}

/** Confirms one quote through the published Module 10 idempotent HTTP command. */
export async function confirmCheckoutQuoteViaHttp(
  customerToken: string,
  quoteId: string,
  stateHash: string,
  idempotencyKey: string,
): Promise<CheckoutAttemptContract> {
  const response = await request(createApp())
    .post(`/api/v1/checkout/quote/${quoteId}/confirm`)
    .set(bearer(customerToken))
    .set("Idempotency-Key", idempotencyKey)
    .send({ stateHash })
    .expect(200);
  return response.body.data as CheckoutAttemptContract;
}

/** Returns the number of persisted rows for one Checkout attempt across attempt and reservation tables. */
export async function readCheckoutAttemptPersistence(attemptId: string): Promise<{
  attemptCount: number;
  reservationCount: number;
  reserveMovementCount: number;
}> {
  const result = await databasePool.query<{
    attempt_count: number;
    reservation_count: number;
    movement_count: number;
  }>(
    `select
       (select count(*)::int from checkout_attempts where id = $1) as attempt_count,
       (select count(*)::int from stock_reservations where order_attempt_id = $1) as reservation_count,
       (select count(*)::int
          from stock_movements movement
          join stock_reservations reservation
            on reservation.id = movement.source_id
         where reservation.order_attempt_id = $1
           and movement.movement_type = 'reserve') as movement_count`,
    [attemptId],
  );
  const row = result.rows[0];
  return {
    attemptCount: row?.attempt_count ?? 0,
    reservationCount: row?.reservation_count ?? 0,
    reserveMovementCount: row?.movement_count ?? 0,
  };
}

/** Counts durable Checkout outbox rows by stable event type. */
export async function countCheckoutOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}
