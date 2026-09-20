import { createHmac, randomUUID } from "node:crypto";
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
const stripeOrigin = process.env.E2E_STRIPE_API_ORIGIN ?? "http://127.0.0.1:4123";
const stripeWebhookSecret =
  process.env.E2E_STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_module12_provider_test_secret";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
  requestId?: string;
}

interface PaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

interface SessionData {
  accessToken: string;
}

interface RegisteredCustomer {
  id: string;
  email: string;
}

interface CurrentActor {
  scopes: {
    sellerIds: string[];
    storeIds: string[];
  };
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
  variants?: ProductVariantRecord[];
}

interface CheckoutQuote {
  id: string;
  stateHash: string;
  grandTotal: string;
}

interface CheckoutAttempt {
  id: string;
  orderId: string | null;
}

interface PaymentIntentResponse {
  paymentId: string;
  orderId: string;
  providerPaymentId: string;
  status: string;
  currency: string;
  amount: string;
}

interface FakeStripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  amount_received: number;
  currency: string;
  capture_method: "automatic";
  status: string;
  client_secret: string | null;
  created: number;
  latest_charge: string | null;
  metadata: {
    paymentId: string;
    orderId: string;
  };
}

interface OrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  remainingQuantity: number;
}

interface SellerOrder {
  id: string;
  sellerId: string;
  sellerOrderNo: string;
  status: string;
  items: OrderItem[];
}

interface OrderDetail {
  id: string;
  orderNo: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  orderStatus: string;
  sellerOrders: SellerOrder[];
}

interface ShipmentTimelineEntry {
  status: "created" | "shipped" | "delivered";
}

interface SellerShipment {
  id: string;
  sellerOrderId: string;
  shipmentNo: string;
  carrier: string | null;
  serviceLevel: string | null;
  trackingNo: string | null;
  status: "created" | "shipped" | "delivered";
  items: Array<{ orderItemId: string; quantity: number }>;
  timeline: ShipmentTimelineEntry[];
}

interface StockMovement {
  id: string;
  movementType: "adjustment" | "reserve" | "release" | "ship" | "restock";
  sourceType: string;
  sourceId: string | null;
  quantityDelta: number;
}

/** Creates a short collision-resistant suffix for Module 13 live-server fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the normal Bearer authorization header used by authenticated setup requests. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Logs in through Module 2 and returns the server-issued access token. */
async function apiLogin(
  context: APIRequestContext,
  email: string,
  password: string,
): Promise<SessionData> {
  const response = await context.post(`${apiBase}/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<SessionData>).data;
}

/** Reads the server-derived seller scope after an application has been approved. */
async function readCurrentActor(
  context: APIRequestContext,
  accessToken: string,
): Promise<CurrentActor> {
  const response = await context.get(`${apiBase}/auth/me`, { headers: bearer(accessToken) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CurrentActor>).data;
}

/** Registers one customer identity through the real public registration endpoint. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 13 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Keeps USD and the tax rate deterministic for the Module 13 checkout fixtures. */
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

/** Creates the owned address required by Checkout for one customer fixture. */
async function createAddress(
  context: APIRequestContext,
  customerToken: string,
  label: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label,
      recipientName: "Module 13 Customer",
      phone: "+1 555 0130",
      line1: "13 Shipping Avenue",
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
}

/** Creates and approves one seller owner and returns its server-derived seller identity. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<SellerFixture> {
  const password = `Module13-${label}-Seller!123`;
  const customer = await registerCustomer(context, `module13-${label}-seller`, password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: `Module 13 ${label} Seller Legal Ltd`,
      displayName: `Module 13 ${label} Seller`,
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
  const actor = await readCurrentActor(context, sellerSession.accessToken);
  const sellerId = actor.scopes.sellerIds[0];
  if (!sellerId) throw new Error("Approved Module 13 seller did not receive a seller scope.");

  const slug = unique(`module13-${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `Module 13 ${label} Store`,
      description: `Store used by the Module 13 ${label} Shipping E2E workflow.`,
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
    sellerId,
    store: ((await storeResponse.json()) as ApiEnvelope<SellerStore>).data,
  };
}

/** Creates the active Catalog category used by the Module 13 Product fixture. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module13-category").toLowerCase(),
      name: "Module 13 Shipping Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates, publishes, and stocks one seller-owned Product variant for both Shipping tests. */
async function createProductFixture(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
): Promise<ProductVariantRecord> {
  const productResponse = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug: unique("module13-product").toLowerCase(),
      name: "Module 13 Shipping Product",
      description: "Published Product used by the Module 13 Shipping E2E workflow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M13-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 13 Variant",
      price: "130.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 13 Product response did not contain the new variant.");

  const publishResponse = await context.post(`${apiBase}/seller/products/${product.id}/publish`, {
    headers: bearer(seller.accessToken),
    data: {},
  });
  expect(publishResponse.status()).toBe(200);

  const stockResponse = await context.post(`${apiBase}/seller/inventory/${variant.id}/adjust`, {
    headers: bearer(seller.accessToken),
    data: { quantityDelta: 30 },
  });
  expect(stockResponse.status()).toBe(200);
  return variant;
}

