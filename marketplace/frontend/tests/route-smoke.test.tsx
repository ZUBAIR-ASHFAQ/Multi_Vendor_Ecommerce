import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { createQueryClient } from "@/lib/query-client";
import { server } from "./setup/msw-server";

type RouteAudience = "public" | "customer" | "seller" | "admin";

interface RouteSmokeCase {
  path: string;
  audience: RouteAudience;
}

const smokeUuid = "11111111-1111-4111-8111-111111111111";

/** Every application route is represented here so route registration changes cannot silently skip smoke coverage. */
const routeSmokeCases: RouteSmokeCase[] = [
  { path: "/", audience: "public" },
  { path: "/login", audience: "public" },
  { path: "/register", audience: "public" },
  { path: "/products", audience: "public" },
  { path: "/products/$slug", audience: "public" },
  { path: "/search", audience: "public" },
  { path: "/search/stores", audience: "public" },
  { path: "/stores/$slug", audience: "public" },

  { path: "/account", audience: "customer" },
  { path: "/cart", audience: "customer" },
  { path: "/wishlist", audience: "customer" },
  { path: "/checkout", audience: "customer" },
  { path: "/orders", audience: "customer" },
  { path: "/orders/$orderId", audience: "customer" },
  { path: "/orders/$orderId/shipping", audience: "customer" },
  { path: "/orders/$orderId/returns/$sellerOrderId/new", audience: "customer" },
  { path: "/orders/$orderId/reviews/$orderItemId/new", audience: "customer" },
  { path: "/returns", audience: "customer" },
  { path: "/notifications", audience: "customer" },
  { path: "/notifications/preferences", audience: "customer" },
  { path: "/customer/profile", audience: "customer" },
  { path: "/customer/addresses", audience: "customer" },
  { path: "/payments/orders/$orderId", audience: "customer" },
  { path: "/seller/apply", audience: "customer" },

  { path: "/seller/catalog-taxonomy", audience: "seller" },
  { path: "/seller/commissions", audience: "seller" },
  { path: "/seller/inventory", audience: "seller" },
  { path: "/seller/inventory/$variantId/manage", audience: "seller" },
  { path: "/seller/inventory/$variantId/movements", audience: "seller" },
  { path: "/seller/orders", audience: "seller" },
  { path: "/seller/orders/$sellerOrderId", audience: "seller" },
  { path: "/seller/orders/$sellerOrderId/shipping", audience: "seller" },
  { path: "/seller/products", audience: "seller" },
  { path: "/seller/products/new", audience: "seller" },
  { path: "/seller/products/$productId", audience: "seller" },
  { path: "/seller/promotions", audience: "seller" },
  { path: "/seller/returns", audience: "seller" },
  { path: "/seller/wallet", audience: "seller" },
  { path: "/seller/payouts", audience: "seller" },
  { path: "/seller/profile", audience: "seller" },
  { path: "/seller/stores", audience: "seller" },
  { path: "/seller/staff", audience: "seller" },
  { path: "/seller/shipments", audience: "seller" },

  { path: "/dashboard", audience: "admin" },
  { path: "/admin/users", audience: "admin" },
  { path: "/admin/users/$userId", audience: "admin" },
  { path: "/admin/roles", audience: "admin" },
  { path: "/admin/roles/$roleId", audience: "admin" },
  { path: "/admin/settings", audience: "admin" },
  { path: "/admin/catalog/categories", audience: "admin" },
  { path: "/admin/catalog/brands", audience: "admin" },
  { path: "/admin/catalog/attributes", audience: "admin" },
  { path: "/admin/catalog/category-attributes", audience: "admin" },
  { path: "/admin/customers", audience: "admin" },
  { path: "/admin/customers/$customerId", audience: "admin" },
  { path: "/admin/commissions/rules", audience: "admin" },
  { path: "/admin/commissions/entries", audience: "admin" },
  { path: "/admin/notification-deliveries", audience: "admin" },
  { path: "/admin/orders", audience: "admin" },
  { path: "/admin/payments", audience: "admin" },
  { path: "/admin/payments/$paymentId", audience: "admin" },
  { path: "/admin/products", audience: "admin" },
  { path: "/admin/products/$productId", audience: "admin" },
  { path: "/admin/promotions", audience: "admin" },
  { path: "/admin/returns", audience: "admin" },
  { path: "/admin/reviews", audience: "admin" },
  { path: "/admin/payouts", audience: "admin" },
  { path: "/admin/seller-applications", audience: "admin" },
  { path: "/admin/sellers/suspend", audience: "admin" },
  { path: "/reports", audience: "admin" },
  { path: "/reports/sales", audience: "admin" },
  { path: "/reports/sellers", audience: "admin" },
  { path: "/reports/inventory", audience: "admin" },
  { path: "/reports/refunds", audience: "admin" },
  { path: "/reports/commissions", audience: "admin" },
  { path: "/reports/payouts", audience: "admin" },
  { path: "/reports/runs/$runId", audience: "admin" },
  { path: "/documents", audience: "admin" },
  { path: "/audit", audience: "admin" },
  { path: "/audit/$auditId", audience: "admin" },
];


