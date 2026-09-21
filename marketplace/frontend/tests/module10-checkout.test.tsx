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

const userId = "11111111-1111-4111-8111-111111111111";
const addressId = "22222222-2222-4222-8222-222222222222";
const billingAddressId = "33333333-3333-4333-8333-333333333333";
const sellerId = "44444444-4444-4444-8444-444444444444";
const storeId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const variantId = "77777777-7777-4777-8777-777777777777";
const cartId = "88888888-8888-4888-8888-888888888888";
const cartItemId = "99999999-9999-4999-8999-999999999999";
const shippingMethodId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const quoteId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const attemptId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stateHash = "a".repeat(64);
const now = "2026-09-12T12:00:00.000Z";

/** Clears the synthetic browser access token after each focused Checkout regression test. */
afterEach(() => clearAccessToken());

/** Creates one deterministic customer actor for Checkout UI tests. */
function customerActor(permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: "checkout@example.com",
    displayName: "Checkout Customer",
    accountType: "customer",
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers the authenticated actor returned by /auth/me. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module10-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-checkout" }),
    ),
  );
}

/** Builds the server-backed Cart preview that Checkout must independently revalidate. */
function cartResponse() {
  return {
    id: cartId,
    currency: "USD",
    items: [
      {
        id: cartItemId,
        productId,
        variantId,
        productName: "Checkout Product",
        productSlug: "checkout-product",
        storeId,
        storeSlug: "cedar-goods",
        storeName: "Cedar Goods",
        thumbnailFileId: null,
        variantTitle: "Default",
        sku: "CHECKOUT-1",
        currentUnitPrice: "100.0000",
        currency: "USD",
        quantity: 2,
        previewLineSubtotal: "200.0000",
        inStock: true,
        isPurchasable: true,
        addedAt: now,
        updatedAt: now,
      },
    ],
    previewSubtotal: "200.0000",
    hasUnavailableItems: false,
    updatedAt: now,
  };
}

/** Builds active customer-owned addresses used by the Checkout address selectors. */
function addressResponse() {
  return [
    {
      id: addressId,
      customerUserId: userId,
      label: "Home",
      recipientName: "Checkout Customer",
      phone: "+15555550100",
      line1: "1 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90001",
      countryCode: "US",
      isDefaultShipping: true,
      isDefaultBilling: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: billingAddressId,
      customerUserId: userId,
      label: "Billing",
      recipientName: "Checkout Customer",
      phone: "+15555550100",
      line1: "2 Market Street",
      line2: null,
      city: "Test City",
      region: "CA",
      postalCode: "90002",
      countryCode: "US",
      isDefaultShipping: false,
      isDefaultBilling: true,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Builds one current Shipping Core group for the Cart's server-derived store. */
function shippingOptionsResponse() {
  return {
    addressId,
    currency: "USD",
    groups: [
      {
        sellerId,
        storeId,
        options: [
          {
            id: shippingMethodId,
            code: "STANDARD",
            name: "Standard shipping",
            pricingType: "flat",
            rate: "10.0000",
            currency: "USD",
          },
        ],
      },
    ],
  };
}

/** Builds the public Product detail used to render a direct Buy Now Checkout summary. */
function buyNowProductResponse() {
  return {
    id: productId,
    storeId,
    categoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    brandId: null,
    slug: "checkout-product",
    name: "Checkout Product",
    description: "Direct checkout product.",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    variants: [
      {
        id: variantId,
        productId,
        sku: "CHECKOUT-1",
        title: "Default",
        price: "100.0000",
        compareAtPrice: null,
        currency: "USD",
        weight: null,
        inStock: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    attributes: [],
    media: [],
    store: {
      id: storeId,
      slug: "cedar-goods",
      name: "Cedar Goods",
      logoFileId: null,
      seller: { id: sellerId, displayName: "Cedar Seller" },
    },
    category: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      slug: "general",
      name: "General",
    },
    brand: null,
  };
}

/** Builds one authoritative server quote returned after current commerce state is recalculated. */
function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: quoteId,
    currency: "USD",
    shippingAddressId: addressId,
    billingAddressId,
    couponCode: "SAVE10",
    subtotal: "200.0000",
    discountTotal: "20.0000",
    taxTotal: "18.0000",
    shippingTotal: "10.0000",
    grandTotal: "208.0000",
    expiresAt: "2027-09-12T12:15:00.000Z",
    stateHash,
    lines: [
      {
        variantId,
        sellerId,
        storeId,
        quantity: 2,
        unitPrice: "100.0000",
        discount: "20.0000",
        tax: "18.0000",
        lineTotal: "198.0000",
      },
    ],
    shippingSelections: [
      {
        sellerId,
        storeId,
        shippingMethodId,
        shippingMethodCode: "STANDARD",
        shippingMethodName: "Standard shipping",
        amount: "10.0000",
        currency: "USD",
      },
    ],
    ...overrides,
  };
}

/** Builds one customer-owned Checkout attempt returned after idempotent confirmation. */
function attemptResponse() {
  return {
    id: attemptId,
    quoteId,
    orderId: null,
    status: "confirmed",
    expiresAt: "2027-09-12T12:30:00.000Z",
  };
}

/** Registers the common Cart, address, and Shipping Core reads used by Checkout tests. */
function useCheckoutPrerequisiteHandlers(): void {
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
      HttpResponse.json({ success: true, data: cartResponse(), requestId: "req-cart-checkout" }),
    ),
    http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
      HttpResponse.json({ success: true, data: addressResponse(), requestId: "req-addresses-checkout" }),
    ),
    http.get(`${env.VITE_API_BASE_URL}/checkout/shipping-options`, ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("addressId")).toBe(addressId);
      return HttpResponse.json({ success: true, data: shippingOptionsResponse(), requestId: "req-shipping-checkout" });
    }),
  );
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Selects the required Shipping Core method and asks the server to calculate a quote. */
async function calculateQuoteFromForm(): Promise<void> {
  const user = userEvent.setup();
  const shippingSelect = await screen.findByLabelText("Shipping method for Cedar Goods");
  await user.selectOptions(shippingSelect, shippingMethodId);
  await user.type(screen.getByLabelText("Checkout coupon code"), "save10");
  await user.click(screen.getByRole("button", { name: "Review order" }));
}

