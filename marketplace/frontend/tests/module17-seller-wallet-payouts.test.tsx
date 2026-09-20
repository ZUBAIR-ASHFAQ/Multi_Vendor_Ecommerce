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

const sellerId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const walletEntryId = "33333333-3333-4333-8333-333333333333";
const commissionEntryId = "44444444-4444-4444-8444-444444444444";
const accountId = "55555555-5555-4555-8555-555555555555";
const payoutId = "66666666-6666-4666-8666-666666666666";
const now = "2026-09-15T10:00:00.000Z";

/** Clears the authenticated browser session after each isolated Module 17 UI test. */
afterEach(() => clearAccessToken());

/** Builds one seller or platform-admin actor with an explicit permission set. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: sellerId,
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

/** Registers the authenticated user returned by the shared auth endpoint. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module17-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-wallet" }),
    ),
  );
}

/** Builds the safe seller Wallet response shared by Wallet/Payout page tests. */
function walletResponse() {
  return {
    wallets: [{
      sellerId,
      currency: "USD",
      pendingBalance: "25.0000",
      availableBalance: "75.0000",
      heldBalance: "0.0000",
      negativeBalance: "0.0000",
      updatedAt: now,
    }],
    entries: [{
      id: walletEntryId,
      sellerId,
      currency: "USD",
      type: "commission_credit",
      amount: "100.0000",
      balanceBucket: "pending",
      sourceType: "commission_entry",
      sourceId: commissionEntryId,
      occurredAt: now,
    }],
    payoutAccounts: [{
      id: accountId,
      sellerId,
      providerType: "test_provider",
      maskedDetails: "Account •••• 4242",
      status: "active",
      verifiedAt: now,
    }],
    payoutSummaries: [{
      currency: "USD",
      lifetimePaidAmount: "40.0000",
      inProgressAmount: "10.5000",
      inProgressCount: 1,
    }],
  };
}

