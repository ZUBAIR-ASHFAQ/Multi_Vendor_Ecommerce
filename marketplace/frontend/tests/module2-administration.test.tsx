import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
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
    expect(alert).toHaveTextContent("Request ID: req-users-retry");

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
