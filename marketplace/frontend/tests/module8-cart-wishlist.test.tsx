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
const cartId = "22222222-2222-4222-8222-222222222222";
const cartItemId = "33333333-3333-4333-8333-333333333333";
const wishlistId = "44444444-4444-4444-8444-444444444444";
const wishlistItemId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const variantId = "77777777-7777-4777-8777-777777777777";
const storeId = "88888888-8888-4888-8888-888888888888";
const categoryId = "99999999-9999-4999-8999-999999999999";
const thumbnailFileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = "2026-09-09T00:00:00.000Z";

afterEach(() => clearAccessToken());

/** Creates a customer actor with the exact Module 8 self-service permissions. */
function customerActor(): AuthenticatedUser {
  return {
    id: userId,
    email: "customer@example.com",
    displayName: "Customer",
    accountType: "customer",
    status: "active",
    roles: [],
    permissions: ["cart.manage_own", "wishlist.manage_own"],
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers the authenticated customer endpoint used by protected Module 8 pages. */
function useCustomerActor(): void {
  setAccessToken("module8-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: customerActor(), requestId: "req-auth" }),
    ),
    http.post(`${env.VITE_API_BASE_URL}/media/public/resolve`, async ({ request }) => {
      const body = await request.json() as { fileIds?: string[] };
      return HttpResponse.json({
        success: true,
        data: {
          items: (body.fileIds ?? [])
            .filter((fileId) => fileId === thumbnailFileId)
            .map((fileId) => ({
              fileId,
              url: "https://cdn.example.test/everyday-backpack.jpg",
              mimeType: "image/jpeg",
              expiresAt: "2026-09-09T00:10:00.000Z",
            })),
        },
        requestId: "req-media",
      });
    }),
  );
}

/** Builds one Cart response with a single current Product variant. */
function cartResponse(quantity = 2) {
  const subtotal = `${quantity * 25}.00`;
  return {
    id: cartId,
    currency: "USD",
    items: [
      {
        id: cartItemId,
        productId,
        variantId,
        productName: "Everyday Backpack",
        productSlug: "everyday-backpack",
        storeId,
        storeSlug: "northstar-goods",
        storeName: "Northstar Goods",
        thumbnailFileId,
        variantTitle: "Black",
        sku: "BAG-BLK",
        currentUnitPrice: "25.00",
        currency: "USD",
        quantity,
        previewLineSubtotal: subtotal,
        inStock: true,
        isPurchasable: true,
        addedAt: now,
        updatedAt: now,
      },
    ],
    previewSubtotal: subtotal,
    hasUnavailableItems: false,
    updatedAt: now,
  };
}

/** Builds an empty Cart response used by Wishlist move tests. */
function emptyCartResponse() {
  return {
    id: cartId,
    currency: "USD",
    items: [],
    previewSubtotal: "0.00",
    hasUnavailableItems: false,
    updatedAt: now,
  };
}

/** Builds one default Wishlist containing a variant-bound Product. */
function wishlistResponse() {
  return {
    id: wishlistId,
    name: "My Wishlist",
    isDefault: true,
    items: [
      {
        id: wishlistItemId,
        productId,
        variantId,
        productName: "Everyday Backpack",
        productSlug: "everyday-backpack",
        storeId,
        storeSlug: "northstar-goods",
        storeName: "Northstar Goods",
        thumbnailFileId,
        variantTitle: "Black",
        currentUnitPrice: "25.00",
        currency: "USD",
        inStock: true,
        isPurchasable: true,
        createdAt: now,
      },
    ],
    createdAt: now,
  };
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Registers the Cart GET endpoint used by the mini Cart and Cart page. */
function useCartGet(data = cartResponse()): void {
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/cart`, () =>
      HttpResponse.json({ success: true, data, requestId: "req-cart-get" }),
    ),
  );
}

/** Returns one public Product detail compatible with the Module 6 Product page. */
function publicProductResponse() {
  return {
    id: productId,
    storeId,
    categoryId,
    brandId: null,
    slug: "everyday-backpack",
    name: "Everyday Backpack",
    description: "Simple everyday bag.",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    variants: [
      {
        id: variantId,
        productId,
        sku: "BAG-BLK",
        title: "Black",
        price: "25.00",
        compareAtPrice: null,
        currency: "USD",
        weight: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    attributes: [],
    media: [],
    store: {
      id: storeId,
      slug: "northstar-goods",
      name: "Northstar Goods",
      logoFileId: null,
      seller: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        displayName: "Northstar Seller",
      },
    },
    category: {
      id: categoryId,
      slug: "bags",
      name: "Bags",
    },
    brand: null,
  };
}

describe("Module 8 Cart & Wishlist UI", () => {
  it("renders preview-only Cart totals and updates quantity through the documented PATCH route", async () => {
    useCustomerActor();
    useCartGet();
    let seenBody: unknown;
    server.use(
      http.patch(`${env.VITE_API_BASE_URL}/cart/items/${cartItemId}`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ success: true, data: cartResponse(3), requestId: "req-cart-update" });
      }),
    );

    await renderRoute("/cart");
    expect(await screen.findByRole("heading", { name: "Review your items" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Northstar Goods" })).toHaveAttribute("href", "/stores/northstar-goods");
    expect(await screen.findByRole("img", { name: "Everyday Backpack" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/everyday-backpack.jpg",
    );
    expect(screen.getByText(/Inventory is not reserved yet/i)).toBeInTheDocument();

    const user = userEvent.setup();
    const quantity = screen.getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Update quantity" }));

    await waitFor(() => expect(seenBody).toEqual({ quantity: 3 }));
    expect((await screen.findAllByText("$75.00")).length).toBeGreaterThan(0);
  });

  it("does not preload Cart data for a non-customer actor even if a stale permission is present", async () => {
    setAccessToken("module8-frontend-token");
    let cartRequestCount = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({
          success: true,
          data: { ...customerActor(), accountType: "seller" },
          requestId: "req-auth-seller",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/cart`, () => {
        cartRequestCount += 1;
        return HttpResponse.json({
          success: true,
          data: emptyCartResponse(),
          requestId: "req-cart-unexpected",
        });
      }),
    );

    await renderRoute("/cart");

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(cartRequestCount).toBe(0);
  });

  it("blocks an invalid Cart quantity before the PATCH request", async () => {
    useCustomerActor();
    useCartGet();
    let updateRequestCount = 0;

    server.use(
      http.patch(`${env.VITE_API_BASE_URL}/cart/items/${cartItemId}`, () => {
        updateRequestCount += 1;
        return HttpResponse.json({
          success: true,
          data: cartResponse(99),
          requestId: "req-cart-invalid-unexpected",
        });
      }),
    );

    await renderRoute("/cart");
    const user = userEvent.setup();
    const quantity = await screen.findByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "100");
    await user.click(screen.getByRole("button", { name: "Update quantity" }));

    expect(await screen.findByText("Quantity cannot exceed 99.")).toBeInTheDocument();
    expect(updateRequestCount).toBe(0);
  });

  it("moves a variant-bound Wishlist item only after Cart addition succeeds", async () => {
    useCustomerActor();
    useCartGet(emptyCartResponse());
    let cartAddCount = 0;
    let wishlistDeleteCount = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/wishlist`, () =>
        HttpResponse.json({ success: true, data: wishlistResponse(), requestId: "req-wishlist" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/cart/items`, async ({ request }) => {
        cartAddCount += 1;
        expect(await request.json()).toEqual({ variantId, quantity: 1 });
        return HttpResponse.json({ success: true, data: cartResponse(1), requestId: "req-move-cart" });
      }),
      http.delete(`${env.VITE_API_BASE_URL}/wishlist/items/${wishlistItemId}`, () => {
        wishlistDeleteCount += 1;
        return HttpResponse.json({
          success: true,
          data: { ...wishlistResponse(), items: [] },
          requestId: "req-move-wishlist",
        });
      }),
    );

    await renderRoute("/wishlist");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Move to Cart" }));

    await waitFor(() => {
      expect(cartAddCount).toBe(1);
      expect(wishlistDeleteCount).toBe(1);
    });
    expect(await screen.findByRole("heading", { name: "Your Wishlist is empty" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mini Cart with 1 item")).toBeInTheDocument();
  });

  it("keeps the Wishlist item when move-to-Cart fails", async () => {
    useCustomerActor();
    useCartGet(emptyCartResponse());
    let wishlistDeleteCount = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/wishlist`, () =>
        HttpResponse.json({ success: true, data: wishlistResponse(), requestId: "req-wishlist" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/cart/items`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "CART_PRODUCT_UNAVAILABLE", message: "The variant is unavailable." },
            requestId: "req-move-failed",
          },
          { status: 409 },
        ),
      ),
      http.delete(`${env.VITE_API_BASE_URL}/wishlist/items/${wishlistItemId}`, () => {
        wishlistDeleteCount += 1;
        return HttpResponse.json({ success: true, data: wishlistResponse(), requestId: "unexpected" });
      }),
    );

    await renderRoute("/wishlist");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Move to Cart" }));

    expect(await screen.findByText("The variant is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-move-failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Everyday Backpack" })).toBeInTheDocument();
    expect(wishlistDeleteCount).toBe(0);
  });

  it("adds a Product variant to Cart and Wishlist without sending price or ownership fields", async () => {
    let cartBody: unknown;
    let wishlistBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/products/everyday-backpack`, () =>
        HttpResponse.json({ success: true, data: publicProductResponse(), requestId: "req-product" }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/cart/items`, async ({ request }) => {
        cartBody = await request.json();
        return HttpResponse.json({ success: true, data: cartResponse(1), requestId: "req-product-cart" });
      }),
      http.post(`${env.VITE_API_BASE_URL}/wishlist/items`, async ({ request }) => {
        wishlistBody = await request.json();
        return HttpResponse.json({ success: true, data: wishlistResponse(), requestId: "req-product-wishlist" });
      }),
    );

    await renderRoute("/products/everyday-backpack");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add to Cart" }));
    await user.click(screen.getByRole("button", { name: "Save to Wishlist" }));

    await waitFor(() => {
      expect(cartBody).toEqual({ variantId, quantity: 1 });
      expect(wishlistBody).toEqual({ productId, variantId });
    });
    expect(screen.getByLabelText("Mini Cart with 1 item")).toBeInTheDocument();
  });

  it("shows the safe request ID and retries Cart loading", async () => {
    useCustomerActor();
    let requestCount = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/cart`, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              success: false,
              error: { code: "CART_PRODUCT_UNAVAILABLE", message: "Cart could not be refreshed." },
              requestId: "req-cart-error",
            },
            { status: 409 },
          );
        }

        return HttpResponse.json({
          success: true,
          data: cartResponse(),
          requestId: "req-cart-recovered",
        });
      }),
    );

    await renderRoute("/cart");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cart could not be refreshed.");
    expect(alert).toHaveTextContent("Technical reference: req-cart-error");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Review your items" })).toBeInTheDocument();
    expect(requestCount).toBe(2);
  });
});
