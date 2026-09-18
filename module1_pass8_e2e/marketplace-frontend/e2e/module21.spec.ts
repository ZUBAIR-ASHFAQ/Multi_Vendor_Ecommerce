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

const DOCUMENT_PERMISSIONS = ["documents.upload", "documents.read", "documents.link"] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface SessionData {
  accessToken: string;
  user: { id: string; email: string; permissions: string[]; accountType: string };
}

interface PermissionData {
  id: string;
  code: string;
}

interface RoleData {
  id: string;
  permissions: PermissionData[];
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

/** Creates one collision-resistant suffix for test-owned identities. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds one bearer header for direct API setup and negative checks. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one user through the real API. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<SessionData>;
  expect(body.success).toBe(true);
  return body.data;
}

/** Registers one customer identity through the approved public registration route. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
): Promise<{ user: RegisteredCustomer; password: string }> {
  const suffix = unique(prefix);
  const email = `${suffix}@example.test`;
  const password = "Module21UserPassword!123";
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email,
      displayName: `Module 21 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ApiEnvelope<RegisteredCustomer>;
  return { user: body.data, password };
}

/** Signs in through the browser and waits for permission-aware navigation. */
async function browserLogin(
  page: Page,
  email: string,
  password: string,
  expectedPath: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll("/", "\\/")}$`));
}

/** Loads role responses because approved role data already carries the permission catalog. */
async function listRoles(
  context: APIRequestContext,
  adminToken: string,
): Promise<RoleData[]> {
  const response = await context.get(`${apiBase}/admin/roles?page=1&pageSize=100`, {
    headers: bearer(adminToken),
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<RoleData[]>;
  return body.data;
}

/** Resolves seeded permission IDs from the approved role-list response. */
async function permissionIds(
  context: APIRequestContext,
  adminToken: string,
  codes: readonly string[],
): Promise<string[]> {
  const roles = await listRoles(context, adminToken);
  const permissions = roles.flatMap((role) => role.permissions);
  return codes.map((code) => {
    const permission = permissions.find((item) => item.code === code);
    expect(permission, `Seeded permission ${code} must exist`).toBeTruthy();
    return permission!.id;
  });
}

/** Creates one customer-scoped role and assigns the requested document permissions. */
async function createDocumentCustomerRole(
  context: APIRequestContext,
  adminToken: string,
  codes: readonly string[],
): Promise<RoleData> {
  const suffix = unique("module21_role").replace(/-/g, "_");
  const create = await context.post(`${apiBase}/admin/roles`, {
    headers: bearer(adminToken),
    data: {
      code: suffix,
      name: `Module 21 E2E ${suffix.slice(-6)}`,
      description: "Playwright document access role",
      scopeType: "customer",
      status: "active",
    },
  });
  expect(create.status()).toBe(201);
  const role = ((await create.json()) as ApiEnvelope<RoleData>).data;

  const replace = await context.put(`${apiBase}/admin/roles/${role.id}/permissions`, {
    headers: bearer(adminToken),
    data: { permissionIds: await permissionIds(context, adminToken, codes) },
  });
  expect(replace.status()).toBe(200);
  return role;
}

/** Replaces one registered customer's roles with the test-owned customer role. */
async function assignCustomerRole(
  context: APIRequestContext,
  adminToken: string,
  customerId: string,
  roleId: string,
): Promise<void> {
  const response = await context.put(`${apiBase}/admin/users/${customerId}/roles`, {
    headers: bearer(adminToken),
    data: { assignments: [{ roleId, sellerId: null }] },
  });
  expect(response.status()).toBe(200);
}

/** Performs the real sign -> S3-compatible PUT -> confirm sequence through HTTP. */
async function uploadPdf(
  context: APIRequestContext,
  accessToken: string,
  bytes: Buffer,
  name: string,
): Promise<string> {
  const sign = await context.post(`${apiBase}/documents/uploads/sign`, {
    headers: bearer(accessToken),
    data: {
      originalName: name,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      purpose: "operational_evidence",
    },
  });
  expect(sign.status()).toBe(201);
  const signed = (await sign.json()) as ApiEnvelope<{
    fileId: string;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  }>;

  const storageUpload = await context.put(signed.data.uploadUrl, {
    data: bytes,
    headers: signed.data.requiredHeaders,
  });
  expect(storageUpload.ok()).toBe(true);

  const confirm = await context.post(`${apiBase}/documents/uploads/${signed.data.fileId}/confirm`, {
    headers: bearer(accessToken),
  });
  expect(confirm.status()).toBe(200);
  return signed.data.fileId;
}

test.describe("Module 21 Documents & Audit E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let adminUserId = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    const adminSession = await apiLogin(apiContext, adminEmail, adminPassword);
    adminToken = adminSession.accessToken;
    adminUserId = adminSession.user.id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("admin completes signed upload, account link, authorized download, and unlink in the browser", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/documents");

    const bytes = Buffer.from("%PDF-1.4\n% Module 21 Playwright evidence\n%%EOF\n", "utf8");
    await page.getByLabel("File").setInputFiles({
      name: "module21-browser-evidence.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    await page.getByLabel("Purpose").selectOption("operational_evidence");
    await page.getByLabel("Link to my account").check();
    await page.getByRole("button", { name: "Upload document" }).click();

    await expect(page.getByText("module21-browser-evidence.pdf").first()).toBeVisible();
    await expect(page.getByText("user · operational_evidence")).toBeVisible();

    await page.getByRole("button", { name: "Request download" }).first().click();
    const signedDownload = page.getByRole("link", { name: "Open signed download" }).first();
    await expect(signedDownload).toBeVisible();
    const href = await signedDownload.getAttribute("href");
    expect(href).toBeTruthy();
    const downloaded = await apiContext.get(href!);
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(bytes);

    await page.getByRole("button", { name: "Unlink" }).click();
    await expect(page.getByText("No linked files are available in this workflow yet.")).toBeVisible();
  });

  test("another user's private file is hidden exactly like a missing file", async () => {
    const role = await createDocumentCustomerRole(apiContext, adminToken, DOCUMENT_PERMISSIONS);
    const owner = await registerCustomer(apiContext, "doc-owner");
    const stranger = await registerCustomer(apiContext, "doc-stranger");
    await assignCustomerRole(apiContext, adminToken, owner.user.id, role.id);
    await assignCustomerRole(apiContext, adminToken, stranger.user.id, role.id);

    const ownerSession = await apiLogin(apiContext, owner.user.email, owner.password);
    const strangerSession = await apiLogin(apiContext, stranger.user.email, stranger.password);

    const bytes = Buffer.from("%PDF-1.4\nprivate owner file\n%%EOF\n", "utf8");
    const fileId = await uploadPdf(apiContext, ownerSession.accessToken, bytes, "private-owner.pdf");

    const hidden = await apiContext.get(`${apiBase}/documents/${fileId}/download`, {
      headers: bearer(strangerSession.accessToken),
    });
    const missing = await apiContext.get(
      `${apiBase}/documents/33333333-3333-4333-8333-333333333333/download`,
      { headers: bearer(strangerSession.accessToken) },
    );

    expect(hidden.status()).toBe(404);
    expect(missing.status()).toBe(404);
    const hiddenBody = (await hidden.json()) as ApiEnvelope<never>;
    const missingBody = (await missing.json()) as ApiEnvelope<never>;
    expect(hiddenBody.error?.code).toBe("FILE_NOT_FOUND");
    expect(missingBody.error?.code).toBe("FILE_NOT_FOUND");
    expect(hiddenBody.error?.message).toBe(missingBody.error?.message);
  });

  test("admin audit search validates and applies the actor user ID filter", async ({ page }) => {
    const bytes = Buffer.from("%PDF-1.4\nactor filter fixture\n%%EOF\n", "utf8");
    await uploadPdf(apiContext, adminToken, bytes, "actor-filter-fixture.pdf");

    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/audit");

    await page.getByLabel("Audit actor user ID").fill("not-a-uuid");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("Enter a valid UUID.")).toBeVisible();

    await page.getByLabel("Audit actor user ID").fill(adminUserId);
    await page.getByLabel("Audit action").fill("file.upload_confirmed");
    await page.getByRole("button", { name: "Apply filters" }).click();

    const rows = page.getByRole("row").filter({ hasText: "file.upload_confirmed" });
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText(adminUserId);
  });

  test("seller audit reads stay inside the server-derived seller scope and remain redacted", async ({ page }) => {
    const sellerASession = await apiLogin(apiContext, sellerAEmail, sellerPassword);
    const sellerBSession = await apiLogin(apiContext, sellerBEmail, sellerPassword);
    expect(sellerASession.user.accountType).toBe("seller");

    const allowed = await apiContext.get(`${apiBase}/audit?sellerId=${sellerAId}`, {
      headers: bearer(sellerASession.accessToken),
    });
    expect(allowed.status()).toBe(200);
    const allowedBody = (await allowed.json()) as ApiEnvelope<Array<{ id: string; sellerId: string; action: string }>>;
    expect(allowedBody.data.length).toBeGreaterThan(0);
    expect(allowedBody.data.every((row) => row.sellerId === sellerAId)).toBe(true);

    const deniedAtoB = await apiContext.get(`${apiBase}/audit?sellerId=${sellerBId}`, {
      headers: bearer(sellerASession.accessToken),
    });
    expect(deniedAtoB.status()).toBe(403);
    const deniedBtoA = await apiContext.get(`${apiBase}/audit?sellerId=${sellerAId}`, {
      headers: bearer(sellerBSession.accessToken),
    });
    expect(deniedBtoA.status()).toBe(403);

    await browserLogin(page, sellerAEmail, sellerPassword, "/audit");
    await expect(page.getByLabel("Seller ID")).toHaveCount(0);
    await expect(page.getByText("e2e.seller_a.audit_fixture")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "e2e.seller_a.audit_fixture" });
    await row.getByRole("link", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: "e2e.seller_a.audit_fixture" })).toBeVisible();
    await expect(page.getByText("[REDACTED]", { exact: false })).toBeVisible();
    await expect(page.getByText("must-never-appear-in-audit-output", { exact: false })).toHaveCount(0);
  });
});
