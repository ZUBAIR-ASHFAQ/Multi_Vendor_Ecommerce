import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const customerId = "11111111-1111-4111-8111-111111111111";
const addressId = "22222222-2222-4222-8222-222222222222";

/** Creates one deterministic authenticated actor for customer frontend tests. */
function actor(permissions: string[], accountType: "customer" | "platform_admin" = "customer") {
  return {
    id: customerId,
    email: accountType === "customer" ? "customer@example.com" : "admin@example.com",
    displayName: accountType === "customer" ? "Customer Jane" : "Admin",
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers the current-user endpoint for one deterministic Module 3 actor. */
function useActor(permissions: string[], accountType: "customer" | "platform_admin" = "customer") {
  setAccessToken("module3-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: actor(permissions, accountType) }),
    ),
  );
}

/** Returns one active address response used by address and admin-detail tests. */
function address(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: addressId,
    customerUserId: customerId,
    label: "Home",
    recipientName: "Customer Jane",
    phone: "+1 555 0100",
    line1: "10 Main Street",
    line2: null,
    city: "Austin",
    region: "Texas",
    postalCode: "78701",
    countryCode: "US",
    isDefaultShipping: true,
    isDefaultBilling: false,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Fills the required create-address fields with valid values. */
async function fillAddressForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Address label"), "Home");
  await user.type(screen.getByLabelText("Recipient name"), "Customer Jane");
  await user.type(screen.getByLabelText("Address phone"), "+1 555 0100");
  await user.type(screen.getByLabelText("Address line 1"), "10 Main Street");
  await user.type(screen.getByLabelText("City"), "Austin");
  await user.type(screen.getByLabelText("Region"), "Texas");
  await user.type(screen.getByLabelText("Country code"), "us");
}

describe("Module 3 Customer Management UI", () => {
  it("loads and updates the authenticated customer profile without exposing authority fields", async () => {
    useActor([
      "customer.profile.read_own",
      "customer.profile.update_own",
      "customer.address.manage_own",
    ]);
    let updateBody: unknown;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/customers/me`, () =>
        HttpResponse.json({
          success: true,
          data: {
            userId: customerId,
            displayName: "Customer Jane",
            phone: "+1 555 0100",
            status: "active",
            marketingOptIn: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      ),
      http.patch(`${env.VITE_API_BASE_URL}/customers/me`, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            userId: customerId,
            displayName: "Jane Updated",
            phone: null,
            status: "active",
            marketingOptIn: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }),
    );

    const router = createTestRouter(["/customer/profile"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Customer Jane" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Order summary" })).toHaveAttribute("href", "#order-summary");

    await user.clear(screen.getByLabelText("Customer display name"));
    await user.type(screen.getByLabelText("Customer display name"), "Jane Updated");
    await user.clear(screen.getByLabelText("Customer phone"));
    await user.click(screen.getByLabelText("Marketing opt in"));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
    expect(updateBody).toEqual({
      displayName: "Jane Updated",
      phone: null,
      marketingOptIn: true,
    });
  });

  it("creates, changes defaults, and archives saved addresses with normalized input", async () => {
    useActor(["customer.address.manage_own"]);
    let addresses: ReturnType<typeof address>[] = [];
    let createBody: unknown;
    let updateBody: unknown;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json({ success: true, data: addresses }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/customers/me/addresses`, async ({ request }) => {
        createBody = await request.json();
        addresses = [address()];
        return HttpResponse.json({ success: true, data: addresses[0] }, { status: 201 });
      }),
      http.patch(`${env.VITE_API_BASE_URL}/customers/me/addresses/${addressId}`, async ({ request }) => {
        updateBody = await request.json();
        addresses = [address({ isDefaultBilling: true })];
        return HttpResponse.json({ success: true, data: addresses[0] });
      }),
      http.delete(`${env.VITE_API_BASE_URL}/customers/me/addresses/${addressId}`, () => {
        addresses = [];
        return HttpResponse.json({ success: true, data: { archived: true } });
      }),
    );

    const router = createTestRouter(["/customer/addresses"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    expect(await screen.findByText("No saved addresses yet.")).toBeInTheDocument();
    await fillAddressForm(user);
    await user.click(screen.getByLabelText("Default shipping address"));
    await user.click(screen.getByRole("button", { name: "Add address" }));

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(createBody).toEqual({
      label: "Home",
      recipientName: "Customer Jane",
      phone: "+1 555 0100",
      line1: "10 Main Street",
      line2: null,
      city: "Austin",
      region: "Texas",
      postalCode: null,
      countryCode: "US",
      isDefaultShipping: true,
      isDefaultBilling: false,
    });

    await user.click(screen.getByRole("button", { name: "Make billing default" }));
    expect(await screen.findByText("Default billing")).toBeInTheDocument();
    expect(updateBody).toEqual({ isDefaultBilling: true });

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("No saved addresses yet.")).toBeInTheDocument();
  });

  it("shows a safe conflict message when a default-address write races", async () => {
    useActor(["customer.address.manage_own"]);
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/customers/me/addresses`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "CONFLICT", message: "The default address changed. Please retry." },
            requestId: "request-module3",
          },
          { status: 409 },
        ),
      ),
    );

    const router = createTestRouter(["/customer/addresses"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Address book" });
    await fillAddressForm(user);
    await user.click(screen.getByRole("button", { name: "Add address" }));

    expect(await screen.findByText("The default address changed. Please retry.")).toBeInTheDocument();
  });

  it("searches customers and opens permission-scoped admin detail without fake order data", async () => {
    useActor(["admin.customers.read"], "platform_admin");
    let listUrl: URL | null = null;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/customers`, ({ request }) => {
        listUrl = new URL(request.url);
        return HttpResponse.json({
          success: true,
          data: [
            {
              userId: customerId,
              email: "customer@example.com",
              accountStatus: "active",
              profileStatus: "active",
              displayName: "Customer Jane",
              phone: "+1 555 0100",
              marketingOptIn: false,
              addressCount: 1,
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        });
      }),
      http.get(`${env.VITE_API_BASE_URL}/admin/customers/${customerId}`, () =>
        HttpResponse.json({
          success: true,
          data: {
            customer: {
              userId: customerId,
              email: "customer@example.com",
              accountStatus: "active",
              profileStatus: "active",
              displayName: "Customer Jane",
              phone: "+1 555 0100",
              marketingOptIn: false,
              addressCount: 1,
              createdAt: new Date().toISOString(),
            },
            addresses: [address()],
          },
        }),
      ),
    );

    const router = createTestRouter(["/admin/customers"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search customers"), "Jane");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(listUrl?.searchParams.get("search")).toBe("Jane"));
    await user.click(await screen.findByRole("link", { name: "View" }));

    expect(await screen.findByRole("heading", { name: "Customer Jane" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Address history" })).toBeInTheDocument();
    expect(screen.getByText(/Module 11 owns customer orders/)).toBeInTheDocument();
  });

  it("shows a clear permission state without calling customer profile data", async () => {
    useActor([]);
    let profileCalls = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/customers/me`, () => {
        profileCalls += 1;
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    const router = createTestRouter(["/customer/profile"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(profileCalls).toBe(0);
  });
});
