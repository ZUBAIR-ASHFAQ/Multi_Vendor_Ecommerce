import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  CHECKOUT_ERROR_CODE,
  CHECKOUT_OUTBOX_EVENT,
} from "../../src/modules/checkout/checkout.constants.js";
import { PROMOTION_SCOPE_TYPE } from "../../src/modules/promotions/promotions.constants.js";
import {
  activatePromotionViaHttp,
  activePromotionWindow,
  createPlatformPromotionViaHttp,
  uniqueCouponCode,
} from "../module9/module9.test-helpers.js";
import {
  addCartItemViaHttp,
  adjustInventoryViaHttp,
  bearer,
  confirmCheckoutQuoteViaHttp,
  countCheckoutOutboxEvents,
  createAddressViaHttp,
  createCheckoutQuoteViaHttp,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  insertShippingMethod,
  loginUser,
  readCheckoutAttemptPersistence,
  readInventoryQuantities,
  registerCustomer,
  resetModule10Tables,
  setCheckoutTaxRate,
  setSupportedCurrencies,
  unpublishProductViaHttp,
  updateVariantViaHttp,
  type Module4TestUser,
  type PublishedCartWishlistFixture,
} from "./module10.test-helpers.js";

interface PreparedCheckout {
  adminToken: string;
  customer: Module4TestUser;
  customerToken: string;
  addressId: string;
  product: PublishedCartWishlistFixture;
  shippingMethodId: string;
  quoteBody: {
    shippingAddressId: string;
    shippingSelections: Array<{ storeId: string; shippingMethodId: string }>;
  };
}

