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
const returnId = "77777777-7777-4777-8777-777777777777";
const returnItemId = "88888888-8888-4888-8888-888888888888";
const shipmentId = "99999999-9999-4999-8999-999999999999";
const refundId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestedHistoryId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const approvedHistoryId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const receivedHistoryId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const now = "2026-09-15T08:00:00.000Z";
const approvedAt = "2026-09-15T09:00:00.000Z";
const deliveredAt = "2026-09-15T07:30:00.000Z";
const returnNo = "RET-77777777777747778777777777777777";

/** Clears the authenticated browser session after each isolated UI test. */
afterEach(() => clearAccessToken());

/** Builds one authenticated customer, seller, or platform-admin actor for Module 14 UI tests. */
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

/** Registers the actor returned by the standard authenticated-user endpoint. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module14-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-returns" }),
    ),
  );
}

/** Builds the customer Order detail used by the Return-request wizard. */
function customerOrder() {
  return {
    id: orderId,
    orderNo: "ORD-44444444444444448444444444444444",
    currency: "USD",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "5.0000",
    grandTotal: "105.0000",
    paymentStatus: "captured",
    fulfillmentStatus: "fulfilled",
    orderStatus: "processing",
    placedAt: now,
    createdAt: now,
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
    billingAddress: {
      recipientName: "Customer",
      phone: "+15555550100",
      line1: "1 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90001",
      countryCode: "US",
    },
    sellerOrders: [{
      id: sellerOrderId,
      sellerOrderNo: "SOR-55555555555545558555555555555555",
      sellerId,
      storeId,
      subtotal: "100.0000",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      shippingTotal: "5.0000",
      grandTotal: "105.0000",
      status: "processing",
      shippingMethod: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        code: "STANDARD",
        name: "Standard shipping",
        amount: "5.0000",
        currency: "USD",
      },
      items: [{
        id: orderItemId,
        productId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        variantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        sku: "RETURN-SKU-1",
        name: "Returnable Product",
        variantTitle: "Default",
        quantity: 2,
        cancelledQuantity: 0,
        remainingQuantity: 2,
        unitPrice: "50.0000",
        discountAllocated: "0.0000",
        taxAllocated: "0.0000",
        lineTotal: "100.0000",
        status: "active",
      }],
    }],
    statusHistory: [],
  };
}

/** Builds one delivered customer-safe Shipment proving potential Return eligibility. */
function deliveredShipment() {
  return {
    id: shipmentId,
    shipmentNo: "SHP-99999999999949998999999999999999",
    carrier: "DHL",
    serviceLevel: "Express",
    trackingNo: "TRACK-RET-1",
    status: "delivered",
    shippedAt: "2026-09-15T06:30:00.000Z",
    deliveredAt,
    items: [{ orderItemId, quantity: 2 }],
    timeline: [
      { status: "shipped", occurredAt: "2026-09-15T06:30:00.000Z" },
      { status: "delivered", occurredAt: deliveredAt },
    ],
  };
}

/** Builds one Return Request response for customer, seller, and admin list views. */
function returnRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: returnId,
    returnNo,
    orderId,
    sellerOrderId,
    customerUserId: customerId,
    status: "requested",
    reasonCode: "damaged",
    requestedAt: now,
    approvedAt: null,
    history: [{
      id: requestedHistoryId,
      fromStatus: null,
      toStatus: "requested",
      changedBy: customerId,
      reason: "Customer requested a Return.",
      changedAt: now,
    }],
    items: [{
      id: returnItemId,
      orderItemId,
      quantity: 1,
      itemCondition: null,
      resolution: null,
      refundAmount: "0.0000",
      restockQty: 0,
    }],
    ...overrides,
  };
}

