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
  title: string;
  price: string;
}

interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  variants?: ProductVariantRecord[];
}

interface InventoryItem {
  variantId: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

interface CartData {
  items: Array<{
    id: string;
    variantId: string;
    quantity: number;
    currentUnitPrice: string | null;
    inStock: boolean;
  }>;
}

interface WishlistData {
  items: Array<{ id: string; variantId: string | null }>;
}

/** Creates a collision-resistant suffix for browser-owned Module 8 fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Authorization header used by approved API fixture setup and verification. */
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

/** Registers one real customer account for the Module 8 browser workflow. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 8 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Creates and approves one seller owner so Product/Inventory fixtures use public APIs only. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<SellerFixture> {
  const password = "Module8Seller!123";
  const customer = await registerCustomer(context, `${label}-seller`, password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
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

  const sellerSession = await apiLogin(context, customer.email, password);
  const slug = unique(`${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `${label} Cart Store`,
      description: "Store used by the Module 8 Cart and Wishlist E2E workflow.",
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

/** Creates one active category required by the public Product fixture. */
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
      name: `${label} Cart Product`,
      description: "Published Product used by the Module 8 Cart and Wishlist E2E workflow.",
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active USD variant to the Module 8 Product fixture. */
async function createVariant(
  context: APIRequestContext,
  sellerToken: string,
  productId: string,
  label: string,
  price: string,
): Promise<ProductVariantRecord> {
  const sku = `M8-${unique(label)}`.toUpperCase();
  const title = `${label} Variant`;
  const response = await context.post(`${apiBase}/seller/products/${productId}/variants`, {
    headers: bearer(sellerToken),
    data: {
      sku,
      title,
      price,
      currency: "USD",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const product = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = product.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 8 E2E Product response did not contain the new variant.");
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

/** Applies a seller-authorized stock adjustment through Module 7 without touching Cart state. */
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

/** Reads the seller-visible Inventory row for the tested variant. */
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
  const items = ((await response.json()) as ApiEnvelope<InventoryItem[]>).data;
  const item = items.find((entry) => entry.variantId === variantId);
  if (!item) throw new Error(`Module 8 E2E Inventory row was not found for ${variantId}.`);
  return item;
}

/** Updates the live Product variant price so Cart can prove it reads current source data. */
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

/** Reads the customer's current Cart directly for post-browser state verification. */
async function readCart(
  context: APIRequestContext,
  customerToken: string,
): Promise<CartData> {
  const response = await context.get(`${apiBase}/cart`, {
    headers: bearer(customerToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CartData>).data;
}

/** Reads the customer's default Wishlist directly for safe move-to-Cart verification. */
async function readWishlist(
  context: APIRequestContext,
  customerToken: string,
): Promise<WishlistData> {
  const response = await context.get(`${apiBase}/wishlist`, {
    headers: bearer(customerToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<WishlistData>).data;
}

/** Signs in through the real React login form so browser Cart/Wishlist requests use normal auth state. */
async function loginInBrowser(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Returns the Product-variant card containing the Module 8 Cart/Wishlist controls. */
function variantCard(page: Page, variantTitle: string) {
  return page
    .getByRole("heading", { name: variantTitle, exact: true })
    .locator("xpath=ancestor::article[1]");
}

test.describe("Module 8 Cart & Wishlist E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let seller: SellerFixture;
  let product: ProductRecord;
  let variant: ProductVariantRecord;
  let customerEmail = "";
  let customerPassword = "";
  let customerToken = "";

  const label = unique("Module8");

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;

    const category = await createCategory(apiContext, adminToken, label);
    seller = await createSellerFixture(apiContext, adminToken, label);
    product = await createProduct(apiContext, seller, category.id, label);
    variant = await createVariant(apiContext, seller.accessToken, product.id, label, "25.00");
    await adjustInventory(apiContext, seller.accessToken, variant.id, 10);
    await publishProduct(apiContext, seller.accessToken, product.id);

    customerPassword = "Module8Customer!123";
    const customer = await registerCustomer(apiContext, `${label}-customer`, customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("adds, persists, updates, and displays a preview without reserving Inventory", async ({ page }) => {
    const inventoryBefore = await readInventory(apiContext, seller.accessToken, variant.id);

    await loginInBrowser(page, customerEmail, customerPassword);
    await page.goto(`/products/${product.slug}`);

    const card = variantCard(page, variant.title);
    await card.getByLabel("Quantity").fill("1");
    await card.getByRole("button", { name: "Add to Cart", exact: true }).click();

    await expect(page.getByLabel("Mini Cart with 1 item")).toBeVisible();
    await page.getByLabel("Mini Cart with 1 item").click();
    await expect(page.getByRole("heading", { name: "Your Cart" })).toBeVisible();
    await expect(page.getByText("Preview subtotal", { exact: true })).toBeVisible();
    await expect(page.getByText("Not a final checkout total", { exact: true })).toBeVisible();
    await expect(page.getByText("Inventory is not reserved until the later Checkout workflow.")).toBeVisible();

    const quantityInput = page.getByLabel("Quantity");
    await quantityInput.fill("2");
    await page.getByRole("button", { name: "Update quantity", exact: true }).click();
    await expect(page.getByLabel("Mini Cart with 2 items")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Quantity")).toHaveValue("2");
    await expect(page.getByText("USD 50.00", { exact: true })).toBeVisible();

    const inventoryAfter = await readInventory(apiContext, seller.accessToken, variant.id);
    expect(inventoryAfter.onHandQty).toBe(inventoryBefore.onHandQty);
    expect(inventoryAfter.reservedQty).toBe(inventoryBefore.reservedQty);
    expect(inventoryAfter.availableQty).toBe(inventoryBefore.availableQty);
  });

  test("moves a Wishlist variant to Cart only after Cart addition succeeds", async ({ page }) => {
    const inventoryBefore = await readInventory(apiContext, seller.accessToken, variant.id);

    await loginInBrowser(page, customerEmail, customerPassword);
    await page.goto(`/products/${product.slug}`);
    const card = variantCard(page, variant.title);
    const saveWishlistResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/wishlist/items") &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await card.getByRole("button", { name: "Save to Wishlist", exact: true }).click();
    await saveWishlistResponse;

    await page.goto("/wishlist");
    await expect(page.getByRole("heading", { name: "My Wishlist" })).toBeVisible();
    await expect(page.getByText(product.name, { exact: true })).toBeVisible();
    const removeWishlistResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/wishlist/items/") &&
        response.request().method() === "DELETE" &&
        response.ok(),
    );
    await page.getByRole("button", { name: "Move to Cart", exact: true }).click();
    await removeWishlistResponse;

    await expect(page.getByText(product.name, { exact: true })).not.toBeVisible();
    const wishlist = await readWishlist(apiContext, customerToken);
    expect(wishlist.items).toHaveLength(0);

    const cart = await readCart(apiContext, customerToken);
    const cartItem = cart.items.find((item) => item.variantId === variant.id);
    expect(cartItem?.quantity).toBe(3);

    const inventoryAfter = await readInventory(apiContext, seller.accessToken, variant.id);
    expect(inventoryAfter.onHandQty).toBe(inventoryBefore.onHandQty);
    expect(inventoryAfter.reservedQty).toBe(inventoryBefore.reservedQty);
    expect(inventoryAfter.availableQty).toBe(inventoryBefore.availableQty);
  });

  test("shows current Product price and stock changes while preserving Cart intent", async ({ page }) => {
    await updateVariantPrice(
      apiContext,
      seller.accessToken,
      product.id,
      variant.id,
      "31.00",
    );
    await adjustInventory(apiContext, seller.accessToken, variant.id, -10);

    await loginInBrowser(page, customerEmail, customerPassword);
    await page.goto("/cart");

    await expect(page.getByText("Current unit price: USD 31.00", { exact: true })).toBeVisible();
    await expect(page.getByText("Line preview: USD 93.00", { exact: true })).toBeVisible();
    await expect(page.getByText("This variant is currently out of stock.", { exact: true })).toBeVisible();
    await expect(page.getByText(/One or more Cart items changed or are unavailable/)).toBeVisible();
    await expect(page.getByLabel("Quantity")).toHaveValue("3");

    const cart = await readCart(apiContext, customerToken);
    const cartItem = cart.items.find((item) => item.variantId === variant.id);
    expect(cartItem?.currentUnitPrice).toBe("31.00");
    expect(cartItem?.inStock).toBe(false);
    expect(cartItem?.quantity).toBe(3);
  });

  test("removes a Cart line through the explicit remove command and can add it again later", async ({ page }) => {
    await loginInBrowser(page, customerEmail, customerPassword);
    await page.goto("/cart");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your Cart is empty" })).toBeVisible();

    await adjustInventory(apiContext, seller.accessToken, variant.id, 10);
    await page.goto(`/products/${product.slug}`);
    await variantCard(page, variant.title)
      .getByRole("button", { name: "Add to Cart", exact: true })
      .click();
    await expect(page.getByLabel("Mini Cart with 1 item")).toBeVisible();

    const cart = await readCart(apiContext, customerToken);
    expect(cart.items.find((item) => item.variantId === variant.id)?.quantity).toBe(1);
    const inventory = await readInventory(apiContext, seller.accessToken, variant.id);
    expect(inventory.reservedQty).toBe(0);
    expect(inventory.availableQty).toBe(inventory.onHandQty);
  });
});
