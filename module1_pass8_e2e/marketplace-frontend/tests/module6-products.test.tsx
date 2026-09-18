import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { getPostLoginPath } from "@/features/auth/auth.navigation";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const userId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const brandId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const variantId = "77777777-7777-4777-8777-777777777777";
const fileId = "88888888-8888-4888-8888-888888888888";
const mediaId = "99999999-9999-4999-8999-999999999999";

/** Creates one deterministic seller actor for Module 6 frontend tests. */
function sellerActor(permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: "seller@example.com",
    displayName: "Seller User",
    accountType: "seller",
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [sellerId], storeIds: [storeId] },
  };
}

/** Registers the authenticated seller returned by /auth/me. */
function useSeller(permissions: string[]): void {
  setAccessToken("module6-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: sellerActor(permissions) }),
    ),
  );
}

/** Returns the active Module 5 reads required by Product forms. */
function useTaxonomy(): void {
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/catalog/categories`, () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            id: categoryId,
            parentId: null,
            slug: "electronics",
            name: "Electronics",
            status: "active",
            sortOrder: 0,
            children: [],
          },
        ],
      }),
    ),
    http.get(`${env.VITE_API_BASE_URL}/catalog/brands`, () =>
      HttpResponse.json({
        success: true,
        data: [{ id: brandId, slug: "acme", name: "Acme", status: "active" }],
      }),
    ),
    http.get(`${env.VITE_API_BASE_URL}/catalog/attributes`, () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
    http.get(`${env.VITE_API_BASE_URL}/catalog/categories/${categoryId}/attributes`, () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
  );
}

/** Returns one deterministic seller-private Product aggregate. */
function productDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    sellerId,
    storeId,
    categoryId,
    brandId,
    slug: "demo-product",
    name: "Demo Product",
    description: "A Product used by Module 6 frontend tests.",
    status: "active",
    publicationStatus: "draft",
    publishedAt: null,
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    variants: [],
    attributes: [],
    media: [],
    priceHistory: [],
    ...overrides,
  };
}

/** Renders one application route with a fresh TanStack Query cache. */
async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 6 Product Management UI", () => {
  it("routes a Product seller directly to the Product table after login", () => {
    expect(getPostLoginPath(sellerActor(["seller.products.read"]))).toBe("/seller/products");
  });

  it("renders the public Product catalog and opens public Product detail", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/products`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: productId,
              storeId,
              categoryId,
              brandId,
              slug: "demo-product",
              name: "Demo Product",
              description: "Public description",
              publishedAt: "2026-09-06T10:00:00.000Z",
              createdAt: "2026-09-06T10:00:00.000Z",
              updatedAt: "2026-09-06T10:00:00.000Z",
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/products/demo-product`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: productId,
            storeId,
            categoryId,
            brandId,
            slug: "demo-product",
            name: "Demo Product",
            description: "Public description",
            publishedAt: "2026-09-06T10:00:00.000Z",
            createdAt: "2026-09-06T10:00:00.000Z",
            updatedAt: "2026-09-06T10:00:00.000Z",
            variants: [
              {
                id: variantId,
                productId,
                sku: "DEMO-1",
                title: "Default",
                price: "19.99",
                compareAtPrice: null,
                currency: "USD",
                weight: null,
                createdAt: "2026-09-06T10:00:00.000Z",
                updatedAt: "2026-09-06T10:00:00.000Z",
              },
            ],
            attributes: [],
            media: [],
          },
        }),
      ),
    );

    await renderRoute("/products");
    expect(await screen.findByText("Demo Product")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("link", { name: "View Product" }));
    expect(await screen.findByText("$19.99")).toBeInTheDocument();
  });

  it("creates a normalized draft Product through the seller create form", async () => {
    useSeller(["seller.products.read", "seller.products.create", "catalog.read"]);
    useTaxonomy();
    let requestBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/seller/products`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ success: true, data: productDetail() }, { status: 201 });
      }),
      http.get(`${env.VITE_API_BASE_URL}/seller/products/${productId}`, () =>
        HttpResponse.json({ success: true, data: productDetail() }),
      ),
    );

    await renderRoute("/seller/products/new");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Product store"), storeId);
    await user.type(screen.getByLabelText("Product name"), "Demo Product");
    await user.type(screen.getByLabelText("Product slug"), "Demo Product");
    await user.type(screen.getByLabelText("Product description"), "A Product used by Module 6 frontend tests.");
    await user.selectOptions(screen.getByLabelText("Product category"), categoryId);
    await user.selectOptions(screen.getByLabelText("Product brand"), brandId);
    await user.click(screen.getByRole("button", { name: "Create draft Product" }));

    await waitFor(() => expect(requestBody).toBeDefined());
    expect(requestBody).toEqual({
      storeId,
      categoryId,
      brandId,
      slug: "demo product",
      name: "Demo Product",
      description: "A Product used by Module 6 frontend tests.",
      attributes: [],
    });
    expect(await screen.findByRole("heading", { name: "Demo Product" })).toBeInTheDocument();
  });

  it("adds a variant and publishes from explicit Product commands", async () => {
    useSeller([
      "seller.products.read",
      "seller.products.update",
      "seller.products.publish",
      "catalog.read",
    ]);
    useTaxonomy();
    let detail = productDetail();
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/products/${productId}`, () =>
        HttpResponse.json({ success: true, data: detail }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/products/${productId}/variants`, async ({ request }) => {
        const body = await request.json();
        detail = productDetail({
          variants: [
            {
              id: variantId,
              productId,
              sku: "DEMO-1",
              title: "Default",
              price: "19.99",
              compareAtPrice: null,
              currency: "USD",
              status: "active",
              weight: null,
              createdAt: "2026-09-06T10:00:00.000Z",
              updatedAt: "2026-09-06T10:00:00.000Z",
            },
          ],
        });
        expect(body).toMatchObject({ sku: "DEMO-1", price: "19.99", currency: "USD" });
        return HttpResponse.json({ success: true, data: detail }, { status: 201 });
      }),
      http.post(`${env.VITE_API_BASE_URL}/seller/products/${productId}/publish`, () => {
        detail = { ...detail, publicationStatus: "published", publishedAt: "2026-09-06T11:00:00.000Z" };
        return HttpResponse.json({ success: true, data: detail });
      }),
    );

    await renderRoute(`/seller/products/${productId}`);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Demo Product" });
    await user.type(screen.getByLabelText("Variant SKU"), "DEMO-1");
    await user.type(screen.getByLabelText("Variant title"), "Default");
    await user.type(screen.getByLabelText("Variant price"), "19.99");
    await user.clear(screen.getByLabelText("Variant currency"));
    await user.type(screen.getByLabelText("Variant currency"), "USD");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    expect(await screen.findByText("SKU DEMO-1 · active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish / submit" }));
    expect(await screen.findByText("published")).toBeInTheDocument();
  });

  it("uploads Product media through the signed Module 21 workflow", async () => {
    useSeller([
      "seller.products.read",
      "seller.products.update",
      "catalog.read",
      "documents.upload",
      "documents.read",
    ]);
    useTaxonomy();
    let detail = productDetail();
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/products/${productId}`, () =>
        HttpResponse.json({ success: true, data: detail }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/sign`, () =>
        HttpResponse.json({
          success: true,
          data: {
            fileId,
            uploadUrl: "https://storage.example.test/module6.png",
            expiresAt: "2026-09-06T12:00:00.000Z",
            requiredHeaders: { "content-type": "image/png" },
          },
        }),
      ),
      http.put("https://storage.example.test/module6.png", () => new HttpResponse(null, { status: 200 })),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/${fileId}/confirm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            file: {
              id: fileId,
              originalName: "product.png",
              mimeType: "image/png",
              sizeBytes: 4,
              status: "confirmed",
              createdAt: "2026-09-06T10:00:00.000Z",
            },
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/products/${productId}/media`, async ({ request }) => {
        expect(await request.json()).toEqual({
          fileId,
          variantId: null,
          altText: "Demo image",
          sortOrder: 0,
        });
        detail = productDetail({
          media: [
            {
              id: mediaId,
              productId,
              variantId: null,
              fileId,
              mediaType: "image",
              altText: "Demo image",
              sortOrder: 0,
              status: "active",
              createdAt: "2026-09-06T10:00:00.000Z",
            },
          ],
        });
        return HttpResponse.json({ success: true, data: detail }, { status: 201 });
      }),
    );

    await renderRoute(`/seller/products/${productId}`);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Demo Product" });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "product.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Product media file"), file);
    await user.type(screen.getByLabelText("Product media alt text"), "Demo image");
    await user.click(screen.getByRole("button", { name: "Upload and link media" }));

    expect(await screen.findByText("Demo image")).toBeInTheDocument();
  });
});
