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
  error?: { code: string; message: string };
}

interface AuthUser {
  id: string;
  email: string;
  accountType: "platform_admin" | "seller" | "customer";
  permissions: string[];
  scopes: { sellerIds: string[]; storeIds: string[] };
}

interface SessionData {
  accessToken: string;
  user: AuthUser;
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

interface SellerRecord {
  id: string;
  ownerUserId: string;
  displayName: string;
  legalName: string;
  status: "active" | "suspended";
}

interface SellerStore {
  id: string;
  sellerId: string;
  slug: string;
  name: string;
  logoFileId: string | null;
  status: "active" | "inactive" | "suspended";
  defaultCurrency: string;
}

interface MySeller {
  seller: SellerRecord;
  stores: SellerStore[];
  staffSummary: { totalCount: number; activeCount: number; inactiveCount: number };
}

interface RoleRecord {
  id: string;
  code: string;
}

/** Creates one collision-resistant suffix for test-owned identities and store slugs. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds one bearer header for direct API setup and negative authorization checks. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one identity through the real API. */
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

/** Signs in through the real browser UI and verifies the permission-aware destination. */
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

/** Registers one customer through the approved public registration endpoint. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(prefix);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 4 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Submits one seller application through the exact approved Module 4 command. */
async function submitApplication(
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

/** Approves one application through the privileged Module 4 review command. */
async function approveApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<{ application: SellerApplication; seller: SellerRecord }> {
  const response = await context.post(
    `${apiBase}/admin/seller-applications/${applicationId}/approve`,
    {
      headers: bearer(adminToken),
      data: {},
    },
  );
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as ApiEnvelope<{
      application: SellerApplication;
      seller: SellerRecord;
    }>
  ).data;
}

/** Creates one approved seller owner using only public registration and approved review APIs. */
async function createApprovedSeller(
  context: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<{
  owner: RegisteredCustomer;
  password: string;
  sellerId: string;
  accessToken: string;
}> {
  const password = "Module4SecondSeller!123";
  const owner = await registerCustomer(context, prefix, password);
  const customerSession = await apiLogin(context, owner.email, password);
  const application = await submitApplication(context, customerSession.accessToken, prefix);
  const approved = await approveApplication(context, adminToken, application.id);
  const sellerSession = await apiLogin(context, owner.email, password);
  return {
    owner,
    password,
    sellerId: approved.seller.id,
    accessToken: sellerSession.accessToken,
  };
}

/** Loads the authenticated seller aggregate through the exact seller self-service read. */
async function getMySeller(
  context: APIRequestContext,
  accessToken: string,
): Promise<MySeller> {
  const response = await context.get(`${apiBase}/sellers/me`, {
    headers: bearer(accessToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<MySeller>).data;
}

/** Performs sign -> direct storage PUT -> confirm for one test-owned file. */
async function uploadFile(
  context: APIRequestContext,
  accessToken: string,
  input: {
    purpose: "seller_verification" | "store_asset";
    name: string;
    mimeType: string;
    bytes: Buffer;
  },
): Promise<string> {
  const sign = await context.post(`${apiBase}/documents/uploads/sign`, {
    headers: bearer(accessToken),
    data: {
      originalName: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      purpose: input.purpose,
    },
  });
  expect(sign.status()).toBe(201);
  const signed = (await sign.json()) as ApiEnvelope<{
    fileId: string;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  }>;

  const storagePut = await context.put(signed.data.uploadUrl, {
    data: input.bytes,
    headers: signed.data.requiredHeaders,
  });
  expect(storagePut.ok()).toBe(true);

  const confirm = await context.post(`${apiBase}/documents/uploads/${signed.data.fileId}/confirm`, {
    headers: bearer(accessToken),
  });
  expect(confirm.status()).toBe(200);
  return signed.data.fileId;
}

/** Returns one seller-role ID from the approved Administration role-list response. */
async function roleIdByCode(
  context: APIRequestContext,
  adminToken: string,
  code: string,
): Promise<string> {
  const response = await context.get(`${apiBase}/admin/roles?page=1&pageSize=100&status=active`, {
    headers: bearer(adminToken),
  });
  expect(response.status()).toBe(200);
  const roles = ((await response.json()) as ApiEnvelope<RoleRecord[]>).data;
  const role = roles.find((item) => item.code === code);
  expect(role, `Role ${code} must exist in platform RBAC`).toBeTruthy();
  return role!.id;
}

/** Extracts one UUID rendered after a stable text label. */
async function renderedUuid(page: Page, label: string): Promise<string> {
  const text = await page.getByText(new RegExp(`${label}\\s*[0-9a-f-]{36}`, "i")).textContent();
  const match = text?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  expect(match, `${label} must render a UUID`).toBeTruthy();
  return match![0];
}

test.describe("Module 4 Seller & Store Management E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let customerEmail = "";
  let customerPassword = "";
  let applicantUserId = "";
  let applicationId = "";
  let sellerId = "";
  let sellerToken = "";
  let sellerBToken = "";
  let sellerBId = "";
  let staffToken = "";
  let storeId = "";
  let storeSlug = "";
  let storeName = "";
  let sellerDisplayName = "";
  let sellerLegalName = "";
  const sellerTaxId = `M4-TAX-${Date.now()}`;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    const admin = await apiLogin(apiContext, adminEmail, adminPassword);
    adminToken = admin.accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("customer registers, signs in, submits seller application, and links verification evidence", async ({ page }) => {
    const suffix = unique("module4-owner");
    customerEmail = `${suffix}@example.test`;
    customerPassword = "Module4OwnerPassword!123";
    sellerDisplayName = `Module 4 Shop ${suffix.slice(-6)}`;
    sellerLegalName = `Module 4 Trading ${suffix.slice(-6)} Ltd`;

    await page.goto("/register");
    await page.getByLabel("Display name").fill(`Owner ${suffix.slice(-6)}`);
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

    const customerSession = await apiLogin(apiContext, customerEmail, customerPassword);
    applicantUserId = customerSession.user.id;
    expect(customerSession.user.accountType).toBe("customer");

    await page.goto("/seller/apply");
    await expect(page.getByRole("heading", { name: "Apply to become a seller" })).toBeVisible();
    await page.getByLabel("Seller legal name").fill(sellerLegalName);
    await page.getByLabel("Seller display name").fill(sellerDisplayName);
    await page.getByLabel("Seller tax ID").fill(sellerTaxId);
    await page.getByRole("button", { name: "Submit seller application" }).click();
    await expect(page.getByText("Application submitted.")).toBeVisible();
    applicationId = await renderedUuid(page, "Application ID:");

    const evidence = Buffer.from("%PDF-1.4\n% Module 4 seller verification\n%%EOF\n", "utf8");
    await page.getByLabel("Seller verification file").setInputFiles({
      name: "module4-verification.pdf",
      mimeType: "application/pdf",
      buffer: evidence,
    });
    await page.getByRole("button", { name: "Upload verification file" }).click();
    await expect(page.getByText("Linked verification file: module4-verification.pdf")).toBeVisible();
  });

  test("platform admin reviews and approves the submitted application in the browser", async ({ page }) => {
    expect(applicationId).not.toBe("");
    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/admin/seller-applications");
    await expect(page.getByRole("heading", { name: "Seller applications" })).toBeVisible();

    const card = page.locator("article").filter({
      has: page.getByRole("heading", { name: sellerDisplayName, exact: true }),
    });
    await expect(card).toBeVisible();
    await expect(card.getByText(`Applicant: ${applicantUserId}`)).toBeVisible();
    await card.getByRole("button", { name: "Approve application" }).click();
    await expect(card.getByText(/Created seller ID:/)).toBeVisible();

    const text = await card.getByText(/Created seller ID:/).textContent();
    const match = text?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(match).toBeTruthy();
    sellerId = match![0];

    const freshSession = await apiLogin(apiContext, customerEmail, customerPassword);
    expect(freshSession.user.accountType).toBe("seller");
    expect(freshSession.user.scopes.sellerIds).toEqual([sellerId]);
    expect(freshSession.user.scopes.storeIds).toEqual([]);
  });

  test("approved seller re-authenticates, updates profile, creates store, uploads logo, and serves public storefront", async ({ page }) => {
    expect(sellerId).not.toBe("");
    await browserLogin(page, customerEmail, customerPassword, "/seller/profile");
    await expect(page.getByRole("heading", { name: sellerDisplayName })).toBeVisible();
    await expect(page.getByText("Status: active · Approval: approved")).toBeVisible();

    const updatedDisplayName = `${sellerDisplayName} Updated`;
    await page.getByLabel("Seller profile display name").fill(updatedDisplayName);
    await page.getByRole("button", { name: "Save seller profile" }).click();
    await expect(page.getByText("Seller profile saved.")).toBeVisible();
    sellerDisplayName = updatedDisplayName;

    sellerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    const sellerBeforeStore = await getMySeller(apiContext, sellerToken);
    expect(sellerBeforeStore.seller.id).toBe(sellerId);
    expect(sellerBeforeStore.staffSummary.activeCount).toBe(1);

    storeSlug = unique("module4-store").toLowerCase();
    storeName = `Module 4 Store ${storeSlug.slice(-6)}`;
    await page.goto("/seller/stores");
    await page.getByLabel("Store name").fill(storeName);
    await page.getByLabel("Store slug").fill(storeSlug.toUpperCase());
    await page.getByLabel("Store description").fill("Module 4 public storefront description.");
    await page.getByLabel("Store currency").fill("pkr");
    await page.getByLabel("Store support email").fill("STORE@EXAMPLE.TEST");
    await page.getByRole("button", { name: "Create store" }).click();
    await expect(page.getByRole("heading", { name: storeName })).toBeVisible();

    const sellerAfterStore = await getMySeller(apiContext, sellerToken);
    const createdStore = sellerAfterStore.stores.find((store) => store.slug === storeSlug);
    expect(createdStore).toBeTruthy();
    storeId = createdStore!.id;
    expect(createdStore!.defaultCurrency).toBe("PKR");

    const authMe = await apiContext.get(`${apiBase}/auth/me`, {
      headers: bearer(sellerToken),
    });
    expect(authMe.status()).toBe(200);
    const currentUser = ((await authMe.json()) as ApiEnvelope<AuthUser>).data;
    expect(currentUser.scopes.sellerIds).toContain(sellerId);
    expect(currentUser.scopes.storeIds).toContain(storeId);

    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    );
    await page.getByLabel(`Store logo file ${storeId}`).setInputFiles({
      name: "module4-store-logo.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await page.getByRole("button", { name: "Upload logo" }).click();
    await expect(page.getByText("Logo updated from module4-store-logo.png.")).toBeVisible();

    await page.goto(`/stores/${storeSlug}`);
    await expect(page.getByRole("heading", { name: storeName })).toBeVisible();
    await expect(page.getByText(`Sold by ${sellerDisplayName}`)).toBeVisible();
    await expect(page.getByText("PKR", { exact: true })).toBeVisible();
    await expect(page.getByText("store@example.test", { exact: true })).toBeVisible();
    await expect(page.getByText(sellerLegalName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(sellerTaxId, { exact: true })).toHaveCount(0);

    const publicResponse = await apiContext.get(`${apiBase}/stores/${storeSlug}`);
    expect(publicResponse.status()).toBe(200);
    const publicStore = ((await publicResponse.json()) as ApiEnvelope<{
      id: string;
      seller: Record<string, unknown>;
    }>).data;
    expect(publicStore.id).toBe(storeId);
    expect(Object.keys(publicStore.seller).sort()).toEqual(["displayName", "id"]);
  });

  test("seller controls store active/inactive status in the browser and public visibility follows", async ({ page }) => {
    expect(storeId).not.toBe("");
    expect(storeSlug).not.toBe("");

    await browserLogin(page, customerEmail, customerPassword, "/seller/profile");
    await page.goto("/seller/stores");

    const storeCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: storeName, exact: true }),
    });
    await expect(storeCard).toBeVisible();

    await storeCard.getByRole("button", { name: "Edit store" }).click();
    await storeCard.getByLabel(`Store status ${storeId}`).selectOption("inactive");
    await storeCard.getByRole("button", { name: "Save store" }).click();
    await expect(storeCard.getByText(new RegExp(`/${storeSlug} · inactive`))).toBeVisible();

    await page.goto(`/stores/${storeSlug}`);
    await expect(page.getByRole("heading", { name: "Store unavailable" })).toBeVisible();
    const hiddenPublicStore = await apiContext.get(`${apiBase}/stores/${storeSlug}`);
    expect(hiddenPublicStore.status()).toBe(404);
    const hiddenBody = (await hiddenPublicStore.json()) as ApiEnvelope<never>;
    expect(hiddenBody.error?.code).toBe("STORE_NOT_FOUND");

    await page.goto("/seller/stores");
    const inactiveStoreCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: storeName, exact: true }),
    });
    await inactiveStoreCard.getByRole("button", { name: "Edit store" }).click();
    await inactiveStoreCard.getByLabel(`Store status ${storeId}`).selectOption("active");
    await inactiveStoreCard.getByRole("button", { name: "Save store" }).click();
    await expect(inactiveStoreCard.getByText(new RegExp(`/${storeSlug} · active`))).toBeVisible();

