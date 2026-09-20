import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";
const apiBase = `${apiOrigin}/api/v1`;
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";

const CUSTOMER_PERMISSIONS = [
  "customer.profile.read_own",
  "customer.profile.update_own",
  "customer.address.manage_own",
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface RegisteredCustomer {
  id: string;
  email: string;
  displayName: string;
}

interface SessionData {
  accessToken: string;
  user: {
    id: string;
    email: string;
    accountType: string;
    roles: Array<{ code: string }>;
    permissions: string[];
  };
}

interface CustomerAddress {
  id: string;
  label: string;
  status: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

/** Creates one collision-resistant suffix for E2E-owned customer identities. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the bearer header used by direct API setup and privacy checks. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Registers one customer through the real public API. */
async function registerCustomer(
  context: APIRequestContext,
  input: { email: string; displayName: string; password: string },
): Promise<RegisteredCustomer> {
  const response = await context.post(`${apiBase}/auth/register`, { data: input });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ApiEnvelope<RegisteredCustomer>;
  expect(body.success).toBe(true);
  return body.data;
}

/** Authenticates one actor through the real API and returns server-derived permissions. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<SessionData>;
  expect(body.success).toBe(true);
  return body.data;
}

/** Signs in through the browser and waits for the normal account destination. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

/** Fills the reusable address form with one complete valid address. */
async function fillAddressForm(
  scope: Page | Locator,
  input: {
    label: string;
    recipientName: string;
    phone: string;
    line1: string;
    city: string;
    region: string;
    postalCode?: string;
    countryCode: string;
  },
): Promise<void> {
  await scope.getByLabel("Address label").fill(input.label);
  await scope.getByLabel("Recipient name").fill(input.recipientName);
  await scope.getByLabel("Address phone").fill(input.phone);
  await scope.getByLabel("Address line 1").fill(input.line1);
  await scope.getByLabel("City").fill(input.city);
  await scope.getByLabel("Region").fill(input.region);
  if (input.postalCode) await scope.getByLabel("Postal code").fill(input.postalCode);
  await scope.getByLabel("Country code").fill(input.countryCode);
}

/** Creates one customer-owned address through the real scoped API. */
async function createAddress(
  context: APIRequestContext,
  accessToken: string,
  label: string,
): Promise<CustomerAddress> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(accessToken),
    data: {
      label,
      recipientName: "Privacy Test Customer",
      phone: "+1 555 0199",
      line1: "99 Private Lane",
      line2: null,
      city: "Austin",
      region: "Texas",
      postalCode: "78701",
      countryCode: "us",
      isDefaultShipping: false,
      isDefaultBilling: false,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ApiEnvelope<CustomerAddress>;
  return body.data;
}

/** Returns the card that renders one saved address by its heading text. */
function addressCard(page: Page, label: string): Locator {
  return page.locator("article").filter({
    has: page.getByRole("heading", { name: label, exact: true }),
  });
}

test.describe("Module 3 Customer Management E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let customerEmail = "";
  let customerPassword = "";
  let customerId = "";
  let updatedDisplayName = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("registration provisions customer self-service and profile updates survive reload", async ({ page }) => {
    const suffix = unique("module3-customer");
    customerEmail = `${suffix}@example.test`;
    customerPassword = "Module3CustomerPassword!123";
    const originalDisplayName = `Module 3 Customer ${suffix.slice(-6)}`;
    updatedDisplayName = `Updated ${suffix.slice(-6)}`;

    await page.goto("/register");
    await page.getByLabel("Display name").fill(originalDisplayName);
    await page.getByLabel("Email").fill(customerEmail);
    await page.getByLabel("Password", { exact: true }).fill(customerPassword);
    await page.getByLabel("Confirm password").fill(customerPassword);
    await page.getByRole("button", { name: "Create customer account" }).click();
    await expect(page.getByText(`Customer account created for ${customerEmail}.`)).toBeVisible();

    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await page.getByLabel("Email").fill(customerEmail);
    await page.getByLabel("Password").fill(customerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    await expect(page.getByText("Customer Self Service", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Addresses" })).toBeVisible();

    const session = await apiLogin(apiContext, customerEmail, customerPassword);
    customerId = session.user.id;
    expect(session.user.accountType).toBe("customer");
    expect(session.user.roles.map((role) => role.code)).toContain("customer_self_service");
    for (const permission of CUSTOMER_PERMISSIONS) {
      expect(session.user.permissions).toContain(permission);
    }

    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/customer\/profile$/);
    await expect(page.getByRole("heading", { name: originalDisplayName })).toBeVisible();

    await page.getByLabel("Customer display name").fill(updatedDisplayName);
    await page.getByLabel("Customer phone").fill("+1 555 0177");
    await page.getByLabel("Marketing opt in").check();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: updatedDisplayName })).toBeVisible();
    await expect(page.getByLabel("Customer display name")).toHaveValue(updatedDisplayName);
    await expect(page.getByLabel("Customer phone")).toHaveValue("+1 555 0177");
    await expect(page.getByLabel("Marketing opt in")).toBeChecked();
    await expect(page.getByRole("link", { name: "Order summary" })).toBeVisible();
    await expect(page.getByText(/Module 11/)).toBeVisible();
  });

  test("address create, default switch, edit, archive, and reload preserve database state", async ({ page }) => {
    await browserLogin(page, customerEmail, customerPassword);
    await page.goto("/customer/addresses");
    await expect(page.getByRole("heading", { name: "Address book" })).toBeVisible();
    await expect(page.getByText("No saved addresses yet.")).toBeVisible();

    await fillAddressForm(page, {
      label: "Home",
      recipientName: "Home Recipient",
      phone: "+1 555 0101",
      line1: "10 Home Street",
      city: "Austin",
      region: "Texas",
      postalCode: "78701",
      countryCode: "us",
    });
    await page.getByLabel("Default shipping address").check();
    await page.getByLabel("Default billing address").check();
    await page.getByRole("button", { name: "Add address" }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(addressCard(page, "Home").getByText("Default shipping")).toBeVisible();
    await expect(addressCard(page, "Home").getByText("Default billing")).toBeVisible();

    await fillAddressForm(page, {
      label: "Work",
      recipientName: "Work Recipient",
      phone: "+1 555 0102",
      line1: "20 Work Avenue",
      city: "Austin",
      region: "Texas",
      postalCode: "78702",
      countryCode: "us",
    });
    await page.getByRole("button", { name: "Add address" }).click();
    await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();

    await addressCard(page, "Work").getByRole("button", { name: "Make shipping default" }).click();
    await expect(addressCard(page, "Work").getByText("Default shipping")).toBeVisible();
    await expect(addressCard(page, "Home").getByText("Default shipping")).toHaveCount(0);

    await addressCard(page, "Work").getByRole("button", { name: "Edit" }).click();
    const editWork = page.locator("article").filter({ hasText: "Edit Work" });
    await editWork.getByLabel("Address line 1").fill("21 Work Avenue");
    await editWork.getByRole("button", { name: "Save address" }).click();
    await expect(addressCard(page, "Work").getByText("21 Work Avenue")).toBeVisible();

    await addressCard(page, "Home").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(addressCard(page, "Work").getByText("Default shipping")).toBeVisible();
    await expect(addressCard(page, "Work").getByText("21 Work Avenue")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Home" })).toHaveCount(0);
  });

  test("another customer's address is hidden exactly like a missing private address", async () => {
    const suffix = unique("module3-private");
    const secondEmail = `${suffix}@example.test`;
    const secondPassword = "Module3SecondCustomer!123";
    await registerCustomer(apiContext, {
      email: secondEmail,
      displayName: `Private Customer ${suffix.slice(-6)}`,
      password: secondPassword,
    });

    const ownerSession = await apiLogin(apiContext, secondEmail, secondPassword);
    const strangerSession = await apiLogin(apiContext, customerEmail, customerPassword);
    const privateAddress = await createAddress(apiContext, ownerSession.accessToken, "Private home");

    const hidden = await apiContext.patch(`${apiBase}/customers/me/addresses/${privateAddress.id}`, {
      headers: bearer(strangerSession.accessToken),
      data: { label: "Should never update" },
    });
    const missing = await apiContext.patch(
      `${apiBase}/customers/me/addresses/33333333-3333-4333-8333-333333333333`,
      {
        headers: bearer(strangerSession.accessToken),
        data: { label: "Missing address" },
      },
    );

    expect(hidden.status()).toBe(404);
    expect(missing.status()).toBe(404);
    const hiddenBody = (await hidden.json()) as ApiEnvelope<never>;
    const missingBody = (await missing.json()) as ApiEnvelope<never>;
    expect(hiddenBody.error?.code).toBe("ADDRESS_NOT_FOUND");
    expect(missingBody.error?.code).toBe("ADDRESS_NOT_FOUND");
    expect(hiddenBody.error?.message).toBe(missingBody.error?.message);
  });

  test("admin searches the customer and reads current plus archived address history", async ({ page }) => {
    expect(customerId).not.toBe("");
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

    await page.getByLabel("Search customers").fill(customerEmail);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText(customerEmail, { exact: true })).toBeVisible();
    await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "View" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/customers/${customerId}$`));
    await expect(page.getByRole("heading", { name: updatedDisplayName })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Address history" })).toBeVisible();
    await expect(page.getByText("Home", { exact: true })).toBeVisible();
    await expect(page.getByText("Work", { exact: true })).toBeVisible();
    await expect(page.getByText("archived", { exact: true })).toBeVisible();
    await expect(page.getByText(/Module 11 owns customer orders/)).toBeVisible();
  });
});
