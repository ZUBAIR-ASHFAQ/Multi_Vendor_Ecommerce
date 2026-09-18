import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type { ShippingMethodRow } from "../../src/database/schema/shipping.js";
import type {
  CustomerShipmentTrackingResponse,
  SellerShipmentResponse,
} from "../../src/modules/shipping/shipping.schema.js";
import {
  SHIPPING_METHOD_STATUS,
  SHIPPING_OWNER_TYPE,
  SHIPPING_PRICING_TYPE,
} from "../../src/modules/shipping/shipping.constants.js";
import { createAddressViaHttp } from "../module3/module3.test-helpers.js";
import {
  bearer,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  loginUser,
  registerCustomer,
  resetModule8Tables,
  type ApprovedSellerFixture,
  type Module4TestUser,
  type PublishedCartWishlistFixture,
} from "../module8/module8.test-helpers.js";
import { addCartItemViaHttp } from "../module9/module9.test-helpers.js";

export {
  addCartItemViaHttp,
  bearer,
  createAddressViaHttp,
  createPlatformAdmin,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  loginUser,
  registerCustomer,
};
export type {
  ApprovedSellerFixture,
  Module4TestUser,
  PublishedCartWishlistFixture,
};

/** Clears Shipping persistence before restoring every released prerequisite fixture table. */
export async function resetModule13Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      shipment_status_history,
      shipment_items,
      shipments,
      shipping_methods
    RESTART IDENTITY CASCADE
  `);
  await resetModule8Tables();
}

/** Inserts one approved Stage 11 shipping-method fixture with explicit owner/currency controls. */
export async function insertShippingMethod(input: {
  ownerType: "platform" | "seller";
  sellerId: string | null;
  code?: string;
  name?: string;
  pricingType?: "flat";
  baseRate?: string;
  currency?: string;
  status?: "active" | "inactive";
}): Promise<ShippingMethodRow> {
  const code = input.code ?? `SHIP-${randomUUID()}`;
  const name = input.name ?? `Shipping Method ${code}`;
  const pricingType = input.pricingType ?? SHIPPING_PRICING_TYPE.FLAT;
  const baseRate = input.baseRate ?? "12.3400";
  const currency = input.currency ?? "PKR";
  const status = input.status ?? SHIPPING_METHOD_STATUS.ACTIVE;

  const result = await databasePool.query<ShippingMethodRow>(
    `insert into shipping_methods
      (owner_type, seller_id, code, name, pricing_type, base_rate, currency, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning
       id,
       owner_type as "ownerType",
       seller_id as "sellerId",
       code,
       name,
       pricing_type as "pricingType",
       base_rate as "baseRate",
       currency,
       status`,
    [
      input.ownerType,
      input.sellerId,
      code,
      name,
      pricingType,
      baseRate,
      currency,
      status,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Shipping Core test fixture insert did not return a row.");
  return row;
}

/** Creates one platform-owned shipping method with defaults that stay inside Patch 0003. */
export async function insertPlatformShippingMethod(
  input: Omit<Parameters<typeof insertShippingMethod>[0], "ownerType" | "sellerId"> = {},
): Promise<ShippingMethodRow> {
  return insertShippingMethod({
    ownerType: SHIPPING_OWNER_TYPE.PLATFORM,
    sellerId: null,
    ...input,
  });
}


/** Creates one seller-scoped Shipment through the approved HTTP command and returns its seller-safe projection. */
export async function createShipmentViaHttp(
  sellerToken: string,
  sellerOrderId: string,
  items: Array<{ orderItemId: string; quantity: number }>,
  idempotencyKey = `module13-create-${randomUUID()}`,
): Promise<SellerShipmentResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/orders/${sellerOrderId}/shipments`)
    .set(bearer(sellerToken))
    .set("Idempotency-Key", idempotencyKey)
    .send({ items })
    .expect(201);
  return response.body.data as SellerShipmentResponse;
}