    await page.goto(`/stores/${storeSlug}`);
    await expect(page.getByRole("heading", { name: storeName })).toBeVisible();
  });

  test("Seller B cannot update or attach a store asset to Seller A private store", async () => {
    expect(storeId).not.toBe("");
    const sellerB = await createApprovedSeller(apiContext, adminToken, "module4-seller-b");
    sellerBToken = sellerB.accessToken;
    sellerBId = sellerB.sellerId;

    const foreignUpdate = await apiContext.patch(`${apiBase}/sellers/me/stores/${storeId}`, {
      headers: bearer(sellerBToken),
      data: { name: "Seller B must not rename Seller A store" },
    });
    expect(foreignUpdate.status()).toBe(404);
    const foreignUpdateBody = (await foreignUpdate.json()) as ApiEnvelope<never>;
    expect(foreignUpdateBody.error?.code).toBe("STORE_NOT_FOUND");

    const foreignAssetId = await uploadFile(apiContext, sellerBToken, {
      purpose: "store_asset",
      name: "seller-b-private-asset.png",
      mimeType: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const foreignLink = await apiContext.post(`${apiBase}/documents/${foreignAssetId}/link`, {
      headers: bearer(sellerBToken),
      data: {
        resourceType: "store",
        resourceId: storeId,
        purpose: "store_asset",
      },
    });
    expect(foreignLink.status()).toBe(404);
    const foreignLinkBody = (await foreignLink.json()) as ApiEnvelope<never>;
    expect(foreignLinkBody.error?.code).toBe("FILE_NOT_FOUND");

    const sellerA = await getMySeller(apiContext, sellerToken);
    expect(sellerA.stores.find((store) => store.id === storeId)?.name).toBe(storeName);
  });

  test("seller owner manages seller staff through the browser without exposing owner-level delegation", async ({ page }) => {
    expect(sellerId).not.toBe("");
    expect(sellerBId).not.toBe("");
    const staffPassword = "Module4SellerStaff!123";
    const staff = await registerCustomer(apiContext, "module4-staff", staffPassword);
    const sellerManagerRoleId = await roleIdByCode(apiContext, adminToken, "seller_manager");

    const foreignAssignment = await apiContext.put(`${apiBase}/admin/users/${staff.id}/roles`, {
      headers: bearer(sellerBToken),
      data: {
        assignments: [{ roleId: sellerManagerRoleId, sellerId }],
      },
    });
    expect(foreignAssignment.status()).toBe(403);
    const foreignBody = (await foreignAssignment.json()) as ApiEnvelope<never>;
    expect(foreignBody.error?.code).toBe("SELLER_SCOPE_FORBIDDEN");

    await browserLogin(page, customerEmail, customerPassword, "/seller/profile");
    await page.goto("/seller/staff");
    await page.getByLabel("Seller staff email").fill(staff.email);
    await page.getByRole("button", { name: "Find staff user" }).click();
    await expect(page.getByText(staff.email, { exact: true })).toBeVisible();

    const roleSelect = page.getByLabel("Seller staff role");
    await expect(roleSelect.locator("option", { hasText: "Seller Owner" })).toHaveCount(0);
    await expect(roleSelect.locator("option", { hasText: "Seller Manager" })).toHaveCount(1);
    await roleSelect.selectOption({ label: "Seller Manager" });
    await page.getByRole("button", { name: "Save seller access" }).click();
    await expect(page.getByText("Seller staff access saved.")).toBeVisible();

    const staffSession = await apiLogin(apiContext, staff.email, staffPassword);
    staffToken = staffSession.accessToken;
    expect(staffSession.user.accountType).toBe("seller");
    expect(staffSession.user.scopes.sellerIds).toEqual([sellerId]);
    expect(staffSession.user.scopes.storeIds).toContain(storeId);

    const sellerProfile = await getMySeller(apiContext, sellerToken);
    expect(sellerProfile.staffSummary).toMatchObject({
      totalCount: 2,
      activeCount: 2,
      inactiveCount: 0,
    });
  });

  test("platform admin suspends the seller through the browser and active scopes disappear", async ({ page }) => {
    expect(sellerId).not.toBe("");

    await browserLogin(page, adminEmail, adminPassword, "/admin/users");
    await page.goto("/admin/sellers/suspend");
    await page.getByLabel("Seller ID to suspend").fill(sellerId);
    await page.getByLabel("Seller suspension reason").fill("Module 4 E2E compliance hold");
    await page.getByRole("button", { name: "Suspend seller" }).click();
    await expect(page.getByText(`Seller ${sellerDisplayName} is now suspended.`)).toBeVisible();

    const ownerMe = await apiContext.get(`${apiBase}/auth/me`, {
      headers: bearer(sellerToken),
    });
    expect(ownerMe.status()).toBe(200);
    const ownerUser = ((await ownerMe.json()) as ApiEnvelope<AuthUser>).data;
    expect(ownerUser.scopes.sellerIds).toEqual([]);
    expect(ownerUser.scopes.storeIds).toEqual([]);

    const staffMe = await apiContext.get(`${apiBase}/auth/me`, {
      headers: bearer(staffToken),
    });
    expect(staffMe.status()).toBe(200);
    const staffUser = ((await staffMe.json()) as ApiEnvelope<AuthUser>).data;
    expect(staffUser.scopes.sellerIds).toEqual([]);
    expect(staffUser.scopes.storeIds).toEqual([]);

    const blockedStore = await apiContext.post(`${apiBase}/sellers/me/stores`, {
      headers: bearer(sellerToken),
      data: {
        slug: unique("suspended-store"),
        name: "Must not be created",
        defaultCurrency: "PKR",
      },
    });
    expect(blockedStore.status()).toBe(403);
    const blockedBody = (await blockedStore.json()) as ApiEnvelope<never>;
    expect(blockedBody.error?.code).toBe("SELLER_SCOPE_FORBIDDEN");

    const hiddenPublicStore = await apiContext.get(`${apiBase}/stores/${storeSlug}`);
    expect(hiddenPublicStore.status()).toBe(404);
    const hiddenBody = (await hiddenPublicStore.json()) as ApiEnvelope<never>;
    expect(hiddenBody.error?.code).toBe("STORE_NOT_FOUND");
  });
});
