import { randomUUID } from "node:crypto";
import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";
const apiBase = `${apiOrigin}/api/v1`;
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";
const internalApiKey =
  process.env.E2E_INTERNAL_API_KEY ?? "e2e-ci-internal-api-key-that-is-at-least-32-characters";

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
  email: string;
  password: string;
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
  name: string;
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
}

interface CheckoutAttempt {
  id: string;
  quoteId: string;
  status: string;
  orderId: string | null;
}

interface OrderItem {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  cancelledQuantity: number;
  remainingQuantity: number;
  unitPrice: string;
  lineTotal: string;
  status: string;
}

interface CustomerSellerOrder {
  id: string;
  sellerOrderNo: string;
  sellerId: string;
  storeId: string;
  status: string;
  items: OrderItem[];
}

interface CustomerOrderDetail {
  id: string;
  orderNo: string;
  grandTotal: string;
  currency: string;
  paymentStatus: string;
  orderStatus: string;
  sellerOrders: CustomerSellerOrder[];
}

interface SellerOrderDetail {
  id: string;
  sellerOrderNo: string;
  orderId: string;
  status: string;
  paymentStatus: string;
}

interface InventoryItem {
  variantId: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

/** Creates a collision-resistant suffix for Module 11 browser fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Authorization header used by approved HTTP fixture setup and verification. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Logs in through the real Module 2 API and returns the server-issued access token. */
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

/** Registers one real customer account used by the Orders E2E flow. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 11 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Freezes deterministic USD/tax settings through the published Administration API. */
async function configureCommerce(
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
  label: string,
): Promise<CustomerAddress> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label,
      recipientName: "Module 11 Customer",
      phone: "+1 555 0111",
      line1: "11 Orders Avenue",
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

/** Creates and approves one seller owner with one active store through published APIs. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<SellerFixture> {
  const password = `Module11-${label}-Seller!123`;
  const customer = await registerCustomer(context, `module11-${label}-seller`, password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: `Module 11 ${label} Seller Legal Ltd`,
      displayName: `Module 11 ${label} Seller`,
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
  const slug = unique(`module11-${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `Module 11 ${label} Store`,
      description: `Store used by the Module 11 ${label} Orders E2E workflow.`,
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
    store: ((await storeResponse.json()) as ApiEnvelope<SellerStore>).data,
  };
}

/** Creates one active category used by both Seller Product fixtures. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const slug = unique("module11-category").toLowerCase();
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug,
      name: "Module 11 Orders Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates one seller-owned Product draft through the real Product API. */
async function createProduct(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
  label: string,
): Promise<ProductRecord> {
  const slug = unique(`module11-${label}-product`).toLowerCase();
  const response = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug,
      name: `Module 11 ${label} Product`,
      description: `Published Product used by the Module 11 ${label} Orders E2E workflow.`,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ProductRecord>).data;
}

