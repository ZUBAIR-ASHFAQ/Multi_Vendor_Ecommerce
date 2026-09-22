import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { isCheckoutPath, isWorkspacePath } from "@/components/layout/app-shell";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { createQueryClient } from "@/lib/query-client";
import { server } from "./setup/msw-server";

const userId = "11111111-1111-4111-8111-111111111111";
const now = "2026-09-20T06:00:00.000Z";

afterEach(() => clearAccessToken());

async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
  return router;
}

function checkoutCustomer(): AuthenticatedUser {
  return {
    id: userId,
    email: "checkout@example.com",
    displayName: "Checkout Customer",
    accountType: "customer",
    status: "active",
    roles: [],
    permissions: ["checkout.create_own", "cart.manage_own", "customer.address.manage_own"],
    scopes: { sellerIds: [], storeIds: [] },
  };
}

describe("global marketplace shell", () => {
  it("classifies checkout, public seller application, and operational workspace paths without changing route ownership", () => {
    expect(isCheckoutPath("/checkout")).toBe(true);
    expect(isCheckoutPath("/cart")).toBe(false);
    expect(isWorkspacePath("/dashboard")).toBe(true);
    expect(isWorkspacePath("/admin/orders")).toBe(true);
    expect(isWorkspacePath("/seller/products")).toBe(true);
    expect(isWorkspacePath("/reports/sales")).toBe(true);
    expect(isWorkspacePath("/documents")).toBe(true);
    expect(isWorkspacePath("/audit/11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isWorkspacePath("/seller/apply")).toBe(false);
  });

  it("renders the public marketplace chrome and routes header searches through existing typed Search URL state", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/search/products`, () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [],
            facets: {
              categories: [],
              brands: [],
              attributes: [],
              price: null,
              availability: { inStock: 0, outOfStock: 0 },
            },
          },
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-shell-search",
        }),
      ),
    );

    const router = await renderRoute("/");

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Global navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Footer navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Mobile marketplace navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/products");

    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search marketplace" }), "a");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
      expect(router.state.location.search.q).toBe("a");
      expect(router.state.location.search.sort).toBe("relevance");
      expect(router.state.location.search.page).toBe(1);
      expect(router.state.location.search.pageSize).toBe(20);
    });
  });


  it("restores a refresh-cookie session in the global shell and then loads customer header state", async () => {
    let currentUserCalls = 0;
    let refreshCalls = 0;
    const customer: AuthenticatedUser = {
      id: userId,
      email: "buyer@example.com",
      displayName: "Buyer Example",
      accountType: "customer",
      status: "active",
      roles: [],
      permissions: [
        "cart.manage_own",
        "wishlist.manage_own",
        "orders.read_own",
        "notifications.read_own",
      ],
      scopes: { sellerIds: [], storeIds: [] },
    };

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, ({ request }) => {
        currentUserCalls += 1;
        if (request.headers.get("Authorization") !== "Bearer refreshed-shell-token") {
          return HttpResponse.json(
            {
              success: false,
              error: { code: "AUTH_REQUIRED", message: "Authentication is required." },
              requestId: "req-shell-me-before-refresh",
            },
            { status: 401 },
          );
        }
        return HttpResponse.json({ success: true, data: customer, requestId: "req-shell-me-after-refresh" });
      }),
      http.post(`${env.VITE_API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({
          success: true,
          data: { accessToken: "refreshed-shell-token" },
          requestId: "req-shell-refresh",
        });
      }),
      http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: "22222222-2222-4222-8222-222222222222",
            currency: "USD",
            items: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                productId: "44444444-4444-4444-8444-444444444444",
                variantId: "55555555-5555-4555-8555-555555555555",
                productName: "Shell Product",
                productSlug: "shell-product",
                storeId: "66666666-6666-4666-8666-666666666666",
                storeSlug: "shell-store",
                storeName: "Shell Store",
                thumbnailFileId: null,
                variantTitle: "Default",
                sku: "SHELL-1",
                currentUnitPrice: "10.00",
                currency: "USD",
                quantity: 2,
                previewLineSubtotal: "20.00",
                inStock: true,
                isPurchasable: true,
                addedAt: now,
                updatedAt: now,
              },
            ],
            previewSubtotal: "20.00",
            hasUnavailableItems: false,
            updatedAt: now,
          },
          requestId: "req-shell-restored-cart",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/notifications`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 1, totalItems: 0, totalPages: 0, unreadCount: 3 },
          requestId: "req-shell-restored-notifications",
        }),
      ),
    );

    await renderRoute("/login");

    expect(await screen.findByRole("link", { name: "Mini Cart with 2 items" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Notifications, 3 unread")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.getAllByRole("link", { name: "Wishlist" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(refreshCalls).toBe(1);
    expect(currentUserCalls).toBe(2);
  });

  it("uses enclosed checkout chrome without the marketplace footer or mobile navigation", async () => {
    setAccessToken("patch002-checkout-token");
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: checkoutCustomer(), requestId: "req-shell-auth" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: "22222222-2222-4222-8222-222222222222",
            currency: "USD",
            items: [],
            previewSubtotal: "0.0000",
            hasUnavailableItems: false,
            updatedAt: now,
          },
          requestId: "req-shell-cart",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json({ success: true, data: [], requestId: "req-shell-addresses" }),
      ),
    );

    await renderRoute("/checkout");

    expect(screen.getByLabelText("Secure checkout")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to cart" })).toHaveAttribute("href", "/cart");
    expect(screen.queryByRole("navigation", { name: "Global navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Footer navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Mobile marketplace navigation" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeInTheDocument();
  });
});
