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

interface SellerFixture {
  email: string;
  password: string;
  accessToken: string;
  sellerId: string;
  store: SellerStore;
}

/** Creates one collision-resistant suffix for browser-owned Product fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the bearer header used only for approved API setup and negative-scope checks. */
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

/** Signs in through the real browser UI and verifies permission-aware seller navigation. */
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
      displayName: `Module 6 ${suffix.slice(-6)}`,
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

/** Approves one submitted seller application through the privileged Module 4 command. */
async function approveSellerApplication(
  context: APIRequestContext,
  adminToken: string,
  applicationId: string,
): Promise<SellerRecord> {
  const response = await context.post(
    `${apiBase}/admin/seller-applications/${applicationId}/approve`,
    {
      headers: bearer(adminToken),
      data: {},
    },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<{
    application: SellerApplication;
    seller: SellerRecord;
  }>;
  return body.data.seller;
}

/** Creates one active seller store through the scoped Module 4 store command. */
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
      description: `Store used by the Module 6 Product E2E workflow for ${label}.`,
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: `${slug}@example.test`,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerStore>).data;
}

/** Creates one approved seller owner and active store without direct database edits. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<SellerFixture> {
  const password = "Module6Seller!123";
  const customer = await registerCustomer(context, prefix, password);
  const customerSession = await apiLogin(context, customer.email, password);
  const application = await submitSellerApplication(
    context,
    customerSession.accessToken,
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

/** Returns a tiny valid PNG buffer for the signed Product-media browser upload. */
function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZL1sAAAAASUVORK5CYII=",
    "base64",
  );
}

test.describe("Module 6 Product Management E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;
  let category: CategoryRecord;
  let productId = "";

  const suffix = unique("product");
  const productName = `Junior Friendly Product ${suffix}`;
  const productSlug = `junior-friendly-product-${suffix}`.toLowerCase();
  const sku = `SKU-${suffix}`.toUpperCase();
  const variantTitle = `Standard ${suffix}`;
  const mediaAltText = `Product image ${suffix}`;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    category = await createCategory(apiContext, adminToken, `Module6 ${suffix}`);
    sellerA = await createSellerFixture(apiContext, adminToken, `seller-a-${suffix}`);
    sellerB = await createSellerFixture(apiContext, adminToken, `seller-b-${suffix}`);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("creates, publishes, changes price history, uploads media, and unpublishes a Product", async ({
    page,
  }) => {
    await browserLogin(page, sellerA.email, sellerA.password, "/seller/products");
    await page.goto("/seller/products/new");
    await expect(page.getByRole("heading", { name: "Create Product" })).toBeVisible();

    await page.getByLabel("Product store").selectOption(sellerA.store.id);
    await page.getByLabel("Product name").fill(productName);
    await page.getByLabel("Product slug").fill(productSlug);
    await page
      .getByLabel("Product description")
      .fill("A clear Product fixture used to verify the complete Module 6 browser workflow.");
    await page.getByLabel("Product category").selectOption(category.id);
    await page.getByLabel("Product brand").selectOption("");
    await page.getByRole("button", { name: "Create draft Product" }).click();

    await expect(page).toHaveURL(/\/seller\/products\/[0-9a-f-]{36}$/);
    productId = page.url().split("/").at(-1) ?? "";
    expect(productId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();

    await page.getByLabel("Variant SKU").fill(sku);
    await page.getByLabel("Variant title").fill(variantTitle);
    await page.getByLabel("Variant price").fill("99.99");
    await page.getByLabel("Variant currency").fill("USD");
    await page.getByLabel("Variant status").selectOption("active");
    await page.getByRole("button", { name: "Add variant" }).click();
    await expect(page.getByText(`SKU ${sku} · active`)).toBeVisible();

    await page.getByLabel("Product media file").setInputFiles({
      name: `${suffix}.png`,
      mimeType: "image/png",
      buffer: tinyPng(),
    });
    await page.getByLabel("Product media alt text").fill(mediaAltText);
    await page.getByRole("button", { name: "Upload and link media" }).click();
    await expect(page.getByText(mediaAltText, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Publish / submit" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Public view" })).toBeVisible();

    await page.getByRole("link", { name: "Public view" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${productSlug}$`));
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    await expect(page.getByRole("heading", { name: variantTitle })).toBeVisible();
    await expect(page.getByText(`${mediaAltText} · image`)).toBeVisible();

    await page.goto(`/seller/products/${productId}`);
    await page.getByRole("button", { name: "Edit variant" }).click();
    await page.getByLabel(/^Variant price /).fill("129.99");
    await page.getByRole("button", { name: "Save variant" }).click();
    await expect(page.getByRole("heading", { name: "Pricing history" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$99.99" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$129.99" })).toBeVisible();

    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("unpublished", { exact: true })).toBeVisible();

    await page.goto(`/products/${productSlug}`);
    await expect(page.getByRole("heading", { name: "Product could not be loaded" })).toBeVisible();

    await page.goto("/products");
    await page.getByLabel("Search Products").fill(productName);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No published Products match these filters.")).toBeVisible();
  });

  test("proves seller-to-seller Product isolation for private reads and writes", async ({ page }) => {
    expect(productId, "The lifecycle test must create a Product before the isolation test runs.").not.toBe("");

    await browserLogin(page, sellerB.email, sellerB.password, "/seller/products");
    await page.goto(`/seller/products/${productId}`);
    await expect(page.getByRole("heading", { name: "Product could not be loaded" })).toBeVisible();

    const privateRead = await apiContext.get(`${apiBase}/seller/products/${productId}`, {
      headers: bearer(sellerB.accessToken),
    });
    expect(privateRead.status()).toBe(404);

    const forbiddenWrite = await apiContext.patch(`${apiBase}/seller/products/${productId}`, {
      headers: bearer(sellerB.accessToken),
      data: { name: `Forbidden update ${suffix}` },
    });
    expect(forbiddenWrite.status()).toBe(404);

    await page.goto("/seller/products");
    await page.getByLabel("Seller Product search").fill(productName);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No Products match these filters.")).toBeVisible();
  });
});
