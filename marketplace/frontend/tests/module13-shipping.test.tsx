import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { createQueryClient } from "@/lib/query-client";
import { server } from "./setup/msw-server";

const customerId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const sellerOrderId = "55555555-5555-4555-8555-555555555555";
const orderItemId = "66666666-6666-4666-8666-666666666666";
const productId = "77777777-7777-4777-8777-777777777777";
const variantId = "88888888-8888-4888-8888-888888888888";
const shippingMethodId = "99999999-9999-4999-8999-999999999999";
const shipmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const historyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = "2026-09-15T06:00:00.000Z";
const shippedAt = "2026-09-15T07:00:00.000Z";
const deliveredAt = "2026-09-15T09:00:00.000Z";
const orderNo = "ORD-44444444444444448444444444444444";
const sellerOrderNo = "SOR-55555555555545558555555555555555";
const shipmentNo = "SHP-AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA";

afterEach(() => clearAccessToken());

/** Builds one authenticated actor for customer, seller, or platform Shipping UI tests. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: accountType === "customer" ? customerId : sellerId,
    email: `${accountType}@example.com`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: accountType === "seller"
      ? { sellerIds: [sellerId], storeIds: [storeId] }
      : { sellerIds: [], storeIds: [] },
  };
}

/** Registers the current actor returned by the standard authenticated-user endpoint. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module13-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-shipping" }),
    ),
  );
}

/** Builds one seller-visible Shipment response. */
function sellerShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: shipmentId,
    sellerOrderId,
    shipmentNo,
    carrier: null,
    serviceLevel: null,
    trackingNo: null,
    status: "created",
    shippedAt: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    items: [{ orderItemId, quantity: 2 }],
    timeline: [{ id: historyId, status: "created", source: "seller", occurredAt: now }],
    ...overrides,
  };
}

/** Builds the Seller Order detail required by the fulfillment workspace. */
function sellerOrder() {
  return {
    id: sellerOrderId,
    sellerOrderNo,
    sellerId,
    storeId,
    orderId,
    orderNo,
    currency: "USD",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "5.0000",
    grandTotal: "105.0000",
    status: "processing",
    paymentStatus: "captured",
    fulfillmentStatus: "partially_fulfilled",
    createdAt: now,
    shippingMethod: {
      id: shippingMethodId,
      code: "STANDARD",
      name: "Standard shipping",
      amount: "5.0000",
      currency: "USD",
    },
    items: [
      {
        id: orderItemId,
        productId,
        variantId,
        sku: "SHIP-SKU-1",
        name: "Shipment Product",
        variantTitle: "Default",
        quantity: 2,
        cancelledQuantity: 0,
        remainingQuantity: 2,
        unitPrice: "50.0000",
        discountAllocated: "0.0000",
        taxAllocated: "0.0000",
        lineTotal: "100.0000",
        status: "active",
      },
    ],
    shippingAddress: {
      recipientName: "Customer",
      phone: "+15555550100",
      line1: "1 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90001",
      countryCode: "US",
    },
    statusHistory: [],
  };
}

/** Builds one customer-safe tracking projection with no created/internal history metadata. */
function customerShipment() {
  return {
    id: shipmentId,
    shipmentNo,
    carrier: "DHL",
    serviceLevel: "Express",
    trackingNo: "TRACK-100",
    status: "delivered",
    shippedAt,
    deliveredAt,
    items: [{ orderItemId, quantity: 2 }],
    timeline: [
      { status: "shipped", occurredAt: shippedAt },
      { status: "delivered", occurredAt: deliveredAt },
    ],
  };
}

