import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
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
const historyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = "2026-09-12T12:00:00.000Z";
const orderNo = "ORD-44444444444444448444444444444444";
const sellerOrderNo = "SOR-55555555555545558555555555555555";

afterEach(() => clearAccessToken());

/** Builds one deterministic actor for customer, seller, or platform Order UI tests. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: accountType === "customer" ? customerId : sellerId,
    email: `${accountType}@example.com`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: accountType === "seller" ? { sellerIds: [sellerId], storeIds: [storeId] } : { sellerIds: [], storeIds: [] },
  };
}

/** Registers the current authenticated actor returned by the standard auth endpoint. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module11-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-orders" }),
    ),
  );
}

/** Builds the customer/admin parent Order list representation. */
function orderSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    orderNo,
    currency: "USD",
    subtotal: "100.0000",
    discountTotal: "10.0000",
    taxTotal: "9.0000",
    shippingTotal: "5.0000",
    grandTotal: "104.0000",
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    orderStatus: "pending_payment",
    placedAt: null,
    createdAt: now,
    ...overrides,
  };
}

/** Builds one safe immutable Order Item snapshot. */
function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: orderItemId,
    productId,
    variantId,
    sku: "ORDER-SKU-1",
    name: "Immutable Order Product",
    variantTitle: "Default",
    quantity: 2,
    cancelledQuantity: 0,
    remainingQuantity: 2,
    unitPrice: "50.0000",
    discountAllocated: "10.0000",
    taxAllocated: "9.0000",
    lineTotal: "99.0000",
    status: "active",
    ...overrides,
  };
}

/** Builds one seller-scoped fulfillment unit returned by customer detail. */
function customerSellerOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: sellerOrderId,
    sellerOrderNo,
    sellerId,
    storeId,
    subtotal: "100.0000",
    discountTotal: "10.0000",
    taxTotal: "9.0000",
    shippingTotal: "5.0000",
    grandTotal: "104.0000",
    status: "pending_payment",
    shippingMethod: {
      id: shippingMethodId,
      code: "STANDARD",
      name: "Standard shipping",
      amount: "5.0000",
      currency: "USD",
    },
    items: [orderItem()],
    ...overrides,
  };
}

/** Builds one customer-owned parent Order detail. */
function orderDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...orderSummary(),
    shippingAddress: {
      recipientName: "Order Customer",
      phone: "+15555550100",
      line1: "1 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90001",
      countryCode: "US",
    },
    billingAddress: {
      recipientName: "Order Customer",
      phone: "+15555550100",
      line1: "2 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90002",
      countryCode: "US",
    },
    sellerOrders: [customerSellerOrder()],
    statusHistory: [
      {
        id: historyId,
        orderId,
        sellerOrderId: null,
        fromStatus: null,
        toStatus: "pending_payment",
        reason: null,
        changedAt: now,
      },
    ],
    ...overrides,
  };
}

