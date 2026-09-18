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
}

interface BrandRecord {
  id: string;
  name: string;
}

interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  variants?: ProductVariantRecord[];
}

interface ProductVariantRecord {
  id: string;
  sku: string;
  price: string;
}

interface SellerFixture {
  email: string;
  password: string;
  accessToken: string;
  store: SellerStore;
}

interface SearchProductCard {
  productId: string;
  storeId: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryPath: string;
  brandId: string | null;
  brand: string | null;
  minPrice: string;
  maxPrice: string;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  thumbnailFileId: string | null;
  updatedAt: string;
}

interface SearchProductsData {
  items: SearchProductCard[];
}

interface SearchReindexRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  errorCode: string | null;
}

/** Creates one collision-resistant token for browser-owned Search fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds an Authorization header for approved API fixture setup and admin verification. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Authenticates one user through the real Module 2 HTTP API. */
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

/** Registers one customer who will become an approved seller owner. */
async function registerCustomer(
  context: APIRequestContext,
  prefix: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(prefix);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 19 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Submits a seller application through the real Module 4 command. */
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

/** Approves one seller application through the real privileged Module 4 command. */
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

/** Creates one active public Store for a seller through Module 4. */
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
      name: `${label} Search Store`,
      description: "Public Store used by the Module 19 Search E2E workflow.",
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: `${slug}@example.test`,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerStore>).data;
}

/** Creates an approved seller owner and active Store without direct database writes. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<SellerFixture> {
  const password = "Module19Seller!123";
  const customer = await registerCustomer(context, prefix, password);
  const firstSession = await apiLogin(context, customer.email, password);
  const application = await submitSellerApplication(
    context,
    firstSession.accessToken,
    prefix,
  );
  await approveSellerApplication(context, adminToken, application.id);
  const sellerSession = await apiLogin(context, customer.email, password);
  const store = await createStore(context, sellerSession.accessToken, prefix);

  return {
    email: customer.email,
    password,
    accessToken: sellerSession.accessToken,
    store,
  };
}

/** Creates one active taxonomy category through the real Module 5 admin API. */
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

