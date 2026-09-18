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

const userId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const savedFilterId = "44444444-4444-4444-8444-444444444444";
const resourceId = "55555555-5555-4555-8555-555555555555";
const now = "2026-09-17T09:00:00.000Z";

/** Clears the in-memory session after every isolated Dashboard frontend test. */
afterEach(() => clearAccessToken());

/** Builds one authenticated actor with deterministic seller/store scope. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: `${accountType}@example.com`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: {
      sellerIds: accountType === "seller" ? [sellerId] : [],
      storeIds: accountType === "seller" ? [storeId] : [],
    },
  };
}

/** Registers one authenticated actor for the shared /auth/me query. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module1-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-dashboard" }),
    ),
  );
}

/** Renders the Dashboard route with an isolated TanStack Query cache. */
async function renderDashboard(): Promise<void> {
  const router = createTestRouter(["/dashboard"]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Returns the complete default widget layout expected by Dashboard preferences. */
function defaultLayout() {
  return {
    widgets: [
      "executive_kpis",
      "orders_trend",
      "seller_performance",
      "operational_alerts",
      "refund_return_summary",
      "commission_payout_summary",
    ].map((widgetCode, order) => ({ widgetCode, order, visible: true })),
  };
}

/** Returns a valid preference snapshot with optional saved-filter data. */
function preferences(withSavedFilter = false) {
  return {
    id: savedFilterId,
    layout: defaultLayout(),
    defaultDateRange: "last_30_days",
    defaultStoreId: null,
    savedFilters: withSavedFilter ? [{ id: savedFilterId, name: "My scope", filters: {}, createdAt: now }] : [],
    updatedAt: now,
  };
}

/** Returns a valid summary while keeping every finance concept separate. */
function summary(finance = true, withSavedFilter = false) {
  return {
    scope: { sellerId: null, storeId: null, categoryId: null, from: null, to: null },
    orderCount: 4,
    lowStockVariantCount: 2,
    openReturnCount: 1,
    gmvByCurrency: [{ currency: "USD", amount: "1000.00" }],
    finance: finance ? {
      capturedCashByCurrency: [{ currency: "USD", amount: "900.00" }],
      refundedPaymentsByCurrency: [{ currency: "USD", amount: "50.00" }],
      marketplaceCommissionRevenueByCurrency: [{ currency: "USD", amount: "100.00" }],
      sellerPayableByCurrency: [{ currency: "USD", amount: "800.00" }],
      sellerPayoutsPaidByCurrency: [{ currency: "USD", amount: "700.00" }],
    } : null,
    preferences: preferences(withSavedFilter),
  };
}

/** Registers the four documented Dashboard read handlers for one happy-path browser test. */
function useDashboardReads(finance = true): void {
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/dashboard/summary`, () =>
      HttpResponse.json({ success: true, data: summary(finance), requestId: "req-dashboard-summary" })),
    http.get(`${env.VITE_API_BASE_URL}/dashboard/orders`, () =>
      HttpResponse.json({
        success: true,
        data: {
          scope: { sellerId: null, storeId: null, categoryId: null, from: null, to: null },
          statusCounts: [
            { status: "pending_payment", count: 0 },
            { status: "confirmed", count: 2 },
            { status: "processing", count: 2 },
            { status: "cancelled", count: 0 },
          ],
          trend: [{ bucketStart: now, currency: "USD", orderCount: 4, gmv: "1000.00" }],
        },
        requestId: "req-dashboard-orders",
      })),
    http.get(`${env.VITE_API_BASE_URL}/dashboard/sellers`, () =>
      HttpResponse.json({
        success: true,
        data: {
          scope: { sellerId: null, storeId: null, categoryId: null, from: null, to: null },
          rows: [{
            sellerId,
            sellerName: "Seller A",
            orderCount: 4,
            currency: "USD",
            gmv: "1000.00",
            finance: finance ? { commissionRevenue: "100.00", sellerPayable: "800.00", refunds: "50.00", payouts: "700.00" } : null,
          }],
        },
        meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        requestId: "req-dashboard-sellers",
      })),
    http.get(`${env.VITE_API_BASE_URL}/dashboard/alerts`, () =>
      HttpResponse.json({
        success: true,
        data: {
          scope: { sellerId: null, storeId: null, categoryId: null, from: null, to: null },
          rows: [{
            type: "fulfillment_attention",
            sellerId,
            storeId,
            resourceId,
            title: "Order needs shipment",
            message: "Seller order is waiting for fulfillment.",
            occurredAt: now,
          }],
        },
        meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        requestId: "req-dashboard-alerts",
      })),
  );
}

describe("Module 1 Dashboard React feature", () => {
  it("renders Executive KPIs, trend, seller performance, alerts, refund/return, and separate finance values", async () => {
    useActor(actor("platform_admin", [
      "dashboard.read",
      "dashboard.finance.read",
      "dashboard.seller.read",
      "dashboard.manage_preferences",
    ]));
    useDashboardReads(true);

    await renderDashboard();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Executive KPIs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Orders & GMV trend" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seller performance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operational alerts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refund & return summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Commission & payout summary" })).toBeInTheDocument();
    expect(screen.getByText("$900.00")).toBeInTheDocument();
    expect(screen.getAllByText("$100.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$800.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$700.00").length).toBeGreaterThan(0);
  });

  it("keeps seller identity server-derived and hides finance values without finance permission", async () => {
    useActor(actor("seller", ["dashboard.read", "dashboard.seller.read", "dashboard.manage_preferences"]));
    let summarySearch = "";
    useDashboardReads(false);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/dashboard/summary`, ({ request }) => {
        summarySearch = new URL(request.url).search;
        return HttpResponse.json({ success: true, data: summary(false), requestId: "req-seller-dashboard" });
      }),
    );

    await renderDashboard();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Dashboard seller UUID")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Finance-sensitive Dashboard values are hidden for this account.", { exact: false }),
    ).toBeInTheDocument();
    await waitFor(() => expect(summarySearch).not.toContain("sellerId="));
    expect(screen.getAllByText("Restricted").length).toBeGreaterThan(0);
  });

  it("persists saved filters through the single documented preferences command without sending user identity", async () => {
    useActor(actor("platform_admin", ["dashboard.read", "dashboard.seller.read", "dashboard.manage_preferences"]));
    useDashboardReads(false);
    let updateBody: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${env.VITE_API_BASE_URL}/dashboard/preferences`, async ({ request }) => {
        updateBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: preferences(true), requestId: "req-dashboard-preferences" });
      }),
    );

    await renderDashboard();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Saved Dashboard filter name"), "My scope");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));

    await waitFor(() => expect(updateBody).not.toBeNull());
    expect(updateBody).not.toHaveProperty("userId");
    expect(updateBody).toHaveProperty("savedFilters");
  });

  it("renders the backend widget-unavailable state instead of fabricating unsupported category history", async () => {
    useActor(actor("platform_admin", ["dashboard.read"]));
    useDashboardReads(false);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/dashboard/summary`, ({ request }) => {
        if (new URL(request.url).searchParams.has("categoryId")) {
          return HttpResponse.json({
            success: false,
            error: { code: "DASHBOARD_WIDGET_UNAVAILABLE", message: "Historical category reporting is unavailable." },
            requestId: "req-dashboard-category",
          }, { status: 409 });
        }
        return HttpResponse.json({ success: true, data: summary(false), requestId: "req-dashboard-summary" });
      }),
    );

    await renderDashboard();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Dashboard category UUID"), savedFilterId);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("heading", { name: "Widget unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Historical category reporting is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-dashboard-category")).toBeInTheDocument();
  });

  it("denies the page before Dashboard reads when the authenticated actor lacks dashboard.read", async () => {
    useActor(actor("customer", []));
    await renderDashboard();
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.getByText("Your account does not have permission to view the Dashboard.")).toBeInTheDocument();
  });
});
