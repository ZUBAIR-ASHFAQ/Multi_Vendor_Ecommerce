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

const reportPermissions = [
  "reports.sales.read",
  "reports.inventory.read",
  "reports.finance.read",
  "reports.seller.read",
  "reports.export",
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

interface ReportRunData {
  id: string;
  reportCode: string;
  outputFormat: "csv" | "pdf";
  status: "queued" | "processing" | "completed" | "failed";
  errorCode: string | null;
  download: {
    fileId: string;
    downloadUrl: string;
    expiresAt: string;
  } | null;
}

/** Builds one bearer header for direct API setup and isolation assertions. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Creates one collision-resistant suffix for test-owned Administration records. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Authenticates one identity through the real Module 2 API. */
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

/** Signs in through the real React form so report navigation uses the production authentication client. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/u);
}

/** Lists the complete role catalog so permission IDs come from the real RBAC read model. */
async function listRoles(
  context: APIRequestContext,
  adminToken: string,
): Promise<RoleData[]> {
  const response = await context.get(`${apiBase}/admin/roles?page=1&pageSize=100`, {
    headers: bearer(adminToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<RoleData[]>).data;
}

/** Resolves stable permission IDs without hard-coding database-generated UUIDs. */
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

/** Creates one seller-scoped reporting role through the approved Administration command. */
async function createSellerReportingRole(
  context: APIRequestContext,
  adminToken: string,
): Promise<RoleData> {
  const suffix = unique("module20_reports").replaceAll("-", "_");
  const response = await context.post(`${apiBase}/admin/roles`, {
    headers: bearer(adminToken),
    data: {
      code: suffix,
      name: `Module 20 reports ${suffix.slice(-6)}`,
      description: "Playwright seller-scoped Reports role",
      scopeType: "seller",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RoleData>).data;
}

/** Replaces one role's permissions with the exact seller-safe Reports permission set. */
async function configureReportingRole(
  context: APIRequestContext,
  adminToken: string,
  roleId: string,
): Promise<void> {
  const ids = await permissionIds(context, adminToken, reportPermissions);
  const response = await context.put(`${apiBase}/admin/roles/${roleId}/permissions`, {
    headers: bearer(adminToken),
    data: { permissionIds: ids },
  });
  expect(response.status()).toBe(200);
}

/** Adds the Reports role while preserving the seller's existing seller-scoped role assignments. */
async function assignReportingRole(
  context: APIRequestContext,
  adminToken: string,
  session: SessionData,
  sellerId: string,
  reportingRoleId: string,
): Promise<void> {
  const assignments = session.user.roles
    .filter((role) => role.sellerId !== null)
    .map((role) => ({ roleId: role.id, sellerId: role.sellerId }));
  assignments.push({ roleId: reportingRoleId, sellerId });

  const response = await context.put(`${apiBase}/admin/users/${session.user.id}/roles`, {
    headers: bearer(adminToken),
    data: { assignments },
  });
  expect(response.status()).toBe(200);
}

/** Polls one requester-owned report run until its worker reaches a terminal state. */
async function waitForReportRun(
  context: APIRequestContext,
  accessToken: string,
  reportRunId: string,
  timeoutMs = 30_000,
): Promise<ReportRunData> {
  const deadline = Date.now() + timeoutMs;
  let latest: ReportRunData | null = null;

  while (Date.now() < deadline) {
    const response = await context.get(`${apiBase}/reports/runs/${reportRunId}`, {
      headers: bearer(accessToken),
    });
    expect(response.status()).toBe(200);
    latest = ((await response.json()) as ApiEnvelope<ReportRunData>).data;
    if (latest.status === "completed" || latest.status === "failed") return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for report run ${reportRunId}; last status was ${latest?.status ?? "unknown"}.`,
  );
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

test.describe("Module 20 Reports & Analytics E2E", () => {
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
    const reportingRole = await createSellerReportingRole(apiContext, adminToken);
    await configureReportingRole(apiContext, adminToken, reportingRole.id);
    await assignReportingRole(apiContext, adminToken, sellerASession, sellerAId, reportingRole.id);
    await assignReportingRole(apiContext, adminToken, sellerBSession, sellerBId, reportingRole.id);

    sellerAToken = (await apiLogin(apiContext, sellerAEmail, sellerPassword)).accessToken;
    sellerBToken = (await apiLogin(apiContext, sellerBEmail, sellerPassword)).accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("platform admin opens the permission-filtered catalog and sees separated Sales money concepts", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/reports");

    await expect(page.getByRole("heading", { name: "Report catalog" })).toBeVisible();
    for (const title of [
      "Sales & orders",
      "Seller performance",
      "Inventory & low stock",
      "Returns & refunds",
      "Commissions",
      "Seller payouts & liability",
      "Audit log export",
    ]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }

    await page.goto("/reports/sales");
    await expect(page.getByRole("heading", { name: "Sales & orders report" })).toBeVisible();
    await expect(page.getByText("GMV", { exact: true })).toBeVisible();
    await expect(page.getByText("Captured cash", { exact: true })).toBeVisible();
    await expect(page.getByText("Refunded payments", { exact: true })).toBeVisible();
  });

  test("seller reporting is server-scoped and cannot read another seller through a crafted filter", async ({ page }) => {
    const allowed = await apiContext.get(`${apiBase}/reports/sales?sellerId=${sellerAId}`, {
      headers: bearer(sellerAToken),
    });
    expect(allowed.status()).toBe(200);

    const forbidden = await apiContext.get(`${apiBase}/reports/sales?sellerId=${sellerBId}`, {
      headers: bearer(sellerAToken),
    });
    expect(forbidden.status()).toBe(403);
    const forbiddenBody = (await forbidden.json()) as ApiEnvelope<never>;
    expect(forbiddenBody).toMatchObject({
      success: false,
      error: { code: "REPORT_SCOPE_FORBIDDEN" },
    });

    await browserLogin(page, sellerAEmail, sellerPassword);
    await page.goto("/reports/sales");
    await expect(page.getByRole("heading", { name: "Sales & orders report" })).toBeVisible();
    await expect(page.getByLabel("Report seller UUID")).toHaveCount(0);
  });

  test("admin queues a CSV export, the worker stores it, and the signed download is readable", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/reports/sales");
    await expect(page.getByRole("heading", { name: "Sales & orders report" })).toBeVisible();

    await page.getByRole("button", { name: "Export CSV" }).click();
    await expect(page).toHaveURL(/\/reports\/runs\/[0-9a-f-]+$/u);
    const runId = page.url().split("/").at(-1);
    expect(runId).toBeTruthy();

    const completed = await waitForReportRun(apiContext, adminToken, runId as string);
    expect(completed.status).toBe("completed");
    expect(completed.reportCode).toBe("sales");
    expect(completed.outputFormat).toBe("csv");
    expect(completed.download).not.toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Sales & orders", exact: true })).toBeVisible();
    const downloadLink = page.getByRole("link", { name: "Download export" });
    await expect(downloadLink).toBeVisible();
    const downloadUrl = await downloadLink.getAttribute("href");
    expect(downloadUrl).toBeTruthy();

    const downloaded = await apiContext.get(downloadUrl as string);
    expect(downloaded.status()).toBe(200);
    expect(downloaded.headers()["content-type"]).toContain("text/csv");
  });

  test("report-run ownership prevents another seller from reading a completed export", async () => {
    const create = await apiContext.post(`${apiBase}/reports/runs`, {
      headers: bearer(sellerAToken),
      data: {
        reportCode: "sales",
        filters: {},
        outputFormat: "pdf",
      },
    });
    expect(create.status()).toBe(202);
    const run = ((await create.json()) as ApiEnvelope<ReportRunData>).data;

    const completed = await waitForReportRun(apiContext, sellerAToken, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.download?.fileId).toBeTruthy();

    const forbidden = await apiContext.get(`${apiBase}/reports/runs/${run.id}`, {
      headers: bearer(sellerBToken),
    });
    expect(forbidden.status()).toBe(403);
    const body = (await forbidden.json()) as ApiEnvelope<never>;
    expect(body).toMatchObject({ success: false, error: { code: "REPORT_SCOPE_FORBIDDEN" } });
  });

  test("live OpenAPI exposes exactly the nine approved Reports operations", async () => {
    const response = await apiContext.get(`${apiOrigin}/openapi.json`);
    expect(response.status()).toBe(200);
    const document = (await response.json()) as {
      paths?: Record<string, Record<string, unknown>>;
    };

    const approved = new Map<string, string[]>([
      ["/api/v1/reports/catalog", ["get"]],
      ["/api/v1/reports/sales", ["get"]],
      ["/api/v1/reports/sellers", ["get"]],
      ["/api/v1/reports/inventory", ["get"]],
      ["/api/v1/reports/refunds", ["get"]],
      ["/api/v1/reports/commissions", ["get"]],
      ["/api/v1/reports/payouts", ["get"]],
      ["/api/v1/reports/runs", ["post"]],
      ["/api/v1/reports/runs/{id}", ["get"]],
    ]);

    for (const [path, methods] of approved) expectMethods(document, path, methods);

    const reportPaths = Object.keys(document.paths ?? {})
      .filter((path) => path.startsWith("/api/v1/reports/"))
      .sort();
    expect(reportPaths).toEqual([...approved.keys()].sort());
  });
});
