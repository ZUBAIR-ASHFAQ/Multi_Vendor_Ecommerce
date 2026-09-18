import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  PAYOUT_STATUS,
  WALLET_PAYOUT_ERROR_CODE,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { bearer } from "../module13/module13.test-helpers.js";
import { createSecondSeller } from "../module14/module14.test-helpers.js";
import {
  createIntegrationWalletService,
  createWalletPayoutAccount,
  creditAndSettleWallet,
  prepareWalletEarningsFixture,
  resetModule17Tables,
  systemWalletContext,
} from "./module17.test-helpers.js";

const INTERNAL_API_KEY =
  process.env.INTERNAL_API_KEY ?? "module7-test-internal-api-key-that-is-at-least-32-characters";

beforeEach(async () => {
  await resetModule17Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 17 Wallet/Payout HTTP and RBAC regression", () => {
  it("requires authentication, strict request contracts, and seller-owned scope for Wallet/Payout reads", async () => {
    await request(createApp()).get("/api/v1/seller/wallet").expect(401).expect((response) => {
      expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
    });

    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    await service.applyCommissionSource(systemWalletContext(), fixture.saleCommissionEntryId);
    const sellerB = await createSecondSeller(fixture.captured.order.adminToken);

    const sellerAResponse = await request(createApp())
      .get("/api/v1/seller/wallet")
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(sellerAResponse.body).toMatchObject({
      success: true,
      data: {
        wallets: [
          expect.objectContaining({
            sellerId: fixture.sellerId,
            pendingBalance: fixture.saleSellerNetAmount,
          }),
        ],
      },
      meta: expect.any(Object),
      requestId: expect.any(String),
    });

    const sellerBResponse = await request(createApp())
      .get("/api/v1/seller/wallet")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBResponse.body.data.wallets).toEqual([]);
    expect(sellerBResponse.body.data.entries).toEqual([]);

    const clientOwnedScope = await request(createApp())
      .post("/api/v1/seller/payouts")
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module17-client-scope-${randomUUID()}`)
      .send({
        accountId: randomUUID(),
        amount: "1.0000",
        currency: fixture.currency,
        sellerId: sellerB.sellerId,
      })
      .expect(422);
    expect(clientOwnedScope.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("creates a seller Payout through HTTP, keeps Seller B isolated, and exposes it only to authorized finance reads", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const { service } = createIntegrationWalletService();
    await creditAndSettleWallet(service, fixture);
    const account = await createWalletPayoutAccount(service, fixture);
    const sellerB = await createSecondSeller(fixture.captured.order.adminToken);

    const missingKey = await request(createApp())
      .post("/api/v1/seller/payouts")
      .set(bearer(fixture.sellerToken))
      .send({ accountId: account.id, amount: "10.0000", currency: fixture.currency })
      .expect(422);
    expect(missingKey.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const created = await request(createApp())
      .post("/api/v1/seller/payouts")
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module17-http-request-${randomUUID()}`)
      .send({ accountId: account.id, amount: "10.0000", currency: fixture.currency })
      .expect(201);
    expect(created.body.data).toMatchObject({
      sellerId: fixture.sellerId,
      amount: "10.0000",
      currency: fixture.currency,
      status: PAYOUT_STATUS.REQUESTED,
    });

    const sellerBHistory = await request(createApp())
      .get("/api/v1/seller/payouts")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBHistory.body.data).toEqual([]);

    const sellerBWrongAccount = await request(createApp())
      .post("/api/v1/seller/payouts")
      .set(bearer(sellerB.ownerToken))
      .set("Idempotency-Key", `module17-http-seller-b-${randomUUID()}`)
      .send({ accountId: account.id, amount: "1.0000", currency: fixture.currency })
      .expect(409);
    expect(sellerBWrongAccount.body.error.code).toBe(
      WALLET_PAYOUT_ERROR_CODE.PAYOUT_ACCOUNT_INVALID,
    );

    const adminQueue = await request(createApp())
      .get("/api/v1/admin/payouts")
      .set(bearer(fixture.captured.order.adminToken))
      .expect(200);
    expect(adminQueue.body.data).toEqual([
      expect.objectContaining({ id: created.body.data.id, sellerId: fixture.sellerId }),
    ]);

    await request(createApp())
      .get("/api/v1/admin/payouts")
      .set(bearer(fixture.sellerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
      });
  });

  it("protects finance approval/send with permissions and Idempotency-Key while production provider stays fail-closed", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    await creditAndSettleWallet(service, fixture);
    const account = await createWalletPayoutAccount(service, fixture);
    const requestResponse = await request(createApp())
      .post("/api/v1/seller/payouts")
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module17-http-finance-request-${randomUUID()}`)
      .send({ accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency })
      .expect(201);
    const payoutId = requestResponse.body.data.id as string;

    await request(createApp())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module17-http-seller-approve-${randomUUID()}`)
      .send({})
      .expect(403);

    await request(createApp())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set(bearer(fixture.captured.order.adminToken))
      .send({})
      .expect(422);

    const approved = await request(createApp())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set(bearer(fixture.captured.order.adminToken))
      .set("Idempotency-Key", `module17-http-admin-approve-${randomUUID()}`)
      .send({})
      .expect(200);
    expect(approved.body.data.status).toBe(PAYOUT_STATUS.APPROVED);

    const providerUnavailable = await request(createApp())
      .post(`/api/v1/admin/payouts/${payoutId}/send`)
      .set(bearer(fixture.captured.order.adminToken))
      .set("Idempotency-Key", `module17-http-admin-send-${randomUUID()}`)
      .send({})
      .expect(502);
    expect(providerUnavailable.body.error.code).toBe(
      WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
    );
  });

  it("keeps internal settlement/adjustment behind internal authentication and strict idempotent command bodies", async () => {
    await request(createApp())
      .post("/api/v1/internal/wallet/settle")
      .set("Idempotency-Key", `module17-internal-denied-${randomUUID()}`)
      .send({ limit: 10 })
      .expect(401)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
      });

    await request(createApp())
      .post("/api/v1/internal/wallet/settle")
      .set("x-internal-api-key", INTERNAL_API_KEY)
      .send({ limit: 10 })
      .expect(422)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
      });

    await request(createApp())
      .post("/api/v1/internal/wallet/adjust")
      .set("x-internal-api-key", INTERNAL_API_KEY)
      .set("Idempotency-Key", `module17-internal-adjust-${randomUUID()}`)
      .send({ commissionEntryId: randomUUID(), amount: "999.0000" })
      .expect(422)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
      });
  });
});