/** Builds one safe Payout projection with immutable Wallet allocation evidence. */
function payout(status: "requested" | "approved" | "processing" | "paid" | "failed" = "requested") {
  return {
    id: payoutId,
    payoutNo: "PAY-66666666666646668666666666666666",
    sellerId,
    amount: "10.5000",
    currency: "USD",
    accountId,
    status,
    requestedAt: now,
    processedAt: status === "paid" || status === "failed" ? now : null,
    providerRef: status === "paid" ? "provider-payout-1" : null,
    allocations: status === "requested" ? [] : [{ walletEntryId, amount: "10.5000" }],
  };
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 17 Seller Wallet & Payouts React feature", () => {
  it("renders separate Wallet buckets and submits only tokenized payout-account input", async () => {
    useActor(actor("seller", [
      "seller.wallet.read",
      "seller.payout.request",
      "seller.payout_account.manage",
    ]));
    let accountBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/wallet`, () =>
        HttpResponse.json({
          success: true,
          data: walletResponse(),
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-wallet-read",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/payout-accounts`, async ({ request }) => {
        accountBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: walletResponse().payoutAccounts[0],
          requestId: "req-account-create",
        }, { status: 201 });
      }),
    );

    await renderRoute("/seller/wallet");
    expect(await screen.findByRole("heading", { name: "Seller wallet" })).toBeInTheDocument();
    expect(screen.getByText("$75.00")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText("Commission credit")).toBeInTheDocument();
    expect(screen.getByText("Account •••• 4242")).toBeInTheDocument();
    expect(screen.queryByText(/provider_account_ref/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payout provider type"), "test_provider");
    await user.type(screen.getByLabelText("Provider account reference"), "acct_tokenized_123");
    await user.click(screen.getByRole("button", { name: "Add Payout Account" }));

    await waitFor(() => expect(accountBody).toEqual({
      providerType: "test_provider",
      providerAccountRef: "acct_tokenized_123",
    }));
    expect(accountBody).not.toHaveProperty("accountNumber");
    expect(accountBody).not.toHaveProperty("routingNumber");
  });

  it("requests a Payout with normalized scale-4 money and a fresh retry-safe key without client-owned seller/status fields", async () => {
    useActor(actor("seller", ["seller.wallet.read", "seller.payout.request"]));
    let requestBody: Record<string, unknown> | null = null;
    let idempotencyKey = "";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/wallet`, () =>
        HttpResponse.json({
          success: true,
          data: walletResponse(),
          meta: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
          requestId: "req-wallet-for-payout",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/seller/payouts`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-payout-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/payouts`, async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>;
        idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({ success: true, data: payout("requested"), requestId: "req-payout-create" }, { status: 201 });
      }),
    );

    await renderRoute("/seller/payouts");
    expect(await screen.findByRole("heading", { name: "Seller payouts" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Payout amount"), "10.5");
    await user.click(screen.getByRole("button", { name: "Request Payout" }));

    await waitFor(() => expect(idempotencyKey.length).toBeGreaterThan(10));
    expect(requestBody).toEqual({ accountId, amount: "10.5000", currency: "USD" });
    expect(requestBody).not.toHaveProperty("sellerId");
    expect(requestBody).not.toHaveProperty("status");
    expect(requestBody).not.toHaveProperty("availableBalance");
  });

  it("shows authoritative payout aggregates to a read-only seller without exposing the request command", async () => {
    useActor(actor("seller", ["seller.wallet.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/wallet`, () =>
        HttpResponse.json({
          success: true,
          data: walletResponse(),
          meta: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
          requestId: "req-wallet-payout-summary",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/seller/payouts`, () =>
        HttpResponse.json({
          success: true,
          data: [payout("processing")],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-payout-summary-list",
        }),
      ),
    );

    await renderRoute("/seller/payouts");
    expect(await screen.findByRole("heading", { name: "Seller payouts" })).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getAllByText("$10.50").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("The provider operation is in progress or awaiting reconciliation.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request Payout" })).not.toBeInTheDocument();
  });

  it("sends finance approve with an empty command body and retry-safe key while showing reconciliation detail", async () => {
    useActor(actor("platform_admin", ["admin.payouts.read", "admin.payouts.manage"]));
    let approveBody: Record<string, unknown> | null = null;
    let idempotencyKey = "";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/payouts`, () =>
        HttpResponse.json({
          success: true,
          data: [payout("requested")],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-payouts",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/payouts/${payoutId}/approve`, async ({ request }) => {
        approveBody = await request.json() as Record<string, unknown>;
        idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({ success: true, data: payout("approved"), requestId: "req-admin-approve" });
      }),
    );

    await renderRoute("/admin/payouts");
    expect(await screen.findByRole("heading", { name: "Finance payout queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payout reconciliation detail" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Approve & Reserve" }));

    await waitFor(() => expect(idempotencyKey.length).toBeGreaterThan(10));
    expect(approveBody).toEqual({});
  });


  it("sends a provider Payout command with an empty body and a fresh retry-safe key", async () => {
    useActor(actor("platform_admin", ["admin.payouts.read", "admin.payouts.manage"]));
    let sendBody: Record<string, unknown> | null = null;
    let idempotencyKey = "";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/payouts`, () =>
        HttpResponse.json({
          success: true,
          data: [payout("approved")],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-send-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/payouts/${payoutId}/send`, async ({ request }) => {
        sendBody = await request.json() as Record<string, unknown>;
        idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({ success: true, data: payout("paid"), requestId: "req-admin-send" });
      }),
    );

    await renderRoute("/admin/payouts");
    expect(await screen.findByRole("button", { name: "Send Payout" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send Payout" }));

    await waitFor(() => expect(idempotencyKey.length).toBeGreaterThan(10));
    expect(sendBody).toEqual({});
  });

  it("refreshes finance Payout state after a provider error because the backend may have persisted failed or processing", async () => {
    useActor(actor("platform_admin", ["admin.payouts.read", "admin.payouts.manage"]));
    let listReads = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/payouts`, () => {
        listReads += 1;
        return HttpResponse.json({
          success: true,
          data: [payout("approved")],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: `req-admin-refresh-${listReads}`,
        });
      }),
      http.post(`${env.VITE_API_BASE_URL}/admin/payouts/${payoutId}/send`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "PAYOUT_PROVIDER_ERROR", message: "Provider result needs reconciliation." },
            requestId: "req-admin-send-uncertain",
          },
          { status: 502 },
        ),
      ),
    );

    await renderRoute("/admin/payouts");
    expect(await screen.findByRole("button", { name: "Send Payout" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send Payout" }));

    await waitFor(() => expect(listReads).toBeGreaterThan(1));
  });

  it("shows a readable seller permission state without calling the Wallet API", async () => {
    useActor(actor("seller", ["seller.orders.read"]));
    let called = false;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/wallet`, () => {
        called = true;
        return HttpResponse.json({ success: true, data: walletResponse(), requestId: "req-unexpected" });
      }),
    );

    await renderRoute("/seller/wallet");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(called).toBe(false);
  });
});
