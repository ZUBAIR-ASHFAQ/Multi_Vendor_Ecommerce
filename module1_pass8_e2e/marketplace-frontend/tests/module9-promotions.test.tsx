import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const userId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const promotionId = "33333333-3333-4333-8333-333333333333";
const couponId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const variantId = "66666666-6666-4666-8666-666666666666";
const cartId = "77777777-7777-4777-8777-777777777777";
const cartItemId = "88888888-8888-4888-8888-888888888888";
const now = "2026-09-09T08:00:00.000Z";

afterEach(() => clearAccessToken());

/** Creates one deterministic authenticated actor for Module 9 frontend tests. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: `${accountType}@example.com`,
    displayName: "Promotion User",
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: accountType === "seller" ? { sellerIds: [sellerId], storeIds: [] } : { sellerIds: [], storeIds: [] },
  };
}

/** Registers the authenticated actor returned by /auth/me. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module9-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-promotion" }),
    ),
  );
}

/** Creates one deterministic private promotion response. */
function promotionResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: promotionId,
    ownerType: "platform",
    sellerId: null,
    name: "Autumn Sale",
    type: "percentage",
    value: "10.0000",
    startAt: "2026-09-10T10:00:00.000Z",
    endAt: "2026-09-20T10:00:00.000Z",
    status: "draft",
    fundingType: "platform",
    scopes: [{ scopeType: "product", scopeId: productId }],
    coupon: null,
    ...overrides,
  };
}

/** Builds one non-authoritative Cart response for customer coupon preview tests. */
function cartResponse() {
  return {
    id: cartId,
    currency: "USD",
    items: [
      {
        id: cartItemId,
        productId,
        variantId,
        productName: "Promotion Product",
        productSlug: "promotion-product",
        variantTitle: "Default",
        sku: "PROMO-1",
        currentUnitPrice: "25.00",
        currency: "USD",
        quantity: 2,
        previewLineSubtotal: "50.00",
        inStock: true,
        isPurchasable: true,
        addedAt: now,
        updatedAt: now,
      },
    ],
    previewSubtotal: "50.00",
    hasUnavailableItems: false,
    updatedAt: now,
  };
}

