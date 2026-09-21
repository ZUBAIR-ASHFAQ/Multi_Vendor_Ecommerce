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
const applicationId = "22222222-2222-4222-8222-222222222222";
const sellerId = "33333333-3333-4333-8333-333333333333";
const storeId = "44444444-4444-4444-8444-444444444444";
const fileId = "55555555-5555-4555-8555-555555555555";
const linkId = "66666666-6666-4666-8666-666666666666";
const staffUserId = "77777777-7777-4777-8777-777777777777";
const sellerManagerRoleId = "88888888-8888-4888-8888-888888888888";
const publicProductId = "99999999-9999-4999-8999-999999999999";
const publicProductFileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Creates one deterministic current actor for Module 4 frontend tests. */
function actor(
  accountType: "customer" | "seller" | "platform_admin",
  permissions: string[],
): AuthenticatedUser {
  return {
    id: userId,
    email: `${accountType}@example.com`,
    displayName: accountType === "platform_admin" ? "Admin" : "Marketplace User",
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: {
      sellerIds: accountType === "seller" ? [sellerId] : [],
      storeIds: accountType === "seller" ? [storeId] : [],
    },
  };
}

/** Registers /auth/me for one deterministic Module 4 actor. */
function useActor(
  accountType: "customer" | "seller" | "platform_admin",
  permissions: string[],
) {
  setAccessToken("module4-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: actor(accountType, permissions) }),
    ),
  );
}