/** Adds the shared sellable Product variant to one customer's persistent Cart. */
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

/** Signs in through the real React form so browser requests use normal auth handling. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Creates an isolated browser context and signs in through the normal React application. */
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

/** Selects the deterministic Shipping Core method seeded by the cross-repository E2E runner. */
async function chooseShippingMethod(page: Page): Promise<void> {
  const select = page.getByLabel(/Shipping method for/).first();
  await expect(select).toBeVisible();
  const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error("The seeded Shipping Core option was not available.");
  await select.selectOption(value);
}

/** Uses the real Checkout page to create the authoritative Order attempt and parent Order. */
async function checkoutThroughBrowser(
  page: Page,
): Promise<{ quote: CheckoutQuote; attempt: CheckoutAttempt }> {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await chooseShippingMethod(page);

  const quoteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/checkout/quote") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Review order" }).click();
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
  const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 13 Order.");

  await expect(page.getByRole("heading", { name: "Secure payment" })).toBeVisible();
  return { quote, attempt };
}

/** Creates the PaymentIntent through the real React payment handoff. */
async function createPaymentIntentThroughBrowser(
  page: Page,
  orderId: string,
): Promise<PaymentIntentResponse> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/payments/order/${orderId}/intent`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue to secure payment" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<PaymentIntentResponse>).data;
}

/** Marks the local Stripe-compatible PaymentIntent captured before sending the signed webhook. */
async function captureAtProvider(
  context: APIRequestContext,
  providerPaymentId: string,
): Promise<FakeStripePaymentIntent> {
  const response = await context.post(
    `${stripeOrigin}/__e2e/payment_intents/${providerPaymentId}/succeed`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as FakeStripePaymentIntent;
}

/** Creates a Stripe-style HMAC signature for the exact raw webhook bytes. */
function stripeSignature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Builds the small provider event shape consumed by the production Stripe adapter. */
function succeededWebhookBody(intent: FakeStripePaymentIntent, eventId: string): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: intent },
  });
}

/** Sends one raw signed Payment webhook so captured state stays provider-authoritative. */
async function sendStripeWebhook(
  context: APIRequestContext,
  rawBody: string,
  signature: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/payments/webhooks/stripe`, {
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    data: rawBody,
  });
  expect(response.status()).toBe(200);
}

/** Reads the customer-owned Order after Payment/Shipping transitions. */
async function readOrder(
  context: APIRequestContext,
  customerToken: string,
  orderId: string,
): Promise<OrderDetail> {
  const response = await context.get(`${apiBase}/orders/${orderId}`, {
    headers: bearer(customerToken),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<OrderDetail>).data;
}

/** Accepts one captured Seller Order through its approved seller command. */
async function acceptSellerOrder(
  context: APIRequestContext,
  sellerToken: string,
  sellerOrderId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/orders/${sellerOrderId}/accept`, {
    headers: bearer(sellerToken),
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Reads one seller's immutable Inventory movement ledger for the shared Product variant. */
async function listInventoryMovements(
  context: APIRequestContext,
  sellerToken: string,
  variantId: string,
): Promise<StockMovement[]> {
  const response = await context.get(`${apiBase}/seller/inventory/${variantId}/movements`, {
    headers: bearer(sellerToken),
    params: { page: 1, pageSize: 100 },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as PaginatedEnvelope<StockMovement>).data;
}

/** Reads the seller Shipment queue for one exact Seller Order. */
async function listSellerShipments(
  context: APIRequestContext,
  sellerToken: string,
  sellerOrderId: string,
): Promise<SellerShipment[]> {
  const response = await context.get(`${apiBase}/seller/shipments`, {
    headers: bearer(sellerToken),
    params: { sellerOrderId, page: 1, pageSize: 100, sort: "createdAt", order: "asc" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as PaginatedEnvelope<SellerShipment>).data;
}

/** Creates one Shipment directly against the live server for the focused concurrency case. */
async function createShipment(
  context: APIRequestContext,
  sellerToken: string,
  sellerOrderId: string,
  orderItemId: string,
  quantity: number,
  idempotencyKey: string,
): Promise<SellerShipment> {
  const response = await context.post(`${apiBase}/seller/orders/${sellerOrderId}/shipments`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": idempotencyKey },
    data: { items: [{ orderItemId, quantity }] },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerShipment>).data;
}

/** Sets the tracking fields needed before one live Shipment can be marked shipped. */
async function updateTracking(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
  trackingNo: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/seller/shipments/${shipmentId}/tracking`, {
    headers: bearer(sellerToken),
    data: {
      carrier: "Module 13 Carrier",
      trackingNo,
      serviceLevel: "Express",
    },
  });
  expect(response.status()).toBe(200);
}

