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
const orderId = "44444444-4444-4444-8444-444444444444";
const sellerOrderId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const fileId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-17T08:00:00.000Z";

/** Clears session and browser-local saved-filter presets after each isolated test. */
afterEach(() => {
  clearAccessToken();
  window.localStorage.clear();
});

/** Builds one authenticated actor with the exact permissions needed by a test. */
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
  setAccessToken("module20-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-reports" }),
    ),
  );
}

/** Renders one Reports route with an isolated router and TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Returns one empty paginated report response with server pagination metadata. */
function emptyPage(data: Record<string, unknown>) {
  return HttpResponse.json({
    success: true,
    data,
    meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    requestId: "req-report-page",
  });
}

/** Returns one valid Sales report response that keeps the three money concepts separate. */
function salesPage() {
  return HttpResponse.json({
    success: true,
    data: {
      summary: {
        orderCount: 1,
        sellerOrderCount: 1,
        gmvByCurrency: [{ currency: "USD", amount: "100.00" }],
        capturedCashByCurrency: [{ currency: "USD", amount: "95.00" }],
        refundsByCurrency: [{ currency: "USD", amount: "5.00" }],
      },
      rows: [{
        orderId,
        orderNo: "ORD-1001",
        sellerOrderId,
        sellerOrderNo: "SO-1001-A",
        sellerId,
        storeId,
        orderStatus: "confirmed",
        sellerOrderStatus: "processing",
        currency: "USD",
        grandTotal: "100.00",
        createdAt: now,
      }],
    },
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    requestId: "req-sales-report",
  });
}

/** Builds one report-run response for queued or completed export states. */
function reportRun(status: "queued" | "completed") {
  return {
    id: runId,
    reportCode: "sales",
    filters: { currency: "USD" },
    outputFormat: "csv",
    status,
    errorCode: null,
    createdAt: now,
    startedAt: status === "completed" ? now : null,
    finishedAt: status === "completed" ? now : null,
    download: status === "completed"
      ? {
          fileId,
          downloadUrl: "https://files.example.test/report.csv",
          expiresAt: "2026-09-17T08:10:00.000Z",
        }
      : null,
  };
}

describe("Module 20 Reports & Analytics React feature", () => {
  it("renders the permission-filtered report catalog including the approved audit export owner", async () => {
    useActor(actor("platform_admin", ["reports.sales.read", "reports.export"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/reports/catalog`, () =>
        HttpResponse.json({
          success: true,
          data: [
            { code: "sales", domain: "sales", requiredPermissions: ["reports.sales.read"], outputFormats: ["csv", "pdf"], status: "active" },
            { code: "audit_log", domain: "audit", requiredPermissions: ["audit.read", "audit.export"], outputFormats: ["csv", "pdf"], status: "active" },
          ],
          requestId: "req-report-catalog",
        }),
      ),
    );

    await renderRoute("/reports");
    expect(await screen.findByRole("heading", { name: "Report catalog" })).toBeInTheDocument();
    expect(screen.getByText("Sales & orders")).toBeInTheDocument();
    expect(screen.getByText("Audit log export")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open report" })).toHaveLength(2);
  });

  it("shows durable requester-owned export history loaded from the server", async () => {
    useActor(actor("platform_admin", ["reports.export"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/reports/catalog`, () =>
        HttpResponse.json({ success: true, data: [], requestId: "req-report-catalog-empty" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/reports/runs`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("page")).toBe("1");
        expect(url.searchParams.get("pageSize")).toBe("6");
        return HttpResponse.json({
          success: true,
          data: [reportRun("completed")],
          meta: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1 },
          requestId: "req-report-history",
        });
      }),
    );

    await renderRoute("/reports");
    expect(await screen.findByRole("heading", { name: "Recent exports" })).toBeInTheDocument();
    expect(await screen.findByText("completed")).toBeInTheDocument();
    expect(screen.getByText(/across browsers and devices/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      `/reports/runs/${runId}`,
    );
  });

  it("keeps seller scope server-derived while showing GMV, captured cash, and refunds separately", async () => {
    useActor(actor("seller", ["reports.sales.read"]));
    let lastSearch = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/reports/sales`, ({ request }) => {
        lastSearch = new URL(request.url).search;
        return salesPage();
      }),
    );

    await renderRoute("/reports/sales");
    expect(await screen.findByRole("heading", { name: "Sales & orders report" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Report seller UUID")).not.toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("$95.00")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Report currency"), "usd");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(lastSearch).toContain("currency=USD"));
    expect(lastSearch).not.toContain("sellerId=");
  });

  it("queues an export without pagination or sort and follows the requester-owned run to a signed download", async () => {
    useActor(actor("platform_admin", ["reports.sales.read", "reports.export"]));
    let exportBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/reports/sales`, () => salesPage()),
      http.post(`${env.VITE_API_BASE_URL}/reports/runs`, async ({ request }) => {
        exportBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: reportRun("queued"), requestId: "req-report-run-create" }, { status: 202 });
      }),
      http.get(`${env.VITE_API_BASE_URL}/reports/runs/${runId}`, () =>
        HttpResponse.json({ success: true, data: reportRun("completed"), requestId: "req-report-run-read" }),
      ),
    );

    await renderRoute("/reports/sales");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Report currency"), "USD");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(exportBody).toEqual({
      reportCode: "sales",
      filters: { currency: "USD" },
      outputFormat: "csv",
    }));
    expect(exportBody).not.toHaveProperty("page");
    expect(exportBody).not.toHaveProperty("pageSize");
    expect(exportBody).not.toHaveProperty("sort");
    expect(await screen.findByRole("heading", { name: "Sales & orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download export" })).toHaveAttribute("href", "https://files.example.test/report.csv");
  });

  it("supports browser-local saved filters without inventing a saved-filter API route", async () => {
    useActor(actor("platform_admin", ["reports.inventory.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/reports/inventory`, () => emptyPage({ rows: [] })),
    );

    await renderRoute("/reports/inventory");
    expect(await screen.findByRole("heading", { name: "Inventory & low stock" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Report low stock filter"), "true");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await user.type(screen.getByLabelText("Saved report filter name"), "Low stock");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));

    expect(screen.getByRole("button", { name: "Low stock" })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(1);
  });

  it("adds the approved Audit export action through Module 20 instead of inventing an Audit export route", async () => {
    useActor(actor("platform_admin", ["audit.read", "audit.export", "reports.export"]));
    let exportBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/audit`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-audit-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/reports/runs`, async ({ request }) => {
        exportBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: { ...reportRun("queued"), reportCode: "audit_log" },
          requestId: "req-audit-export",
        }, { status: 202 });
      }),
      http.get(`${env.VITE_API_BASE_URL}/reports/runs/${runId}`, () =>
        HttpResponse.json({
          success: true,
          data: { ...reportRun("completed"), reportCode: "audit_log" },
          requestId: "req-audit-export-read",
        }),
      ),
    );

    await renderRoute("/audit");
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(exportBody).toEqual({ reportCode: "audit_log", filters: {}, outputFormat: "pdf" }));
  });
});