/** Reads the route modules so new or removed route declarations must update the smoke matrix. */
function declaredRoutePaths(): string[] {
  const routesDirectory = resolve(process.cwd(), "src/app/routes");
  return readdirSync(routesDirectory)
    .filter((fileName) => fileName.endsWith(".tsx"))
    .flatMap((fileName) => {
      const source = readFileSync(resolve(routesDirectory, fileName), "utf8");
      return [...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]);
    });
}

/** Builds a minimal authenticated actor that exercises route guards without granting feature data access. */
function actorFor(audience: Exclude<RouteAudience, "public">): AuthenticatedUser {
  return {
    id: smokeUuid,
    email: `${audience}@route-smoke.test`,
    displayName: `${audience} route smoke`,
    accountType: audience === "admin" ? "platform_admin" : audience,
    status: "active",
    roles: [],
    permissions: [],
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Replaces typed path parameters with harmless deterministic values. */
function materializePath(path: string): string {
  return path.replace(/\$slug\b/g, "route-smoke").replace(/\$[A-Za-z][A-Za-z0-9_]*/g, smokeUuid);
}

/** Keeps smoke tests focused on route rendering by returning one fast controlled error for feature reads. */
function blockedFeatureResponse() {
  return HttpResponse.json(
    {
      success: false,
      error: {
        code: "ROUTE_SMOKE_DATA_BLOCKED",
        message: "Feature data is intentionally blocked by the route smoke suite.",
      },
      requestId: "req-route-smoke-feature",
    },
    { status: 403 },
  );
}

/** Installs only the auth identity needed by the route plus a controlled fallback for feature reads. */
function useRouteSmokeApi(audience: RouteAudience): void {
  const fallback = http.all(`${env.VITE_API_BASE_URL}/*`, blockedFeatureResponse);

  if (audience === "public") {
    server.use(fallback);
    return;
  }

  const actor = actorFor(audience);
  setAccessToken("route-smoke-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: actor, requestId: "req-route-smoke-auth" }),
    ),
    fallback,
  );
}

afterEach(() => {
  clearAccessToken();
  window.localStorage.clear();
});

describe("application route smoke coverage", () => {
  it("tracks every route declared by the application", () => {
    const declaredPaths = declaredRoutePaths();
    const smokePaths = routeSmokeCases.map((route) => route.path);

    expect(declaredPaths).toHaveLength(80);
    expect(new Set(smokePaths).size).toBe(smokePaths.length);
    expect([...new Set(smokePaths)].sort()).toEqual([...new Set(declaredPaths)].sort());
  });

  it.each(routeSmokeCases)("renders $path without falling through the application error boundary", async ({ path, audience }) => {
    useRouteSmokeApi(audience);
    const concretePath = materializePath(path);
    const router = createTestRouter([concretePath]);
    const queryClient = createQueryClient();

    await router.load();
    render(<App router={router} queryClient={queryClient} />);

    await waitFor(() => expect(queryClient.isFetching()).toBe(0), { timeout: 3_000 });
    expect(router.state.location.pathname).toBe(concretePath);

    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
    expect(main).not.toBeEmptyDOMElement();
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
  });
});
