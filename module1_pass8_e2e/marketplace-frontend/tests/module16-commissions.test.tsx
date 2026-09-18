import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const actorId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const otherSellerId = "33333333-3333-4333-8333-333333333333";
const ruleId = "44444444-4444-4444-8444-444444444444";
const sellerOrderId = "55555555-5555-4555-8555-555555555555";
const orderItemId = "66666666-6666-4666-8666-666666666666";
const entryId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-14T08:00:00.000Z";

/** Clears the synthetic session used by focused Module 16 frontend tests. */
afterEach(() => clearAccessToken());

/** Builds one deterministic platform or seller actor for Commission UI tests. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: actorId,
    email: `${accountType}@example.test`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: accountType === "seller" ? { sellerIds: [sellerId], storeIds: [] } : { sellerIds: [], storeIds: [] },
  };
}

/** Registers the authenticated actor response used by protected Commission pages. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module16-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-commissions" }),
    ),
  );
}

/** Returns one valid future-effective Commission rule. */
function commissionRule() {
  return {
    id: ruleId,
    priority: 100,
    scopeType: "seller" as const,
    scopeId: sellerId,
    ratePercent: "10.000000",
    fixedFee: "1.0000",
    fundingRulesJson: null,
    startAt: "2026-09-15T10:00:00.000Z",
    endAt: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns one immutable Commission sale entry. */
function commissionEntry() {
  return {
    id: entryId,
    sellerId,
    sellerOrderId,
    orderItemId,
    type: "sale" as const,
    grossAmount: "100.0000",
    commissionAmount: "11.0000",
    sellerNetAmount: "89.0000",
    currency: "USD",
    occurredAt: now,
    createdAt: now,
  };
}

/** Renders one real application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 16 Commissions UI", () => {
  it("shows the rule manager read-only when admin.commissions.manage is missing", async () => {
    useActor(actor("platform_admin", ["admin.commissions.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/commissions/rules`, () =>
        HttpResponse.json({
          success: true,
          data: [commissionRule()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-commission-rules",
        }),
      ),
    );

    await renderRoute("/admin/commissions/rules");

    expect(await screen.findByRole("heading", { name: "Commission rule manager" })).toBeInTheDocument();
    expect(screen.getByText("10.000000%")).toBeInTheDocument();
    expect(screen.getByLabelText("Commission rule status filter")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Inactive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create rule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit future rule" })).not.toBeInTheDocument();
  });

  it("creates a future-effective rule with TanStack Form values and only documented fields", async () => {
    useActor(actor("platform_admin", ["admin.commissions.read", "admin.commissions.manage"]));
    let requestBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/commissions/rules`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-empty-rules",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/commissions/rules`, async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: commissionRule(), requestId: "req-rule-created" }, { status: 201 });
      }),
    );

    await renderRoute("/admin/commissions/rules");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create rule" }));
    await user.selectOptions(screen.getByLabelText("Commission rule scope"), "seller");
    await user.type(screen.getByLabelText("Commission rule scope UUID"), sellerId);
    await user.clear(screen.getByLabelText("Commission rate percent"));
    await user.type(screen.getByLabelText("Commission rate percent"), "10.000000");
    await user.type(screen.getByLabelText("Commission fixed fee"), "1.0000");
    await user.selectOptions(screen.getByLabelText("Commission rule status"), "inactive");
    fireEvent.change(screen.getByLabelText("Commission rule start time"), {
      target: { value: "2026-09-15T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(requestBody).not.toBeNull());
    expect(requestBody).toMatchObject({
      priority: 0,
      scopeType: "seller",
      scopeId: sellerId,
      ratePercent: "10.000000",
      fixedFee: "1.0000",
      status: "inactive",
    });
    expect(requestBody).not.toHaveProperty("fundingRulesJson");
    expect(requestBody).not.toHaveProperty("sellerNetAmount");
    expect(requestBody).not.toHaveProperty("commissionAmount");
  });

  it("updates a future-effective rule without overwriting funding metadata the UI does not own", async () => {
    useActor(actor("platform_admin", ["admin.commissions.read", "admin.commissions.manage"]));
    let requestBody: Record<string, unknown> | null = null;
    const rule = { ...commissionRule(), fundingRulesJson: { owner: "server-history" } };
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/commissions/rules`, () =>
        HttpResponse.json({
          success: true,
          data: [rule],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-rule-for-edit",
        }),
      ),
      http.patch(`${env.VITE_API_BASE_URL}/admin/commissions/rules/${ruleId}`, async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { ...rule, ratePercent: "12.000000" }, requestId: "req-rule-updated" });
      }),
    );

    await renderRoute("/admin/commissions/rules");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit future rule" }));
    await user.clear(screen.getByLabelText("Commission rate percent"));
    await user.type(screen.getByLabelText("Commission rate percent"), "12.000000");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(requestBody).not.toBeNull());
    expect(requestBody).not.toHaveProperty("fundingRulesJson");
    expect(requestBody).toMatchObject({ ratePercent: "12.000000", scopeId: sellerId });
  });

  it("reads the seller statement without ever sending a sellerId query parameter", async () => {
    useActor(actor("seller", ["seller.commissions.read"]));
    let requestedUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/commissions`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: {
            sellerId,
            summaries: [
              {
                currency: "USD",
                grossAmount: "100.0000",
                sellerFundedDiscountAmount: "0.0000",
                commissionAmount: "11.0000",
                refundAdjustmentAmount: "0.0000",
                sellerNetAmount: "89.0000",
              },
            ],
            entries: [commissionEntry()],
          },
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-seller-commission",
        });
      }),
    );

    await renderRoute("/seller/commissions");

    expect(await screen.findByRole("heading", { name: "Seller fee statement" })).toBeInTheDocument();
    expect(screen.getByText("89.0000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Per-order Commission breakdown" })).toBeInTheDocument();
    const url = new URL(requestedUrl);
    expect(url.searchParams.has("sellerId")).toBe(false);
  });

  it("blocks seller Commission reads before the API call when seller.commissions.read is missing", async () => {
    useActor(actor("seller", []));
    let statementCalls = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/commissions`, () => {
        statementCalls += 1;
        return HttpResponse.json({ success: true, data: {}, requestId: "unexpected-statement" });
      }),
    );

    await renderRoute("/seller/commissions");

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(statementCalls).toBe(0);
  });

  it("filters the finance Commission ledger with allow-listed values and shows immutable entries", async () => {
    useActor(actor("platform_admin", ["admin.commissions.read"]));
    let requestedUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/commissions/entries`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: [commissionEntry()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-commission-ledger",
        });
      }),
    );

    await renderRoute("/admin/commissions/entries");
    expect(await screen.findByRole("heading", { name: "Finance Commission ledger" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Finance Commission seller UUID"), otherSellerId);
    await user.selectOptions(screen.getByLabelText("Finance Commission entry type filter"), "sale");
    await user.type(screen.getByLabelText("Finance Commission currency filter"), "usd");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      const url = new URL(requestedUrl);
      expect(url.searchParams.get("sellerId")).toBe(otherSellerId);
      expect(url.searchParams.get("type")).toBe("sale");
      expect(url.searchParams.get("currency")).toBe("USD");
    });
    expect(screen.getByText("11.0000 USD")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
