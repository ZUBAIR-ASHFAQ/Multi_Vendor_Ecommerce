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
  requestId?: string;
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
}

interface SellerFixture {
  email: string;
  password: string;
  accessToken: string;
  sellerId: string;
  store: SellerStore;
}

interface CategoryRecord {
  id: string;
}

interface ProductVariantRecord {
  id: string;
  sku: string;
}

interface ProductRecord {
  id: string;
  slug: string;
  variants?: ProductVariantRecord[];
}

interface PromotionRecord {
  id: string;
  name: string;
  status: "draft" | "scheduled" | "active" | "inactive";
  ownerType: "platform" | "seller";
  sellerId: string | null;
  fundingType: "platform" | "seller";
  coupon: { code: string } | null;
}

/** Creates a collision-resistant suffix for browser-owned Module 9 fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Authorization header used by approved API fixture setup and verification. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Converts one Date into the local minute-precision value required by datetime-local inputs. */
function localDateTimeValue(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Logs in through the real Module 2 HTTP API and returns the server-issued access token. */
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

/** Registers one customer through the approved public registration command. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 9 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Creates and approves one seller owner using only released Module 2/4 HTTP commands. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<SellerFixture> {
  const password = "Module9Seller!123";
  const customer = await registerCustomer(context, `${label}-seller`, password);
  const customerSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(customerSession.accessToken),
    data: {
      legalName: `${label} Legal Ltd`,
      displayName: `${label} Seller`,
      taxId: null,
    },
  });
  expect(applicationResponse.status()).toBe(201);
  const application = ((await applicationResponse.json()) as ApiEnvelope<SellerApplication>).data;

  const approvalResponse = await context.post(
    `${apiBase}/admin/seller-applications/${application.id}/approve`,
    { headers: bearer(adminToken), data: {} },
  );
  expect(approvalResponse.status()).toBe(200);
  const approved = (await approvalResponse.json()) as ApiEnvelope<{
    seller: SellerRecord;
  }>;

  const sellerSession = await apiLogin(context, customer.email, password);
  const slug = unique(`${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `${label} Promotion Store`,
      description: "Store used by the Module 9 Promotions E2E workflow.",
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: `${slug}@example.test`,
    },
  });
  expect(storeResponse.status()).toBe(201);

  return {
    email: customer.email,
    password,
    accessToken: sellerSession.accessToken,
    sellerId: approved.data.seller.id,
    store: ((await storeResponse.json()) as ApiEnvelope<SellerStore>).data,
  };
}

/** Creates one active category required by the public Product used for coupon eligibility. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<CategoryRecord> {
  const slug = unique(`${label}-category`).toLowerCase();
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

/** Creates one seller-owned Product draft through the real Module 6 API. */
async function createProduct(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
  label: string,
): Promise<ProductRecord> {
  const slug = unique(`${label}-product`).toLowerCase();
  const response = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug,
      name: `${label} Promotion Product`,
      description: "Published Product used by the Module 9 coupon eligibility workflow.",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active USD variant to the Product fixture. */
async function createVariant(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  label: string,
  price: string,
): Promise<ProductVariantRecord> {
  const sku = `M9-${unique(label)}`.toUpperCase();
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
  const product = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = product.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 9 E2E Product response did not contain the new variant.");
  return variant;
}

/** Adds sellable stock to the Product variant through the Module 7 seller command. */
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

/** Publishes the Product through the explicit Module 6 lifecycle command. */
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

/** Adds the eligible Product variant to the customer's persistent Cart through Module 8. */
async function addCartItem(
  context: APIRequestContext,
  customerToken: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  const response = await context.post(`${apiBase}/cart/items`, {
    headers: bearer(customerToken),
    data: { variantId, quantity },
  });
  expect(response.status()).toBe(200);
}

/** Lists platform promotions through the exact administrator endpoint. */
async function listAdminPromotions(
  context: APIRequestContext,
  adminToken: string,
): Promise<PromotionRecord[]> {
  const response = await context.get(`${apiBase}/admin/promotions`, {
    headers: bearer(adminToken),
    params: { page: 1, pageSize: 100 },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<PromotionRecord[]>).data;
}

/** Signs in through the real React login form so requests use normal browser authentication state. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Fills the shared Promotion form with one percentage rule and one eligibility scope. */
async function fillPromotionForm(
  page: Page,
  {
    name,
    value,
    scopeType,
    scopeId,
  }: {
    name: string;
    value: string;
    scopeType: "seller" | "store" | "category" | "product";
    scopeId: string;
  },
): Promise<void> {
  const now = Date.now();
  await page.getByLabel("Promotion name").fill(name);
  await page.getByLabel("Promotion value").fill(value);
  await page.getByLabel("Promotion start time").fill(
    localDateTimeValue(new Date(now - 5 * 60_000)),
  );
  await page.getByLabel("Promotion end time").fill(
    localDateTimeValue(new Date(now + 60 * 60_000)),
  );
  await page.getByLabel("Promotion scope type").selectOption(scopeType);
  await page.getByLabel("Promotion scope UUID").fill(scopeId);
  await page.getByRole("button", { name: "Add scope", exact: true }).click();
}

test.describe("Module 9 Promotions & Coupons E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;
  let product: ProductRecord;
  let variant: ProductVariantRecord;
  let customerEmail = "";
  let customerPassword = "";
  let customerToken = "";
  let platformPromotionId = "";

  const label = unique("Module9");
  const promotionName = `${label} Platform Promotion`;
  const couponCode = `SAVE-${unique("M9")}`.toUpperCase();

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;

    const category = await createCategory(apiContext, adminToken, label);
    sellerA = await createSellerFixture(apiContext, adminToken, `${label}-A`);
    sellerB = await createSellerFixture(apiContext, adminToken, `${label}-B`);
    product = await createProduct(apiContext, sellerA, category.id, label);
    variant = await createVariant(apiContext, sellerA.accessToken, product.id, label, "100.00");
    await adjustInventory(apiContext, sellerA.accessToken, variant.id, 10);
    await publishProduct(apiContext, sellerA.accessToken, product.id);

    customerPassword = "Module9Customer!123";
    const customer = await registerCustomer(apiContext, `${label}-customer`, customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await addCartItem(apiContext, customerToken, variant.id, 2);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("creates and activates a platform promotion with a coupon through the real UI", async ({ page }) => {
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/admin/promotions");
    await expect(page.getByRole("heading", { name: "Promotions & Coupons" })).toBeVisible();

    await fillPromotionForm(page, {
      name: promotionName,
      value: "10",
      scopeType: "product",
      scopeId: product.id,
    });
    await page.getByRole("button", { name: "Attach coupon", exact: true }).click();
    await page.getByLabel("Coupon code").fill(couponCode.toLowerCase());
    await page.getByLabel("Coupon maximum uses").fill("5");
    await page.getByLabel("Coupon maximum uses per customer").fill("1");

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/promotions") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Create promotion", exact: true }).click();
    await createResponse;
    await expect(page.getByText(`${promotionName} was created as a draft.`)).toBeVisible();

    const created = (await listAdminPromotions(apiContext, adminToken)).find(
      (promotion) => promotion.name === promotionName,
    );
    if (!created) throw new Error("Module 9 E2E platform promotion was not found after browser creation.");
    platformPromotionId = created.id;
    expect(created).toMatchObject({
      ownerType: "platform",
      sellerId: null,
      fundingType: "platform",
      coupon: { code: couponCode },
    });

    const row = page.getByRole("row").filter({ hasText: promotionName });
    await expect(row).toBeVisible();
    const activateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/promotions/${platformPromotionId}/activate`) &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await row.getByRole("button", { name: "Activate", exact: true }).click();
    await activateResponse;
    await expect(page.getByText(`${promotionName} was activated or scheduled.`)).toBeVisible();
    await expect(row.getByText("active", { exact: true })).toBeVisible();
  });

  test("validates the active coupon against the real Cart and shows deterministic discount breakdown", async ({ page }) => {
    await browserLogin(page, customerEmail, customerPassword);
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your Cart" })).toBeVisible();
    await expect(page.getByText("$200.00", { exact: true })).toBeVisible();

    const validateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/promotions/validate") &&
        response.request().method() === "GET" &&
        response.ok(),
    );
    await page.getByLabel("Checkout coupon code").fill(couponCode.toLowerCase());
    await page.getByRole("button", { name: "Apply coupon", exact: true }).click();
    await validateResponse;

    await expect(page.getByText(`Coupon ${couponCode} is eligible`)).toBeVisible();
    const breakdown = page.getByRole("region", { name: "Discount breakdown" });
    await expect(breakdown).toContainText("-$20.00");
    await expect(breakdown).toContainText("Funding: platform");
    await expect(breakdown).toContainText("Checkout must revalidate promotion, Product, Inventory");
  });

  test("blocks Seller A from targeting Seller B and then accepts Seller A's own scope", async ({ page }) => {
    await browserLogin(page, sellerA.email, sellerA.password);
    await page.goto("/seller/promotions");
    await expect(page.getByRole("heading", { name: "Seller Promotions" })).toBeVisible();

    const sellerPromotionName = `${label} Seller Promotion`;
    await fillPromotionForm(page, {
      name: sellerPromotionName,
      value: "15",
      scopeType: "store",
      scopeId: sellerB.store.id,
    });
    await page.getByRole("button", { name: "Create promotion", exact: true }).click();
    const forbiddenAlert = await page.getByRole("alert").filter({ hasText: "Promotion scope is not allowed." });
    await expect(forbiddenAlert).toBeVisible();
    await expect(forbiddenAlert).toContainText("Request ID:");

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByLabel("Promotion scope UUID").fill(sellerA.store.id);
    await page.getByRole("button", { name: "Add scope", exact: true }).click();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/seller/promotions") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Create promotion", exact: true }).click();
    await createResponse;
    await expect(page.getByText(new RegExp(`${sellerPromotionName} was created with 1 eligibility scope`))).toBeVisible();
  });

  test("deactivates the promotion without deleting it and rejects later coupon validation", async ({ page }) => {
    expect(platformPromotionId).toMatch(/^[0-9a-f-]{36}$/);
    await browserLogin(page, adminEmail, adminPassword);
    await page.goto("/admin/promotions");

    const row = page.getByRole("row").filter({ hasText: promotionName });
    await expect(row.getByText("active", { exact: true })).toBeVisible();
    const deactivateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/promotions/${platformPromotionId}/deactivate`) &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await row.getByRole("button", { name: "Deactivate", exact: true }).click();
    await deactivateResponse;
    await expect(page.getByText(`${promotionName} was deactivated.`)).toBeVisible();
    await expect(row.getByText("inactive", { exact: true })).toBeVisible();

    const validation = await apiContext.get(`${apiBase}/promotions/validate`, {
      headers: bearer(customerToken),
      params: { code: couponCode },
    });
    expect(validation.status()).toBe(409);
    const body = (await validation.json()) as ApiEnvelope<never>;
    expect(body.error?.code).toBe("COUPON_INVALID");

    const persisted = (await listAdminPromotions(apiContext, adminToken)).find(
      (promotion) => promotion.id === platformPromotionId,
    );
    expect(persisted?.status).toBe("inactive");
  });
});
