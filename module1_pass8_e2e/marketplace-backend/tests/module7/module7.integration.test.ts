import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  INVENTORY_AUDIT_ACTION,
  INVENTORY_ERROR_CODE,
  INVENTORY_OUTBOX_EVENT,
  STOCK_RESERVATION_STATUS,
} from "../../src/modules/inventory/inventory.constants.js";
import { InventoryService } from "../../src/modules/inventory/inventory.service.js";
import {
  adjustInventoryViaHttp,
  bearer,
  countInventoryAuditActions,
  countInventoryOutboxEvents,
  createCategoryViaHttp,
  createInventoryVariantFixture,
  createPlatformAdmin,
  createProductSellerFixture,
  internalApiKey,
  loginUser,
  registerCustomer,
  reserveInventoryViaHttp,
  resetModule7Tables,
} from "./module7.test-helpers.js";

/** Creates the same trusted system context established by the internal-service middleware. */
function systemContext(): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

beforeEach(async () => {
  await resetModule7Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 7 repository/service/API integration", () => {
  it("enforces authentication, Inventory permissions, and seller-to-seller isolation", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "InventoryIsolationA");
    const sellerB = await createProductSellerFixture(adminToken, "InventoryIsolationB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-isolation-${randomUUID()}`,
      name: "Module 7 Isolation",
    });
    const fixture = await createInventoryVariantFixture(
      sellerA.ownerToken,
      sellerA.storeId,
      String(category.id),
      "Isolation",
    );
    await adjustInventoryViaHttp(sellerA.ownerToken, fixture.variant.id, 10);
    const app = createApp();

    await request(app).get("/api/v1/seller/inventory").expect(401);

    const customer = await registerCustomer(
      `module7-reader-${randomUUID()}@example.com`,
      "Module 7 Reader",
    );
    const customerToken = await loginUser(customer);
    const forbidden = await request(app)
      .get("/api/v1/seller/inventory")
      .set(bearer(customerToken))
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const sellerAList = await request(app)
      .get("/api/v1/seller/inventory")
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(sellerAList.body.data).toHaveLength(1);
    expect(sellerAList.body.data[0]).toMatchObject({
      variantId: fixture.variant.id,
      onHandQty: 10,
      reservedQty: 0,
      availableQty: 10,
    });

    const sellerBList = await request(app)
      .get("/api/v1/seller/inventory")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBList.body.data).toEqual([]);

    const hiddenRead = await request(app)
      .get(`/api/v1/seller/inventory/${fixture.variant.id}/movements`)
      .set(bearer(sellerB.ownerToken))
      .expect(404);
    expect(hiddenRead.body.error.code).toBe(INVENTORY_ERROR_CODE.INVENTORY_NOT_FOUND);

    const hiddenWrite = await request(app)
      .post(`/api/v1/seller/inventory/${fixture.variant.id}/adjust`)
      .set(bearer(sellerB.ownerToken))
      .send({ quantityDelta: 1 })
      .expect(404);
    expect(hiddenWrite.body.error.code).toBe(INVENTORY_ERROR_CODE.INVENTORY_NOT_FOUND);

    const persisted = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(persisted.rows[0]).toMatchObject({ on_hand_qty: 10, reserved_qty: 0 });
  });

  it("protects internal commands and makes reserve retries idempotent without double-reserving stock", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryReserve");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-reserve-${randomUUID()}`,
      name: "Module 7 Reserve",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Reserve",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const customer = await registerCustomer(
      `module7-reserve-${randomUUID()}@example.com`,
      "Reserve Customer",
    );
    const app = createApp();
    const payload = {
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 3,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      sourceKey: `reserve-${randomUUID()}`,
    };

    await request(app).post("/api/v1/internal/inventory/reserve").send(payload).expect(401);
    await request(app)
      .post("/api/v1/internal/inventory/reserve")
      .set({ "x-internal-api-key": "wrong-internal-key" })
      .send(payload)
      .expect(401);

    const first = await request(app)
      .post("/api/v1/internal/inventory/reserve")
      .set(internalApiKey())
      .send(payload)
      .expect(200);
    const retry = await request(app)
      .post("/api/v1/internal/inventory/reserve")
      .set(internalApiKey())
      .send(payload)
      .expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);

    const conflict = await request(app)
      .post("/api/v1/internal/inventory/reserve")
      .set(internalApiKey())
      .send({ ...payload, quantity: 2 })
      .expect(409);
    expect(conflict.body.error.code).toBe(INVENTORY_ERROR_CODE.DUPLICATE_STOCK_SOURCE);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 5, reserved_qty: 3 });
    const reserveMovements = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements where movement_type = 'reserve'",
    );
    expect(reserveMovements.rows[0]?.count).toBe(1);
    expect(await countInventoryAuditActions(INVENTORY_AUDIT_ACTION.RESERVED)).toBe(1);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.RESERVED)).toBe(1);
  });

  it("prevents overselling when concurrent reservations compete for the last available stock", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryConcurrent");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-concurrent-${randomUUID()}`,
      name: "Module 7 Concurrent Reserve",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Concurrent",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const customer = await registerCustomer(
      `module7-concurrent-${randomUUID()}@example.com`,
      "Concurrent Customer",
    );
    const app = createApp();
    const base = {
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 4,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };

    const [first, second] = await Promise.all([
      request(app)
        .post("/api/v1/internal/inventory/reserve")
        .set(internalApiKey())
        .send({ ...base, sourceKey: `concurrent-a-${randomUUID()}` }),
      request(app)
        .post("/api/v1/internal/inventory/reserve")
        .set(internalApiKey())
        .send({ ...base, sourceKey: `concurrent-b-${randomUUID()}` }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(rejected.body.error.code).toBe(INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 5, reserved_qty: 4 });

    const reservationCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_reservations where variant_id = $1",
      [fixture.variant.id],
    );
    expect(reservationCount.rows[0]?.count).toBe(1);
  });

  it("rolls an invalid seller adjustment back without changing stock, ledger, audit, or outbox state", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryRollback");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-rollback-${randomUUID()}`,
      name: "Module 7 Rollback",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Rollback",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const customer = await registerCustomer(
      `module7-rollback-${randomUUID()}@example.com`,
      "Rollback Customer",
    );
    await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 4,
      sourceKey: `rollback-reserve-${randomUUID()}`,
    });

    const beforeMovements = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements",
    );
    const beforeAudit = await countInventoryAuditActions(INVENTORY_AUDIT_ACTION.ADJUSTED);
    const beforeOutbox = await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.ADJUSTED);

    const rejected = await request(createApp())
      .post(`/api/v1/seller/inventory/${fixture.variant.id}/adjust`)
      .set(bearer(seller.ownerToken))
      .send({ quantityDelta: -2 })
      .expect(409);
    expect(rejected.body.error.code).toBe(INVENTORY_ERROR_CODE.STOCK_ADJUSTMENT_INVALID);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 5, reserved_qty: 4 });
    const afterMovements = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements",
    );
    expect(afterMovements.rows[0]?.count).toBe(beforeMovements.rows[0]?.count);
    expect(await countInventoryAuditActions(INVENTORY_AUDIT_ACTION.ADJUSTED)).toBe(beforeAudit);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.ADJUSTED)).toBe(beforeOutbox);
  });

  it("emits low-stock only when available quantity crosses into the configured threshold", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryLowStock");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-low-stock-${randomUUID()}`,
      name: "Module 7 Low Stock",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "LowStock",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 10);
    const app = createApp();

    await request(app)
      .patch(`/api/v1/seller/inventory/${fixture.variant.id}/reorder-level`)
      .set(bearer(seller.ownerToken))
      .send({ reorderLevel: 5 })
      .expect(200);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.LOW_STOCK)).toBe(0);

    await request(app)
      .post(`/api/v1/seller/inventory/${fixture.variant.id}/adjust`)
      .set(bearer(seller.ownerToken))
      .send({ quantityDelta: -5 })
      .expect(200);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.LOW_STOCK)).toBe(1);

    await request(app)
      .post(`/api/v1/seller/inventory/${fixture.variant.id}/adjust`)
      .set(bearer(seller.ownerToken))
      .send({ quantityDelta: -1 })
      .expect(200);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.LOW_STOCK)).toBe(1);

    const lowStockList = await request(app)
      .get("/api/v1/seller/inventory?lowStock=true")
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(lowStockList.body.data).toHaveLength(1);
    expect(lowStockList.body.data[0]).toMatchObject({ availableQty: 4, reorderLevel: 5 });
  });

  it("releases reservations exactly once and restores reserved quantity without mutating history", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryRelease");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-release-${randomUUID()}`,
      name: "Module 7 Release",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Release",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const customer = await registerCustomer(
      `module7-release-${randomUUID()}@example.com`,
      "Release Customer",
    );
    const reservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 3,
      sourceKey: `release-reserve-${randomUUID()}`,
    });
    const releasePayload = {
      reservationId: String(reservation.id),
      sourceKey: `release-command-${randomUUID()}`,
    };
    const app = createApp();

    const first = await request(app)
      .post("/api/v1/internal/inventory/release")
      .set(internalApiKey())
      .send(releasePayload)
      .expect(200);
    const retry = await request(app)
      .post("/api/v1/internal/inventory/release")
      .set(internalApiKey())
      .send(releasePayload)
      .expect(200);
    expect(first.body.data.status).toBe(STOCK_RESERVATION_STATUS.RELEASED);
    expect(retry.body.data.id).toBe(first.body.data.id);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 5, reserved_qty: 0 });
    const releases = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements where movement_type = 'release'",
    );
    expect(releases.rows[0]?.count).toBe(1);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.RESERVATION_RELEASED)).toBe(1);
  });

  it("expires abandoned reservations once while leaving committed stock reserved", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryExpirySweep");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-expiry-sweep-${randomUUID()}`,
      name: "Module 7 Expiry Sweep",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "ExpirySweep",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 6);
    const customer = await registerCustomer(
      `module7-expiry-sweep-${randomUUID()}@example.com`,
      "Expiry Sweep Customer",
    );
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const abandoned = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 2,
      expiresAt: expiresAt.toISOString(),
      sourceKey: `expiry-abandoned-${randomUUID()}`,
    });
    const committed = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 2,
      expiresAt: expiresAt.toISOString(),
      sourceKey: `expiry-committed-${randomUUID()}`,
    });

    await new InventoryService().commitStockReservation(systemContext(), {
      reservationId: String(committed.id),
    });

    const afterExpiry = new InventoryService({
      now: () => new Date(expiresAt.getTime() + 60_000),
    });
    await expect(afterExpiry.releaseExpiredReservations(10)).resolves.toBe(1);
    await expect(afterExpiry.releaseExpiredReservations(10)).resolves.toBe(0);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 6, reserved_qty: 2 });

    const reservations = await databasePool.query<{ id: string; status: string }>(
      "select id, status from stock_reservations where id = any($1::uuid[]) order by id",
      [[String(abandoned.id), String(committed.id)]],
    );
    const statusById = new Map(reservations.rows.map((row) => [row.id, row.status]));
    expect(statusById.get(String(abandoned.id))).toBe(STOCK_RESERVATION_STATUS.EXPIRED);
    expect(statusById.get(String(committed.id))).toBe(STOCK_RESERVATION_STATUS.COMMITTED);

    const releaseMovements = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements where movement_type = 'release'",
    );
    expect(releaseMovements.rows[0]?.count).toBe(1);
    expect(await countInventoryAuditActions(INVENTORY_AUDIT_ACTION.RESERVATION_RELEASED)).toBe(1);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.RESERVATION_RELEASED)).toBe(1);
  });

  it("ships one committed reservation through the trusted internal HTTP command", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryShipHttp");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-ship-http-${randomUUID()}`,
      name: "Module 7 Ship HTTP",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "ShipHttp",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 4);
    const customer = await registerCustomer(
      `module7-ship-http-${randomUUID()}@example.com`,
      "Ship HTTP Customer",
    );
    const reservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 2,
      sourceKey: `ship-http-reserve-${randomUUID()}`,
    });
    await new InventoryService().commitStockReservation(systemContext(), {
      reservationId: String(reservation.id),
    });

    const response = await request(createApp())
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: reservation.id,
        quantity: 2,
        sourceId: randomUUID(),
        sourceKey: `ship-http-${randomUUID()}`,
      })
      .expect(200);
    expect(response.body.data.status).toBe(STOCK_RESERVATION_STATUS.CONSUMED);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 2, reserved_qty: 0 });
  });

  it("keeps committed stock reserved after checkout expiry until fulfillment or explicit release", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryCommitted");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-committed-${randomUUID()}`,
      name: "Module 7 Committed Reservation",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Committed",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const customer = await registerCustomer(
      `module7-committed-${randomUUID()}@example.com`,
      "Committed Customer",
    );
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const releaseReservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 2,
      expiresAt: expiresAt.toISOString(),
      sourceKey: `commit-release-reserve-${randomUUID()}`,
    });
    const shipReservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 2,
      expiresAt: expiresAt.toISOString(),
      sourceKey: `commit-ship-reserve-${randomUUID()}`,
    });
    const service = new InventoryService();
    await service.commitStockReservation(systemContext(), {
      reservationId: String(releaseReservation.id),
    });
    await service.commitStockReservation(systemContext(), {
      reservationId: String(shipReservation.id),
    });

    const afterCheckoutExpiry = new InventoryService({
      now: () => new Date(expiresAt.getTime() + 60_000),
    });
    const released = await afterCheckoutExpiry.releaseStock(systemContext(), {
      reservationId: String(releaseReservation.id),
      sourceKey: `committed-release-${randomUUID()}`,
    });
    expect(released.status).toBe(STOCK_RESERVATION_STATUS.RELEASED);

    const shipmentSourceId = randomUUID();
    const sourceKey = `shipment-${randomUUID()}`;
    const shipped = await afterCheckoutExpiry.shipStock(systemContext(), {
      reservationId: String(shipReservation.id),
      quantity: 2,
      sourceId: shipmentSourceId,
      sourceKey,
    });
    expect(shipped.status).toBe(STOCK_RESERVATION_STATUS.CONSUMED);

    const retry = await afterCheckoutExpiry.shipStock(systemContext(), {
      reservationId: String(shipReservation.id),
      quantity: 2,
      sourceId: shipmentSourceId,
      sourceKey,
    });
    expect(retry.status).toBe(STOCK_RESERVATION_STATUS.CONSUMED);

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 3, reserved_qty: 0 });
    const shippedMovements = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements where movement_type = 'ship'",
    );
    expect(shippedMovements.rows[0]?.count).toBe(1);
    expect(await countInventoryAuditActions(INVENTORY_AUDIT_ACTION.SHIPPED)).toBe(1);
    expect(await countInventoryOutboxEvents(INVENTORY_OUTBOX_EVENT.SHIPPED)).toBe(1);
  });
  it("supports two partial shipments through the internal HTTP command without double-deducting stock", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryPartialShip");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-partial-ship-${randomUUID()}`,
      name: "Module 7 Partial Shipment",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "PartialShip",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 7);
    const customer = await registerCustomer(
      `module7-partial-ship-${randomUUID()}@example.com`,
      "Partial Shipment Customer",
    );
    const reservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 5,
      sourceKey: `partial-reserve-${randomUUID()}`,
    });

    const service = new InventoryService();
    await service.commitStockReservation(systemContext(), {
      reservationId: String(reservation.id),
    });

    const app = createApp();
    const firstSourceId = randomUUID();
    const firstSourceKey = `partial-shipment-1-${randomUUID()}`;
    const first = await request(app)
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        quantity: 2,
        sourceId: firstSourceId,
        sourceKey: firstSourceKey,
      })
      .expect(200);
    expect(first.body.data).toMatchObject({
      quantity: 5,
      consumedQuantity: 2,
      remainingQuantity: 3,
      status: STOCK_RESERVATION_STATUS.COMMITTED,
    });

    const firstRetry = await request(app)
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        quantity: 2,
        sourceId: firstSourceId,
        sourceKey: firstSourceKey,
      })
      .expect(200);
    expect(firstRetry.body.data).toMatchObject({
      consumedQuantity: 2,
      remainingQuantity: 3,
      status: STOCK_RESERVATION_STATUS.COMMITTED,
    });

    const overShip = await request(app)
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        quantity: 4,
        sourceId: randomUUID(),
        sourceKey: `partial-over-ship-${randomUUID()}`,
      })
      .expect(409);
    expect(overShip.body.error.code).toBe(INVENTORY_ERROR_CODE.STOCK_ADJUSTMENT_INVALID);

    const second = await request(app)
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        quantity: 3,
        sourceId: randomUUID(),
        sourceKey: `partial-shipment-2-${randomUUID()}`,
      })
      .expect(200);
    expect(second.body.data).toMatchObject({
      consumedQuantity: 5,
      remainingQuantity: 0,
      status: STOCK_RESERVATION_STATUS.CONSUMED,
    });

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 2, reserved_qty: 0 });

    const persistedReservation = await databasePool.query<{
      qty: number;
      consumed_qty: number;
      status: string;
    }>(
      "select qty, consumed_qty, status from stock_reservations where id = $1",
      [reservation.id],
    );
    expect(persistedReservation.rows[0]).toEqual({
      qty: 5,
      consumed_qty: 5,
      status: STOCK_RESERVATION_STATUS.CONSUMED,
    });

    const shipments = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_movements where movement_type = 'ship'",
    );
    expect(shipments.rows[0]?.count).toBe(2);
  });

  it("releases only the unshipped remainder after a partial shipment", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryPartialRelease");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-partial-release-${randomUUID()}`,
      name: "Module 7 Partial Release",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "PartialRelease",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 6);
    const customer = await registerCustomer(
      `module7-partial-release-${randomUUID()}@example.com`,
      "Partial Release Customer",
    );
    const reservation = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 5,
      sourceKey: `partial-release-reserve-${randomUUID()}`,
    });

    const service = new InventoryService();
    await service.commitStockReservation(systemContext(), {
      reservationId: String(reservation.id),
    });
    const app = createApp();
    await request(app)
      .post("/api/v1/internal/inventory/ship")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        quantity: 2,
        sourceId: randomUUID(),
        sourceKey: `partial-release-ship-${randomUUID()}`,
      })
      .expect(200);

    const released = await request(app)
      .post("/api/v1/internal/inventory/release")
      .set(internalApiKey())
      .send({
        reservationId: String(reservation.id),
        sourceKey: `partial-release-command-${randomUUID()}`,
      })
      .expect(200);
    expect(released.body.data).toMatchObject({
      consumedQuantity: 2,
      remainingQuantity: 0,
      status: STOCK_RESERVATION_STATUS.RELEASED,
    });

    const inventory = await databasePool.query<{ on_hand_qty: number; reserved_qty: number }>(
      "select on_hand_qty, reserved_qty from inventory_items where variant_id = $1",
      [fixture.variant.id],
    );
    expect(inventory.rows[0]).toMatchObject({ on_hand_qty: 4, reserved_qty: 0 });

    const releaseMovement = await databasePool.query<{ quantity_delta: number }>(
      "select quantity_delta from stock_movements where movement_type = 'release'",
    );
    expect(releaseMovement.rows).toEqual([{ quantity_delta: -3 }]);
  });

});
