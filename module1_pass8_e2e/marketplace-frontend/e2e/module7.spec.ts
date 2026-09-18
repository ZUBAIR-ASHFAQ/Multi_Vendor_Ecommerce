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

interface SessionData {
  accessToken: string;
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

interface SellerApplication {
  id: string;
}

interface SellerRecord {
  id: string;
}

interface SellerStore {
  id: string;
  name: string;
  slug: string;
}

interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
}

interface ProductRecord {
  id: string;
  variants?: ProductVariantRecord[];
}

interface ProductVariantRecord {
  id: string;
  sku: string;
}

interface SellerFixture {
  email: string;
  password: string;
  accessToken: string;
  sellerId: string;
  store: SellerStore;
}

/** Creates one collision-resistant suffix for browser-owned Inventory fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the bearer header used only for approved API fixture setup and isolation checks. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one identity through the real HTTP API. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<SessionData>).data;
}

/** Signs in through the browser UI and waits for the seller landing route. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/seller\/products$/);
}

/** Registers one customer through the approved public registration command. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(prefix);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 7 ${suffix.slice(-6)}`,
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

/** Approves one seller application through the privileged Module 4 command. */
async function approveSellerApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<SellerRecord> {
  const response = await context.post(
    `${apiBase}/admin/seller-applications/${applicationId}/approve`,
    { headers: bearer(adminToken), data: {} },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<{
    application: SellerApplication;
    seller: SellerRecord;
  }>;
  return body.data.seller;
}

/** Creates one active seller store through the scoped Module 4 command. */
async function createStore(
  context: APIRequestContext,
  sellerToken: string,
  label: string,
): Promise<SellerStore> {
  const slug = unique(label.replace(/[^a-z0-9]+/gi, "-")).toLowerCase();
  const response = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerToken),
    data: {
      slug,
      name: `${label} Store`,
      description: `Store used by the Module 7 Inventory E2E workflow for ${label}.`,
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: `${slug}@example.test`,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerStore>).data;
}