/** Adds one active USD Product variant with a deterministic starting price. */
async function createVariant(
  context: APIRequestContext,
  seller: SellerFixture,
  productId: string,
  label: string,
  price: string,
): Promise<ProductVariantRecord> {
  const sku = `M11-${label}-${unique("sku")}`.toUpperCase();
  const response = await context.post(`${apiBase}/seller/products/${productId}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: `Module 11 ${label} Variant`,
      price,
      currency: "USD",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  const product = ((await response.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = product.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error(`Module 11 ${label} Product response did not contain the new variant.`);
  return variant;
}

/** Publishes one Product through the explicit Module 6 lifecycle command. */
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

/** Adds seller-authorized on-hand quantity through the real Inventory adjustment command. */
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

/** Adds one variant and quantity to a customer's persistent Cart. */
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

/** Reads one seller-visible Inventory row for release/availability reconciliation assertions. */
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
  if (!item) throw new Error(`Module 11 Inventory row was not found for ${variantId}.`);
  return item;
}

/** Updates mutable Product fields after ordering to prove immutable Order snapshots never change. */
async function mutateProductAfterOrder(
  context: APIRequestContext,
  seller: SellerFixture,
  productId: string,
  variantId: string,
): Promise<void> {
  const productResponse = await context.patch(`${apiBase}/seller/products/${productId}`, {
    headers: bearer(seller.accessToken),
    data: { name: "Module 11 Mutated Product Name" },
  });
  expect(productResponse.status()).toBe(200);

  const variantResponse = await context.patch(
    `${apiBase}/seller/products/${productId}/variants/${variantId}`,
    { headers: bearer(seller.accessToken), data: { price: "999.0000" } },
  );
  expect(variantResponse.status()).toBe(200);
}

/** Signs in through the real React login form so Orders pages use normal browser authentication state. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Selects the deterministic platform Shipping Core option for every Checkout seller/store group. */
async function chooseShippingMethods(page: Page): Promise<void> {
  const selects = page.getByLabel(/Shipping method for store/);
  await expect(selects.first()).toBeVisible();
  const count = await selects.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
    const value = await option.getAttribute("value");
    if (!value) throw new Error("The seeded Shipping Core option was not available.");
    await select.selectOption(value);
  }
}

/** Completes the real Checkout UI and returns the server-created Order link from the confirmed attempt. */
async function checkoutThroughBrowser(page: Page): Promise<{
  quote: CheckoutQuote;
  attempt: CheckoutAttempt;
  idempotencyKey: string;
}> {
  await page.goto("/checkout");
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
  const quote = ((await quoteResponse.json()) as ApiEnvelope<CheckoutQuote>).data;

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
  const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
  if (!attempt.orderId) throw new Error("Module 11 Checkout confirmation did not create an Order.");

  return { quote, attempt, idempotencyKey };
}

/** Applies the trusted future-Payment boundary without pretending the browser itself captured money. */
async function confirmPayment(
  context: APIRequestContext,
  order: CustomerOrderDetail,
): Promise<CustomerOrderDetail> {
  const response = await context.post(`${apiBase}/internal/orders/${order.id}/payment-confirmed`, {
    headers: { "x-internal-api-key": internalApiKey },
    data: {
      paymentId: randomUUID(),
      paymentTransactionId: randomUUID(),
      sourceKey: unique("module11-payment-confirmed"),
      currency: order.currency,
      capturedAmount: order.grandTotal,
      capturedAt: new Date().toISOString(),
    },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CustomerOrderDetail>).data;
}

/** Creates an isolated browser context, logs in, and returns the authenticated page. */
async function authenticatedPage(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await browserLogin(page, email, password);
  return { page, close: () => context.close() };
}

test.describe("Module 11 Orders E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let customerEmail = "";
  const customerPassword = "Module11Customer!123";
  let customerToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;
  let productA: ProductRecord;
  let productB: ProductRecord;
  let variantA: ProductVariantRecord;
  let variantB: ProductVariantRecord;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();

    const admin = await apiLogin(apiContext, adminEmail, adminPassword);
    adminToken = admin.accessToken;
    await configureCommerce(apiContext, adminToken);

    const customer = await registerCustomer(apiContext, "module11-customer", customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await createAddress(apiContext, customerToken, "Orders Home");

    sellerA = await createSellerFixture(apiContext, adminToken, "A");
    sellerB = await createSellerFixture(apiContext, adminToken, "B");
    const category = await createCategory(apiContext, adminToken);

    productA = await createProduct(apiContext, sellerA, category.id, "Seller A");
    variantA = await createVariant(apiContext, sellerA, productA.id, "A", "100.0000");
    await publishProduct(apiContext, sellerA.accessToken, productA.id);
    await adjustInventory(apiContext, sellerA.accessToken, variantA.id, 30);

    productB = await createProduct(apiContext, sellerB, category.id, "Seller B");
    variantB = await createVariant(apiContext, sellerB, productB.id, "B", "50.0000");
    await publishProduct(apiContext, sellerB.accessToken, productB.id);
    await adjustInventory(apiContext, sellerB.accessToken, variantB.id, 30);

    await addCartItem(apiContext, customerToken, variantA.id, 2);
    await addCartItem(apiContext, customerToken, variantB.id, 1);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test(
    "creates one multi-seller parent Order, preserves immutable snapshots, and accepts only seller-scoped units",
    async ({ browser }) => {
    const customerBrowser = await authenticatedPage(browser, customerEmail, customerPassword);
    try {
      const { quote, attempt, idempotencyKey } = await checkoutThroughBrowser(customerBrowser.page);
      expect(quote).toMatchObject({
        subtotal: "250.0000",
        taxTotal: "12.5000",
        shippingTotal: "25.0000",
        grandTotal: "287.5000",
      });

      const orderId = attempt.orderId!;
      const replayResponse = await apiContext.post(
        `${apiBase}/checkout/quote/${quote.id}/confirm`,
        {
          headers: { ...bearer(customerToken), "Idempotency-Key": idempotencyKey },
          data: { stateHash: quote.stateHash },
        },
      );
      expect(replayResponse.status()).toBe(200);
      const replay = ((await replayResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
      expect(replay).toMatchObject({ id: attempt.id, orderId });

      const orderResponse = await apiContext.get(`${apiBase}/orders/${orderId}`, {
        headers: bearer(customerToken),
      });
      expect(orderResponse.status()).toBe(200);
      const order = ((await orderResponse.json()) as ApiEnvelope<CustomerOrderDetail>).data;
      expect(order.sellerOrders).toHaveLength(2);
      expect(order.paymentStatus).toBe("pending");
      expect(order.orderStatus).toBe("pending_payment");

      const sellerAOrder = order.sellerOrders.find((entry) => entry.storeId === sellerA.store.id);
      const sellerBOrder = order.sellerOrders.find((entry) => entry.storeId === sellerB.store.id);
      if (!sellerAOrder || !sellerBOrder) throw new Error("Module 11 deterministic Seller Order split is incomplete.");
      expect(sellerAOrder.items[0]).toMatchObject({
        sku: variantA.sku,
        name: "Module 11 Seller A Product",
        quantity: 2,
        unitPrice: "100.0000",
      });
      expect(sellerBOrder.items[0]).toMatchObject({
        sku: variantB.sku,
        name: "Module 11 Seller B Product",
        quantity: 1,
        unitPrice: "50.0000",
      });

      await customerBrowser.page.goto("/orders");
      await expect(customerBrowser.page.getByRole("heading", { name: "Your Orders" })).toBeVisible();
      await expect(customerBrowser.page.getByText(order.orderNo, { exact: true })).toBeVisible();

      await mutateProductAfterOrder(apiContext, sellerA, productA.id, variantA.id);
      await customerBrowser.page.goto(`/orders/${order.id}`);
      await expect(customerBrowser.page.getByRole("heading", { name: order.orderNo })).toBeVisible();
      await expect(customerBrowser.page.getByText("Module 11 Seller A Product", { exact: true })).toBeVisible();
      await expect(customerBrowser.page.getByText(variantA.sku, { exact: true })).toBeVisible();
      await expect(customerBrowser.page.getByRole("list", { name: "Order status timeline" })).toBeVisible();

      const snapshotResponse = await apiContext.get(`${apiBase}/orders/${order.id}`, {
        headers: bearer(customerToken),
      });
      const snapshot = ((await snapshotResponse.json()) as ApiEnvelope<CustomerOrderDetail>).data;
      const snapshotA = snapshot.sellerOrders.find((entry) => entry.id === sellerAOrder.id)?.items[0];
      expect(snapshotA).toMatchObject({
        name: "Module 11 Seller A Product",
        sku: variantA.sku,
        unitPrice: "100.0000",
      });

      const paidOrder = await confirmPayment(apiContext, order);
      expect(paidOrder).toMatchObject({ paymentStatus: "captured", orderStatus: "confirmed" });

      const sellerAForbidden = await apiContext.get(`${apiBase}/seller/orders/${sellerBOrder.id}`, {
        headers: bearer(sellerA.accessToken),
      });
      expect(sellerAForbidden.status()).toBe(403);
      const forbiddenBody = (await sellerAForbidden.json()) as ApiEnvelope<never>;
      expect(forbiddenBody.error?.code).toBe("SELLER_ORDER_SCOPE_FORBIDDEN");

      const sellerABrowser = await authenticatedPage(browser, sellerA.email, sellerA.password);
      try {
        await sellerABrowser.page.goto("/seller/orders");
        await expect(sellerABrowser.page.getByRole("heading", { name: "Seller Order queue" })).toBeVisible();
        await expect(sellerABrowser.page.getByText(sellerAOrder.sellerOrderNo, { exact: true })).toBeVisible();
        await expect(sellerABrowser.page.getByText(sellerBOrder.sellerOrderNo, { exact: true })).toHaveCount(0);
        await sellerABrowser.page.goto(`/seller/orders/${sellerAOrder.id}`);
        await sellerABrowser.page.getByRole("button", { name: "Accept Seller Order" }).click();
        await expect(sellerABrowser.page.getByText("Processing", { exact: true }).first()).toBeVisible();
      } finally {
        await sellerABrowser.close();
      }

      const sellerBBrowser = await authenticatedPage(browser, sellerB.email, sellerB.password);
      try {
        await sellerBBrowser.page.goto("/seller/orders");
        await expect(sellerBBrowser.page.getByText(sellerBOrder.sellerOrderNo, { exact: true })).toBeVisible();
        await expect(sellerBBrowser.page.getByText(sellerAOrder.sellerOrderNo, { exact: true })).toHaveCount(0);
        await sellerBBrowser.page.goto(`/seller/orders/${sellerBOrder.id}`);
        await sellerBBrowser.page.getByRole("button", { name: "Accept Seller Order" }).click();
        await expect(sellerBBrowser.page.getByText("Processing", { exact: true }).first()).toBeVisible();
      } finally {
        await sellerBBrowser.close();
      }

      await customerBrowser.page.goto(`/orders/${order.id}`);
      await expect(customerBrowser.page.getByText("Processing", { exact: true }).first()).toBeVisible();
      await expect(customerBrowser.page.getByText("Captured", { exact: true })).toBeVisible();

      const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);
      try {
        await adminBrowser.page.goto("/admin/orders");
        await adminBrowser.page.getByLabel("Order number").fill(order.orderNo);
        await adminBrowser.page.getByRole("button", { name: "Apply filters" }).click();
        await expect(adminBrowser.page.getByText(order.orderNo, { exact: true })).toBeVisible();
      } finally {
        await adminBrowser.close();
      }

      const customerListResponse = await apiContext.get(`${apiBase}/orders`, {
        headers: bearer(customerToken),
        params: { page: 1, pageSize: 100 },
      });
      const customerOrders = ((await customerListResponse.json()) as ApiEnvelope<Array<{ id: string }>>).data;
      expect(customerOrders.filter((entry) => entry.id === order.id)).toHaveLength(1);
    } finally {
      await customerBrowser.close();
    }
    },
  );

  test("cancels one pre-capture item quantity in the UI, safely replays it, and releases exact reserved stock", async ({ browser }) => {
    const cancellationPassword = "Module11Cancellation!123";
    const customer = await registerCustomer(apiContext, "module11-cancel-customer", cancellationPassword);
    const token = (await apiLogin(apiContext, customer.email, cancellationPassword)).accessToken;
    await createAddress(apiContext, token, "Cancellation Home");
    await addCartItem(apiContext, token, variantA.id, 2);

    const cancellationBrowser = await authenticatedPage(browser, customer.email, cancellationPassword);
    try {
      const { attempt } = await checkoutThroughBrowser(cancellationBrowser.page);
      const orderId = attempt.orderId!;
      const orderResponse = await apiContext.get(`${apiBase}/orders/${orderId}`, {
        headers: bearer(token),
      });
      const order = ((await orderResponse.json()) as ApiEnvelope<CustomerOrderDetail>).data;
      const item = order.sellerOrders[0]?.items[0];
      if (!item) throw new Error("Cancellation Order did not contain its expected Order Item.");

      const beforeInventory = await readInventory(apiContext, sellerA.accessToken, variantA.id);
      await cancellationBrowser.page.goto(`/orders/${order.id}`);

      const itemSelect = cancellationBrowser.page.getByLabel("Order Item");
      const option = itemSelect.locator("option").filter({ hasText: item.name }).first();
      const optionValue = await option.getAttribute("value");
      if (!optionValue) throw new Error("Cancellation Order Item option was not available.");
      await itemSelect.selectOption(optionValue);
      await cancellationBrowser.page.getByLabel("Cancellation quantity").fill("1");
      await cancellationBrowser.page.getByLabel("Cancellation reason").fill("Customer changed quantity");

      const cancelResponsePromise = cancellationBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/orders/${order.id}/cancel`) &&
          response.request().method() === "POST",
      );
      await cancellationBrowser.page.getByRole("button", { name: "Cancel eligible quantity" }).click();
      const cancelResponse = await cancelResponsePromise;
      expect(cancelResponse.status()).toBe(200);
      const idempotencyKey = cancelResponse.request().headers()["idempotency-key"];
      if (!idempotencyKey) throw new Error("Order cancellation did not send Idempotency-Key.");
      const cancellationBody = cancelResponse.request().postDataJSON() as {
        items: Array<{ orderItemId: string; quantity: number }>;
        reason?: string;
      };
      expect(cancellationBody).toEqual({
        items: [{ orderItemId: item.id, quantity: 1 }],
        reason: "Customer changed quantity",
      });

      await expect(cancellationBrowser.page.getByText("2 ordered · 1 remaining", { exact: true })).toBeVisible();
      await expect(cancellationBrowser.page.getByText("Partially cancelled", { exact: true })).toBeVisible();

      const replayResponse = await apiContext.post(`${apiBase}/orders/${order.id}/cancel`, {
        headers: { ...bearer(token), "Idempotency-Key": idempotencyKey },
        data: cancellationBody,
      });
      expect(replayResponse.status()).toBe(200);
      const replay = ((await replayResponse.json()) as ApiEnvelope<CustomerOrderDetail>).data;
      const replayItem = replay.sellerOrders[0]?.items.find((entry) => entry.id === item.id);
      expect(replayItem).toMatchObject({ cancelledQuantity: 1, remainingQuantity: 1 });

      const afterInventory = await readInventory(apiContext, sellerA.accessToken, variantA.id);
      expect(afterInventory.reservedQty).toBe(beforeInventory.reservedQty - 1);
      expect(afterInventory.availableQty).toBe(beforeInventory.availableQty + 1);
    } finally {
      await cancellationBrowser.close();
    }
  });
});