/** Renders one application route with a fresh TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 13 Shipping & Fulfillment UI", () => {
  it("renders the seller fulfillment queue and sends only allow-listed status filters", async () => {
    useActor(actor("seller", ["seller.shipping.read"]));
    let requestedUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/shipments`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: [sellerShipment()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-shipment-list",
        });
      }),
    );

    await renderRoute("/seller/shipments");
    expect(await screen.findByRole("heading", { name: "Fulfillment Shipments" })).toBeInTheDocument();
    expect(screen.getByText(shipmentNo)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Shipment status filter"), "shipped");
    await waitFor(() => expect(new URL(requestedUrl).searchParams.get("status")).toBe("shipped"));
  });

  it("creates a Shipment, saves tracking, and sends mark-shipped as an idempotent command", async () => {
    useActor(actor("seller", ["seller.orders.read", "seller.shipping.read", "seller.shipping.manage"]));
    let currentShipments: ReturnType<typeof sellerShipment>[] = [];
    let createBody: unknown = null;
    let createKey = "";
    let trackingBody: unknown = null;
    let shippedKey = "";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/orders/${sellerOrderId}`, () =>
        HttpResponse.json({ success: true, data: sellerOrder(), requestId: "req-seller-order" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/seller/shipments`, () =>
        HttpResponse.json({
          success: true,
          data: currentShipments,
          meta: { page: 1, pageSize: 100, totalItems: currentShipments.length, totalPages: currentShipments.length ? 1 : 0 },
          requestId: "req-order-shipments",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/orders/${sellerOrderId}/shipments`, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get("Idempotency-Key") ?? "";
        currentShipments = [sellerShipment()];
        return HttpResponse.json({ success: true, data: currentShipments[0], requestId: "req-create-shipment" }, { status: 201 });
      }),
      http.patch(`${env.VITE_API_BASE_URL}/seller/shipments/${shipmentId}/tracking`, async ({ request }) => {
        trackingBody = await request.json();
        currentShipments = [sellerShipment({ carrier: "DHL", trackingNo: "TRACK-100", serviceLevel: "Express" })];
        return HttpResponse.json({ success: true, data: currentShipments[0], requestId: "req-track-shipment" });
      }),
      http.post(`${env.VITE_API_BASE_URL}/seller/shipments/${shipmentId}/mark-shipped`, async ({ request }) => {
        shippedKey = request.headers.get("Idempotency-Key") ?? "";
        currentShipments = [sellerShipment({
          carrier: "DHL",
          trackingNo: "TRACK-100",
          serviceLevel: "Express",
          status: "shipped",
          shippedAt,
          updatedAt: shippedAt,
          timeline: [
            { id: historyId, status: "created", source: "seller", occurredAt: now },
            { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "shipped", source: "seller", occurredAt: shippedAt },
          ],
        })];
        return HttpResponse.json({ success: true, data: currentShipments[0], requestId: "req-mark-shipped" });
      }),
    );

    await renderRoute(`/seller/orders/${sellerOrderId}/shipping`);
    expect(await screen.findByRole("heading", { name: `Fulfillment for ${sellerOrderNo}` })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Shipment quantity for Shipment Product (SHIP-SKU-1)"), "2");
    await user.click(screen.getByRole("button", { name: "Create Shipment" }));

    await waitFor(() => expect(createBody).toEqual({ items: [{ orderItemId, quantity: 2 }] }));
    expect(createKey.length).toBeGreaterThan(10);
    expect(await screen.findByText(shipmentNo)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Shipment carrier"), "DHL");
    await user.type(screen.getByLabelText("Shipment tracking number"), "TRACK-100");
    await user.type(screen.getByLabelText("Shipment service level"), "Express");
    await user.click(screen.getByRole("button", { name: "Save tracking" }));

    await waitFor(() => expect(trackingBody).toEqual({
      carrier: "DHL",
      trackingNo: "TRACK-100",
      serviceLevel: "Express",
    }));
    expect(trackingBody).not.toHaveProperty("status");

    expect(await screen.findByRole("button", { name: "Mark shipped" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    await waitFor(() => expect(shippedKey.length).toBeGreaterThan(10));
    expect(await screen.findByText("Shipped")).toBeInTheDocument();
  });

  it("renders only customer-safe shipped/delivered tracking fields", async () => {
    useActor(actor("customer", ["shipping.read_own_order"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders/${orderId}/shipments`, () =>
        HttpResponse.json({ success: true, data: [customerShipment()], requestId: "req-customer-tracking" }),
      ),
    );

    await renderRoute(`/orders/${orderId}/shipping`);
    expect(await screen.findByRole("heading", { name: "Shipment tracking" })).toBeInTheDocument();
    expect(screen.getByText("DHL · TRACK-100")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Shipment timeline" })).toBeInTheDocument();
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText(/Source:/)).not.toBeInTheDocument();
  });

  it("shows a readable permission state without calling the seller Shipment API", async () => {
    useActor(actor("seller", ["seller.orders.read"]));
    await renderRoute("/seller/shipments");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.getByText("Your seller account does not have permission to use this feature.")).toBeInTheDocument();
  });
});