/** Builds one seller-scoped queue/detail representation. */
function sellerOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: sellerOrderId,
    sellerOrderNo,
    sellerId,
    storeId,
    orderId,
    orderNo,
    currency: "USD",
    subtotal: "100.0000",
    discountTotal: "10.0000",
    taxTotal: "9.0000",
    shippingTotal: "5.0000",
    grandTotal: "104.0000",
    status: "pending_acceptance",
    paymentStatus: "captured",
    fulfillmentStatus: "unfulfilled",
    createdAt: now,
    ...overrides,
  };
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 11 Orders UI", () => {
  it("renders customer parent Order history without treating Seller Orders as the customer list model", async () => {
    useActor(actor("customer", ["orders.read_own"]));
    let requestedUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: [orderSummary()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-customer-orders",
        });
      }),
    );

    await renderRoute("/orders");
    expect(await screen.findByRole("heading", { name: "Your Orders" })).toBeInTheDocument();
    expect(screen.getByText(orderNo)).toBeInTheDocument();
    expect(screen.queryByText(sellerOrderNo)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Customer Order status filter"), "confirmed");
    await waitFor(() => expect(new URL(requestedUrl).searchParams.get("orderStatus")).toBe("confirmed"));
  });

  it("renders immutable customer Order detail and sends a partial cancellation with a retry key", async () => {
    useActor(actor("customer", ["orders.read_own"]));
    let cancelBody: unknown = null;
    let idempotencyKey = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders/${orderId}`, () =>
        HttpResponse.json({ success: true, data: orderDetail(), requestId: "req-order-detail" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/orders/${orderId}/cancel`, async ({ request }) => {
        cancelBody = await request.json();
        idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({
          success: true,
          data: orderDetail({
            sellerOrders: [
              customerSellerOrder({
                items: [
                  orderItem({
                    cancelledQuantity: 1,
                    remainingQuantity: 1,
                    status: "partially_cancelled",
                  }),
                ],
              }),
            ],
          }),
          requestId: "req-order-cancel",
        });
      }),
    );

    await renderRoute(`/orders/${orderId}`);
    expect(await screen.findByRole("heading", { name: orderNo })).toBeInTheDocument();
    expect(screen.getByText("Immutable Order Product")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Order status timeline" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Order Item"), orderItemId);
    await user.type(screen.getByLabelText("Cancellation quantity"), "1");
    await user.type(screen.getByLabelText("Cancellation reason"), "Customer changed quantity");
    await user.click(screen.getByRole("button", { name: "Cancel eligible quantity" }));

    await waitFor(() => expect(cancelBody).not.toBeNull());
    expect(cancelBody).toEqual({
      items: [{ orderItemId, quantity: 1 }],
      reason: "Customer changed quantity",
    });
    expect(idempotencyKey.length).toBeGreaterThan(10);
    expect(await screen.findByText("1 remaining")).toBeInTheDocument();
  });

  it("blocks customer Order reads before calling the API when orders.read_own is missing", async () => {
    useActor(actor("customer", []));
    let orderRequests = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders`, () => {
        orderRequests += 1;
        return HttpResponse.json({ success: true, data: [], requestId: "unexpected" });
      }),
    );

    await renderRoute("/orders");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(orderRequests).toBe(0);
  });

  it("renders only seller-scoped Seller Orders and accepts one paid fulfillment unit without client status fields", async () => {
    useActor(actor("seller", ["seller.orders.read", "seller.orders.manage"]));
    let acceptBody: unknown = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/orders/${sellerOrderId}`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...sellerOrder(),
            shippingMethod: { id: shippingMethodId, code: "STANDARD", name: "Standard shipping", amount: "5.0000", currency: "USD" },
            items: [orderItem()],
            shippingAddress: orderDetail().shippingAddress,
            statusHistory: [
              {
                id: historyId,
                orderId: null,
                sellerOrderId,
                fromStatus: "pending_payment",
                toStatus: "pending_acceptance",
                reason: null,
                changedAt: now,
              },
            ],
          },
          requestId: "req-seller-order-detail",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/orders/${sellerOrderId}/accept`, async ({ request }) => {
        acceptBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            ...sellerOrder({ status: "processing" }),
            shippingMethod: { id: shippingMethodId, code: "STANDARD", name: "Standard shipping", amount: "5.0000", currency: "USD" },
            items: [orderItem()],
            shippingAddress: orderDetail().shippingAddress,
            statusHistory: [
              {
                id: historyId,
                orderId: null,
                sellerOrderId,
                fromStatus: "pending_acceptance",
                toStatus: "processing",
                reason: null,
                changedAt: now,
              },
            ],
          },
          requestId: "req-seller-order-accept",
        });
      }),
    );

    await renderRoute(`/seller/orders/${sellerOrderId}`);
    expect(await screen.findByRole("heading", { name: sellerOrderNo })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Accept Seller Order" }));
    await waitFor(() => expect(acceptBody).toEqual({}));
    expect(await screen.findByText("Processing")).toBeInTheDocument();
  });

  it("hides Seller Order acceptance when the actor has read permission but not seller.orders.manage", async () => {
    useActor(actor("seller", ["seller.orders.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/orders/${sellerOrderId}`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...sellerOrder(),
            shippingMethod: { id: shippingMethodId, code: "STANDARD", name: "Standard shipping", amount: "5.0000", currency: "USD" },
            items: [orderItem()],
            shippingAddress: orderDetail().shippingAddress,
            statusHistory: [],
          },
          requestId: "req-seller-order-readonly",
        }),
      ),
    );

    await renderRoute(`/seller/orders/${sellerOrderId}`);
    expect(await screen.findByRole("heading", { name: sellerOrderNo })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept Seller Order" })).not.toBeInTheDocument();
  });

  it("searches admin Orders with allow-listed filters and performs privileged whole-Order cancellation", async () => {
    useActor(actor("platform_admin", ["admin.orders.read", "admin.orders.cancel"]));
    let searchUrl = "";
    let cancelBody: unknown = null;
    let cancelKey = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/orders`, ({ request }) => {
        searchUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: [orderSummary()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-orders",
        });
      }),
      http.post(`${env.VITE_API_BASE_URL}/admin/orders/${orderId}/cancel`, async ({ request }) => {
        cancelBody = await request.json();
        cancelKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({ success: true, data: orderDetail({ orderStatus: "cancelled" }), requestId: "req-admin-cancel" });
      }),
    );

    await renderRoute("/admin/orders");
    expect(await screen.findByRole("heading", { name: "Order support" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Order number"), orderNo);
    await user.selectOptions(screen.getByLabelText("Order status"), "pending_payment");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const url = new URL(searchUrl);
      expect(url.searchParams.get("orderNo")).toBe(orderNo);
      expect(url.searchParams.get("orderStatus")).toBe("pending_payment");
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.type(screen.getByLabelText("Cancellation reason"), "Support cancellation");
    await user.click(screen.getByRole("button", { name: "Cancel eligible quantity" }));
    await waitFor(() => expect(cancelBody).toEqual({ reason: "Support cancellation" }));
    expect(cancelKey.length).toBeGreaterThan(10);
  });

  it("shows the safe request ID when customer Order history fails", async () => {
    useActor(actor("customer", ["orders.read_own"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/orders`, () =>
        HttpResponse.json(
          {
            success: false,
            error: {
              code: "ORDER_NOT_FOUND",
              message: "Orders are unavailable.",
            },
            requestId: "req-orders-error",
          },
          { status: 500 },
        ),
      ),
    );

    await renderRoute("/orders");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Orders are unavailable.");
    expect(alert).toHaveTextContent("Request ID: req-orders-error");
  });
});