describe("Module 10 Checkout UI", () => {
  it("creates an authoritative quote without sending client totals and confirms it with the required retry key", async () => {
    useActor(customerActor(["checkout.create_own", "checkout.confirm_own", "cart.manage_own", "customer.address.manage_own"]));
    useCheckoutPrerequisiteHandlers();
    let createBody: Record<string, unknown> | null = null;
    let confirmBody: Record<string, unknown> | null = null;
    let idempotencyKey: string | null = null;

    server.use(
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote`, async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: quoteResponse(), requestId: "req-quote-create" }, { status: 201 });
      }),
      http.get(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}`, () =>
        HttpResponse.json({ success: true, data: quoteResponse(), requestId: "req-quote-read" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}/confirm`, async ({ request }) => {
        confirmBody = (await request.json()) as Record<string, unknown>;
        idempotencyKey = request.headers.get("Idempotency-Key");
        return HttpResponse.json({ success: true, data: attemptResponse(), requestId: "req-confirm" });
      }),
      http.get(`${env.VITE_API_BASE_URL}/checkout/${attemptId}/status`, () =>
        HttpResponse.json({ success: true, data: attemptResponse(), requestId: "req-attempt-status" }),
      ),
    );

    await renderRoute("/checkout");
    expect(await screen.findByRole("heading", { name: "Checkout", level: 1 })).toBeInTheDocument();
    await calculateQuoteFromForm();

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toEqual({
      shippingAddressId: addressId,
      billingAddressId,
      couponCode: "SAVE10",
      shippingSelections: [{ storeId, shippingMethodId }],
    });
    expect(createBody).not.toHaveProperty("subtotal");
    expect(createBody).not.toHaveProperty("grandTotal");
    expect(await screen.findByRole("region", { name: "Checkout quote summary" })).toHaveTextContent("$208.00");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirm & pay" }));

    await waitFor(() => expect(confirmBody).not.toBeNull());
    expect(confirmBody).toEqual({ stateHash });
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByRole("region", { name: "Checkout attempt status" })).toHaveTextContent("confirmed");
    expect(screen.getByText(/Your order has been created/i)).toBeInTheDocument();
  });

  it("creates Buy Now shipping and quote requests without loading or changing the customer Cart", async () => {
    useActor(customerActor(["checkout.create_own", "checkout.confirm_own", "customer.address.manage_own"]));
    let cartRequestCount = 0;
    let shippingQuery: URLSearchParams | null = null;
    let createBody: Record<string, unknown> | null = null;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () => {
        cartRequestCount += 1;
        return HttpResponse.json({ success: true, data: cartResponse(), requestId: "unexpected-cart" });
      }),
      http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json({ success: true, data: addressResponse(), requestId: "req-buy-now-addresses" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/products/checkout-product`, () =>
        HttpResponse.json({ success: true, data: buyNowProductResponse(), requestId: "req-buy-now-product" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/checkout/shipping-options`, ({ request }) => {
        shippingQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ success: true, data: shippingOptionsResponse(), requestId: "req-buy-now-shipping" });
      }),
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote`, async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: quoteResponse({ couponCode: null }), requestId: "req-buy-now-quote" }, { status: 201 });
      }),
      http.get(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}`, () =>
        HttpResponse.json({ success: true, data: quoteResponse({ couponCode: null }), requestId: "req-buy-now-read" }),
      ),
    );

    await renderRoute(`/checkout?buyNowVariantId=${variantId}&buyNowQuantity=2&productSlug=checkout-product`);
    expect(await screen.findByRole("heading", { name: "Buy Now", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Buy Now does not change your Cart.", { exact: false })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText("Shipping method for Cedar Goods"),
      shippingMethodId,
    );
    await user.click(screen.getByRole("button", { name: "Review order" }));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(cartRequestCount).toBe(0);
    expect(shippingQuery?.get("addressId")).toBe(addressId);
    expect(shippingQuery?.get("variantId")).toBe(variantId);
    expect(shippingQuery?.get("quantity")).toBe("2");
    expect(createBody).toEqual({
      shippingAddressId: addressId,
      billingAddressId,
      shippingSelections: [{ storeId, shippingMethodId }],
      buyNowItem: { variantId, quantity: 2 },
    });
  });

  it("shows a quote-change warning with the safe request ID when confirmation detects a stale price", async () => {
    useActor(customerActor(["checkout.create_own", "checkout.confirm_own", "cart.manage_own"]));
    useCheckoutPrerequisiteHandlers();
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote`, () =>
        HttpResponse.json({ success: true, data: quoteResponse(), requestId: "req-quote-create" }, { status: 201 }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}`, () =>
        HttpResponse.json({ success: true, data: quoteResponse(), requestId: "req-quote-read" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}/confirm`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "CHECKOUT_PRICE_CHANGED", message: "Product price changed after this quote was created." },
            requestId: "req-checkout-price-changed",
          },
          { status: 409 },
        ),
      ),
    );

    await renderRoute("/checkout");
    await calculateQuoteFromForm();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Confirm & pay" }));

    const warning = await screen.findByText("Checkout details changed");
    expect(warning.closest('[role="alert"]')).toHaveTextContent("review the latest totals");
    expect(warning.closest('[role="alert"]')).toHaveTextContent("Technical reference: req-checkout-price-changed");
  });

  it("shows an expired-quote warning and disables confirmation until the customer recalculates", async () => {
    useActor(customerActor(["checkout.create_own", "checkout.confirm_own", "cart.manage_own"]));
    useCheckoutPrerequisiteHandlers();
    const expiredQuote = quoteResponse({ expiresAt: "2020-01-01T00:00:00.000Z" });
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/checkout/quote`, () =>
        HttpResponse.json({ success: true, data: expiredQuote, requestId: "req-expired-quote" }, { status: 201 }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/checkout/quote/${quoteId}`, () =>
        HttpResponse.json({ success: true, data: expiredQuote, requestId: "req-expired-quote-read" }),
      ),
    );

    await renderRoute("/checkout");
    await calculateQuoteFromForm();

    expect(await screen.findByText("This review has expired. Review your order again before placing it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & pay" })).toBeDisabled();
  });

  it("blocks the Checkout feature before Cart or address reads when the customer lacks checkout.create_own", async () => {
    useActor(customerActor(["cart.manage_own"]));
    let cartCalls = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () => {
        cartCalls += 1;
        return HttpResponse.json({ success: true, data: cartResponse(), requestId: "unexpected-cart" });
      }),
    );

    await renderRoute("/checkout");
    expect(await screen.findByRole("alert")).toHaveTextContent("does not have permission to create a customer Checkout quote");
    expect(cartCalls).toBe(0);
  });

  it("requires an active saved address before requesting Shipping Core options", async () => {
    useActor(customerActor(["checkout.create_own", "checkout.confirm_own", "cart.manage_own"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
        HttpResponse.json({ success: true, data: cartResponse(), requestId: "req-cart" }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json({ success: true, data: [], requestId: "req-address-empty" }),
      ),
    );

    await renderRoute("/checkout");
    expect(await screen.findByRole("heading", { name: "Checkout needs an address" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage addresses" })).toHaveAttribute("href", "/customer/addresses");
  });
});
