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
const sellerPassword = process.env.E2E_SELLER_PASSWORD ?? "E2e-Seller-Password!123";
const sellerAEmail = process.env.E2E_SELLER_A_EMAIL ?? "e2e.seller.a@marketplace.test";
const sellerBEmail = process.env.E2E_SELLER_B_EMAIL ?? "e2e.seller.b@marketplace.test";
const sellerAId = "11111111-1111-4111-8111-111111111111";
const sellerBId = "22222222-2222-4222-8222-222222222222";
const savedFilterName = "Module 1 E2E saved filter";
const forbiddenSavedFilterName = "Forbidden Seller B scope";

const sellerDashboardPermissions = [
  "dashboard.read",
  "dashboard.seller.read",
  "dashboard.manage_preferences",
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface SessionData {
  accessToken: string;
  user: {
    id: string;
    email: string;
    accountType: string;
    permissions: string[];
    roles: Array<{
      id: string;
      code: string;
      name: string;
      sellerId: string | null;
    }>;
  };
}

interface PermissionData {
  id: string;
  code: string;
}

interface RoleData {
  id: string;
  code: string;
  name: string;
  permissions: PermissionData[];
}

interface DashboardSummaryData {
  scope: {
    sellerId: string | null;
    storeId: string | null;
    categoryId: string | null;
    from: string | null;
    to: string | null;
  };
  orderCount: number;
  gmvByCurrency: Array<{ currency: string; amount: string }>;
  finance: null | {
    capturedCashByCurrency: Array<{ currency: string; amount: string }>;
    refundedPaymentsByCurrency: Array<{ currency: string; amount: string }>;
    marketplaceCommissionRevenueByCurrency: Array<{ currency: string; amount: string }>;
    sellerPayableByCurrency: Array<{ currency: string; amount: string }>;
    sellerPayoutsPaidByCurrency: Array<{ currency: string; amount: string }>;
  };
  preferences: {
    defaultDateRange: string;
    savedFilters: Array<{ name: string }>;
  };
}

interface SalesReportData {
  summary: {
    orderCount: number;
    gmvByCurrency: Array<{ currency: string; amount: string }>;
  };
}

interface DashboardAlertsData {
  scope: {
    sellerId: string | null;
  };
  rows: Array<{
    sellerId: string | null;
  }>;
}

/** Builds one bearer header for direct API setup and scope assertions. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Creates a collision-resistant role code for this browser run. */
function uniqueRoleCode(): string {
  return `module1_dashboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Formats one local browser datetime value without embedding a timezone suffix. */
function localDateTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Authenticates one identity through the production Module 2 API. */
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

/** Signs in through the real React form so Dashboard navigation uses the production auth client. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/u);
}

/** Lists the complete Administration role catalog so permission IDs are never hard-coded. */
async function listRoles(context: APIRequestContext, adminToken: string): Promise<RoleData[]> {
  const response = await context.get(`${apiBase}/admin/roles?page=1&pageSize=100`, {
    headers: bearer(adminToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<RoleData[]>).data;
}

/** Resolves stable permission IDs from the seeded RBAC catalog. */
async function permissionIds(
  context: APIRequestContext,
  adminToken: string,
  permissionCodes: readonly string[],
): Promise<string[]> {
  const roles = await listRoles(context, adminToken);
  const byCode = new Map(
    roles.flatMap((role) => role.permissions).map((permission) => [permission.code, permission.id]),
  );

  return permissionCodes.map((code) => {
    const id = byCode.get(code);
    expect(id, `Permission ${code} must exist in the seeded RBAC catalog`).toBeTruthy();
    return id as string;
  });
}

/** Creates one seller-scoped Dashboard role for the deterministic Seller A/B identities. */
async function createSellerDashboardRole(
  context: APIRequestContext,
  adminToken: string,
): Promise<RoleData> {
  const code = uniqueRoleCode();
  const response = await context.post(`${apiBase}/admin/roles`, {
    headers: bearer(adminToken),
    data: {
      code,
      name: `Module 1 Dashboard ${code.slice(-6)}`,
      description: "Playwright seller-scoped Dashboard role",
      scopeType: "seller",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RoleData>).data;
}

/** Replaces one role's permissions with the exact seller-safe Dashboard permission set. */
async function configureDashboardRole(
  context: APIRequestContext,
  adminToken: string,
  roleId: string,
): Promise<void> {
  const ids = await permissionIds(context, adminToken, sellerDashboardPermissions);
  const response = await context.put(`${apiBase}/admin/roles/${roleId}/permissions`, {
    headers: bearer(adminToken),
    data: { permissionIds: ids },
  });
  expect(response.status()).toBe(200);
}

/** Adds the Dashboard role without removing the seller's existing scoped assignments. */
async function assignDashboardRole(
  context: APIRequestContext,
  adminToken: string,
  session: SessionData,
  sellerId: string,
  dashboardRoleId: string,
): Promise<void> {
  const assignments = session.user.roles
    .filter((role) => role.sellerId !== null)
    .map((role) => ({ roleId: role.id, sellerId: role.sellerId }));
  assignments.push({ roleId: dashboardRoleId, sellerId });

  const response = await context.put(`${apiBase}/admin/users/${session.user.id}/roles`, {
    headers: bearer(adminToken),
    data: { assignments },
  });
  expect(response.status()).toBe(200);
}

/** Reads one Dashboard summary with the caller's authenticated scope. */
async function getDashboardSummary(
  context: APIRequestContext,
  accessToken: string,
  query = "",
): Promise<DashboardSummaryData> {
  const response = await context.get(`${apiBase}/dashboard/summary${query}`, {
    headers: bearer(accessToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<DashboardSummaryData>).data;
}

/** Verifies one OpenAPI path exposes exactly the documented HTTP methods. */
function expectMethods(
  document: { paths?: Record<string, Record<string, unknown>> },
  path: string,
  expectedMethods: string[],
): void {
  const pathItem = document.paths?.[path];
  expect(pathItem, `OpenAPI path ${path} must exist`).toBeTruthy();
  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
  const actualMethods = Object.keys(pathItem ?? {})
    .filter((method) => httpMethods.includes(method))
    .sort();
  expect(actualMethods).toEqual([...expectedMethods].sort());
}

test.describe("Module 1 Dashboard E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let sellerAToken = "";
  let sellerBToken = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;

    const sellerASession = await apiLogin(apiContext, sellerAEmail, sellerPassword);
    const sellerBSession = await apiLogin(apiContext, sellerBEmail, sellerPassword);
    const dashboardRole = await createSellerDashboardRole(apiContext, adminToken);
    await configureDashboardRole(apiContext, adminToken, dashboardRole.id);
    await assignDashboardRole(apiContext, adminToken, sellerASession, sellerAId, dashboardRole.id);
    await assignDashboardRole(apiContext, adminToken, sellerBSession, sellerBId, dashboardRole.id);

    sellerAToken = (await apiLogin(apiContext, sellerAEmail, sellerPassword)).accessToken;
    sellerBToken = (await apiLogin(apiContext, sellerBEmail, sellerPassword)).accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("platform admin opens every Dashboard section with finance concepts kept separately labeled", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    for (const heading of [
      "Executive KPIs",
      "Orders & GMV trend",
      "Seller performance",
      "Operational alerts",
      "Refund & return summary",
      "Commission & payout summary",
      "Saved filters",
      "Dashboard preferences",
    ]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    for (const label of [
      "Captured cash",
      "Marketplace commission revenue",
      "Seller payable",
      "Seller payouts paid",
      "Refunded payments",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("Dashboard order count and GMV match the stable Module 20 Sales source", async () => {
    const dashboard = await getDashboardSummary(apiContext, adminToken);
    const reportsResponse = await apiContext.get(`${apiBase}/reports/sales?page=1&pageSize=1&sort=created_desc`, {
      headers: bearer(adminToken),
    });
    expect(reportsResponse.status()).toBe(200);
    const reports = ((await reportsResponse.json()) as ApiEnvelope<SalesReportData>).data;

    expect(dashboard.orderCount).toBe(reports.summary.orderCount);
    expect(dashboard.gmvByCurrency).toEqual(reports.summary.gmvByCurrency);
    expect(dashboard.finance).not.toBeNull();
  });

  test("admin applies bounded Dashboard filters and drills down to the source refunds report", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard preferences" })).toBeVisible();
    await expect(page.getByLabel("Dashboard from")).not.toHaveValue("");

    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    await page.getByLabel("Dashboard from").fill(localDateTimeValue(from));
    await page.getByLabel("Dashboard to").fill(localDateTimeValue(to));

    const filteredSummary = page.waitForResponse((response) => {
      if (!response.url().includes("/api/v1/dashboard/summary")) return false;
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.searchParams.has("from") && url.searchParams.has("to");
    });
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await filteredSummary).status()).toBe(200);

    await page.getByRole("link", { name: "Open refunds report" }).click();
    await expect(page).toHaveURL(/\/reports\/refunds$/u);
    await expect(page.getByRole("heading", { name: "Returns & refunds report" })).toBeVisible();
  });

  test("seller scope is server-derived and Seller A cannot request Seller B Dashboard data", async ({ page }) => {
    const own = await getDashboardSummary(apiContext, sellerAToken);
    expect(own.scope.sellerId).toBe(sellerAId);
    expect(own.finance).toBeNull();

    const forbidden = await apiContext.get(`${apiBase}/dashboard/summary?sellerId=${sellerBId}`, {
      headers: bearer(sellerAToken),
    });
    expect(forbidden.status()).toBe(403);
    const forbiddenBody = (await forbidden.json()) as ApiEnvelope<never>;
    expect(forbiddenBody.error?.code).toBe("DASHBOARD_SCOPE_FORBIDDEN");

    const sellerB = await getDashboardSummary(apiContext, sellerBToken);
    expect(sellerB.scope.sellerId).toBe(sellerBId);

    const sellerAlertsResponse = await apiContext.get(`${apiBase}/dashboard/alerts?page=1&pageSize=10`, {
      headers: bearer(sellerAToken),
    });
    expect(sellerAlertsResponse.status()).toBe(200);
    const sellerAlerts = ((await sellerAlertsResponse.json()) as ApiEnvelope<DashboardAlertsData>).data;
    expect(sellerAlerts.scope.sellerId).toBe(sellerAId);
    expect(sellerAlerts.rows.every((row) => row.sellerId === sellerAId)).toBe(true);

    const forbiddenPreferenceWrite = await apiContext.patch(`${apiBase}/dashboard/preferences`, {
      headers: bearer(sellerAToken),
      data: {
        savedFilters: [{
          name: forbiddenSavedFilterName,
          filters: { sellerId: sellerBId },
        }],
      },
    });
    expect(forbiddenPreferenceWrite.status()).toBe(403);
    const forbiddenWriteBody = (await forbiddenPreferenceWrite.json()) as ApiEnvelope<never>;
    expect(forbiddenWriteBody.error?.code).toBe("DASHBOARD_SCOPE_FORBIDDEN");

    await browserLogin(page, sellerAEmail, sellerPassword);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByLabel("Dashboard seller UUID")).toHaveCount(0);
    await expect(page.getByText("Finance-sensitive Dashboard values are hidden for this account.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commission & payout summary" })).toHaveCount(0);
  });

  test("admin saves Dashboard preferences and one user-owned saved filter through the documented command", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard preferences" })).toBeVisible();

    await page.getByLabel("Dashboard default date range").selectOption("last_7_days");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();

    await page.getByLabel("Saved Dashboard filter name").fill(savedFilterName);
    await page.getByRole("button", { name: "Save current filters" }).click();
    await expect(page.getByRole("button", { name: savedFilterName, exact: true })).toBeVisible();

    const summary = await getDashboardSummary(apiContext, adminToken);
    expect(summary.preferences.defaultDateRange).toBe("last_7_days");
    expect(summary.preferences.savedFilters.some((filter) => filter.name === savedFilterName)).toBe(true);
  });

  test("unsupported historical category filtering fails explicitly instead of returning misleading KPIs", async () => {
    const response = await apiContext.get(`${apiBase}/dashboard/summary?categoryId=${sellerAId}`, {
      headers: bearer(adminToken),
    });
    expect(response.status()).toBe(409);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.error?.code).toBe("DASHBOARD_WIDGET_UNAVAILABLE");
  });

  test("live OpenAPI exposes exactly the five documented Dashboard methods", async () => {
    const response = await apiContext.get(`${apiOrigin}/openapi.json`);
    expect(response.status()).toBe(200);
    const document = (await response.json()) as { paths?: Record<string, Record<string, unknown>> };

    for (const [path, methods] of [
      ["/api/v1/dashboard/summary", ["get"]],
      ["/api/v1/dashboard/orders", ["get"]],
      ["/api/v1/dashboard/sellers", ["get"]],
      ["/api/v1/dashboard/alerts", ["get"]],
      ["/api/v1/dashboard/preferences", ["patch"]],
    ] as const) {
      expectMethods(document, path, [...methods]);
    }
  });
});
