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
  requestId?: string;
  error?: { code: string; message: string };
}

interface SessionData {
  accessToken: string;
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

interface CustomerAddress {
  id: string;
}

interface SellerApplication {
  id: string;
}

interface SellerStore {
  id: string;
}

interface SellerFixture {
  accessToken: string;
  store: SellerStore;
}

interface CategoryRecord {
  id: string;
}

interface ProductVariantRecord {
  id: string;
  sku: string;
  price: string;
}

interface ProductRecord {
  id: string;
  variants?: ProductVariantRecord[];
}

interface CheckoutQuote {
  id: string;
  stateHash: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  shippingSelections: Array<{
    storeId: string;
    shippingMethodName: string;
    amount: string;
  }>;
}

interface CheckoutAttempt {
  id: string;
  quoteId: string;
  status: string;
  orderId: string | null;
}

interface InventoryItem {
  variantId: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

/** Creates a collision-resistant suffix for browser-owned Module 10 fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Authorization header used by approved HTTP fixture setup and verification. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
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

/** Registers one real customer account for the Checkout browser workflow. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 10 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Freezes deterministic USD/tax settings through the published Administration API. */
async function configureCheckoutSettings(
  context: APIRequestContext,
  adminToken: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/admin/settings`, {
    headers: bearer(adminToken),
    data: {
      settings: [
        { key: "commerce.supported_currencies", value: ["USD"] },
        { key: "commerce.default_currency", value: "USD" },
        { key: "commerce.default_tax_rate_percent", value: 5 },
      ],
    },
  });
  expect(response.status()).toBe(200);
}

/** Creates one active customer-owned address through the real Customer API. */
async function createAddress(
  context: APIRequestContext,
  customerToken: string,
): Promise<CustomerAddress> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label: "Checkout Home",
      recipientName: "Module 10 Customer",
      phone: "+1 555 0110",
      line1: "10 Checkout Avenue",
      line2: null,
      city: "Austin",
      region: "Texas",
      postalCode: "78701",
      countryCode: "US",
      isDefaultShipping: true,
      isDefaultBilling: true,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CustomerAddress>).data;
}

/** Creates and approves one seller owner so Product/Inventory setup stays on published APIs. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
): Promise<SellerFixture> {
  const password = "Module10Seller!123";
  const customer = await registerCustomer(context, "module10-seller", password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: "Module 10 Seller Legal Ltd",
      displayName: "Module 10 Seller",
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

  const sellerSession = await apiLogin(context, customer.email, password);
  const slug = unique("module10-store").toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: "Module 10 Checkout Store",
      description: "Store used by the Module 10 Checkout Playwright workflow.",
      logoFileId: null,
      defaultCurrency: "USD",
      supportEmail: `${slug}@example.test`,
    },
  });
  expect(storeResponse.status()).toBe(201);

  return {
    accessToken: sellerSession.accessToken,
    store: ((await storeResponse.json()) as ApiEnvelope<SellerStore>).data,
  };
}

/** Creates one active category required by the published Product fixture. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const slug = unique("module10-category").toLowerCase();
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug,
      name: "Module 10 Checkout Category",
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
): Promise<ProductRecord> {
  const slug = unique("module10-product").toLowerCase();
  const response = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug,
      name: "Module 10 Checkout Product",
      description: "Published Product used by the Module 10 Checkout E2E workflow.",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active USD variant to the Checkout Product fixture. */
async function createVariant(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
): Promise<ProductVariantRecord> {
  const sku = `M10-${unique("checkout")}`.toUpperCase();
  const response = await context.post(`${apiBase}/seller/products/${productId}/variants`, {
    headers: bearer(sellerToken),
    data: {
      sku,
      title: "Module 10 Checkout Variant",
      price: "100.00",
      currency: "USD",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const product = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = product.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 10 E2E Product response did not contain the new variant.");
  return variant;
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

/** Applies seller-authorized stock through Module 7. */
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

/** Adds the Product variant to the customer's persistent Cart through Module 8. */
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

/** Updates the live Product price to prove confirmation revalidates authoritative state. */
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

/** Reads seller-visible stock so the browser flow can prove exactly one reservation was created. */
async function readInventory(
  context: APIRequestContext,
  sellerToken: string,
  variantId: string,
): Promise<InventoryItem> {
  const response = await context.get(`${apiBase}/seller/inventory`, {
    headers: bearer(sellerToken),
    params: { page: 1, pageSize: 100 },
  });
  expect(response.status()).toBe(200);
  const rows = ((await response.json()) as ApiEnvelope<InventoryItem[]>).data;
  const item = rows.find((row) => row.variantId === variantId);
  if (!item) throw new Error(`Module 10 E2E Inventory row was not found for ${variantId}.`);
  return item;
}

/** Signs in through the real React login form so Checkout uses normal browser authentication state. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Selects the seeded platform Shipping Core option for every server-derived store group. */
async function chooseShippingMethods(page: Page): Promise<void> {
  const selects = page.getByLabel(/Shipping method for store/);
  await expect(selects.first()).toBeVisible();
  const count = await selects.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
    const value = await option.getAttribute("value");
    if (!value) throw new Error("The seeded Module 10 Shipping Core option was not available.");
    await select.selectOption(value);
  }
}

test.describe("Module 10 Checkout E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let customerEmail = "";
  const customerPassword = "Module10Customer!123";
  let customerToken = "";
  let seller: SellerFixture;
  let product: ProductRecord;
  let variant: ProductVariantRecord;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();

    const admin = await apiLogin(apiContext, adminEmail, adminPassword);
    await configureCheckoutSettings(apiContext, admin.accessToken);

    const customer = await registerCustomer(apiContext, "module10-customer", customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await createAddress(apiContext, customerToken);

    seller = await createSellerFixture(apiContext, admin.accessToken);
    const category = await createCategory(apiContext, admin.accessToken);
    product = await createProduct(apiContext, seller, category.id);
    variant = await createVariant(apiContext, seller.accessToken, product.id);
    await publishProduct(apiContext, seller.accessToken, product.id);
    await adjustInventory(apiContext, seller.accessToken, variant.id, 10);
    await addCartItem(apiContext, customerToken, variant.id, 2);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("creates an authoritative quote in the UI, confirms it idempotently, and reserves exact stock", async ({ page }) => {
    await browserLogin(page, customerEmail, customerPassword);
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your Cart" })).toBeVisible();
    await page.getByRole("link", { name: "Proceed to Checkout" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();

    await chooseShippingMethods(page);

    const quoteResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/checkout/quote") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Calculate authoritative quote" }).click();
    const quoteResponse = await quoteResponsePromise;
    const quoteRequestBody = quoteResponse.request().postDataJSON() as Record<string, unknown>;
    const quote = ((await quoteResponse.json()) as ApiEnvelope<CheckoutQuote>).data;

    expect(quoteRequestBody).not.toHaveProperty("subtotal");
    expect(quoteRequestBody).not.toHaveProperty("taxTotal");
    expect(quoteRequestBody).not.toHaveProperty("grandTotal");
    expect(quoteRequestBody).not.toHaveProperty("customerUserId");
    expect(quote.subtotal).toBe("200.0000");
    expect(quote.discountTotal).toBe("0.0000");
    expect(quote.taxTotal).toBe("10.0000");
    expect(quote.shippingTotal).toBe("12.5000");
    expect(quote.grandTotal).toBe("222.5000");
    expect(quote.shippingSelections).toHaveLength(1);
    expect(quote.shippingSelections[0]?.shippingMethodName).toBe("E2E Checkout Standard");
    await expect(page.getByText("Review totals")).toBeVisible();

    const readQuoteResponse = await apiContext.get(`${apiBase}/checkout/quote/${quote.id}`, {
      headers: bearer(customerToken),
    });
    expect(readQuoteResponse.status()).toBe(200);

    const confirmResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/checkout/quote/${quote.id}/confirm`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirm & pay" }).click();
    const confirmResponse = await confirmResponsePromise;
    expect(confirmResponse.status()).toBe(200);

    const idempotencyKey = confirmResponse.request().headers()["idempotency-key"];
    if (!idempotencyKey) throw new Error("Checkout confirmation did not send Idempotency-Key.");
    const confirmBody = confirmResponse.request().postDataJSON() as { stateHash: string };
    expect(confirmBody).toEqual({ stateHash: quote.stateHash });

    const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
    expect(attempt).toMatchObject({
      quoteId: quote.id,
      status: "confirmed",
    });
    expect(attempt.orderId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.getByLabel("Checkout attempt status")).toContainText("Status: confirmed");
    await expect(page.getByText(/this page does not mark an order paid/i)).toBeVisible();

    const replayResponse = await apiContext.post(
      `${apiBase}/checkout/quote/${quote.id}/confirm`,
      {
        headers: { ...bearer(customerToken), "Idempotency-Key": idempotencyKey },
        data: { stateHash: quote.stateHash },
      },
    );
    expect(replayResponse.status()).toBe(200);
    const replay = ((await replayResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
    expect(replay.id).toBe(attempt.id);
    expect(replay.orderId).toBe(attempt.orderId);

    const statusResponse = await apiContext.get(`${apiBase}/checkout/${attempt.id}/status`, {
      headers: bearer(customerToken),
    });
    expect(statusResponse.status()).toBe(200);
    const status = ((await statusResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
    expect(status).toMatchObject({ id: attempt.id, status: "confirmed" });

    const inventory = await readInventory(apiContext, seller.accessToken, variant.id);
    expect(inventory).toMatchObject({ onHandQty: 10, reservedQty: 2, availableQty: 8 });
  });

  test("shows the real Checkout change warning when Product price changes after quoting", async ({ page }) => {
    await browserLogin(page, customerEmail, customerPassword);
    await page.goto("/checkout");
    await chooseShippingMethods(page);

    const quoteResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/checkout/quote") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Calculate authoritative quote" }).click();
    const quoteResponse = await quoteResponsePromise;
    const quote = ((await quoteResponse.json()) as ApiEnvelope<CheckoutQuote>).data;
    expect(quote.subtotal).toBe("200.0000");

    await updateVariantPrice(apiContext, seller.accessToken, product.id, variant.id, "110.00");

    const staleResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/checkout/quote/${quote.id}/confirm`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirm & pay" }).click();
    const staleResponse = await staleResponsePromise;
    expect(staleResponse.status()).toBe(409);
    const body = (await staleResponse.json()) as ApiEnvelope<never>;
    expect(body.error?.code).toBe("CHECKOUT_PRICE_CHANGED");

    const warning = page.getByRole("alert").filter({ hasText: "Checkout details changed" });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Recalculate the quote and review the new totals");
    await expect(warning).toContainText("Request ID:");
  });
});