/** Creates the smallest real customer/Product/Inventory/Shipping fixture needed to exercise Checkout over HTTP. */
async function prepareSingleSellerCheckout(
  options: {
    currency?: string;
    price?: string;
    quantity?: number;
    onHandQty?: number;
    shippingRate?: string;
  } = {},
): Promise<PreparedCheckout> {
  const admin = await createPlatformAdmin(`module10-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const product = await createPublishedCartWishlistFixture(adminToken, "Checkout", {
    currency: options.currency ?? "PKR",
    price: options.price ?? "100.00",
    onHandQty: options.onHandQty ?? 10,
  });
  const customer = await registerCustomer(`module10-customer-${randomUUID()}@example.com`);
  const customerToken = await loginUser(customer);
  const address = await createAddressViaHttp(customerToken, {
    isDefaultShipping: true,
    isDefaultBilling: true,
  });
  const addressId = String(address.id);
  await addCartItemViaHttp(customerToken, product.variant.id, options.quantity ?? 2);
  const shippingMethod = await insertShippingMethod({
    ownerType: "seller",
    sellerId: product.seller.sellerId,
    code: `CHECKOUT-${randomUUID()}`,
    name: "Checkout Standard",
    baseRate: options.shippingRate ?? "12.5000",
    currency: options.currency ?? "PKR",
    status: "active",
  });

  return {
    adminToken,
    customer,
    customerToken,
    addressId,
    product,
    shippingMethodId: shippingMethod.id,
    quoteBody: {
      shippingAddressId: addressId,
      shippingSelections: [
        {
          storeId: product.seller.storeId,
          shippingMethodId: shippingMethod.id,
        },
      ],
    },
  };
}

/** Counts persisted attempts for one quote without coupling a test to attempt identifiers. */
async function countAttemptsForQuote(quoteId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from checkout_attempts where quote_id = $1",
    [quoteId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts all reservations owned by one customer; each integration test resets prerequisite state first. */
async function countCustomerReservations(customerUserId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from stock_reservations where customer_user_id = $1",
    [customerUserId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads coupon redemption count and linked Order identity without exposing persistence through an API. */
async function readCouponRedemptionSummary(
  code: string,
): Promise<{ count: number; orderId: string | null }> {
  const result = await databasePool.query<{ count: number; order_id: string | null }>(
    `select count(*)::int as count, min(cr.order_id::text) as order_id
       from coupon_redemptions cr
       join coupons c on c.id = cr.coupon_id
      where c.code = $1`,
    [code],
  );
  return {
    count: result.rows[0]?.count ?? 0,
    orderId: result.rows[0]?.order_id ?? null,
  };
}

/** Counts persisted Customer Orders for one customer so rollback assertions stay easy to read. */
async function countCustomerOrders(customerUserId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from orders where customer_user_id = $1",
    [customerUserId],
  );
  return result.rows[0]?.count ?? 0;
}

beforeEach(async () => {
  await resetModule10Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 10 Checkout service/API integration", () => {
  it("creates authoritative totals, confirms exactly once, replays the same key, and exposes attempt status", async () => {
    await setCheckoutTaxRate(7.5);
    const fixture = await prepareSingleSellerCheckout({
      price: "100.00",
      quantity: 2,
      shippingRate: "12.5000",
    });

    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    expect(quote).toMatchObject({
      currency: "PKR",
      shippingAddressId: fixture.addressId,
      billingAddressId: fixture.addressId,
      subtotal: "200.0000",
      discountTotal: "0.0000",
      taxTotal: "15.0000",
      shippingTotal: "12.5000",
      grandTotal: "227.5000",
    });
    expect(quote.lines).toEqual([
      expect.objectContaining({
        variantId: fixture.product.variant.id,
        sellerId: fixture.product.seller.sellerId,
        storeId: fixture.product.seller.storeId,
        quantity: 2,
        unitPrice: "100.0000",
        discount: "0.0000",
        tax: "15.0000",
        lineTotal: "215.0000",
      }),
    ]);
    expect(quote.shippingSelections).toEqual([
      expect.objectContaining({
        storeId: fixture.product.seller.storeId,
        shippingMethodId: fixture.shippingMethodId,
        amount: "12.5000",
        currency: "PKR",
      }),
    ]);

    const missingHeader = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .send({ stateHash: quote.stateHash })
      .expect(422);
    expect(missingHeader.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const key = `checkout-happy-${randomUUID()}`;
    const first = await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      quote.id,
      quote.stateHash,
      key,
    );
    const replay = await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      quote.id,
      quote.stateHash,
      key,
    );
    expect(replay).toEqual(first);

    const status = await request(createApp())
      .get(`/api/v1/checkout/${first.id}/status`)
      .set(bearer(fixture.customerToken))
      .expect(200);
    expect(status.body.data).toEqual(first);

    const otherCustomer = await registerCustomer(`module10-status-other-${randomUUID()}@example.com`);
    const otherToken = await loginUser(otherCustomer);
    const hiddenAttempt = await request(createApp())
      .get(`/api/v1/checkout/${first.id}/status`)
      .set(bearer(otherToken))
      .expect(404);
    expect(hiddenAttempt.body.error.code).toBe(ERROR_CODE.RESOURCE_NOT_FOUND);

    expect(await readCheckoutAttemptPersistence(first.id)).toEqual({
      attemptCount: 1,
      reservationCount: 1,
      reserveMovementCount: 1,
    });
    expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
      onHandQty: 10,
      reservedQty: 2,
      availableQty: 8,
    });
    expect(await countCheckoutOutboxEvents(CHECKOUT_OUTBOX_EVENT.QUOTED)).toBe(1);
    expect(await countCheckoutOutboxEvents(CHECKOUT_OUTBOX_EVENT.CONFIRMED)).toBe(1);
  });

  it("keeps a confirmed Checkout linked to its Order and leaves overdue unpaid expiry to Module 12", async () => {
    const fixture = await prepareSingleSellerCheckout({ quantity: 2, onHandQty: 10 });
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    const attempt = await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      quote.id,
      quote.stateHash,
      `expiry-owner-${randomUUID()}`,
    );

    expect(attempt.orderId).toEqual(expect.any(String));
    expect(await countCustomerOrders(fixture.customer.id)).toBe(1);

    await databasePool.query(
      `update checkout_attempts
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        where id = $1`,
      [attempt.id],
    );
    await databasePool.query(
      `update stock_reservations
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        where order_attempt_id = $1`,
      [attempt.id],
    );

    const status = await request(createApp())
      .get(`/api/v1/checkout/${attempt.id}/status`)
      .set(bearer(fixture.customerToken))
      .expect(200);

    expect(status.body.data).toMatchObject({
      id: attempt.id,
      status: "confirmed",
      orderId: attempt.orderId,
    });
    expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
      onHandQty: 10,
      reservedQty: 2,
      availableQty: 8,
    });
    expect(await countCheckoutOutboxEvents(CHECKOUT_OUTBOX_EVENT.EXPIRED)).toBe(0);
  });

  it("enforces authentication, route permissions, customer quote isolation, and customer-owned addresses", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    const otherCustomer = await registerCustomer(`module10-other-${randomUUID()}@example.com`);
    const otherToken = await loginUser(otherCustomer);

    const unauthenticated = await request(createApp())
      .post("/api/v1/checkout/quote")
      .send(fixture.quoteBody)
      .expect(401);
    expect(unauthenticated.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const forbidden = await request(createApp())
      .post("/api/v1/checkout/quote")
      .set(bearer(fixture.product.seller.ownerToken))
      .send(fixture.quoteBody)
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const hiddenQuote = await request(createApp())
      .get(`/api/v1/checkout/quote/${quote.id}`)
      .set(bearer(otherToken))
      .expect(404);
    expect(hiddenQuote.body.error.code).toBe(ERROR_CODE.RESOURCE_NOT_FOUND);

    const foreignAddress = await request(createApp())
      .post("/api/v1/checkout/quote")
      .set(bearer(otherToken))
      .send(fixture.quoteBody)
      .expect(409);
    expect(foreignAddress.body.error.code).toBe(CHECKOUT_ERROR_CODE.ADDRESS_INVALID);
  });

  it("rejects confirmation when a selected customer address changes after quote creation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await databasePool.query(
      `update customer_addresses
          set line1 = '99 Changed Checkout Road',
              updated_at = now() + interval '1 second'
        where id = $1`,
      [fixture.addressId],
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `address-change-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);

    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.ADDRESS_INVALID);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("rejects an expired quote before creating an attempt or reserving stock", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await databasePool.query(
      `update checkout_quotes
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        where id = $1`,
      [quote.id],
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `expired-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);

    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.QUOTE_EXPIRED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
    expect(await countCustomerReservations(fixture.customer.id)).toBe(0);
  });

  it("detects a Product price change between quote and confirmation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await updateVariantViaHttp(
      fixture.product.seller.ownerToken,
      fixture.product.product.id,
      fixture.product.variant.id,
      { price: "125.50" },
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `price-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PRICE_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("detects a Product becoming unpublished between quote and confirmation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await unpublishProductViaHttp(
      fixture.product.seller.ownerToken,
      fixture.product.product.id,
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `unpublished-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PRICE_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("detects exact-quantity stock loss between quote and confirmation", async () => {
    const fixture = await prepareSingleSellerCheckout({ quantity: 2, onHandQty: 10 });
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await adjustInventoryViaHttp(
      fixture.product.seller.ownerToken,
      fixture.product.variant.id,
      -9,
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `stock-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.STOCK_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
    expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
      onHandQty: 1,
      reservedQty: 0,
      availableQty: 1,
    });
  });

  it("records an applied coupon exactly once inside Checkout confirmation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const code = uniqueCouponCode("CONFIRM");
    const promotion = await createPlatformPromotionViaHttp(fixture.adminToken, {
      name: "Confirmed Checkout coupon",
      type: "percentage",
      value: "10.0000",
      ...activePromotionWindow(),
      scopes: [
        { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.product.id },
      ],
      coupon: { code, maxUses: 20, maxUsesPerCustomer: 2 },
    });
    await activatePromotionViaHttp(fixture.adminToken, promotion.id);
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, {
      ...fixture.quoteBody,
      couponCode: code,
    });
    const idempotencyKey = `coupon-confirm-${randomUUID()}`;

    const first = await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      quote.id,
      quote.stateHash,
      idempotencyKey,
    );
    const replay = await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      quote.id,
      quote.stateHash,
      idempotencyKey,
    );

    expect(first.orderId).toBeTruthy();
    expect(replay.id).toBe(first.id);
    expect(await readCouponRedemptionSummary(code)).toEqual({
      count: 1,
      orderId: first.orderId,
    });
  });

  it(
    "serializes the last coupon use across concurrent confirmations and rolls back the losing Checkout transaction",
    async () => {
      const fixture = await prepareSingleSellerCheckout({ quantity: 2, onHandQty: 10 });
      const secondCustomer = await registerCustomer(
        `module10-coupon-race-${randomUUID()}@example.com`,
      );
      const secondToken = await loginUser(secondCustomer);
      const secondAddress = await createAddressViaHttp(secondToken);
      await addCartItemViaHttp(secondToken, fixture.product.variant.id, 2);
      const code = uniqueCouponCode("LASTUSE");
      const promotion = await createPlatformPromotionViaHttp(fixture.adminToken, {
        name: "Single-use concurrent Checkout coupon",
        type: "percentage",
        value: "10.0000",
        ...activePromotionWindow(),
        scopes: [
          { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.product.id },
        ],
        coupon: { code, maxUses: 1, maxUsesPerCustomer: 1 },
      });
      await activatePromotionViaHttp(fixture.adminToken, promotion.id);

      const firstQuote = await createCheckoutQuoteViaHttp(fixture.customerToken, {
        ...fixture.quoteBody,
        couponCode: code,
      });
      const secondQuote = await createCheckoutQuoteViaHttp(secondToken, {
        shippingAddressId: String(secondAddress.id),
        shippingSelections: [
          {
            storeId: fixture.product.seller.storeId,
            shippingMethodId: fixture.shippingMethodId,
          },
        ],
        couponCode: code,
      });

      const app = createApp();
      const responses = await Promise.all([
        request(app)
          .post(`/api/v1/checkout/quote/${firstQuote.id}/confirm`)
          .set(bearer(fixture.customerToken))
          .set("Idempotency-Key", `coupon-race-a-${randomUUID()}`)
          .send({ stateHash: firstQuote.stateHash }),
        request(app)
          .post(`/api/v1/checkout/quote/${secondQuote.id}/confirm`)
          .set(bearer(secondToken))
          .set("Idempotency-Key", `coupon-race-b-${randomUUID()}`)
          .send({ stateHash: secondQuote.stateHash }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const success = responses.find((response) => response.status === 200);
      const rejected = responses.find((response) => response.status === 409);
      expect(success?.body.data.orderId).toEqual(expect.any(String));
      expect(rejected?.body.error.code).toBe(CHECKOUT_ERROR_CODE.PROMOTION_CHANGED);

      expect(await readCouponRedemptionSummary(code)).toEqual({
        count: 1,
        orderId: success?.body.data.orderId ?? null,
      });
      expect(
        (await countAttemptsForQuote(firstQuote.id)) +
          (await countAttemptsForQuote(secondQuote.id)),
      ).toBe(1);
      expect(
        (await countCustomerOrders(fixture.customer.id)) +
          (await countCustomerOrders(secondCustomer.id)),
      ).toBe(1);
      expect(
        (await countCustomerReservations(fixture.customer.id)) +
          (await countCustomerReservations(secondCustomer.id)),
      ).toBe(1);
      expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
        reservedQty: 2,
        availableQty: 8,
      });
    },
  );

  it(
    "rolls back coupon redemption when a later Checkout write fails in the same confirmation transaction",
    async () => {
      const fixture = await prepareSingleSellerCheckout({ quantity: 1, onHandQty: 10 });
      const code = uniqueCouponCode("ROLLBACK");
      const promotion = await createPlatformPromotionViaHttp(fixture.adminToken, {
        name: "Checkout coupon rollback proof",
        type: "percentage",
        value: "10.0000",
        ...activePromotionWindow(),
        scopes: [
          { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.product.id },
        ],
        coupon: { code, maxUses: 5, maxUsesPerCustomer: 5 },
      });
      await activatePromotionViaHttp(fixture.adminToken, promotion.id);
      const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, {
        ...fixture.quoteBody,
        couponCode: code,
      });

      await databasePool.query(`
        create or replace function module10_fail_attempt_order_link()
        returns trigger
        language plpgsql
        as $$
        begin
          if old.order_id is null and new.order_id is not null then
            raise exception 'module10 injected order-link failure';
          end if;
          return new;
        end;
        $$;
        create trigger module10_fail_attempt_order_link_trigger
        before update of order_id on checkout_attempts
        for each row execute function module10_fail_attempt_order_link();
      `);

      try {
        const response = await request(createApp())
          .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
          .set(bearer(fixture.customerToken))
          .set("Idempotency-Key", `coupon-rollback-${randomUUID()}`)
          .send({ stateHash: quote.stateHash })
          .expect(500);

        expect(response.body.error.code).toBe(ERROR_CODE.INTERNAL_ERROR);
        expect(await readCouponRedemptionSummary(code)).toEqual({ count: 0, orderId: null });
        expect(await countAttemptsForQuote(quote.id)).toBe(0);
        expect(await countCustomerOrders(fixture.customer.id)).toBe(0);
        expect(await countCustomerReservations(fixture.customer.id)).toBe(0);
        expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
          reservedQty: 0,
          availableQty: 10,
        });
      } finally {
        await databasePool.query(`
          drop trigger if exists module10_fail_attempt_order_link_trigger on checkout_attempts;
          drop function if exists module10_fail_attempt_order_link();
        `);
      }
    },
  );

  it("detects a coupon becoming ineligible between quote and confirmation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const code = uniqueCouponCode("CHECKOUT");
    const promotion = await createPlatformPromotionViaHttp(fixture.adminToken, {
      name: "Checkout coupon",
      type: "percentage",
      value: "10.0000",
      ...activePromotionWindow(),
      scopes: [
        { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.product.id },
      ],
      coupon: { code, maxUses: 20, maxUsesPerCustomer: 2 },
    });
    await activatePromotionViaHttp(fixture.adminToken, promotion.id);
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, {
      ...fixture.quoteBody,
      couponCode: code,
    });
    expect(quote.discountTotal).toBe("20.0000");

    await request(createApp())
      .post(`/api/v1/admin/promotions/${promotion.id}/deactivate`)
      .set(bearer(fixture.adminToken))
      .send({})
      .expect(200);

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `coupon-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PROMOTION_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("detects a Shipping rate change through authoritative confirmation revalidation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await databasePool.query(
      "update shipping_methods set base_rate = 99.0000 where id = $1",
      [fixture.shippingMethodId],
    );

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `shipping-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PRICE_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("detects an Administration tax change through authoritative confirmation revalidation", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    await setCheckoutTaxRate(5);

    const response = await request(createApp())
      .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `tax-${randomUUID()}`)
      .send({ stateHash: quote.stateHash })
      .expect(409);
    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PRICE_CHANGED);
    expect(await countAttemptsForQuote(quote.id)).toBe(0);
  });

  it("maps one reused idempotency key with a different quote payload to CHECKOUT_IDEMPOTENCY_CONFLICT", async () => {
    const fixture = await prepareSingleSellerCheckout();
    const firstQuote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    const secondQuote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    const key = `conflict-${randomUUID()}`;

    await confirmCheckoutQuoteViaHttp(
      fixture.customerToken,
      firstQuote.id,
      firstQuote.stateHash,
      key,
    );

    const conflict = await request(createApp())
      .post(`/api/v1/checkout/quote/${secondQuote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", key)
      .send({ stateHash: secondQuote.stateHash })
      .expect(409);
    expect(conflict.body.error.code).toBe(CHECKOUT_ERROR_CODE.IDEMPOTENCY_CONFLICT);
    expect(await countAttemptsForQuote(secondQuote.id)).toBe(0);

    const audit = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from audit_logs where action = 'checkout.idempotency_conflict'",
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it("serializes different-key concurrent confirmations into one attempt and one reservation set", async () => {
    const fixture = await prepareSingleSellerCheckout({ quantity: 2, onHandQty: 10 });
    const quote = await createCheckoutQuoteViaHttp(fixture.customerToken, fixture.quoteBody);
    const app = createApp();

    const [firstResponse, secondResponse] = await Promise.all([
      request(app)
        .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
        .set(bearer(fixture.customerToken))
        .set("Idempotency-Key", `race-a-${randomUUID()}`)
        .send({ stateHash: quote.stateHash })
        .expect(200),
      request(app)
        .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
        .set(bearer(fixture.customerToken))
        .set("Idempotency-Key", `race-b-${randomUUID()}`)
        .send({ stateHash: quote.stateHash })
        .expect(200),
    ]);

    expect(firstResponse.body.data.id).toBe(secondResponse.body.data.id);
    expect(await countAttemptsForQuote(quote.id)).toBe(1);
    expect(await readCheckoutAttemptPersistence(String(firstResponse.body.data.id))).toEqual({
      attemptCount: 1,
      reservationCount: 1,
      reserveMovementCount: 1,
    });
    expect(await readInventoryQuantities(fixture.product.variant.id)).toMatchObject({
      reservedQty: 2,
      availableQty: 8,
    });
    expect(await countCheckoutOutboxEvents(CHECKOUT_OUTBOX_EVENT.CONFIRMED)).toBe(1);
  });

  it("rolls back the attempt and the first reservation when a later reservation write fails", async () => {
    const admin = await createPlatformAdmin(`module10-rollback-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const firstProduct = await createPublishedCartWishlistFixture(adminToken, "RollbackA", {
      onHandQty: 10,
      price: "100.00",
    });
    const secondProduct = await createPublishedCartWishlistFixture(adminToken, "RollbackB", {
      onHandQty: 10,
      price: "50.00",
    });
    const customer = await registerCustomer(`module10-rollback-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const address = await createAddressViaHttp(customerToken);
    await addCartItemViaHttp(customerToken, firstProduct.variant.id, 1);
    await addCartItemViaHttp(customerToken, secondProduct.variant.id, 1);
    const firstShipping = await insertShippingMethod({
      ownerType: "seller",
      sellerId: firstProduct.seller.sellerId,
      baseRate: "5.0000",
      currency: "PKR",
    });
    const secondShipping = await insertShippingMethod({
      ownerType: "seller",
      sellerId: secondProduct.seller.sellerId,
      baseRate: "6.0000",
      currency: "PKR",
    });
    const quote = await createCheckoutQuoteViaHttp(customerToken, {
      shippingAddressId: String(address.id),
      shippingSelections: [
        { storeId: firstProduct.seller.storeId, shippingMethodId: firstShipping.id },
        { storeId: secondProduct.seller.storeId, shippingMethodId: secondShipping.id },
      ],
    });
    const orderedVariantIds = [firstProduct.variant.id, secondProduct.variant.id].sort();
    const failVariantId = orderedVariantIds[1]!;

    await databasePool.query(`
      create or replace function module10_fail_reservation_insert()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.variant_id = '${failVariantId}'::uuid then
          raise exception 'module10 injected reservation failure';
        end if;
        return new;
      end;
      $$;
      create trigger module10_fail_reservation_insert_trigger
      before insert on stock_reservations
      for each row execute function module10_fail_reservation_insert();
    `);

    try {
      const response = await request(createApp())
        .post(`/api/v1/checkout/quote/${quote.id}/confirm`)
        .set(bearer(customerToken))
        .set("Idempotency-Key", `rollback-${randomUUID()}`)
        .send({ stateHash: quote.stateHash })
        .expect(500);
      expect(response.body.error.code).toBe(ERROR_CODE.INTERNAL_ERROR);

      expect(await countAttemptsForQuote(quote.id)).toBe(0);
      expect(await countCustomerReservations(customer.id)).toBe(0);
      expect(await readInventoryQuantities(firstProduct.variant.id)).toMatchObject({ reservedQty: 0 });
      expect(await readInventoryQuantities(secondProduct.variant.id)).toMatchObject({ reservedQty: 0 });
      expect(await countCheckoutOutboxEvents(CHECKOUT_OUTBOX_EVENT.CONFIRMED)).toBe(0);
    } finally {
      await databasePool.query(`
        drop trigger if exists module10_fail_reservation_insert_trigger on stock_reservations;
        drop function if exists module10_fail_reservation_insert();
      `);
    }
  });

  it("persists one Shipping selection per server-derived seller/store group", async () => {
    const admin = await createPlatformAdmin(`module10-groups-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const productA = await createPublishedCartWishlistFixture(adminToken, "GroupA", {
      price: "100.00",
      onHandQty: 5,
    });
    const productB = await createPublishedCartWishlistFixture(adminToken, "GroupB", {
      price: "50.00",
      onHandQty: 5,
    });
    const customer = await registerCustomer(`module10-groups-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const address = await createAddressViaHttp(token);
    await addCartItemViaHttp(token, productA.variant.id, 1);
    await addCartItemViaHttp(token, productB.variant.id, 1);
    const methodA = await insertShippingMethod({
      ownerType: "seller",
      sellerId: productA.seller.sellerId,
      baseRate: "7.0000",
      currency: "PKR",
    });
    const methodB = await insertShippingMethod({
      ownerType: "seller",
      sellerId: productB.seller.sellerId,
      baseRate: "8.0000",
      currency: "PKR",
    });

    const quote = await createCheckoutQuoteViaHttp(token, {
      shippingAddressId: String(address.id),
      shippingSelections: [
        { storeId: productA.seller.storeId, shippingMethodId: methodA.id },
        { storeId: productB.seller.storeId, shippingMethodId: methodB.id },
      ],
    });

    expect(quote.lines).toHaveLength(2);
    expect(new Set(quote.lines.map((line) => line.sellerId))).toEqual(
      new Set([productA.seller.sellerId, productB.seller.sellerId]),
    );
    expect(quote.shippingSelections).toHaveLength(2);
    expect(new Set(quote.shippingSelections.map((selection) => selection.storeId))).toEqual(
      new Set([productA.seller.storeId, productB.seller.storeId]),
    );
    expect(quote).toMatchObject({
      subtotal: "150.0000",
      shippingTotal: "15.0000",
      grandTotal: "165.0000",
    });
  });

  it("rejects a currency removed from Administration support before quote persistence", async () => {
    const fixture = await prepareSingleSellerCheckout({
      currency: "USD",
      price: "25.00",
      quantity: 1,
      shippingRate: "5.0000",
    });
    await setSupportedCurrencies(["PKR"]);

    const response = await request(createApp())
      .post("/api/v1/checkout/quote")
      .set(bearer(fixture.customerToken))
      .send(fixture.quoteBody)
      .expect(409);

    expect(response.body.error.code).toBe(CHECKOUT_ERROR_CODE.PRICE_CHANGED);
    const quotes = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from checkout_quotes",
    );
    expect(quotes.rows[0]?.count).toBe(0);
  });
});
