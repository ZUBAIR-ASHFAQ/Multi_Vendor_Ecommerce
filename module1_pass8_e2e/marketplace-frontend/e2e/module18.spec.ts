import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";
const apiBase = `${apiOrigin}/api/v1`;
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

interface SessionData {
  accessToken: string;
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

interface SellerApplication {
  id: string;
  applicantUserId: string;
  status: "submitted" | "approved" | "rejected";
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
}

/** Creates one collision-resistant suffix for test-owned Notification identities. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds one bearer header for direct API setup and asynchronous-state polling. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one identity through the real API. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<SessionData>).data;
}

/** Registers one test-owned customer through the public registration endpoint. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(prefix);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 18 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Submits one seller application through the real Module 4 command. */
async function submitSellerApplication(
  context: APIRequestContext,
  accessToken: string,
  label: string,
): Promise<SellerApplication> {
  const response = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(accessToken),
    data: {
      legalName: `${label} Legal Ltd`,
      displayName: `${label} Seller`,
      taxId: null,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerApplication>).data;
}

/** Approves one seller application and returns only after the source transaction commits successfully. */
async function approveSellerApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/admin/seller-applications/${applicationId}/approve`, {
    headers: bearer(adminToken),
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Rejects one seller application and returns only after the source transaction commits successfully. */
async function rejectSellerApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/admin/seller-applications/${applicationId}/reject`, {
    headers: bearer(adminToken),
    data: { reason: "Module 18 E2E rejection notification proof." },
  });
  expect(response.status()).toBe(200);
}

/** Polls the owner-scoped Notification API until the asynchronous outbox/BullMQ pipeline materializes the event. */
async function waitForNotification(
  context: APIRequestContext,
  accessToken: string,
  type: string,
  timeoutMs = 20_000,
): Promise<NotificationItem> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;

  while (Date.now() < deadline) {
    const response = await context.get(`${apiBase}/notifications?page=1&pageSize=20`, {
      headers: bearer(accessToken),
    });
    lastStatus = response.status();
    if (response.status() === 200) {
      const body = (await response.json()) as ApiEnvelope<NotificationItem[]>;
      const notification = body.data.find((item) => item.type === type);
      if (notification) return notification;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${type} Notification; last API status was ${lastStatus}.`);
}

/** Signs in through the real React form so browser actions use the production authentication client. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/u);
}

/** Returns the masking format used by the persisted failed-delivery fixture. */
function maskedEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) throw new Error("E2E admin email is invalid.");
  return `${localPart.slice(0, 1)}***@${domain}`;
}

test.describe("Module 18 Notifications E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let approvedEmail = "";
  let approvedPassword = "";
  let rejectedEmail = "";
  let rejectedPassword = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("real seller approval commits first, then outbox/BullMQ creates an owner-scoped Notification that can be marked read", async ({ page }) => {
    approvedPassword = "Module18-Approved!123";
    const applicant = await registerCustomer(apiContext, "module18-approved", approvedPassword);
    approvedEmail = applicant.email;
    const customerSession = await apiLogin(apiContext, approvedEmail, approvedPassword);
    const application = await submitSellerApplication(
      apiContext,
      customerSession.accessToken,
      "Module 18 Approved",
    );

    await approveSellerApplication(apiContext, adminToken, application.id);

    const sellerSession = await apiLogin(apiContext, approvedEmail, approvedPassword);
    const notification = await waitForNotification(
      apiContext,
      sellerSession.accessToken,
      "seller.approved",
    );
    expect(notification.title).toBe("Seller application approved");
    expect(notification.readAt).toBeNull();

    await browserLogin(page, approvedEmail, approvedPassword);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Your notifications" })).toBeVisible();
    await expect(page.getByLabel(/Notifications, [1-9][0-9]* unread/u)).toBeVisible();
    const card = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Seller application approved", exact: true }),
    });
    await expect(card).toBeVisible();

    const readResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/notifications/${notification.id}/read`) &&
        response.request().method() === "POST",
    );
    await card.getByRole("button", { name: "Mark read" }).click();
    expect((await readResponse).status()).toBe(200);
    await expect(card.getByText("Read", { exact: true })).toBeVisible();
  });

  test("real seller rejection creates an unread Notification that the browser can mark all read", async ({ page }) => {
    rejectedPassword = "Module18-Rejected!123";
    const applicant = await registerCustomer(apiContext, "module18-rejected", rejectedPassword);
    rejectedEmail = applicant.email;
    const customerSession = await apiLogin(apiContext, rejectedEmail, rejectedPassword);
    const application = await submitSellerApplication(
      apiContext,
      customerSession.accessToken,
      "Module 18 Rejected",
    );

    await rejectSellerApplication(apiContext, adminToken, application.id);
    const refreshedSession = await apiLogin(apiContext, rejectedEmail, rejectedPassword);
    await waitForNotification(apiContext, refreshedSession.accessToken, "seller.rejected");

    await browserLogin(page, rejectedEmail, rejectedPassword);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Your notifications" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seller application update" })).toBeVisible();

    const readAllResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/notifications/read-all") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Mark all read" }).click();
    expect((await readAllResponse).status()).toBe(200);
    await expect(page.getByText("0 unread across your account.")).toBeVisible();
  });

  test("seller manages an allowed email preference through the real TanStack Form", async ({ page }) => {
    expect(approvedEmail).not.toBe("");
    await browserLogin(page, approvedEmail, approvedPassword);
    await page.goto("/notifications/preferences");
    await expect(page.getByRole("heading", { name: "Notification preferences" })).toBeVisible();

    await page.getByLabel("Notification event code").fill("seller.approved");
    await page.getByLabel("Notification channel").selectOption("email");
    await page.getByLabel("Notification preference enabled").selectOption("disabled");

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/notifications/preferences") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save preference" }).click();
    expect((await updateResponse).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "seller.approved", exact: true })).toBeVisible();
    await expect(page.getByText("Email · Disabled", { exact: true })).toBeVisible();
  });

  test("platform admin sees only the masked failed destination and retries the durable delivery", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/admin/notification-deliveries");
    await expect(page.getByRole("heading", { name: "Failed delivery queue" })).toBeVisible();

    const card = page.locator("article").filter({ hasText: "seller.approved.email" }).filter({
      hasText: maskedEmail(adminEmail),
    });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText(adminEmail);

    const retryResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/admin/notification-deliveries/") &&
        response.url().endsWith("/retry") &&
        response.request().method() === "POST",
    );
    await card.getByRole("button", { name: "Retry" }).click();
    expect((await retryResponse).status()).toBe(200);
    await expect(card).toHaveCount(0);
  });
});