/** Sets normalized tracking values through the approved seller Shipment HTTP command. */
export async function updateShipmentTrackingViaHttp(
  sellerToken: string,
  shipmentId: string,
  input: { carrier: string; trackingNo: string; serviceLevel?: string | null },
): Promise<SellerShipmentResponse> {
  const response = await request(createApp())
    .patch(`/api/v1/seller/shipments/${shipmentId}/tracking`)
    .set(bearer(sellerToken))
    .send(input)
    .expect(200);
  return response.body.data as SellerShipmentResponse;
}

/** Marks one created Shipment shipped using the required Foundation idempotency header. */
export async function markShipmentShippedViaHttp(
  sellerToken: string,
  shipmentId: string,
  idempotencyKey = `module13-ship-${randomUUID()}`,
): Promise<SellerShipmentResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/shipments/${shipmentId}/mark-shipped`)
    .set(bearer(sellerToken))
    .set("Idempotency-Key", idempotencyKey)
    .send({})
    .expect(200);
  return response.body.data as SellerShipmentResponse;
}

/** Marks one shipped Shipment delivered using the required Foundation idempotency header. */
export async function markShipmentDeliveredViaHttp(
  sellerToken: string,
  shipmentId: string,
  idempotencyKey = `module13-deliver-${randomUUID()}`,
): Promise<SellerShipmentResponse> {
  const response = await request(createApp())
    .post(`/api/v1/seller/shipments/${shipmentId}/mark-delivered`)
    .set(bearer(sellerToken))
    .set("Idempotency-Key", idempotencyKey)
    .send({})
    .expect(200);
  return response.body.data as SellerShipmentResponse;
}

/** Reads the seller Shipment queue through the published seller-scoped HTTP operation. */
export async function listSellerShipmentsViaHttp(
  sellerToken: string,
): Promise<SellerShipmentResponse[]> {
  const response = await request(createApp())
    .get("/api/v1/seller/shipments")
    .set(bearer(sellerToken))
    .expect(200);
  return response.body.data as SellerShipmentResponse[];
}

/** Reads customer/admin-safe Shipment tracking through the published Order tracking operation. */
export async function getOrderShipmentsViaHttp(
  token: string,
  orderId: string,
): Promise<CustomerShipmentTrackingResponse[]> {
  const response = await request(createApp())
    .get(`/api/v1/orders/${orderId}/shipments`)
    .set(bearer(token))
    .expect(200);
  return response.body.data as CustomerShipmentTrackingResponse[];
}

/** Counts durable Shipping outbox events, optionally narrowed to one Shipment aggregate. */
export async function countShippingOutboxEvents(
  eventType: string,
  shipmentId?: string,
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from outbox_events
      where event_type = $1
        and ($2::text is null or aggregate_id = $2::text)`,
    [eventType, shipmentId ?? null],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts immutable Shipping audit evidence, optionally narrowed to one Shipment entity. */
export async function countShippingAuditEvents(
  action: string,
  shipmentId?: string,
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from audit_logs
      where action = $1
        and ($2::text is null or resource_id = $2::text)`,
    [action, shipmentId ?? null],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts Inventory physical-issue movements produced by one Shipment aggregate. */
export async function countShipmentInventoryMovements(shipmentId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from stock_movements
      where movement_type = 'ship'
        and source_type = 'shipment'
        and source_id = $1`,
    [shipmentId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads the parent Customer Order fulfillment state after Shipment issue reconciliation. */
export async function readOrderFulfillmentStatus(orderId: string): Promise<string> {
  const result = await databasePool.query<{ fulfillment_status: string }>(
    `select fulfillment_status
       from orders
      where id = $1`,
    [orderId],
  );
  const status = result.rows[0]?.fulfillment_status;
  if (!status) throw new Error("Module 13 test Order was not found.");
  return status;
}

/** Counts one Shipment lifecycle status row to prove replay-safe history behavior. */
export async function countShipmentHistory(
  shipmentId: string,
  status: "created" | "shipped" | "delivered",
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from shipment_status_history
      where shipment_id = $1 and status = $2`,
    [shipmentId, status],
  );
  return result.rows[0]?.count ?? 0;
}
