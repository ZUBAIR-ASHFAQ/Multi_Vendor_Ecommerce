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
const inventoryId = "44444444-4444-4444-8444-444444444444";
const variantId = "55555555-5555-4555-8555-555555555555";
const movementId = "66666666-6666-4666-8666-666666666666";

/** Creates one deterministic seller actor for Module 7 frontend tests. */
function sellerActor(permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: "inventory-seller@example.com",
    displayName: "Inventory Seller",
    accountType: "seller",
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [sellerId], storeIds: [storeId] },
  };
}

/** Registers the authenticated seller returned by /auth/me. */
function useSeller(permissions: string[]): void {
  setAccessToken("module7-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: sellerActor(permissions) }),
    ),
  );
}

/** Returns one deterministic seller-safe Inventory row. */
function inventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: inventoryId,
    sellerId,
    storeId,
    variantId,
    onHandQty: 10,
    reservedQty: 2,
    availableQty: 8,
    reorderLevel: 3,
    createdAt: "2026-09-07T10:00:00.000Z",
    updatedAt: "2026-09-07T10:00:00.000Z",
    ...overrides,
  };
}

/** Renders one application route with a fresh TanStack Query cache. */
async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 7 Inventory & Stock UI", () => {
  it("routes an Inventory-only seller to the Inventory table after login", () => {
    expect(getPostLoginPath(sellerActor(["inventory.read"]))).toBe("/seller/inventory");
  });

  it("renders authoritative stock columns and sends the documented low-stock filter", async () => {
    useSeller(["inventory.read"]);
    let lowStockFilter: string | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/inventory`, ({ request }) => {
        lowStockFilter = new URL(request.url).searchParams.get("lowStock");
        return HttpResponse.json({
          success: true,
          data: [inventoryItem()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        });
      }),
    );

    await renderRoute("/seller/inventory");
    expect(await screen.findByText("Inventory & Stock")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "On hand" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Reserved" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Available" })).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Only low stock"));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(lowStockFilter).toBe("true"));
  });

  it("adjusts physical stock and updates the reorder threshold through explicit commands", async () => {
    useSeller(["inventory.read", "inventory.adjust", "inventory.reorder.manage"]);
    let item = inventoryItem();
    let adjustmentBody: unknown;
    let reorderBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/inventory`, () =>
        HttpResponse.json({
          success: true,
          data: [item],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/seller/inventory/${variantId}/adjust`, async ({ request }) => {
        adjustmentBody = await request.json();
        item = inventoryItem({ onHandQty: 15, availableQty: 13, updatedAt: "2026-09-07T10:05:00.000Z" });
        return HttpResponse.json({ success: true, data: item });
      }),
      http.patch(`${env.VITE_API_BASE_URL}/seller/inventory/${variantId}/reorder-level`, async ({ request }) => {
        reorderBody = await request.json();
        item = inventoryItem({ onHandQty: 15, availableQty: 13, reorderLevel: 5, updatedAt: "2026-09-07T10:06:00.000Z" });
        return HttpResponse.json({ success: true, data: item });
      }),
    );

    await renderRoute("/seller/inventory");
    const user = userEvent.setup();
    await screen.findByText("Inventory & Stock");
    await user.click(screen.getByRole("button", { name: "Manage" }));

    await user.type(screen.getByLabelText("Inventory quantity adjustment"), "5");
    await user.click(screen.getByRole("button", { name: "Apply adjustment" }));
    await waitFor(() => expect(adjustmentBody).toEqual({ quantityDelta: 5 }));
    expect(await screen.findByText("15")).toBeInTheDocument();

    const reorderInput = screen.getByLabelText("Inventory reorder level");
    await user.clear(reorderInput);
    await user.type(reorderInput, "5");
    await user.click(screen.getByRole("button", { name: "Save threshold" }));
    await waitFor(() => expect(reorderBody).toEqual({ reorderLevel: 5 }));
  });


  it("initializes a new Product variant through the direct Inventory management route", async () => {
    useSeller(["inventory.read", "inventory.adjust"]);
    let adjustmentBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/seller/inventory/${variantId}/adjust`, async ({ request }) => {
        adjustmentBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: inventoryItem({ onHandQty: 6, reservedQty: 0, availableQty: 6, reorderLevel: null }),
        });
      }),
    );

    await renderRoute(`/seller/inventory/${variantId}/manage`);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Manage variant Inventory" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Inventory quantity adjustment"), "6");
    await user.click(screen.getByRole("button", { name: "Apply adjustment" }));

    await waitFor(() => expect(adjustmentBody).toEqual({ quantityDelta: 6 }));
    expect((await screen.findAllByText("6")).length).toBeGreaterThanOrEqual(2);
  });

  it("renders immutable movement history for one seller-owned variant", async () => {
    useSeller(["inventory.read"]);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/seller/inventory/${variantId}/movements`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: movementId,
              inventoryItemId: inventoryId,
              movementType: "adjustment",
              quantityDelta: 10,
              sourceType: "seller_adjustment",
              sourceId: null,
              occurredAt: "2026-09-07T10:00:00.000Z",
              actorUserId: userId,
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }),
      ),
    );

    await renderRoute(`/seller/inventory/${variantId}/movements`);
    expect(await screen.findByRole("heading", { name: "Stock movement history" })).toBeInTheDocument();
    expect(screen.getByText("adjustment")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("seller adjustment")).toBeInTheDocument();
  });
});
