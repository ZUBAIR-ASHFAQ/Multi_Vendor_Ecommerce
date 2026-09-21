import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { AdminReviewModerationActions } from "@/features/reviews/components/admin-review-moderation-actions";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { createQueryClient } from "@/lib/query-client";
import { server } from "./setup/msw-server";

const customerId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const sellerId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const orderItemId = "66666666-6666-4666-8666-666666666666";
const reviewId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-15T12:00:00.000Z";

/** Clears the in-memory access token after every isolated Module 15 frontend test. */
afterEach(() => clearAccessToken());

/** Builds one authenticated actor with only the permissions under test. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: customerId,
    email: `${accountType}@example.com`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers the authenticated actor returned by the shared /auth/me endpoint. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module15-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-review" }),
    ),
  );
}

/** Builds one public privacy-safe Review card. */
function publicReview(helpfulCount = 2) {
  return {
    id: reviewId,
    rating: 5,
    title: "Excellent purchase",
    body: "Arrived exactly as described.",
    verifiedPurchase: true,
    helpfulCount,
    publishedAt: now,
    updatedAt: now,
  };
}

/** Builds one authenticated Review response returned by write/moderation commands. */
function reviewResponse(status: "pending" | "published" | "hidden" = "pending") {
  return {
    id: reviewId,
    orderItemId,
    productId,
    sellerId,
    storeId,
    rating: 5,
    title: "Excellent purchase",
    body: "Arrived exactly as described.",
    status,
    verifiedPurchase: true,
    helpfulCount: 0,
    publishedAt: status === "published" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Builds one privacy-safe moderation queue row without customer or Order identity. */
function adminReviewResponse(status: "pending" | "published" | "hidden" = "pending") {
  const review = reviewResponse(status);
  return {
    id: review.id,
    productId: review.productId,
    sellerId: review.sellerId,
    storeId: review.storeId,
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    verifiedPurchase: review.verifiedPurchase,
    helpfulCount: review.helpfulCount,
    publishedAt: review.publishedAt,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 15 Reviews & Ratings React feature", () => {
  it("renders published Product Reviews, rating aggregate, privacy-safe fields, and Helpful replay UI", async () => {
    setAccessToken("module15-public-reader");
    let helpfulPosts = 0;
    let helpfulCount = 2;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/products/widget`, () =>
        HttpResponse.json({
          success: true,
          data: { id: productId, name: "Widget", description: "A public widget", variants: [], media: [] },
          requestId: "req-product",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/products/${productId}/reviews`, () =>
        HttpResponse.json({
          success: true,
          data: { reviews: [publicReview(helpfulCount)], rating: { ratingAvg: 5, ratingCount: 1 } },
          meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          requestId: "req-product-reviews",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/reviews/${reviewId}/helpful`, () => {
        helpfulPosts += 1;
        helpfulCount = 3;
        return HttpResponse.json({
          success: true,
          data: { reviewId, helpfulCount, markedHelpful: true },
          requestId: "req-helpful",
        });
      }),
    );

    await renderRoute("/products/widget");
    expect(await screen.findByRole("heading", { name: "Customer Reviews" })).toBeInTheDocument();
    expect(screen.getByText("5.0")).toBeInTheDocument();
    expect(screen.getByText("Excellent purchase")).toBeInTheDocument();
    expect(screen.getByText("Verified purchase")).toBeInTheDocument();
    expect(screen.queryByText(customerId)).not.toBeInTheDocument();
    expect(screen.queryByText(orderItemId)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(helpfulPosts).toBe(1));
    expect(await screen.findByText("3 helpful")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marked helpful" })).toBeDisabled();
  });

  it("renders the canonical Store rating and published Store Reviews", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/stores/store-one`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: storeId,
            slug: "store-one",
            name: "Store One",
            description: "Trusted seller",
            logoFileId: null,
            defaultCurrency: "USD",
            supportEmail: null,
            seller: { id: sellerId, displayName: "Seller One" },
          },
          requestId: "req-store",
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/products`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 12, totalItems: 0, totalPages: 0 },
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/stores/${storeId}/reviews`, () =>
        HttpResponse.json({
          success: true,
          data: { reviews: [publicReview()], rating: { ratingAvg: 4.5, ratingCount: 8 } },
          meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          requestId: "req-store-reviews",
        }),
      ),
    );

    await renderRoute("/stores/store-one");
    expect(await screen.findByRole("heading", { name: "Store One" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Reviews" }));
    expect(await screen.findByRole("heading", { name: "Store Reviews" })).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("8 reviews")).toBeInTheDocument();
  });

  it("creates a Review with only Order Item and authored fields, then exposes the returned edit form", async () => {
    useActor(actor("customer", ["reviews.create_verified", "reviews.update_own"]));
    let postedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${env.VITE_API_BASE_URL}/reviews`, async ({ request }) => {
        postedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: reviewResponse(), requestId: "req-review-create" }, { status: 201 });
      }),
    );

    await renderRoute(`/orders/${orderId}/reviews/${orderItemId}/new`);
    expect(await screen.findByRole("heading", { name: "Review your purchase" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Review rating"), "5");
    await user.type(screen.getByLabelText("Review title"), "Excellent purchase");
    await user.type(screen.getByLabelText("Review body"), "Arrived exactly as described.");
    await user.click(screen.getByRole("button", { name: "Submit Review" }));

    await waitFor(() => expect(postedBody).toEqual({
      orderItemId,
      rating: 5,
      title: "Excellent purchase",
      body: "Arrived exactly as described.",
    }));
    expect(postedBody).not.toHaveProperty("verifiedPurchase");
    expect(postedBody).not.toHaveProperty("productId");
    expect(postedBody).not.toHaveProperty("sellerId");
    expect(postedBody).not.toHaveProperty("storeId");
    expect(postedBody).not.toHaveProperty("status");
    expect(await screen.findByText(/Pending moderation/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit your Review" })).toBeInTheDocument();
  });

  it("shows the stable duplicate Review conflict without inventing a client eligibility override", async () => {
    useActor(actor("customer", ["reviews.create_verified"]));
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/reviews`, () =>
        HttpResponse.json({
          success: false,
          error: { code: "REVIEW_ALREADY_EXISTS", message: "Review already exists" },
          requestId: "req-review-duplicate",
        }, { status: 409 }),
      ),
    );

    await renderRoute(`/orders/${orderId}/reviews/${orderItemId}/new`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Submit Review" }));
    expect(await screen.findByText("Review already exists")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-review-duplicate")).toBeInTheDocument();
  });

  it("renders the admin moderation queue through the approved read route without customer identity", async () => {
    useActor(actor("platform_admin", ["admin.reviews.moderate"]));
    let requestedStatus = "";
    let requestedSort = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/reviews`, ({ request }) => {
        const url = new URL(request.url);
        requestedStatus = url.searchParams.get("status") ?? "";
        requestedSort = url.searchParams.get("sort") ?? "";
        return HttpResponse.json({
          success: true,
          data: [adminReviewResponse("pending")],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-reviews",
        });
      }),
    );

    await renderRoute("/admin/reviews");

    expect(await screen.findByRole("heading", { name: "Review moderation queue" })).toBeInTheDocument();
    expect(await screen.findByText("Excellent purchase")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Moderate" }));
    expect(requestedStatus).toBe("pending");
    expect(requestedSort).toBe("created_desc");
    expect(screen.getByText(productId)).toBeInTheDocument();
    expect(screen.getByText(storeId)).toBeInTheDocument();
    expect(screen.getByText(sellerId)).toBeInTheDocument();
    expect(screen.queryByText(customerId)).not.toBeInTheDocument();
    expect(screen.queryByText(orderItemId)).not.toBeInTheDocument();
    expect(screen.queryByText("platform_admin@example.com")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Review" })).toBeInTheDocument();
  });

  it("blocks the admin moderation queue when the actor lacks admin.reviews.moderate", async () => {
    useActor(actor("platform_admin", []));
    let adminListRequests = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/reviews`, () => {
        adminListRequests += 1;
        return HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-admin-reviews-denied",
        });
      }),
    );

    await renderRoute("/admin/reviews");

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(adminListRequests).toBe(0);
  });

  it("keeps moderation UI limited to the two approved command endpoints with an explicit reason", async () => {
    let hiddenBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/admin/reviews/${reviewId}/hide`, async ({ request }) => {
        hiddenBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: reviewResponse("hidden"), requestId: "req-review-hide" });
      }),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AdminReviewModerationActions reviewId={reviewId} status="pending" />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Hide Review reason"), "Contains prohibited content");
    await user.click(screen.getByRole("button", { name: "Hide Review" }));
    expect(screen.getByRole("alertdialog", { name: "Hide this Review?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm hide" }));
    await waitFor(() => expect(hiddenBody).toEqual({ reason: "Contains prohibited content" }));
    expect(hiddenBody).not.toHaveProperty("status");
  });
});