/** Marks one live Shipment shipped with an explicit idempotency key. */
async function markShipped(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
  idempotencyKey: string,
): Promise<SellerShipment> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-shipped`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": idempotencyKey },
    data: {},
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<SellerShipment>).data;
}

/** Creates one provider-captured Order with the requested Product quantity for a Shipping test. */
async function createCapturedOrder(
  browser: Browser,
  context: APIRequestContext,
  variantId: string,
  quantity: number,
  label: string,
): Promise<{
  customerEmail: string;
  customerPassword: string;
  customerToken: string;
  order: OrderDetail;
}> {
  const customerPassword = `Module13-${label}-Customer!123`;
  const customer = await registerCustomer(context, `module13-${label}-customer`, customerPassword);
  const customerToken = (await apiLogin(context, customer.email, customerPassword)).accessToken;
  await createAddress(context, customerToken, `${label} Home`);
  await addCartItem(context, customerToken, variantId, quantity);

  const customerBrowser = await authenticatedPage(browser, customer.email, customerPassword);
  try {
    const { quote, attempt } = await checkoutThroughBrowser(customerBrowser.page);
    const orderId = attempt.orderId!;
    const intent = await createPaymentIntentThroughBrowser(customerBrowser.page, orderId);
    expect(intent).toMatchObject({ orderId, amount: quote.grandTotal, status: "pending" });

    const capturedIntent = await captureAtProvider(context, intent.providerPaymentId);
    const rawWebhook = succeededWebhookBody(
      capturedIntent,
      `evt_module13_${randomUUID().replaceAll("-", "")}`,
    );
    await sendStripeWebhook(context, rawWebhook, stripeSignature(rawWebhook));

    const order = await readOrder(context, customerToken, orderId);
    expect(order.paymentStatus).toBe("captured");
    return {
      customerEmail: customer.email,
      customerPassword,
      customerToken,
      order,
    };
  } finally {
    await customerBrowser.close();
  }
}

test.describe("Module 13 Shipping & Fulfillment E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;
  let variant: ProductVariantRecord;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    await configureCommerce(apiContext, adminToken);
    sellerA = await createSellerFixture(apiContext, adminToken, "a");
    sellerB = await createSellerFixture(apiContext, adminToken, "b");
    const category = await createCategory(apiContext, adminToken);
    variant = await createProductFixture(apiContext, sellerA, category.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("creates, tracks, ships, replays, delivers, isolates, and exposes one customer-safe Shipment", async ({ browser }) => {
    const captured = await createCapturedOrder(browser, apiContext, variant.id, 1, "main");
    const sellerOrder = captured.order.sellerOrders.find((entry) => entry.sellerId === sellerA.sellerId);
    if (!sellerOrder) throw new Error("Captured Module 13 Order did not contain Seller A's Seller Order.");
    const orderItem = sellerOrder.items[0];
    if (!orderItem) throw new Error("Captured Module 13 Seller Order did not contain its Order Item.");

    const sellerBrowser = await authenticatedPage(browser, sellerA.email, sellerA.password);
    const customerBrowser = await authenticatedPage(
      browser,
      captured.customerEmail,
      captured.customerPassword,
    );

    try {
      await sellerBrowser.page.goto(`/seller/orders/${sellerOrder.id}`);
      await sellerBrowser.page.getByRole("button", { name: "Accept Seller Order" }).click();
      await expect(sellerBrowser.page.getByText("Processing", { exact: true }).first()).toBeVisible();

      await sellerBrowser.page.goto(`/seller/orders/${sellerOrder.id}/shipping`);
      await expect(
        sellerBrowser.page.getByRole("heading", { name: `Fulfillment for ${sellerOrder.sellerOrderNo}` }),
      ).toBeVisible();

      const createResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/orders/${sellerOrder.id}/shipments`) &&
          response.request().method() === "POST",
      );
      await sellerBrowser.page
        .getByLabel(`Shipment quantity for ${orderItem.name} (${orderItem.sku})`)
        .fill("1");
      await sellerBrowser.page.getByRole("button", { name: "Create Shipment" }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = ((await createResponse.json()) as ApiEnvelope<SellerShipment>).data;
      const createKey = createResponse.request().headers()["idempotency-key"];
      const createBody = createResponse.request().postDataJSON();
      if (!createKey) throw new Error("Create Shipment did not send Idempotency-Key.");
      await expect(sellerBrowser.page.getByText(created.shipmentNo, { exact: true })).toBeVisible();

      const createReplay = await apiContext.post(
        `${apiBase}/seller/orders/${sellerOrder.id}/shipments`,
        {
          headers: { ...bearer(sellerA.accessToken), "Idempotency-Key": createKey },
          data: createBody,
        },
      );
      expect(createReplay.status()).toBe(201);
      expect(((await createReplay.json()) as ApiEnvelope<SellerShipment>).data.id).toBe(created.id);

      const crossSeller = await apiContext.patch(
        `${apiBase}/seller/shipments/${created.id}/tracking`,
        {
          headers: bearer(sellerB.accessToken),
          data: { carrier: "Hidden Carrier", trackingNo: "M13-CROSS-SELLER" },
        },
      );
      expect(crossSeller.status()).toBe(404);
      expect(((await crossSeller.json()) as ApiEnvelope<never>).error?.code).toBe("SHIPMENT_NOT_FOUND");

      await customerBrowser.page.goto(`/orders/${captured.order.id}/shipping`);
      await expect(
        customerBrowser.page.getByText(
          "Tracking is not available yet. A Shipment appears here after the seller marks it shipped.",
        ),
      ).toBeVisible();

      const trackingNo = `M13-E2E-${unique("TRACK").toUpperCase()}`;
      const trackingResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/shipments/${created.id}/tracking`) &&
          response.request().method() === "PATCH",
      );
      await sellerBrowser.page.getByLabel("Shipment carrier").fill("Module 13 Carrier");
      await sellerBrowser.page.getByLabel("Shipment tracking number").fill(trackingNo);
      await sellerBrowser.page.getByLabel("Shipment service level").fill("Express");
      await sellerBrowser.page.getByRole("button", { name: "Save tracking" }).click();
      expect((await trackingResponsePromise).status()).toBe(200);

      const shipResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/shipments/${created.id}/mark-shipped`) &&
          response.request().method() === "POST",
      );
      await sellerBrowser.page.getByRole("button", { name: "Mark shipped" }).click();
      const shipResponse = await shipResponsePromise;
      expect(shipResponse.status()).toBe(200);
      const shipped = ((await shipResponse.json()) as ApiEnvelope<SellerShipment>).data;
      const shipKey = shipResponse.request().headers()["idempotency-key"];
      if (!shipKey) throw new Error("Mark shipped did not send Idempotency-Key.");
      expect(shipped.status).toBe("shipped");

      const shipReplay = await apiContext.post(
        `${apiBase}/seller/shipments/${created.id}/mark-shipped`,
        {
          headers: { ...bearer(sellerA.accessToken), "Idempotency-Key": shipKey },
          data: {},
        },
      );
      expect(shipReplay.status()).toBe(200);
      expect(((await shipReplay.json()) as ApiEnvelope<SellerShipment>).data.id).toBe(created.id);

      const movements = await listInventoryMovements(
        apiContext,
        sellerA.accessToken,
        variant.id,
      );
      expect(
        movements.filter(
          (movement) =>
            movement.movementType === "ship" &&
            movement.sourceType === "shipment" &&
            movement.sourceId === created.id,
        ),
      ).toHaveLength(1);

      const shippedOrder = await readOrder(apiContext, captured.customerToken, captured.order.id);
      expect(shippedOrder.fulfillmentStatus).toBe("fulfilled");

      await customerBrowser.page.reload();
      await expect(customerBrowser.page.getByText(trackingNo, { exact: true })).toBeVisible();
      await expect(customerBrowser.page.getByText("Shipped", { exact: true }).first()).toBeVisible();

      const deliverResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/shipments/${created.id}/mark-delivered`) &&
          response.request().method() === "POST",
      );
      await sellerBrowser.page.getByRole("button", { name: "Mark delivered" }).click();
      const deliverResponse = await deliverResponsePromise;
      expect(deliverResponse.status()).toBe(200);
      const deliverKey = deliverResponse.request().headers()["idempotency-key"];
      if (!deliverKey) throw new Error("Mark delivered did not send Idempotency-Key.");

      const deliverReplay = await apiContext.post(
        `${apiBase}/seller/shipments/${created.id}/mark-delivered`,
        {
          headers: { ...bearer(sellerA.accessToken), "Idempotency-Key": deliverKey },
          data: {},
        },
      );
      expect(deliverReplay.status()).toBe(200);
      expect(((await deliverReplay.json()) as ApiEnvelope<SellerShipment>).data.status).toBe("delivered");

      const sellerShipments = await listSellerShipments(
        apiContext,
        sellerA.accessToken,
        sellerOrder.id,
      );
      const finalShipment = sellerShipments.find((entry) => entry.id === created.id);
      if (!finalShipment) throw new Error("Seller Shipment list did not contain the delivered Shipment.");
      expect(finalShipment.timeline.filter((entry) => entry.status === "created")).toHaveLength(1);
      expect(finalShipment.timeline.filter((entry) => entry.status === "shipped")).toHaveLength(1);
      expect(finalShipment.timeline.filter((entry) => entry.status === "delivered")).toHaveLength(1);

      await customerBrowser.page.reload();
      await expect(customerBrowser.page.getByText("Delivered", { exact: true }).first()).toBeVisible();
      await expect(customerBrowser.page.getByText(trackingNo, { exact: true })).toBeVisible();
    } finally {
      await Promise.all([sellerBrowser.close(), customerBrowser.close()]);
    }
  });

  test("ships two concurrent partial Shipments and reconciles the parent Order to fulfilled", async ({ browser }) => {
    const captured = await createCapturedOrder(browser, apiContext, variant.id, 2, "concurrent");
    const sellerOrder = captured.order.sellerOrders.find((entry) => entry.sellerId === sellerA.sellerId);
    if (!sellerOrder) throw new Error("Concurrent Module 13 Order did not contain Seller A's Seller Order.");
    const orderItem = sellerOrder.items[0];
    if (!orderItem) throw new Error("Concurrent Module 13 Seller Order did not contain its Order Item.");

    await acceptSellerOrder(apiContext, sellerA.accessToken, sellerOrder.id);

    const first = await createShipment(
      apiContext,
      sellerA.accessToken,
      sellerOrder.id,
      orderItem.id,
      1,
      `module13-e2e-concurrent-create-a-${randomUUID()}`,
    );
    const second = await createShipment(
      apiContext,
      sellerA.accessToken,
      sellerOrder.id,
      orderItem.id,
      1,
      `module13-e2e-concurrent-create-b-${randomUUID()}`,
    );
    await updateTracking(
      apiContext,
      sellerA.accessToken,
      first.id,
      `M13-CONCURRENT-A-${unique("TRACK").toUpperCase()}`,
    );
    await updateTracking(
      apiContext,
      sellerA.accessToken,
      second.id,
      `M13-CONCURRENT-B-${unique("TRACK").toUpperCase()}`,
    );

    const [firstShipped, secondShipped] = await Promise.all([
      markShipped(
        apiContext,
        sellerA.accessToken,
        first.id,
        `module13-e2e-concurrent-ship-a-${randomUUID()}`,
      ),
      markShipped(
        apiContext,
        sellerA.accessToken,
        second.id,
        `module13-e2e-concurrent-ship-b-${randomUUID()}`,
      ),
    ]);
    expect(firstShipped.status).toBe("shipped");
    expect(secondShipped.status).toBe("shipped");

    const finalOrder = await readOrder(apiContext, captured.customerToken, captured.order.id);
    expect(finalOrder.fulfillmentStatus).toBe("fulfilled");

    const movements = await listInventoryMovements(apiContext, sellerA.accessToken, variant.id);
    expect(
      movements.filter(
        (movement) => movement.movementType === "ship" && movement.sourceId === first.id,
      ),
    ).toHaveLength(1);
    expect(
      movements.filter(
        (movement) => movement.movementType === "ship" && movement.sourceId === second.id,
      ),
    ).toHaveLength(1);
  });
});