/** Creates one approved seller owner and active store without direct database writes. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<SellerFixture> {
  const password = "Module7Seller!123";
  const customer = await registerCustomer(context, prefix, password);
  const initialSession = await apiLogin(context, customer.email, password);
  const application = await submitSellerApplication(
    context,
    initialSession.accessToken,
    prefix,
  );
  const seller = await approveSellerApplication(context, adminToken, application.id);
  const sellerSession = await apiLogin(context, customer.email, password);
  const store = await createStore(context, sellerSession.accessToken, prefix);

  return {
    email: customer.email,
    password,
    accessToken: sellerSession.accessToken,
    sellerId: seller.id,
    store,
  };
}

/** Creates one active taxonomy category through the real Module 5 administration API. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<CategoryRecord> {
  const slug = unique(label.replace(/[^a-z0-9]+/gi, "-")).toLowerCase();
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug,
      name: `${label} Category`,
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates one seller Product draft through the real Module 6 API. */
async function createProduct(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
  label: string,
): Promise<ProductRecord> {
  const slug = unique(label.replace(/[^a-z0-9]+/gi, "-")).toLowerCase();
  const response = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug,
      name: `${label} Inventory Product`,
      description: "Product created through Module 6 for the Module 7 Inventory E2E workflow.",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active Product variant and returns the created sellable unit. */
async function createVariant(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  label: string,
): Promise<ProductVariantRecord> {
  const sku = `M7-${unique(label)}`.toUpperCase();
  const response = await context.post(`${apiBase}/seller/products/${productId}/variants`, {
    headers: bearer(sellerToken),
    data: {
      sku,
      title: `${label} Variant`,
      price: "100.00",
      currency: "USD",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const detail = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = detail.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 7 E2E Product response did not contain the created variant.");
  return variant;
}

/** Returns the table row that owns one exact Product variant UUID. */
function inventoryRow(page: Page, variantId: string) {
  return page.locator(`td[title="${variantId}"]`).locator("..");
}

test.describe("Module 7 Inventory & Stock E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;
  let variantId = "";

  const suffix = unique("inventory");

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    const category = await createCategory(apiContext, adminToken, `Module7 ${suffix}`);
    sellerA = await createSellerFixture(apiContext, adminToken, `seller-a-${suffix}`);
    sellerB = await createSellerFixture(apiContext, adminToken, `seller-b-${suffix}`);
    const product = await createProduct(apiContext, sellerA, category.id, `Module7 ${suffix}`);
    const variant = await createVariant(
      apiContext,
      sellerA.accessToken,
      product.id,
      `Stock ${suffix}`,
    );
    variantId = variant.id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("initializes stock, manages a reorder threshold, creates low stock, and shows immutable movements", async ({
    page,
  }) => {
    await browserLogin(page, sellerA.email, sellerA.password);
    await page.goto(`/seller/inventory/${variantId}/manage`);
    await expect(page.getByRole("heading", { name: "Manage variant Inventory" })).toBeVisible();

    await page.getByLabel("Inventory quantity adjustment").fill("10");
    await page.getByRole("button", { name: "Apply adjustment" }).click();
    await expect(page.getByText("On hand").locator("..").getByText("10", { exact: true })).toBeVisible();
    await expect(page.getByText("Reserved").locator("..").getByText("0", { exact: true })).toBeVisible();
    await expect(page.getByText("Available").locator("..").getByText("10", { exact: true })).toBeVisible();

    await page.getByLabel("Inventory reorder level").fill("5");
    await page.getByRole("button", { name: "Save threshold" }).click();

    await page.goto("/seller/inventory");
    await expect(page.getByRole("heading", { name: "Inventory & Stock" })).toBeVisible();
    let row = inventoryRow(page, variantId);
    await expect(row).toContainText("10");
    await expect(row).toContainText("5");
    await expect(row.getByText("Healthy", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Manage" }).click();
    await page.getByLabel("Inventory quantity adjustment").fill("-5");
    await page.getByRole("button", { name: "Apply adjustment" }).click();

    row = inventoryRow(page, variantId);
    await expect(row).toContainText("5");
    await expect(row.getByText("Low stock", { exact: true })).toBeVisible();

    await page.getByLabel("Only low stock").check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    row = inventoryRow(page, variantId);
    await expect(row).toBeVisible();
    await expect(row.getByText("Low stock", { exact: true })).toBeVisible();

    await row.getByRole("link", { name: "Movements" }).click();
    await expect(page.getByRole("heading", { name: "Stock movement history" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "+10" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "-5" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "adjustment" }).first()).toBeVisible();
  });

  test("proves Seller B cannot read or adjust Seller A Inventory", async ({ page }) => {
    expect(variantId, "The Inventory lifecycle test fixture must exist before isolation proof.").not.toBe("");

    await browserLogin(page, sellerB.email, sellerB.password);
    await page.goto("/seller/inventory");
    await expect(
      page.getByText("No Inventory rows match these filters. Create Product variants first, then use an adjustment to initialize stock."),
    ).toBeVisible();

    const privateMovementRead = await apiContext.get(
      `${apiBase}/seller/inventory/${variantId}/movements`,
      { headers: bearer(sellerB.accessToken) },
    );
    expect(privateMovementRead.status()).toBe(404);

    await page.goto(`/seller/inventory/${variantId}/manage`);
    await page.getByLabel("Inventory quantity adjustment").fill("1");
    await page.getByRole("button", { name: "Apply adjustment" }).click();
    await expect(page.getByRole("alert")).toHaveText("Inventory was not found.");

    const forbiddenWrite = await apiContext.post(
      `${apiBase}/seller/inventory/${variantId}/adjust`,
      {
        headers: bearer(sellerB.accessToken),
        data: { quantityDelta: 1 },
      },
    );
    expect(forbiddenWrite.status()).toBe(404);
  });
});
