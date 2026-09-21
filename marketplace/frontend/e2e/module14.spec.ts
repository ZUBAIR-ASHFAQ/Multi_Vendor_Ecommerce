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
const internalApiKey =
  process.env.E2E_INTERNAL_API_KEY ?? "e2e-ci-internal-api-key-that-is-at-least-32-characters";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
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
  scopes: { sellerIds: string[]; storeIds: string[] };
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
  metadata: { paymentId: string; orderId: string };
}

interface OrderItem {
  id: string;
  name: string;
  sku: string;
  variantTitle: string | null;
  quantity: number;
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

interface SellerShipment {
  id: string;
  sellerOrderId: string;
  shipmentNo: string;
  status: "created" | "shipped" | "delivered";
  items: Array<{ orderItemId: string; quantity: number }>;
}

interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  itemCondition: string | null;
  resolution: "refund_restock" | "refund_no_restock" | null;
  refundAmount: string;
  restockQty: number;
}

interface ReturnRequest {
  id: string;
  returnNo: string;
  orderId: string;
  sellerOrderId: string;
  customerUserId: string;
  status: "requested" | "approved" | "rejected" | "received" | "closed";
  reasonCode: string;
  requestedAt: string;
  approvedAt: string | null;
  items: ReturnItem[];
}

interface ReturnRefundResult {
  refundId: string;
  returnRequestId: string;
  orderId: string;
  paymentId: string;
  amount: string;
  currency: string;
  providerRef: string | null;
}

interface StockMovement {
  id: string;
  movementType: "adjustment" | "reserve" | "release" | "ship" | "restock";
  sourceType: string;
  sourceId: string | null;
  quantityDelta: number;
}

/** Creates a short collision-resistant suffix for Module 14 live-server fixtures. */
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
      displayName: `Module 14 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Keeps commerce and the Return window deterministic for Module 14 fixtures. */
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
        { key: "returns.window_days", value: 30 },
      ],
    },
  });
  expect(response.status()).toBe(200);
}

/** Ensures one effective default Commission rule exists for Return refund adjustment proof. */
async function ensureCommissionRule(
  context: APIRequestContext,
  adminToken: string,
): Promise<void> {
  const effectiveAt = new Date().toISOString();
  const listResponse = await context.get(`${apiBase}/admin/commissions/rules`, {
    headers: bearer(adminToken),
    params: { page: 1, pageSize: 100, status: "active", effectiveAt },
  });
  expect(listResponse.status()).toBe(200);
  const existing = ((await listResponse.json()) as PaginatedEnvelope<{
    priority: number;
    scopeType: string;
    scopeId: string | null;
  }>).data;
  if (existing.some((rule) => rule.priority === 140000 && rule.scopeType === "default" && rule.scopeId === null)) {
    return;
  }

  const createResponse = await context.post(`${apiBase}/admin/commissions/rules`, {
    headers: bearer(adminToken),
    data: {
      priority: 140000,
      scopeType: "default",
      scopeId: null,
      ratePercent: "10.000000",
      fixedFee: "1.0000",
      startAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      endAt: null,
      status: "active",
    },
  });
  expect(createResponse.status()).toBe(201);
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
      recipientName: "Module 14 Customer",
      phone: "+1 555 0140",
      line1: "14 Returns Avenue",
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
  const password = `Module14-${label}-Seller!123`;
  const customer = await registerCustomer(context, `module14-${label}-seller`, password);
  const initialSession = await apiLogin(context, customer.email, password);
  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: `Module 14 ${label} Seller Legal Ltd`,
      displayName: `Module 14 ${label} Seller`,
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
  if (!sellerId) throw new Error("Approved Module 14 seller did not receive a seller scope.");

  const slug = unique(`module14-${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `Module 14 ${label} Store`,
      description: `Store used by the Module 14 Returns E2E workflow.`,
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

/** Creates the active Catalog category used by the Module 14 Product fixture. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module14-category").toLowerCase(),
      name: "Module 14 Returns Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates, publishes, and stocks one seller-owned Product variant for Return workflows. */
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
      slug: unique("module14-product").toLowerCase(),
      name: "Module 14 Returns Product",
      description: "Published Product used by the Module 14 Returns E2E workflow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M14-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 14 Variant",
      price: "140.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 14 Product response did not contain the new variant.");

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
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 14 Order.");
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

