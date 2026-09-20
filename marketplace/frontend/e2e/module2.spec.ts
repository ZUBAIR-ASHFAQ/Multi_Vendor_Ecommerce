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

const USERS_READ = "admin.users.read";
const CUSTOMER_PROFILE_READ = "customer.profile.read_own";

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
    permissions: string[];
    roles: Array<{ id: string; code: string; name: string }>;
  };
}

interface RegisteredCustomer {
  id: string;
  email: string;
  displayName: string;
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

/** Creates a collision-resistant suffix for records created by the E2E suite. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Authorization header used by direct API setup calls. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one test user through the real API and returns its session payload. */
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

/** Registers one customer through the approved public registration API. */
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

/** Signs in through the browser and verifies permission-aware navigation. */
async function browserLogin(
  page: Page,
  email: string,
  password: string,
  expectedPath = "/account",
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll("/", "\\/")}$`));
}

/** Loads the complete approved role catalog so tests can reuse permission IDs already exposed there. */
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

/** Resolves one permission ID from permissions embedded in the approved role-list response. */
async function getPermissionId(
  context: APIRequestContext,
  adminToken: string,
  code: string,
): Promise<string> {
  const roles = await listRoles(context, adminToken);
  const permission = roles
    .flatMap((role) => role.permissions)
    .find((item) => item.code === code);
  expect(permission, `Permission ${code} must exist in the seeded role catalog`).toBeTruthy();
  return permission!.id;
}

/** Creates one custom role through the approved Administration role command. */
async function createRole(
  context: APIRequestContext,
  adminToken: string,
  code: string,
  name: string,
  scopeType: "platform" | "seller" | "customer",
): Promise<RoleData> {
  const response = await context.post(`${apiBase}/admin/roles`, {
    headers: bearer(adminToken),
    data: {
      code,
      name,
      description: "Playwright E2E role",
      scopeType,
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ApiEnvelope<RoleData>;
  return body.data;
}

/** Replaces one role permission set through the approved command route. */
async function replaceRolePermissions(
  context: APIRequestContext,
  adminToken: string,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  const response = await context.put(`${apiBase}/admin/roles/${roleId}/permissions`, {
    headers: bearer(adminToken),
    data: { permissionIds },
  });
  expect(response.status()).toBe(200);
}

/** Verifies that one OpenAPI path exposes exactly the documented HTTP methods. */
function expectMethods(
  document: { paths?: Record<string, Record<string, unknown>> },
  path: string,
  expectedMethods: string[],
): void {
  const pathItem = document.paths?.[path];
  expect(pathItem, `OpenAPI path ${path} must exist`).toBeTruthy();
  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
  const actualMethods = Object.keys(pathItem ?? {}).filter((method) => httpMethods.includes(method)).sort();
  expect(actualMethods).toEqual([...expectedMethods].sort());
}

test.describe("Module 2 Administration, Authentication & RBAC E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    const session = await apiLogin(apiContext, adminEmail, adminPassword);
    adminToken = session.accessToken;
    expect(session.user.permissions).toContain(USERS_READ);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("customer registration creates a customer account with the protected self-service role", async ({ page }) => {
    const suffix = unique("customer");
    const email = `${suffix}@example.test`;
    const displayName = `Customer ${suffix.slice(-6)}`;
    const password = "CustomerPassword!123";

    await page.goto("/register");
    await page.getByLabel("Display name").fill(displayName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create customer account" }).click();

    await expect(page.getByText(`Customer account created for ${email}.`)).toBeVisible();
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page.getByText("Customer", { exact: true })).toBeVisible();
    await expect(page.getByText("Customer Self Service", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Addresses" })).toBeVisible();
  });

  test("admin updates allow-listed platform settings and refresh cookie restores the reloaded session", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/admin/settings");

    await expect(page.getByRole("heading", { name: "Platform settings" })).toBeVisible();
    await page.getByLabel("Supported currencies").fill("USD, EUR");
    await page.getByLabel("Default currency").fill("EUR");
    await page.getByLabel("Default tax rate").fill("7.5");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Platform settings saved.")).toBeVisible();

    const response = await apiContext.get(`${apiBase}/admin/settings`, {
      headers: bearer(adminToken),
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ApiEnvelope<{
      settings: Array<{ key: string; value: unknown }>;
    }>;
    const values = new Map(body.data.settings.map((setting) => [setting.key, setting.value]));
    expect(values.get("commerce.supported_currencies")).toEqual(["EUR", "USD"]);
    expect(values.get("commerce.default_currency")).toBe("EUR");
    expect(values.get("commerce.default_tax_rate_percent")).toBe(7.5);

    // Reload clears the in-memory access token. The HttpOnly refresh cookie must recover the session.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Platform settings" })).toBeVisible();
  });

  test("admin assigns a custom customer role through the approved user-role workflow", async ({ page }) => {
    const suffix = unique("role-assignment");
    const roleCode = `customer_${suffix.replace(/-/g, "_")}`;
    const roleName = `Customer role ${suffix.slice(-6)}`;
    const role = await createRole(apiContext, adminToken, roleCode, roleName, "customer");
    const permissionId = await getPermissionId(apiContext, adminToken, CUSTOMER_PROFILE_READ);
    await replaceRolePermissions(apiContext, adminToken, role.id, [permissionId]);

    const email = `${suffix}@example.test`;
    const password = "RoleAssignmentPassword!123";
    const customer = await registerCustomer(apiContext, {
      email,
      displayName: `Role Customer ${suffix.slice(-6)}`,
      password,
    });

    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.getByLabel("Search users").fill(email);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Manage" }).click();

    const customRole = page.locator("label").filter({ hasText: roleName }).getByRole("checkbox");
    await expect(customRole).toBeVisible();
    await customRole.check();
    const roleUpdate = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/users/${customer.id}/roles`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save roles" }).click();
    expect((await roleUpdate).status()).toBe(200);