/** Renders one application route with a fresh TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Completes the common create-promotion fields and adds one Product scope. */
async function fillPromotionForm(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Promotion name"), "Autumn Sale");
  await user.type(screen.getByLabelText("Promotion value"), "10");
  fireEvent.change(screen.getByLabelText("Promotion start time"), {
    target: { value: "2026-09-10T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Promotion end time"), {
    target: { value: "2026-09-20T10:00" },
  });
  await user.type(screen.getByLabelText("Promotion scope UUID"), productId);
  await user.click(screen.getByRole("button", { name: "Add scope" }));
}

describe("Module 9 Promotions & Coupons UI", () => {
  it("creates a platform promotion without sending client-owned funding or seller authority", async () => {
    useActor(actor("platform_admin", ["admin.promotions.manage"]));
    let createBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/promotions`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-promotion-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/promotions`, async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: promotionResponse(), requestId: "req-promotion-create" });
      }),
    );

    await renderRoute("/admin/promotions");
    expect(await screen.findByRole("heading", { name: "Promotions & Coupons" })).toBeInTheDocument();
    await fillPromotionForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach coupon" }));
    await user.type(screen.getByLabelText("Coupon code"), "save10");
    await user.click(screen.getByRole("button", { name: "Create promotion" }));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({
      name: "Autumn Sale",
      type: "percentage",
      value: "10",
      scopes: [{ scopeType: "product", scopeId: productId }],
      coupon: { code: "SAVE10" },
    });
    expect(createBody).not.toHaveProperty("ownerType");
    expect(createBody).not.toHaveProperty("sellerId");
    expect(createBody).not.toHaveProperty("fundingType");
    expect(createBody).not.toHaveProperty("discountAmount");
    expect(await screen.findByText("Autumn Sale was created as a draft.")).toBeInTheDocument();
  });

  it("blocks an invalid percentage before the promotion API request", async () => {
    useActor(actor("platform_admin", ["admin.promotions.manage"]));
    let createCount = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/promotions`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-promotion-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/promotions`, () => {
        createCount += 1;
        return HttpResponse.json({ success: true, data: promotionResponse(), requestId: "unexpected" });
      }),
    );

    await renderRoute("/admin/promotions");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Promotion name"), "Too Large");
    await user.type(screen.getByLabelText("Promotion value"), "101");
    fireEvent.change(screen.getByLabelText("Promotion start time"), { target: { value: "2026-09-10T10:00" } });
    fireEvent.change(screen.getByLabelText("Promotion end time"), { target: { value: "2026-09-20T10:00" } });
    await user.type(screen.getByLabelText("Promotion scope UUID"), productId);
    await user.click(screen.getByRole("button", { name: "Add scope" }));
    await user.click(screen.getByRole("button", { name: "Create promotion" }));

    expect(await screen.findByText("Percentage promotion value must not exceed 100.")).toBeInTheDocument();
    expect(createCount).toBe(0);
  });

  it("shows safe list request context and retries a failed administrator query", async () => {
    useActor(actor("platform_admin", ["admin.promotions.manage"]));
    let requestCount = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/promotions`, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              success: false,
              error: { code: "PROMOTIONS_UNAVAILABLE", message: "Promotions are temporarily unavailable." },
              requestId: "req-promotions-retry",
            },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          success: true,
          data: [promotionResponse()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-promotions-recovered",
        });
      }),
    );

    await renderRoute("/admin/promotions");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Promotions are temporarily unavailable.");
    expect(alert).toHaveTextContent("Request ID: req-promotions-retry");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Autumn Sale")).toBeInTheDocument();
    expect(requestCount).toBe(2);
  });

  it("creates a seller-funded promotion without exposing seller ownership fields in the form payload", async () => {
    useActor(actor("seller", ["seller.promotions.manage"]));
    let createBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/seller/promotions`, async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: promotionResponse({ ownerType: "seller", sellerId, fundingType: "seller" }),
          requestId: "req-seller-promotion-create",
        });
      }),
    );

    await renderRoute("/seller/promotions");
    expect(await screen.findByRole("heading", { name: "Seller Promotions" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Promotion name"), "Seller Sale");
    await user.type(screen.getByLabelText("Promotion value"), "15");
    fireEvent.change(screen.getByLabelText("Promotion start time"), { target: { value: "2026-09-10T10:00" } });
    fireEvent.change(screen.getByLabelText("Promotion end time"), { target: { value: "2026-09-20T10:00" } });
    await user.selectOptions(screen.getByLabelText("Promotion scope type"), "seller");
    await user.type(screen.getByLabelText("Promotion scope UUID"), sellerId);
    await user.click(screen.getByRole("button", { name: "Add scope" }));
    await user.click(screen.getByRole("button", { name: "Create promotion" }));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ scopes: [{ scopeType: "seller", scopeId: sellerId }] });
    expect(createBody).not.toHaveProperty("sellerId");
    expect(createBody).not.toHaveProperty("fundingType");
    expect(createBody).not.toHaveProperty("ownerType");
    expect(await screen.findByText(/was created with 1 eligibility scope/)).toBeInTheDocument();
  });

  it("validates a checkout coupon from the current Cart and renders the server discount breakdown", async () => {
    useActor(actor("customer", ["cart.manage_own", "wishlist.manage_own", "promotions.read"]));
    let validateUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
        HttpResponse.json({ success: true, data: cartResponse(), requestId: "req-cart" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/promotions/validate`, ({ request }) => {
        validateUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: {
            valid: true,
            promotionId,
            couponId,
            code: "SAVE10",
            fundingType: "platform",
            currency: "USD",
            discountTotal: "5.00",
            allocations: [
              { cartItemId, productId, variantId, discountAmount: "5.00" },
            ],
          },
          requestId: "req-coupon-preview",
        });
      }),
    );

    await renderRoute("/cart");
    expect(await screen.findByRole("heading", { name: "Your Cart" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Checkout coupon code"), "save10");
    await user.click(screen.getByRole("button", { name: "Apply coupon" }));

    expect(await screen.findByText("Coupon SAVE10 is eligible")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Discount breakdown" })).toHaveTextContent("-$5.00");
    expect(screen.getByText(/Checkout must revalidate promotion, Product, Inventory/)).toBeInTheDocument();
    expect(new URL(validateUrl).searchParams.get("code")).toBe("SAVE10");
  });
  it("shows a coupon conflict with its safe request ID", async () => {
    useActor(actor("customer", ["cart.manage_own", "wishlist.manage_own", "promotions.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
        HttpResponse.json({ success: true, data: cartResponse(), requestId: "req-cart" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/promotions/validate`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "COUPON_INVALID", message: "Coupon is invalid or inactive." },
            requestId: "req-coupon-invalid",
          },
          { status: 409 },
        ),
      ),
    );

    await renderRoute("/cart");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Checkout coupon code"), "expired");
    await user.click(screen.getByRole("button", { name: "Apply coupon" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Coupon is invalid or inactive.");
    expect(alert).toHaveTextContent("Request ID: req-coupon-invalid");
    expect(screen.queryByRole("region", { name: "Discount breakdown" })).not.toBeInTheDocument();
  });

});