/** Creates one active brand through the real Module 5 admin API. */
async function createBrand(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<BrandRecord> {
  const slug = unique(label.replace(/[^a-z0-9]+/gi, "-")).toLowerCase();
  const response = await context.post(`${apiBase}/admin/catalog/brands`, {
    headers: bearer(adminToken),
    data: { slug, name: `${label} Brand` },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<BrandRecord>).data;
}

/** Creates one seller Product draft through the real Module 6 API. */
async function createProduct(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
  brandId: string,
  label: string,
): Promise<ProductRecord> {
  const slug = unique(label.replace(/[^a-z0-9]+/gi, "-")).toLowerCase();
  const response = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId,
      slug,
      name: `${label} Search Product`,
      description: "Public Product used to verify event-driven Search discovery.",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active sellable variant to a Product through Module 6. */
async function createVariant(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  label: string,
  price: string,
): Promise<ProductVariantRecord> {
  const sku = `M19-${unique(label)}`.toUpperCase();
  const response = await context.post(`${apiBase}/seller/products/${productId}/variants`, {
    headers: bearer(sellerToken),
    data: {
      sku,
      title: `${label} Variant`,
      price,
      currency: "USD",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const detail = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = detail.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 19 E2E Product response did not contain the new variant.");
  return variant;
}

/** Publishes one valid Product through the real Module 6 lifecycle command. */
async function publishProduct(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/products/${productId}/publish`, {
    headers: bearer(sellerToken),
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Unpublishes one Product so Search must remove its derived document. */
async function unpublishProduct(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/products/${productId}/unpublish`, {
    headers: bearer(sellerToken),
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Applies one controlled Inventory adjustment through the seller Module 7 command. */
async function adjustInventory(
  context: APIRequestContext,
  sellerToken: string,
  variantId: string,
  quantityDelta: number,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/inventory/${variantId}/adjust`, {
    headers: bearer(sellerToken),
    data: { quantityDelta },
  });
  expect(response.status()).toBe(200);
}

/** Changes one authoritative Product variant price so Search must eventually refresh its cached range. */
async function updateVariantPrice(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  variantId: string,
  price: string,
): Promise<void> {
  const response = await context.patch(
    `${apiBase}/seller/products/${productId}/variants/${variantId}`,
    { headers: bearer(sellerToken), data: { price } },
  );
  expect(response.status()).toBe(200);
}

/** Changes one authoritative Product name so text Search must eventually discover the new token. */
async function updateProductName(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  name: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/seller/products/${productId}`, {
    headers: bearer(sellerToken),
    data: { name },
  });
  expect(response.status()).toBe(200);
}

/** Reads one public-safe Search Product card by Product ID without using seller-private APIs. */
async function findSearchProduct(
  context: APIRequestContext,
  productId: string,
  query: string,
): Promise<SearchProductCard | null> {
  const response = await context.get(`${apiBase}/search/products`, {
    params: { q: query, page: 1, pageSize: 20 },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ApiEnvelope<SearchProductsData>;
  return body.data.items.find((item) => item.productId === productId) ?? null;
}

/** Polls the eventual Search read model until one Product satisfies the expected public-card state. */
async function waitForSearchProduct(
  context: APIRequestContext,
  productId: string,
  query: string,
  predicate: (product: SearchProductCard) => boolean,
): Promise<SearchProductCard> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const product = await findSearchProduct(context, productId, query);
    if (product && predicate(product)) return product;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Search Product ${productId} to reach the expected state.`);
}

/** Polls until a Product has been removed from the public Search read model. */
async function waitForSearchProductRemoval(
  context: APIRequestContext,
  productId: string,
  query: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!(await findSearchProduct(context, productId, query))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Search Product ${productId} to be removed.`);
}

/** Queues an admin full reindex, retrying briefly when an event-triggered reindex is already active. */
async function queueAdminReindex(
  context: APIRequestContext,
  adminToken: string,
): Promise<SearchReindexRun> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await context.post(`${apiBase}/admin/search/reindex`, {
      headers: bearer(adminToken),
      data: {},
    });
    if (response.status() === 202) {
      return ((await response.json()) as ApiEnvelope<SearchReindexRun>).data;
    }
    if (response.status() !== 409) {
      throw new Error(`Search reindex request returned unexpected status ${response.status()}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting to queue an administrator Search reindex.");
}

/** Polls the persisted admin reindex status until the worker completes successfully. */
async function waitForReindexCompletion(
  context: APIRequestContext,
  adminToken: string,
  reindexRunId: string,
): Promise<SearchReindexRun> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await context.get(`${apiBase}/admin/search/reindex/${reindexRunId}`, {
      headers: bearer(adminToken),
    });
    expect(response.status()).toBe(200);
    const run = ((await response.json()) as ApiEnvelope<SearchReindexRun>).data;
    if (run.status === "completed") return run;
    if (run.status === "failed") {
      throw new Error(`Search reindex failed with ${run.errorCode ?? "unknown error"}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Search reindex ${reindexRunId} to complete.`);
}

/** Returns the Product Search card that contains one exact Product heading. */
function productCard(page: Page, productName: string) {
  return page
    .getByRole("heading", { name: productName, exact: true })
    .locator("xpath=ancestor::article[1]");
}

test.describe("Module 19 Search & Discovery E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let seller: SellerFixture;
  let category: CategoryRecord;
  let brand: BrandRecord;
  let product: ProductRecord;
  let variant: ProductVariantRecord;

  const suffix = unique("search");
  const originalToken = `Nebula${suffix.replace(/[^a-z0-9]/gi, "")}`;
  const updatedToken = `Aurora${suffix.replace(/[^a-z0-9]/gi, "")}`;
  const originalProductName = `${originalToken} Search Product`;
  const updatedProductName = `${updatedToken} Search Product`;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    category = await createCategory(apiContext, adminToken, `Module19 ${suffix}`);
    brand = await createBrand(apiContext, adminToken, `Module19 ${suffix}`);
    seller = await createSellerFixture(apiContext, adminToken, `seller-${suffix}`);

    product = await createProduct(
      apiContext,
      seller,
      category.id,
      brand.id,
      originalToken,
    );
    variant = await createVariant(
      apiContext,
      seller.accessToken,
      product.id,
      originalToken,
      "120.00",
    );
    await adjustInventory(apiContext, seller.accessToken, variant.id, 7);
    await publishProduct(apiContext, seller.accessToken, product.id);

    // Leave one second published Product behind so post-E2E integrity can validate a live Search document.
    const control = await createProduct(
      apiContext,
      seller,
      category.id,
      brand.id,
      `Control${suffix.replace(/[^a-z0-9]/gi, "")}`,
    );
    await createVariant(apiContext, seller.accessToken, control.id, "Control", "80.00");
    await publishProduct(apiContext, seller.accessToken, control.id);

    await waitForSearchProduct(
      apiContext,
      product.id,
      originalToken,
      (item) => item.inStock && item.minPrice === "120.00" && item.brandId === brand.id,
    );
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("searches, autocompletes, filters by facets/price/stock, and opens authoritative Product detail", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search marketplace" })).toBeVisible();

    await page.getByLabel("Marketplace search").fill(originalToken.slice(0, -3));
    await expect(page.getByText("Suggestions", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: originalProductName })).toBeVisible();
    await page.getByRole("button", { name: originalProductName }).click();

    await page.getByLabel("Minimum price").fill("100.00");
    await page.getByLabel("Maximum price").fill("130.00");
    await page.getByLabel("Availability").selectOption("true");
    await page.getByLabel("Search result sort").selectOption("price_desc");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/minPrice=100/);
    await expect(page).toHaveURL(/maxPrice=130/);
    await expect(page).toHaveURL(/inStock=true/);
    const card = productCard(page, originalProductName);
    await expect(card).toContainText("USD 120.00");
    await expect(card.getByText("In stock", { exact: true })).toBeVisible();
    await expect(card).toContainText("No ratings yet");

    await page.getByRole("button", { name: new RegExp(category.name) }).click();
    await expect(page).toHaveURL(new RegExp(`categoryId=${category.id}`));
    await expect(productCard(page, originalProductName)).toBeVisible();

    await page.getByRole("button", { name: new RegExp(brand.name) }).click();
    await expect(page).toHaveURL(new RegExp(`brandId=${brand.id}`));
    await expect(productCard(page, originalProductName)).toBeVisible();

    await productCard(page, originalProductName).getByRole("link", { name: "View Product" }).click();
    await expect(page.getByRole("heading", { name: originalProductName })).toBeVisible();
  });

  test("blocks invalid Search price filters with readable browser validation", async ({ page }) => {
    await page.goto("/search");

    const minPrice = page.getByLabel("Minimum price");
    const maxPrice = page.getByLabel("Maximum price");

    await maxPrice.fill("-1");
    await expect(page.getByText(/non-negative price/i)).toBeVisible();
    await expect(maxPrice).toHaveAttribute("aria-invalid", "true");

    await maxPrice.fill("50.00");
    await minPrice.fill("100.00");
    await expect(
      page.getByText(/maximum price must be greater than or equal to minimum price/i),
    ).toBeVisible();
    await expect(maxPrice).toHaveAttribute("aria-invalid", "true");
  });

  test("shows a safe request ID when the live Search page receives an API failure", async ({ page }) => {
    await page.route("**/api/v1/search/products**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "SEARCH_INDEX_UNAVAILABLE",
            message: "Search is temporarily unavailable.",
          },
          requestId: "e2e-search-request-123",
        }),
      });
    });

    await page.goto(`/search?q=${encodeURIComponent(originalToken)}`);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Search is temporarily unavailable.");
    await expect(alert).toContainText("Request ID: e2e-search-request-123");
  });

  test("reflects source name, price, and availability changes without making Search authoritative", async ({ page }) => {
    await updateProductName(apiContext, seller.accessToken, product.id, updatedProductName);
    await updateVariantPrice(apiContext, seller.accessToken, product.id, variant.id, "145.00");
    await adjustInventory(apiContext, seller.accessToken, variant.id, -7);

    const refreshed = await waitForSearchProduct(
      apiContext,
      product.id,
      updatedToken,
      (item) => item.name === updatedProductName && item.minPrice === "145.00" && !item.inStock,
    );
    expect(refreshed).not.toHaveProperty("sellerId");
    expect(refreshed).not.toHaveProperty("publicationStatus");
    expect(refreshed).not.toHaveProperty("createdBy");

    await page.goto(`/search?q=${encodeURIComponent(updatedToken)}&inStock=true&sort=relevance&page=1&pageSize=20`);
    await expect(page.getByRole("heading", { name: "No Products found" })).toBeVisible();

    await page.getByLabel("Availability").selectOption("false");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const card = productCard(page, updatedProductName);
    await expect(card).toContainText("USD 145.00");
    await expect(card.getByText("Out of stock", { exact: true })).toBeVisible();
  });

  test("searches public Stores and completes the privileged full-reindex lifecycle", async ({ page }) => {
    await page.goto(`/search/stores?q=${encodeURIComponent(seller.store.name)}&sort=relevance&page=1&pageSize=20`);
    await expect(page.getByRole("heading", { name: "Search stores" })).toBeVisible();
    await expect(page.getByRole("heading", { name: seller.store.name, exact: true })).toBeVisible();

    const run = await queueAdminReindex(apiContext, adminToken);
    expect(["queued", "running"]).toContain(run.status);
    const completed = await waitForReindexCompletion(apiContext, adminToken, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.errorCode).toBeNull();

    await waitForSearchProduct(
      apiContext,
      product.id,
      updatedToken,
      (item) => item.minPrice === "145.00" && !item.inStock,
    );
  });

  test("removes an unpublished Product from Search while the authoritative Product lifecycle remains server-owned", async ({ page }) => {
    await unpublishProduct(apiContext, seller.accessToken, product.id);
    await waitForSearchProductRemoval(apiContext, product.id, updatedToken);

    await page.goto(`/search?q=${encodeURIComponent(updatedToken)}&sort=relevance&page=1&pageSize=20`);
    await expect(page.getByRole("heading", { name: "No Products found" })).toBeVisible();

    const publicProduct = await apiContext.get(`${apiBase}/products/${product.slug}`);
    expect(publicProduct.status()).toBe(404);
  });
});
