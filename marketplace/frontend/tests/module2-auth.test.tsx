import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { createQueryClient } from "@/lib/query-client";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const adminUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  displayName: "Admin",
  accountType: "platform_admin",
  status: "active",
  roles: [],
  permissions: ["admin.users.read"],
  scopes: { sellerIds: [], storeIds: [] },
};

afterEach(() => clearAccessToken());

/** Creates the shared login session payload used by Module 2 authentication tests. */
function adminSession() {
  return {
    accessToken: "access",
    expiresInSeconds: 900,
    user: adminUser,
  };
}

describe("Module 2 authentication UI", () => {
  it("logs in and navigates to the first authorized administration page", async () => {
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: true, data: adminSession() }),
      ),
      http.get(`${env.VITE_API_BASE_URL}/admin/users`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
        }),
      ),
    );

    const router = createTestRouter(["/login"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPassword!23");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
  });

  it("routes a customer without administration permissions to the account page", async () => {
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({
          success: true,
          data: {
            accessToken: "customer-access",
            expiresInSeconds: 900,
            user: {
              ...adminUser,
              id: "22222222-2222-4222-8222-222222222222",
              email: "customer@example.com",
              displayName: "Customer",
              accountType: "customer",
              permissions: [],
            },
          },
        }),
      ),
    );

    const router = createTestRouter(["/login"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "customer@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPassword!23");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(screen.getByText("Customer", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Customer account navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument();
  });

  it("shows a safe account error and retries the authenticated actor request", async () => {
    setAccessToken("token");
    let requestCount = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/auth/me`, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              success: false,
              error: { code: "INTERNAL_ERROR", message: "Account service is temporarily unavailable." },
              requestId: "req-auth-retry",
            },
            { status: 503 },
          );
        }

        return HttpResponse.json({
          success: true,
          data: adminUser,
          requestId: "req-auth-recovered",
        });
      }),
    );

    const router = createTestRouter(["/account"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Account service is temporarily unavailable.");
    expect(alert).toHaveTextContent("Request ID: req-auth-retry");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Customer account navigation" })).not.toBeInTheDocument();
    expect(requestCount).toBe(2);
  });

  it("registers a customer without exposing role or account-type fields", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/auth/register`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            success: true,
            data: {
              id: "33333333-3333-4333-8333-333333333333",
              email: "new.customer@example.com",
              displayName: "New Customer",
              accountType: "customer",
              status: "active",
            },
          },
          { status: 201 },
        );
      }),
    );

    const router = createTestRouter(["/register"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Display name"), "New Customer");
    await user.type(screen.getByLabelText("Email"), "new.customer@example.com");
    await user.type(screen.getByLabelText("Password"), "CustomerPassword!123");
    await user.type(screen.getByLabelText("Confirm password"), "CustomerPassword!123");
    await user.click(screen.getByRole("button", { name: "Create customer account" }));

    expect(await screen.findByText(/customer account created/i)).toBeInTheDocument();
    expect(receivedBody).toEqual({
      displayName: "New Customer",
      email: "new.customer@example.com",
      password: "CustomerPassword!123",
    });
  });

  it("shows a stable login validation error", async () => {
    const router = createTestRouter(["/login"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });
});
