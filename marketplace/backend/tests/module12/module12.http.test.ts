import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  PAYMENTS_ERROR_CODE,
} from "../../src/modules/payments/payments.constants.js";
import {
  bearer,
  internalApiKey,
  prepareOrderFixture,
} from "../module11/module11.test-helpers.js";
import {
  loginUser,
  registerCustomer,
} from "../module10/module10.test-helpers.js";
import {
  createPersistedPaymentForFixture,
  resetModule12Tables,
} from "./module12.test-helpers.js";

beforeEach(async () => {
  await resetModule12Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 12 Payments HTTP contracts", () => {
  it("protects customer/admin/internal Payment routes with their approved authentication boundaries", async () => {
    const app = createApp();

    const customer = await request(app)
      .get(`/api/v1/payments/order/${randomUUID()}`)
      .expect(401);
    expect(customer.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const admin = await request(app)
      .get("/api/v1/admin/payments")
      .expect(401);
    expect(admin.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const internal = await request(app)
      .post(`/api/v1/internal/payments/${randomUUID()}/refund`)
      .set("x-internal-api-key", "wrong-internal-key")
      .send({ sourceKey: "refunds:test", amount: "1.0000" })
      .expect(401);
    expect(internal.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
  });

  it("requires Idempotency-Key and rejects client-controlled PaymentIntent fields before any provider call", async () => {
    const fixture = await prepareOrderFixture();
    const app = createApp();

    const missingKey = await request(app)
      .post(`/api/v1/payments/order/${fixture.orderId}/intent`)
      .set(bearer(fixture.customerToken))
      .send({})
      .expect(422);
    expect(missingKey.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const clientControlledAmount = await request(app)
      .post(`/api/v1/payments/order/${fixture.orderId}/intent`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `module12-http-${randomUUID()}`)
      .send({ amount: "1.0000", currency: "USD", status: "captured" })
      .expect(422);
    expect(clientControlledAmount.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("accepts only the owning customer's marketplace Payment status and never exposes client secrets", async () => {
    const fixture = await prepareOrderFixture();
    const payment = await createPersistedPaymentForFixture(fixture, {
      providerPaymentId: `pi_${randomUUID().replaceAll("-", "")}`,
      status: "processing",
    });
    const app = createApp();

    const owner = await request(app)
      .get(`/api/v1/payments/order/${fixture.orderId}`)
      .set(bearer(fixture.customerToken))
      .expect(200);
    expect(owner.body.data).toMatchObject({
      paymentId: payment.id,
      orderId: fixture.orderId,
      status: "processing",
      currency: fixture.quote.currency,
    });
    expect(owner.body.data).not.toHaveProperty("clientSecret");
    expect(owner.body.data).not.toHaveProperty("idempotencyKey");

    const otherCustomer = await registerCustomer(`module12-other-${randomUUID()}@example.com`);
    const otherToken = await loginUser(otherCustomer);
    const hidden = await request(app)
      .get(`/api/v1/payments/order/${fixture.orderId}`)
      .set(bearer(otherToken))
      .expect(404);
    expect(hidden.body.error.code).not.toBe(ERROR_CODE.INTERNAL_ERROR);
  });

  it("supports permission-protected finance search/detail without returning Payment secrets", async () => {
    const fixture = await prepareOrderFixture();
    const providerPaymentId = `pi_${randomUUID().replaceAll("-", "")}`;
    const payment = await createPersistedPaymentForFixture(fixture, {
      providerPaymentId,
      status: "captured",
      amountAuthorized: fixture.quote.grandTotal,
      amountCaptured: fixture.quote.grandTotal,
    });
    const app = createApp();

    const forbiddenCustomer = await request(app)
      .get("/api/v1/admin/payments")
      .set(bearer(fixture.customerToken))
      .expect(403);
    expect(forbiddenCustomer.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const list = await request(app)
      .get("/api/v1/admin/payments")
      .query({ orderId: fixture.orderId, sort: "createdAt", order: "desc" })
      .set(bearer(fixture.adminToken))
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        paymentId: payment.id,
        orderId: fixture.orderId,
        providerPaymentId,
        status: "captured",
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain("clientSecret");
    expect(JSON.stringify(list.body)).not.toContain("idempotencyKey");

    const detail = await request(app)
      .get(`/api/v1/admin/payments/${payment.id}`)
      .set(bearer(fixture.adminToken))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      paymentId: payment.id,
      providerPaymentId,
      transactions: [],
    });
    expect(JSON.stringify(detail.body)).not.toContain("clientSecret");
    expect(JSON.stringify(detail.body)).not.toContain("idempotencyKey");
  });

  it("rejects missing/invalid Stripe signatures before persisting unverified webhook payloads", async () => {
    const app = createApp();
    const body = Buffer.from(JSON.stringify({ id: "evt_untrusted", type: "payment_intent.succeeded" }));

    const missing = await request(app)
      .post("/api/v1/payments/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(400);
    expect(missing.body.error.code).toBe(PAYMENTS_ERROR_CODE.WEBHOOK_INVALID);

    const invalid = await request(app)
      .post("/api/v1/payments/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "invalid-signature")
      .send(body)
      .expect(400);
    expect(invalid.body.error.code).toBe(PAYMENTS_ERROR_CODE.WEBHOOK_INVALID);

    const count = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from payment_webhook_events",
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it("validates the trusted internal refund body before looking up Payment/provider state", async () => {
    const app = createApp();
    const response = await request(app)
      .post(`/api/v1/internal/payments/${randomUUID()}/refund`)
      .set(internalApiKey())
      .send({ sourceKey: "refunds:test", amount: "1.23", requestedByUserId: "not-a-uuid" })
      .expect(422);

    expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });
});