    const customerSession = await apiLogin(apiContext, email, password);
    expect(customerSession.user.roles.map((item) => item.code)).toContain(roleCode);
  });

  test("customer sees an access-denied admin page and the backend rejects the same read", async ({ page }) => {
    const suffix = unique("customer-denied");
    const email = `${suffix}@example.test`;
    const password = "CustomerDeniedPassword!123";
    await registerCustomer(apiContext, {
      email,
      displayName: `Denied Customer ${suffix.slice(-6)}`,
      password,
    });

    await browserLogin(page, email, password);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Roles" })).toHaveCount(0);

    const customerSession = await apiLogin(apiContext, email, password);
    const forbidden = await apiContext.get(`${apiBase}/admin/users`, {
      headers: bearer(customerSession.accessToken),
    });
    expect(forbidden.status()).toBe(403);
    const body = (await forbidden.json()) as ApiEnvelope<never>;
    expect(body).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  });

  test("deactivating a registered customer revokes the live session and prevents another login", async ({ page }) => {
    const suffix = unique("inactive");
    const email = `${suffix}@example.test`;
    const password = "DeactivatePassword!123";
    const customer = await registerCustomer(apiContext, {
      email,
      displayName: `Deactivate Customer ${suffix.slice(-6)}`,
      password,
    });

    await browserLogin(page, email, password);
    await expect(page.getByRole("heading", { name: `Deactivate Customer ${suffix.slice(-6)}` })).toBeVisible();

    const deactivation = await apiContext.patch(`${apiBase}/admin/users/${customer.id}/status`, {
      headers: bearer(adminToken),
      data: { status: "inactive", reason: "Playwright Module 2 E2E" },
    });
    expect(deactivation.status()).toBe(200);

    await page.reload();
    await expect(page).toHaveURL(/\/login$/);

    const relogin = await apiContext.post(`${apiBase}/auth/login`, {
      data: { email, password },
    });
    expect(relogin.status()).toBe(403);
    const body = (await relogin.json()) as ApiEnvelope<never>;
    expect(body).toMatchObject({ success: false, error: { code: "AUTH_USER_INACTIVE" } });
  });

  test("Module 2 live OpenAPI exposes only the approved auth and administration methods", async () => {
    const response = await apiContext.get(`${apiOrigin}/openapi.json`);
    expect(response.status()).toBe(200);
    const document = (await response.json()) as {
      paths?: Record<string, Record<string, unknown>>;
      components?: { securitySchemes?: Record<string, unknown> };
    };

    const approved = new Map<string, string[]>([
      ["/api/v1/auth/register", ["post"]],
      ["/api/v1/auth/login", ["post"]],
      ["/api/v1/auth/refresh", ["post"]],
      ["/api/v1/auth/logout", ["post"]],
      ["/api/v1/auth/me", ["get"]],
      ["/api/v1/admin/users", ["get"]],
      ["/api/v1/admin/users/{id}/status", ["patch"]],
      ["/api/v1/admin/users/{id}/roles", ["put"]],
      ["/api/v1/admin/roles", ["get", "post"]],
      ["/api/v1/admin/roles/{id}/permissions", ["put"]],
      ["/api/v1/admin/settings", ["get", "patch"]],
    ]);

    for (const [path, methods] of approved) expectMethods(document, path, methods);

    const authPaths = Object.keys(document.paths ?? {}).filter((path) => path.startsWith("/api/v1/auth/"));
    expect(authPaths.sort()).toEqual(
      [...approved.keys()].filter((path) => path.startsWith("/api/v1/auth/")).sort(),
    );

    for (const removedPath of [
      "/api/v1/auth/logout-all",
      "/api/v1/auth/change-password",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/reset-password",
      "/api/v1/admin/permissions",
    ]) {
      expect(document.paths).not.toHaveProperty(removedPath);
    }

    expect(document.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(document.components?.securitySchemes).toHaveProperty("refreshCookie");
  });
});