/** Returns one seller application in the requested review state. */
function application(status: "submitted" | "approved" | "rejected" = "submitted") {
  return {
    id: applicationId,
    applicantUserId: userId,
    businessProfile: {
      legalName: "Example Seller LLC",
      displayName: "Example Seller",
      taxId: "TAX-100",
    },
    status,
    reviewedBy: status === "submitted" ? null : userId,
    reviewedAt: status === "submitted" ? null : new Date().toISOString(),
    reason: status === "rejected" ? "Incomplete verification" : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Returns one approved seller master used by seller profile/store tests. */
function seller() {
  return {
    id: sellerId,
    ownerUserId: userId,
    legalName: "Example Seller LLC",
    displayName: "Example Seller",
    taxId: "TAX-100",
    status: "active",
    approvalStatus: "approved",
    approvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Returns one seller-owned store response used by store setup tests. */
function store(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: storeId,
    sellerId,
    slug: "example-store",
    name: "Example Store",
    description: "Simple storefront",
    logoFileId: null,
    status: "active",
    defaultCurrency: "USD",
    supportEmail: "support@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Renders the application with one memory route and a fresh query cache. */
async function renderRoute(path: string) {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 4 Seller & Store Management UI", () => {
  it("prefers seller work over generic document navigation after seller approval", () => {
    const sellerActor = actor("seller", [
      "seller.profile.read",
      "seller.store.manage",
      "documents.upload",
      "documents.read",
      "documents.link",
    ]);

    expect(getPostLoginPath(sellerActor)).toBe("/seller/profile");
  });

  it("submits a customer seller application without client-owned approval fields", async () => {
    useActor("customer", []);
    let requestBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/sellers/applications`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ success: true, data: application() }, { status: 201 });
      }),
    );

    await renderRoute("/seller/apply");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Seller legal name"), "  Example Seller LLC  ");
    await user.type(screen.getByLabelText("Seller display name"), "Example Seller");
    await user.type(screen.getByLabelText("Seller tax ID"), "TAX-100");
    await user.click(screen.getByRole("button", { name: "Submit seller application" }));

    expect(await screen.findByText("Application submitted.")).toBeInTheDocument();
    expect(requestBody).toEqual({
      legalName: "Example Seller LLC",
      displayName: "Example Seller",
      taxId: "TAX-100",
    });
  });

  it("uploads optional seller verification to the submitted seller application resource", async () => {
    useActor("customer", ["documents.upload", "documents.link"]);
    let signBody: unknown;
    let linkBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/sellers/applications`, () =>
        HttpResponse.json({ success: true, data: application() }, { status: 201 }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/sign`, async ({ request }) => {
        signBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            fileId,
            uploadUrl: "https://storage.example.test/upload-verification",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            requiredHeaders: { "Content-Type": "application/pdf" },
          },
        });
      }),
      http.put(
        "https://storage.example.test/upload-verification",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/${fileId}/confirm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            file: {
              id: fileId,
              originalName: "verification.pdf",
              mimeType: "application/pdf",
              sizeBytes: 8,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            },
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/${fileId}/link`, async ({ request }) => {
        linkBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            link: {
              id: linkId,
              fileId,
              resourceType: "seller_application",
              resourceId: applicationId,
              purpose: "seller_verification",
              createdBy: userId,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }),
    );

    await renderRoute("/seller/apply");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Seller legal name"), "Example Seller LLC");
    await user.type(screen.getByLabelText("Seller display name"), "Example Seller");
    await user.click(screen.getByRole("button", { name: "Submit seller application" }));
    await screen.findByText("Application submitted.");

    const verification = new File(["evidence"], "verification.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Seller verification file"), verification);
    await user.click(screen.getByRole("button", { name: "Upload verification file" }));

    expect(await screen.findByText("Linked verification file: verification.pdf")).toBeInTheDocument();
    expect(signBody).toEqual({
      originalName: "verification.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      purpose: "seller_verification",
    });
    expect(linkBody).toEqual({
      resourceType: "seller_application",
      resourceId: applicationId,
      purpose: "seller_verification",
    });
  });

  it("loads the admin review queue and sends the explicit approve command", async () => {
    useActor("platform_admin", ["admin.sellers.review"]);
    let approveCalled = false;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/seller-applications`, () =>
        HttpResponse.json({
          success: true,
          data: [application()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/seller-applications/${applicationId}/approve`, async ({ request }) => {
        approveCalled = true;
        expect(await request.json()).toEqual({});
        return HttpResponse.json({
          success: true,
          data: { application: application("approved"), seller: seller() },
        });
      }),
    );

    await renderRoute("/admin/seller-applications");
    expect(await screen.findByRole("heading", { name: "Seller application queue" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByRole("heading", { name: "Example Seller" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve application" }));
    await waitFor(() => expect(approveCalled).toBe(true));
  });

  it("updates the seller profile and shows the server-owned staff summary", async () => {
    useActor("seller", ["seller.profile.read", "seller.profile.manage"]);
    let updateBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores: [],
            staffSummary: { totalCount: 3, activeCount: 2, inactiveCount: 1 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
      http.patch(`${env.VITE_API_BASE_URL}/sellers/me`, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: { ...seller(), displayName: "Updated Seller" },
        });
      }),
    );

    await renderRoute("/seller/profile");
    expect(await screen.findByText("3")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Seller profile display name"));
    await user.type(screen.getByLabelText("Seller profile display name"), "Updated Seller");
    await user.click(screen.getByRole("button", { name: "Save seller profile" }));

    expect(await screen.findByText("Seller profile saved.")).toBeInTheDocument();
    expect(updateBody).toEqual({
      legalName: "Example Seller LLC",
      displayName: "Updated Seller",
      taxId: "TAX-100",
    });
  });

  it("creates a normalized store and renders the returned store status", async () => {
    useActor("seller", ["seller.profile.read", "seller.store.manage"]);
    let stores: ReturnType<typeof store>[] = [];
    let createBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores,
            staffSummary: { totalCount: 1, activeCount: 1, inactiveCount: 0 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/sellers/me/stores`, async ({ request }) => {
        createBody = await request.json();
        stores = [store({ defaultCurrency: "PKR" })];
        return HttpResponse.json({ success: true, data: stores[0] }, { status: 201 });
      }),
    );

    await renderRoute("/seller/stores");
    expect(await screen.findByText("No stores have been created yet.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Store name"));
    await user.type(screen.getByLabelText("Store name"), "Example Store");
    await user.type(screen.getByLabelText("Store slug"), "Example-Store");
    await user.selectOptions(screen.getByLabelText("Store currency"), "PKR");
    await user.type(screen.getByLabelText("Store support email"), "SUPPORT@EXAMPLE.COM");
    await user.click(screen.getByRole("button", { name: "Create store" }));

    expect(await screen.findByRole("heading", { name: "Example Store" })).toBeInTheDocument();
    expect(createBody).toEqual({
      slug: "example-store",
      name: "Example Store",
      description: null,
      logoFileId: null,
      defaultCurrency: "PKR",
      supportEmail: "support@example.com",
    });
  });

  it("uploads and links a store_asset before assigning the confirmed logo file", async () => {
    useActor("seller", [
      "seller.profile.read",
      "seller.store.manage",
      "documents.upload",
      "documents.link",
    ]);
    let linkedBody: unknown;
    let updateBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores: [store()],
            staffSummary: { totalCount: 1, activeCount: 1, inactiveCount: 0 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/sign`, () =>
        HttpResponse.json({
          success: true,
          data: {
            fileId,
            uploadUrl: "https://storage.example.test/upload-logo",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            requiredHeaders: { "Content-Type": "image/png" },
          },
        }),
      ),
      http.put("https://storage.example.test/upload-logo", () => new HttpResponse(null, { status: 200 })),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/${fileId}/confirm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            file: {
              id: fileId,
              originalName: "logo.png",
              mimeType: "image/png",
              sizeBytes: 4,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            },
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/${fileId}/link`, async ({ request }) => {
        linkedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            link: {
              id: linkId,
              fileId,
              resourceType: "store",
              resourceId: storeId,
              purpose: "store_asset",
              createdBy: userId,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }),
      http.patch(`${env.VITE_API_BASE_URL}/sellers/me/stores/${storeId}`, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({ success: true, data: store({ logoFileId: fileId }) });
      }),
    );

    await renderRoute("/seller/stores");
    await screen.findByRole("heading", { name: "Example Store" });
    const user = userEvent.setup();
    const file = new File(["logo"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(`Store logo file ${storeId}`), file);
    await user.click(screen.getByRole("button", { name: "Upload logo" }));

    expect(await screen.findByText("Logo updated from logo.png.")).toBeInTheDocument();
    expect(linkedBody).toEqual({ resourceType: "store", resourceId: storeId, purpose: "store_asset" });
    expect(updateBody).toEqual({ logoFileId: fileId });
  });

  it("updates seller-controlled store status through the existing store PATCH command", async () => {
    useActor("seller", ["seller.profile.read", "seller.store.manage"]);
    let updateBody: unknown;
    let currentStore = store();
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores: [currentStore],
            staffSummary: { totalCount: 1, activeCount: 1, inactiveCount: 0 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
      http.patch(`${env.VITE_API_BASE_URL}/sellers/me/stores/${storeId}`, async ({ request }) => {
        updateBody = await request.json();
        currentStore = store({ status: "inactive" });
        return HttpResponse.json({ success: true, data: currentStore });
      }),
    );

    await renderRoute("/seller/stores");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Example Store" });
    await user.click(screen.getByRole("button", { name: "Edit store" }));
    await user.selectOptions(screen.getByLabelText(`Store status ${storeId}`), "inactive");
    await user.click(screen.getByRole("button", { name: "Save store" }));

    await waitFor(() => expect(updateBody).toBeTruthy());
    expect(updateBody).toEqual({
      slug: "example-store",
      name: "Example Store",
      description: "Simple storefront",
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: "support@example.com",
      status: "inactive",
    });
  });

  it("lets a seller owner find one exact-email user and assign a safe seller role", async () => {
    useActor("seller", ["seller.profile.read", "seller.staff.manage"]);
    let lookupSearch = "";
    let assignmentBody: unknown;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores: [],
            staffSummary: { totalCount: 1, activeCount: 1, inactiveCount: 0 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/roles`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: sellerManagerRoleId,
              code: "seller_manager",
              name: "Seller Manager",
              scopeType: "seller",
              description: "Seller management staff",
              isSystem: true,
              status: "active",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              permissions: [],
            },
          ],
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, ({ request }) => {
        lookupSearch = new URL(request.url).searchParams.get("search") ?? "";
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: staffUserId,
              email: "staff@example.com",
              displayName: "Staff User",
              accountType: "customer",
              status: "active",
              emailVerifiedAt: null,
              passwordChangedAt: null,
              lastLoginAt: null,
              failedLoginAttempts: 0,
              lockedUntil: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              roles: [],
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        });
      }),
      http.put(`${env.VITE_API_BASE_URL}/admin/users/${staffUserId}/roles`, async ({ request }) => {
        assignmentBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            id: staffUserId,
            email: "staff@example.com",
            displayName: "Staff User",
            accountType: "seller",
            status: "active",
            emailVerifiedAt: null,
            passwordChangedAt: null,
            lastLoginAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            roles: [
              {
                id: sellerManagerRoleId,
                code: "seller_manager",
                name: "Seller Manager",
                scopeType: "seller",
                sellerId,
                isSystem: true,
                status: "active",
              },
            ],
          },
        });
      }),
    );

    await renderRoute("/seller/staff");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Seller staff email"), "STAFF@EXAMPLE.COM");
    await user.click(screen.getByRole("button", { name: "Find staff user" }));
    expect(await screen.findByRole("heading", { name: "Staff User" })).toBeInTheDocument();
    expect(lookupSearch).toBe("staff@example.com");

    await user.selectOptions(screen.getByLabelText("Seller staff role"), sellerManagerRoleId);
    await user.click(screen.getByRole("button", { name: "Save seller access" }));

    await waitFor(() => expect(assignmentBody).toEqual({
      assignments: [{ roleId: sellerManagerRoleId, sellerId }],
    }));
    expect(await screen.findByText("Seller staff access saved.")).toBeInTheDocument();
  });

  it("shows seller staff management from the seller profile when the owner has permission", async () => {
    useActor("seller", ["seller.profile.read", "seller.staff.manage"]);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/sellers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            seller: seller(),
            stores: [],
            staffSummary: { totalCount: 1, activeCount: 1, inactiveCount: 0 },
            supportedCurrencies: ["PKR", "USD"],
            defaultCurrency: "USD",
          },
        }),
      ),
    );

    await renderRoute("/seller/profile");
    expect(await screen.findByRole("link", { name: "Manage seller staff access" })).toHaveAttribute(
      "href",
      "/seller/staff",
    );
  });

  it("sends the explicit admin seller suspension command from the protected frontend page", async () => {
    useActor("platform_admin", ["admin.sellers.suspend"]);
    let suspendBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/admin/sellers/${sellerId}/suspend`, async ({ request }) => {
        suspendBody = await request.json();
        return HttpResponse.json({ success: true, data: { ...seller(), status: "suspended" } });
      }),
    );

    await renderRoute("/admin/sellers/suspend");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Seller ID to suspend"), sellerId);
    await user.type(screen.getByLabelText("Seller suspension reason"), "Compliance review");
    await user.click(screen.getByRole("button", { name: "Suspend seller" }));
    expect(screen.getByRole("alertdialog", { name: "Suspend this seller?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm suspension" }));

    await waitFor(() => expect(suspendBody).toEqual({ reason: "Compliance review" }));
    expect(await screen.findByText("Seller Example Seller is now suspended.")).toBeInTheDocument();
  });

  it("renders a shoppable public-safe storefront without loading an authenticated actor", async () => {
    let productStoreFilter = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/stores/example-store`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: storeId,
            slug: "example-store",
            name: "Example Store",
            description: "Simple storefront",
            logoFileId: fileId,
            defaultCurrency: "USD",
            supportEmail: "support@example.com",
            seller: { id: sellerId, displayName: "Example Seller" },
          },
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/products`, ({ request }) => {
        productStoreFilter = new URL(request.url).searchParams.get("storeId") ?? "";
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: publicProductId,
              storeId,
              categoryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              brandId: null,
              slug: "store-product",
              name: "Store Product",
              description: "Published store product",
              minPrice: "29.00",
              maxPrice: "29.00",
              currency: "USD",
              thumbnailFileId: publicProductFileId,
              publishedAt: "2026-09-20T10:00:00.000Z",
              createdAt: "2026-09-20T10:00:00.000Z",
              updatedAt: "2026-09-20T10:00:00.000Z",
            },
          ],
          meta: { page: 1, pageSize: 12, totalItems: 1, totalPages: 1 },
        });
      }),
      http.post(`${env.VITE_API_BASE_URL}/media/public/resolve`, async ({ request }) => {
        const body = await request.json() as { fileIds: string[] };
        return HttpResponse.json({
          success: true,
          data: {
            items: body.fileIds.map((resolvedFileId) => ({
              fileId: resolvedFileId,
              url: `https://media.example.test/${resolvedFileId}.jpg`,
              mimeType: "image/jpeg",
              expiresAt: "2026-09-20T10:15:00.000Z",
            })),
          },
        });
      }),
      http.get(`${env.VITE_API_BASE_URL}/stores/${storeId}/reviews`, () =>
        HttpResponse.json({
          success: true,
          data: { reviews: [], rating: { ratingAvg: 0, ratingCount: 0 } },
          meta: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
        }),
      ),
    );

    await renderRoute("/stores/example-store");
    expect(await screen.findByRole("heading", { name: "Example Store" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Store Product" })).toBeInTheDocument();
    expect(productStoreFilter).toBe(storeId);
    expect(screen.getByText("Sold by Example Seller")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Example Store logo" })).toBeInTheDocument();
    expect(screen.queryByText("Example Seller LLC")).not.toBeInTheDocument();
    expect(screen.queryByText("TAX-100")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Reviews" }));
    expect(await screen.findByRole("heading", { name: "Store Reviews" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.getByRole("link", { name: "support@example.com" })).toHaveAttribute(
      "href",
      "mailto:support@example.com",
    );
  });

  it("shows a permission state before a seller without store permission calls store APIs", async () => {
    useActor("seller", ["seller.profile.read"]);
    await renderRoute("/seller/stores");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  });
});
