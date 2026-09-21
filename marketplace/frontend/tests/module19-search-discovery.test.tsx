import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const productId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const sellerId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const brandId = "55555555-5555-4555-8555-555555555555";
const attributeId = "66666666-6666-4666-8666-666666666666";

/** Returns a deterministic public Search response with all required facet families. */
function searchResponse(thumbnailFileId: string | null = null) {
  return {
    success: true,
    data: {
      items: [
        {
          productId,
          storeId,
          slug: "wireless-headphones",
          name: "Wireless Headphones",
          categoryId,
          categoryPath: "Electronics / Audio",
          brandId,
          brand: "Demo Audio",
          minPrice: "79.99",
          maxPrice: "99.99",
          currency: "USD",
          ratingAvg: 0,
          ratingCount: 0,
          inStock: true,
          thumbnailFileId,
          updatedAt: "2026-09-07T08:00:00.000Z",
        },
      ],
      facets: {
        categories: [{ categoryId, label: "Audio", path: "Electronics / Audio", count: 1 }],
        brands: [{ brandId, label: "Demo Audio", count: 1 }],
        attributes: [
          {
            attributeId,
            label: "Color",
            values: [{ value: "Black", label: "Black", count: 1 }],
          },
        ],
        price: { min: "79.99", max: "99.99" },
        availability: { inStock: 1, outOfStock: 0 },
      },
    },
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 2 },
  };
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Installs the public Product Search handlers needed by tests that also render autocomplete. */
function useProductSearchApi(onSearch?: (url: URL) => void) {
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/search/products`, ({ request }) => {
      onSearch?.(new URL(request.url));
      return HttpResponse.json(searchResponse());
    }),
    http.get(`${env.VITE_API_BASE_URL}/search/suggestions`, () =>
      HttpResponse.json({ success: true, data: ["Wireless Headphones", "Wireless Earbuds"] }),
    ),
  );
}

describe("Module 19 Search & Discovery UI", () => {
  it("renders public Product cards and sends URL-backed category, attribute, sort, and pagination filters", async () => {
    const seenUrls: URL[] = [];
    useProductSearchApi((url) => seenUrls.push(url));

    await renderRoute("/search?q=headphones");
    expect(await screen.findByRole("heading", { name: "Wireless Headphones" })).toBeInTheDocument();
    expect(screen.getByText("$79.99 – $99.99")).toBeInTheDocument();
    expect(screen.getByLabelText("No ratings yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Wireless Headphones to wishlist" })).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Audio/ }));
    await waitFor(() => expect(seenUrls.some((url) => url.searchParams.get("categoryId") === categoryId)).toBe(true));

    await user.click(screen.getByLabelText(/Black/));
    await waitFor(() => expect(seenUrls.some((url) => url.searchParams.getAll("attribute").includes(`${attributeId}=Black`))).toBe(true));

    await user.selectOptions(screen.getByLabelText("Search result sort"), "price_asc");
    await waitFor(() => expect(seenUrls.some((url) => url.searchParams.get("sort") === "price_asc")).toBe(true));

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(seenUrls.some((url) => url.searchParams.get("page") === "2")).toBe(true));
  });


  it("treats the mobile Product filter surface as a keyboard-contained dialog", async () => {
    useProductSearchApi();
    await renderRoute("/search");

    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "Filters" });
    trigger.focus();
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close filters" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });


  it("resolves public Search thumbnails in one media request and renders the returned image", async () => {
    const thumbnailFileId = "77777777-7777-4777-8777-777777777777";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/search/products`, () =>
        HttpResponse.json(searchResponse(thumbnailFileId)),
      ),
      http.post(`${env.VITE_API_BASE_URL}/media/public/resolve`, async ({ request }) => {
        expect(await request.json()).toEqual({ fileIds: [thumbnailFileId] });
        return HttpResponse.json({
          success: true,
          data: {
            items: [{
              fileId: thumbnailFileId,
              url: "https://cdn.example.test/wireless-headphones.jpg",
              mimeType: "image/jpeg",
              expiresAt: "2026-09-20T12:30:00.000Z",
            }],
          },
        });
      }),
    );

    await renderRoute("/search?q=headphones");
    const image = await screen.findByRole("img", { name: "Wireless Headphones" });
    expect(image).toHaveAttribute("src", "https://cdn.example.test/wireless-headphones.jpg");
  });

  it("shows readable validation for an invalid maximum price and an inverted price range", async () => {
    useProductSearchApi();
    await renderRoute("/search");

    const user = userEvent.setup();
    const minPrice = screen.getByLabelText("Minimum price");
    const maxPrice = screen.getByLabelText("Maximum price");

    await user.type(maxPrice, "-1");
    expect(await screen.findByText(/non-negative price/i)).toBeInTheDocument();

    await user.clear(maxPrice);
    await user.type(minPrice, "100.00");
    await user.type(maxPrice, "50.00");
    expect(await screen.findByText(/maximum price must be greater than or equal to minimum price/i)).toBeInTheDocument();
    expect(maxPrice).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the API request ID when Product Search fails", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/search/products`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "SEARCH_INDEX_UNAVAILABLE", message: "Search is temporarily unavailable." },
            requestId: "req-search-123",
          },
          { status: 503 },
        ),
      ),
    );

    await renderRoute("/search?q=headphones");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search is temporarily unavailable.");
    expect(alert).toHaveTextContent("Technical reference: req-search-123");
  });

  it("shows bounded autocomplete and uses a selected suggestion without treating it as authoritative data", async () => {
    useProductSearchApi();
    await renderRoute("/search");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Marketplace search");
    await user.type(input, "wire");
    await user.click(await screen.findByRole("button", { name: "Wireless Headphones" }));
    expect(input).toHaveValue("Wireless Headphones");
  });

  it("searches public stores and links the result to Module 4 public Store detail", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/search/stores`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("demo");
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: storeId,
              slug: "demo-store",
              name: "Demo Store",
              description: "Public store description",
              logoFileId: null,
              defaultCurrency: "USD",
              supportEmail: "support@example.test",
              seller: { id: sellerId, displayName: "Demo Seller" },
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        });
      }),
    );

    await renderRoute("/search/stores?q=demo");
    expect(await screen.findByRole("heading", { name: "Demo Store" })).toBeInTheDocument();
    const storeLink = screen.getByRole("link", { name: "View store" });
    expect(storeLink).toHaveAttribute("href", "/stores/demo-store");
  });
});