/** Renders one route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 14 Returns, Refunds & Disputes UI", () => {
  it("creates a Return only from potentially delivered quantity without client-owned refund/restock fields", async () => {
    useActor(actor("customer", [
      "orders.read_own",
      "shipping.read_own_order",
      "returns.create_own",
      "returns.read_own",
    ]));
    let postedBody: Record<string, unknown> | null = null;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders/${orderId}`, () =>
        HttpResponse.json({ success: true, data: customerOrder(), requestId: "req-order-return" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/orders/${orderId}/shipments`, () =>
        HttpResponse.json({ success: true, data: [deliveredShipment()], requestId: "req-return-shipping" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/returns`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
          requestId: "req-return-list-empty",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/orders/${orderId}/returns`, async ({ request }) => {
        postedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: returnRequest(), requestId: "req-return-create" }, { status: 201 });
      }),
    );

    await renderRoute(`/orders/${orderId}/returns/${sellerOrderId}/new`);
    expect(await screen.findByRole("heading", { name: "Request a Return" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Return reason"), "damaged");
    await user.type(screen.getByLabelText(/Return quantity for Returnable Product/), "1");
    await user.click(screen.getByRole("button", { name: "Submit Return Request" }));

    await waitFor(() => expect(postedBody).toEqual({
      sellerOrderId,
      reasonCode: "damaged",
      items: [{ orderItemId, quantity: 1 }],
    }));
    expect(postedBody).not.toHaveProperty("refundAmount");
    expect(postedBody).not.toHaveProperty("restockQty");
    expect(postedBody).not.toHaveProperty("sellerId");
  });

  it("keeps seller approval and inspection as explicit server-owned commands", async () => {
    useActor(actor("seller", ["seller.returns.manage"]));
    let current = returnRequest();
    let approveBody: unknown = null;
    let receiveBody: unknown = null;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/returns`, () =>
        HttpResponse.json({
          success: true,
          data: [current],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-seller-returns",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/returns/${returnId}/approve`, async ({ request }) => {
        approveBody = await request.json();
        current = returnRequest({
          status: "approved",
          approvedAt,
          history: [
            {
              id: requestedHistoryId,
              fromStatus: null,
              toStatus: "requested",
              changedBy: customerId,
              reason: "Customer requested a Return.",
              changedAt: now,
            },
            {
              id: approvedHistoryId,
              fromStatus: "requested",
              toStatus: "approved",
              changedBy: sellerId,
              reason: "Seller approved the Return.",
              changedAt: approvedAt,
            },
          ],
        });
        return HttpResponse.json({ success: true, data: current, requestId: "req-return-approve" });
      }),
      http.post(`${env.VITE_API_BASE_URL}/seller/returns/${returnId}/receive`, async ({ request }) => {
        receiveBody = await request.json();
        current = returnRequest({
          status: "received",
          approvedAt,
          history: [
            {
              id: requestedHistoryId,
              fromStatus: null,
              toStatus: "requested",
              changedBy: customerId,
              reason: "Customer requested a Return.",
              changedAt: now,
            },
            {
              id: approvedHistoryId,
              fromStatus: "requested",
              toStatus: "approved",
              changedBy: sellerId,
              reason: "Seller approved the Return.",
              changedAt: approvedAt,
            },
            {
              id: receivedHistoryId,
              fromStatus: "approved",
              toStatus: "received",
              changedBy: sellerId,
              reason: "Warehouse inspection complete.",
              changedAt: "2026-09-15T10:00:00.000Z",
            },
          ],
          items: [{
            id: returnItemId,
            orderItemId,
            quantity: 1,
            itemCondition: "damaged",
            resolution: "refund_no_restock",
            refundAmount: "50.0000",
            restockQty: 0,
          }],
        });
        return HttpResponse.json({ success: true, data: current, requestId: "req-return-receive" });
      }),
    );

    await renderRoute("/seller/returns");
    expect(await screen.findByText(returnNo)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Approve Return" }));
    await waitFor(() => expect(approveBody).toEqual({}));

    expect(await screen.findByRole("heading", { name: "Receive and inspect" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(`Condition for Return Item ${returnItemId}`), "damaged");
    await user.selectOptions(screen.getByLabelText(`Resolution for Return Item ${returnItemId}`), "refund_no_restock");
    await user.click(screen.getByRole("button", { name: "Receive Return" }));

    await waitFor(() => expect(receiveBody).toEqual({
      items: [{
        returnItemId,
        itemCondition: "damaged",
        resolution: "refund_no_restock",
      }],
    }));
    expect(receiveBody as Record<string, unknown>).not.toHaveProperty("refundAmount");
    expect(receiveBody as Record<string, unknown>).not.toHaveProperty("restockQty");
  });

  it("renders persisted Return lifecycle timestamps and reasons instead of placeholder states", async () => {
    useActor(actor("customer", ["returns.read_own"]));
    const receivedAt = "2026-09-15T10:00:00.000Z";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/returns`, () =>
        HttpResponse.json({
          success: true,
          data: [returnRequest({
            status: "received",
            approvedAt,
            history: [
              {
                id: requestedHistoryId,
                fromStatus: null,
                toStatus: "requested",
                changedBy: customerId,
                reason: "Customer requested a Return.",
                changedAt: now,
              },
              {
                id: approvedHistoryId,
                fromStatus: "requested",
                toStatus: "approved",
                changedBy: sellerId,
                reason: "Seller approved the Return.",
                changedAt: approvedAt,
              },
              {
                id: receivedHistoryId,
                fromStatus: "approved",
                toStatus: "received",
                changedBy: sellerId,
                reason: "Warehouse inspection complete.",
                changedAt: receivedAt,
              },
            ],
          })],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-customer-return-history",
        }),
      ),
    );

    await renderRoute("/returns");

    expect(await screen.findByText("Warehouse inspection complete.")).toBeInTheDocument();
    expect(screen.getByText(new Date(receivedAt).toLocaleString())).toBeInTheDocument();
    expect(screen.queryByText("Current state")).not.toBeInTheDocument();
  });

  it("issues an admin refund with a retry-safe key and no client-owned financial fields", async () => {
    useActor(actor("platform_admin", ["admin.returns.manage", "admin.refunds.issue"]));
    let refundBody: Record<string, unknown> | null = null;
    let idempotencyKey = "";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/returns`, () =>
        HttpResponse.json({
          success: true,
          data: [returnRequest({
            status: "received",
            approvedAt,
            items: [{
              id: returnItemId,
              orderItemId,
              quantity: 1,
              itemCondition: "damaged",
              resolution: "refund_restock",
              refundAmount: "50.0000",
              restockQty: 1,
            }],
          })],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-returns",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/returns/${returnId}/refund`, async ({ request }) => {
        refundBody = await request.json() as Record<string, unknown>;
        idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({
          success: true,
          data: {
            refundId,
            returnRequestId: returnId,
            orderId,
            paymentId,
            amount: "50.0000",
            currency: "USD",
            providerRef: "re_test_module14",
          },
          requestId: "req-admin-refund",
        });
      }),
    );

    await renderRoute("/admin/returns");
    expect(await screen.findByRole("heading", { name: "Returns & dispute queue" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Issue Refund" }));
    expect(screen.getByRole("alertdialog", { name: "Issue this refund?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm refund" }));

    await waitFor(() => expect(idempotencyKey.length).toBeGreaterThan(10));
    expect(refundBody).toEqual({});
    expect(refundBody).not.toHaveProperty("amount");
    expect(refundBody).not.toHaveProperty("currency");
    expect(refundBody).not.toHaveProperty("paymentId");
    expect(await screen.findByText(/Refund completed: 50.0000 USD/)).toBeInTheDocument();
  });

  it("shows a readable seller permission state without calling the Return queue", async () => {
    useActor(actor("seller", ["seller.orders.read"]));
    let called = false;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/returns`, () => {
        called = true;
        return HttpResponse.json({ success: true, data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 }, requestId: "req-unexpected" });
      }),
    );

    await renderRoute("/seller/returns");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(called).toBe(false);
  });
});
