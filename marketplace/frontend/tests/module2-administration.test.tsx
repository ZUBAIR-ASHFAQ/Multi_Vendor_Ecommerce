import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { createQueryClient } from "@/lib/query-client";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

/** Builds one authenticated platform actor with the requested permissions. */
function actor(permissions: string[]) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@example.com",
    displayName: "Admin",
    accountType: "platform_admin",
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

afterEach(() => clearAccessToken());

describe("Module 2 administration UI", () => {
  it("renders users for an authorized actor", async () => {
    setAccessToken("token");
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(["admin.users.read"]) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              email: "user@example.com",
              displayName: "Test User",
              accountType: "platform_admin",
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
        }),
      ),
    );

    const router = createTestRouter(["/admin/users"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByText("Test User")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create user" })).not.toBeInTheDocument();
    const navigation = screen.getByLabelText("Administration navigation");
    expect(within(navigation).getByText("Access")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: /Users/ })).toBeInTheDocument();
    expect(within(navigation).queryByText("Commerce")).not.toBeInTheDocument();
  });

  it("groups the complete admin operating system by business domain without bypassing permissions", async () => {
    setAccessToken("token");
    const permissions = [
      "dashboard.read",
      "admin.orders.read",
      "admin.payments.read",
      "admin.returns.manage",
      "admin.reviews.moderate",
      "admin.sellers.review",
      "admin.sellers.suspend",
      "admin.customers.read",
      "admin.products.review",
      "admin.promotions.manage",
      "catalog.manage_categories",
      "catalog.manage_brands",
      "catalog.manage_attributes",
      "admin.commissions.read",
      "admin.payouts.read",
      "admin.notifications.read",
      "reports.sales.read",
      "documents.read",
      "audit.read",
      "admin.users.read",
      "admin.roles.read",
      "admin.settings.manage",
    ];

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(permissions) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
        }),
      ),
    );

    const router = createTestRouter(["/admin/users"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
    const navigation = screen.getByLabelText("Administration navigation");
    for (const group of ["Overview", "Commerce", "Marketplace", "Catalog", "Finance", "Operations", "Access"]) {
      expect(within(navigation).getByText(group)).toBeInTheDocument();
    }
    expect(within(navigation).getByRole("link", { name: /Reviews/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: /Product approvals/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: /Commission rules/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: /Notification failures/ })).toBeInTheDocument();
  });


  it("shows a safe users error and retries the failed query", async () => {
    setAccessToken("token");
    let requestCount = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(["admin.users.read"]) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              success: false,
              error: { code: "ADMIN_USERS_UNAVAILABLE", message: "Users are temporarily unavailable." },
              requestId: "req-users-retry",
            },
            { status: 503 },
          );
        }

        return HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-users-recovered",
        });
      }),
    );

    const router = createTestRouter(["/admin/users"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Users are temporarily unavailable.");
    expect(alert).toHaveTextContent("Technical reference: req-users-retry");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
    expect(requestCount).toBe(2);
  });

  it("shows an explicit empty state when the role catalog has no rows", async () => {
    setAccessToken("token");
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(["admin.roles.read"]) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/roles`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          requestId: "req-empty-roles",
        }),
      ),
    );

    const router = createTestRouter(["/admin/roles"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByText("No roles found.")).toBeInTheDocument();
  });

  it("does not request the role catalog when the actor cannot read roles", async () => {
    setAccessToken("token");
    const targetUserId = "22222222-2222-4222-8222-222222222222";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(["admin.users.read"]) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: targetUserId,
              email: "user@example.com",
              displayName: "Test User",
              accountType: "platform_admin",
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
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      ),
    );

    const router = createTestRouter([`/admin/users/${targetUserId}`]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Test User" })).toBeInTheDocument();
    expect(
      screen.getByText(/cannot read the role catalog/i),
    ).toBeInTheDocument();
  });

  it("refreshes user detail after a status mutation", async () => {
    setAccessToken("token");
    const targetUserId = "22222222-2222-4222-8222-222222222222";
    let currentStatus: "active" | "inactive" = "active";
    let userReads = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({
          success: true,
          data: actor(["admin.users.read", "admin.users.status.manage"]),
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () => {
        userReads += 1;
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: targetUserId,
              email: "user@example.com",
              displayName: "Refresh User",
              accountType: "platform_admin",
              status: currentStatus,
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
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        });
      }),
      http.patch(`${env.VITE_API_BASE_URL}/admin/users/${targetUserId}/status`, async ({ request }) => {
        const body = (await request.json()) as { status: "active" | "inactive" };
        currentStatus = body.status;
        return HttpResponse.json({
          success: true,
          data: {
            id: targetUserId,
            email: "user@example.com",
            displayName: "Refresh User",
            accountType: "platform_admin",
            status: currentStatus,
            emailVerifiedAt: null,
            passwordChangedAt: null,
            lastLoginAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            roles: [],
          },
        });
      }),
    );

    const router = createTestRouter([`/admin/users/${targetUserId}`]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Refresh User" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Status"), "inactive");
    await user.click(screen.getByRole("button", { name: "Save status" }));

    await waitFor(() => expect(userReads).toBeGreaterThan(1));
    expect(await screen.findByText("inactive")).toBeInTheDocument();
  });

  it("groups role permissions by backend domain on role detail", async () => {
    setAccessToken("token");
    const roleId = "33333333-3333-4333-8333-333333333333";

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({
          success: true,
          data: actor(["admin.roles.read", "admin.roles.permissions.manage"]),
        }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/roles`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: roleId,
              code: "ops_manager",
              name: "Operations Manager",
              description: "Cross-domain operations access",
              scopeType: "platform",
              isSystem: false,
              status: "active",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              permissions: [
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  code: "catalog.manage_categories",
                  domain: "catalog",
                  description: "Manage category hierarchy",
                },
                {
                  id: "55555555-5555-4555-8555-555555555555",
                  code: "admin.orders.read",
                  domain: "orders",
                  description: "Read platform orders",
                },
              ],
            },
          ],
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      ),
    );

    const router = createTestRouter([`/admin/roles/${roleId}`]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Operations Manager" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "catalog" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByText("catalog.manage_categories")).toBeInTheDocument();
    expect(screen.getByText("admin.orders.read")).toBeInTheDocument();
  });

  it("does not register the removed permissions page", async () => {
    setAccessToken("token");

    const router = createTestRouter(["/admin/permissions"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("loads and updates allow-listed platform settings", async () => {
    setAccessToken("token");
    let patchBody: unknown;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
        HttpResponse.json({ success: true, data: actor(["admin.settings.manage"]) }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/settings`, () =>
        HttpResponse.json({
          success: true,
          data: {
            settings: [
              {
                key: "commerce.supported_currencies",
                value: ["USD", "EUR"],
                updatedBy: null,
                updatedAt: new Date().toISOString(),
              },
              {
                key: "commerce.default_currency",
                value: "USD",
                updatedBy: null,
                updatedAt: new Date().toISOString(),
              },
              {
                key: "commerce.default_tax_rate_percent",
                value: 5,
                updatedBy: null,
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        }),
      ),
      http.patch(`${env.VITE_API_BASE_URL}/admin/settings`, async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ success: true, data: { settings: [] } });
      }),
    );

    const router = createTestRouter(["/admin/settings"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Platform settings" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Supported currencies"));
    await user.type(screen.getByLabelText("Supported currencies"), "USD, GBP");
    await user.clear(screen.getByLabelText("Default currency"));
    await user.type(screen.getByLabelText("Default currency"), "GBP");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("Platform settings saved.")).toBeInTheDocument();
    expect(patchBody).toEqual({
      settings: [
        { key: "commerce.supported_currencies", value: ["USD", "GBP"] },
        { key: "commerce.default_currency", value: "GBP" },
        { key: "commerce.default_tax_rate_percent", value: 5 },
      ],
    });
  });
});