/** Runs the trusted Commission settlement once the provider-authoritative capture exists. */
async function settleCommission(
  context: APIRequestContext,
  orderId: string,
  sourceKey: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/internal/commissions/order-settle`, {
    headers: { "x-internal-api-key": internalApiKey },
    data: { sourceKey, orderId },
  });
  expect(response.status()).toBe(200);
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

/** Creates one Shipment directly against the live server for Return delivery setup. */
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

/** Sets the tracking fields required before one Shipment can be marked shipped. */
async function updateTracking(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
  trackingNo: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/seller/shipments/${shipmentId}/tracking`, {
    headers: bearer(sellerToken),
    data: { carrier: "Module 14 Carrier", trackingNo, serviceLevel: "Returns E2E" },
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment shipped so Inventory issue is established before delivery. */
async function markShipped(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-shipped`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": idempotencyKey },
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment delivered so its allocation becomes Return-eligible. */
async function markDelivered(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-delivered`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": idempotencyKey },
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

/** Creates a provider-captured, Commission-settled, accepted, shipped, and delivered Order. */
async function createDeliveredOrder(
  browser: Browser,
  context: APIRequestContext,
  seller: SellerFixture,
  variantId: string,
  quantity: number,
  label: string,
): Promise<{
  customerEmail: string;
  customerPassword: string;
  customerToken: string;
  order: OrderDetail;
  sellerOrder: SellerOrder;
  orderItem: OrderItem;
}> {
  const customerPassword = `Module14-${label}-Customer!123`;
  const customer = await registerCustomer(context, `module14-${label}-customer`, customerPassword);
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
      `evt_module14_${randomUUID().replaceAll("-", "")}`,
    );
    await sendStripeWebhook(context, rawWebhook, stripeSignature(rawWebhook));
    await settleCommission(context, orderId, `module14-e2e-settle-${randomUUID()}`);

    const order = await readOrder(context, customerToken, orderId);
    expect(order.paymentStatus).toBe("captured");
    const sellerOrder = order.sellerOrders.find((entry) => entry.sellerId === seller.sellerId);
    if (!sellerOrder) throw new Error("Module 14 Order did not contain the expected Seller Order.");
    const orderItem = sellerOrder.items[0];
    if (!orderItem) throw new Error("Module 14 Seller Order did not contain its Order Item.");

    await acceptSellerOrder(context, seller.accessToken, sellerOrder.id);
    const shipment = await createShipment(
      context,
      seller.accessToken,
      sellerOrder.id,
      orderItem.id,
      quantity,
      `module14-e2e-create-shipment-${randomUUID()}`,
    );
    await updateTracking(
      context,
      seller.accessToken,
      shipment.id,
      `M14-E2E-${unique("TRACK").toUpperCase()}`,
    );
    await markShipped(
      context,
      seller.accessToken,
      shipment.id,
      `module14-e2e-ship-${randomUUID()}`,
    );
    await markDelivered(
      context,
      seller.accessToken,
      shipment.id,
      `module14-e2e-deliver-${randomUUID()}`,
    );

    return {
      customerEmail: customer.email,
      customerPassword,
      customerToken,
      order,
      sellerOrder,
      orderItem,
    };
  } finally {
    await customerBrowser.close();
  }
}

/** Creates one Return Request through the documented customer API for focused non-restock proof. */
async function createReturnRequest(
  context: APIRequestContext,
  customerToken: string,
  orderId: string,
  sellerOrderId: string,
  orderItemId: string,
): Promise<ReturnRequest> {
  const response = await context.post(`${apiBase}/orders/${orderId}/returns`, {
    headers: bearer(customerToken),
    data: {
      sellerOrderId,
      reasonCode: "changed_mind",
      items: [{ orderItemId, quantity: 1 }],
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<ReturnRequest>).data;
}

/** Approves one Return through the documented seller command. */
async function approveReturn(
  context: APIRequestContext,
  sellerToken: string,
  returnId: string,
): Promise<ReturnRequest> {
  const response = await context.post(`${apiBase}/seller/returns/${returnId}/approve`, {
    headers: bearer(sellerToken),
    data: { note: "Approved by Module 14 E2E" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<ReturnRequest>).data;
}

/** Executes one admin refund command with an explicit Foundation idempotency key. */
async function issueRefund(
  context: APIRequestContext,
  adminToken: string,
  returnId: string,
  idempotencyKey: string,
): Promise<ReturnRefundResult> {
  const response = await context.post(`${apiBase}/returns/${returnId}/refund`, {
    headers: { ...bearer(adminToken), "Idempotency-Key": idempotencyKey },
    data: { note: "Module 14 E2E refund" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<ReturnRefundResult>).data;
}

/** Reads customer-owned Returns for one Order after lifecycle/refund commands complete. */
async function listCustomerReturns(
  context: APIRequestContext,
  customerToken: string,
  orderId: string,
): Promise<ReturnRequest[]> {
  const response = await context.get(`${apiBase}/returns`, {
    headers: bearer(customerToken),
    params: { orderId, page: 1, pageSize: 100, sort: "requestedAt", order: "asc" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as PaginatedEnvelope<ReturnRequest>).data;
}

test.describe("Module 14 Returns, Refunds & Disputes E2E", () => {
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
    await ensureCommissionRule(apiContext, adminToken);
    sellerA = await createSellerFixture(apiContext, adminToken, "a");
    sellerB = await createSellerFixture(apiContext, adminToken, "b");
    const category = await createCategory(apiContext, adminToken);
    variant = await createProductFixture(apiContext, sellerA, category.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("requests, seller-inspects, refunds, replays, restocks once, and preserves seller isolation", async ({ browser }) => {
    const delivered = await createDeliveredOrder(browser, apiContext, sellerA, variant.id, 2, "restock");
    const customerBrowser = await authenticatedPage(
      browser,
      delivered.customerEmail,
      delivered.customerPassword,
    );
    const sellerBrowser = await authenticatedPage(browser, sellerA.email, sellerA.password);
    const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);

    try {
      await customerBrowser.page.goto(
        `/orders/${delivered.order.id}/returns/${delivered.sellerOrder.id}/new`,
      );
      await expect(customerBrowser.page.getByRole("heading", { name: "Request a Return" })).toBeVisible();
      await customerBrowser.page.getByLabel("Return reason").selectOption("defective");
      await customerBrowser.page.getByLabel(/Return quantity for/).first().fill("1");

      const createResponsePromise = customerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/orders/${delivered.order.id}/returns`) &&
          response.request().method() === "POST",
      );
      await customerBrowser.page.getByRole("button", { name: "Submit Return Request" }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = ((await createResponse.json()) as ApiEnvelope<ReturnRequest>).data;
      expect(created.items[0]?.quantity).toBe(1);
      await expect(customerBrowser.page.getByText(created.returnNo, { exact: true })).toBeVisible();

      const crossSellerResponse = await apiContext.post(
        `${apiBase}/seller/returns/${created.id}/approve`,
        { headers: bearer(sellerB.accessToken), data: { note: "Must not cross seller scope" } },
      );
      expect(crossSellerResponse.status()).toBe(403);
      expect(((await crossSellerResponse.json()) as ApiEnvelope<never>).error?.code).toBe(
        "RETURN_SCOPE_FORBIDDEN",
      );

      await sellerBrowser.page.goto("/seller/returns");
      await expect(sellerBrowser.page.getByRole("heading", { name: "Seller Return queue" })).toBeVisible();
      const sellerCard = sellerBrowser.page.locator("article").filter({ hasText: created.returnNo });
      await expect(sellerCard).toBeVisible();
      await sellerCard.getByLabel("Return approval note").fill("Approved for physical inspection");
      const approveResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/returns/${created.id}/approve`) &&
          response.request().method() === "POST",
      );
      await sellerCard.getByRole("button", { name: "Approve Return" }).click();
      expect((await approveResponsePromise).status()).toBe(200);
      await expect(sellerCard.getByText("Approved", { exact: true }).first()).toBeVisible();

      const returnItemId = created.items[0]!.id;
      await sellerCard.getByLabel(`Condition for Return Item ${returnItemId}`).selectOption("unopened");
      await sellerCard.getByLabel(`Resolution for Return Item ${returnItemId}`).selectOption("refund_restock");
      await sellerCard.getByLabel("Return inspection note").fill("Unopened item accepted for restock");
      const receiveResponsePromise = sellerBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/seller/returns/${created.id}/receive`) &&
          response.request().method() === "POST",
      );
      await sellerCard.getByRole("button", { name: "Receive Return" }).click();
      const receiveResponse = await receiveResponsePromise;
      expect(receiveResponse.status()).toBe(200);
      const received = ((await receiveResponse.json()) as ApiEnvelope<ReturnRequest>).data;
      expect(received).toMatchObject({ status: "received" });
      expect(received.items[0]).toMatchObject({ resolution: "refund_restock", restockQty: 1 });

      await adminBrowser.page.goto("/admin/returns");
      await expect(adminBrowser.page.getByRole("heading", { name: "Returns & dispute queue" })).toBeVisible();
      const adminRow = adminBrowser.page.getByRole("row").filter({ hasText: created.returnNo });
      await expect(adminRow).toBeVisible();
      await adminRow.getByRole("button", { name: "Review" }).click();
      await adminBrowser.page.getByLabel("Return refund note").fill("Refund after accepted inspection");
      const refundResponsePromise = adminBrowser.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/returns/${created.id}/refund`) &&
          response.request().method() === "POST",
      );
      await adminBrowser.page.getByRole("button", { name: "Issue Refund" }).click();
      await adminBrowser.page.getByRole("button", { name: "Confirm refund" }).click();
      const refundResponse = await refundResponsePromise;
      expect(refundResponse.status()).toBe(200);
      const refund = ((await refundResponse.json()) as ApiEnvelope<ReturnRefundResult>).data;
      const refundKey = refundResponse.request().headers()["idempotency-key"];
      const refundBody = refundResponse.request().postDataJSON();
      if (!refundKey) throw new Error("Module 14 refund UI did not send Idempotency-Key.");
      expect(refund.returnRequestId).toBe(created.id);
      expect(refund.providerRef).toBeTruthy();

      const replayResponse = await apiContext.post(`${apiBase}/returns/${created.id}/refund`, {
        headers: { ...bearer(adminToken), "Idempotency-Key": refundKey },
        data: refundBody,
      });
      expect(replayResponse.status()).toBe(200);
      const replay = ((await replayResponse.json()) as ApiEnvelope<ReturnRefundResult>).data;
      expect(replay).toEqual(refund);

      const movements = await listInventoryMovements(apiContext, sellerA.accessToken, variant.id);
      const restocks = movements.filter(
        (movement) =>
          movement.movementType === "restock" &&
          movement.sourceType === "return" &&
          movement.sourceId === returnItemId,
      );
      expect(restocks).toHaveLength(1);
      expect(restocks[0]?.quantityDelta).toBe(1);

      await customerBrowser.page.goto("/returns");
      const customerCard = customerBrowser.page.locator("article").filter({ hasText: created.returnNo });
      await expect(customerCard).toBeVisible();
      await expect(customerCard.getByText("Closed", { exact: true }).first()).toBeVisible();
      await expect(customerCard.getByText(Number(refund.amount).toFixed(2), { exact: true }).first()).toBeVisible();
    } finally {
      await Promise.all([customerBrowser.close(), sellerBrowser.close(), adminBrowser.close()]);
    }
  });

  test("refunds an approved Return without physical restock and replays the same money command", async ({ browser }) => {
    const delivered = await createDeliveredOrder(browser, apiContext, sellerA, variant.id, 1, "no-restock");
    const created = await createReturnRequest(
      apiContext,
      delivered.customerToken,
      delivered.order.id,
      delivered.sellerOrder.id,
      delivered.orderItem.id,
    );
    const approved = await approveReturn(apiContext, sellerA.accessToken, created.id);
    expect(approved.status).toBe("approved");

    const key = `module14-e2e-no-restock-${randomUUID()}`;
    const first = await issueRefund(apiContext, adminToken, created.id, key);
    const replay = await issueRefund(apiContext, adminToken, created.id, key);
    expect(replay).toEqual(first);

    const returns = await listCustomerReturns(apiContext, delivered.customerToken, delivered.order.id);
    const closed = returns.find((value) => value.id === created.id);
    if (!closed) throw new Error("Customer Return list did not contain the no-restock Return.");
    expect(closed.status).toBe("closed");
    expect(closed.items[0]).toMatchObject({ resolution: "refund_no_restock", restockQty: 0 });

    const movements = await listInventoryMovements(apiContext, sellerA.accessToken, variant.id);
    expect(
      movements.filter(
        (movement) =>
          movement.movementType === "restock" &&
          movement.sourceType === "return" &&
          movement.sourceId === created.items[0]!.id,
      ),
    ).toHaveLength(0);
  });
});
