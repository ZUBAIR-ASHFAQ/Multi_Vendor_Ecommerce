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
  slug: string;
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
  name: string;
  variants?: ProductVariantRecord[];
}

interface ProductFixture {
  product: ProductRecord;
  variant: ProductVariantRecord;
}

interface CheckoutQuote {
  id: string;
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
  quantity: number;
}

interface SellerOrder {
  id: string;
  sellerId: string;
  items: OrderItem[];
}

interface OrderDetail {
  id: string;
  paymentStatus: string;
  sellerOrders: SellerOrder[];
}

interface SellerShipment {
  id: string;
}

interface ReviewRecord {
  id: string;
  orderItemId: string;
  productId: string;
  sellerId: string;
  storeId: string;
  rating: number;
  status: "pending" | "published" | "hidden";
  verifiedPurchase: true;
  helpfulCount: number;
}

interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  verifiedPurchase: true;
  helpfulCount: number;
}

interface PublicReviewsData {
  reviews: PublicReview[];
  rating: { ratingAvg: number; ratingCount: number };
}

interface SearchProductCard {
  productId: string;
  ratingAvg: number;
  ratingCount: number;
}

interface SearchProductsData {
  items: SearchProductCard[];
}

/** Creates a short collision-resistant suffix for Module 15 live-server fixtures. */
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
      displayName: `Module 15 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Configures deterministic USD commerce settings for the delivered-purchase fixture. */
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
): Promise<void> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label: "Review Home",
      recipientName: "Module 15 Customer",
      phone: "+1 555 0150",
      line1: "15 Review Avenue",
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
): Promise<SellerFixture> {
  const password = "Module15-Seller!123";
  const customer = await registerCustomer(context, "module15-seller", password);
  const initialSession = await apiLogin(context, customer.email, password);
  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: "Module 15 Seller Legal Ltd",
      displayName: "Module 15 Seller",
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
  if (!sellerId) throw new Error("Approved Module 15 seller did not receive a seller scope.");

  const slug = unique("module15-store").toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: "Module 15 Review Store",
      description: "Store used by the Module 15 Reviews E2E workflow.",
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

/** Creates the active Catalog category used by the Module 15 Product fixture. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module15-category").toLowerCase(),
      name: "Module 15 Reviews Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates, publishes, and stocks one seller-owned Product variant for Review workflows. */
async function createProductFixture(
  context: APIRequestContext,
  seller: SellerFixture,
  categoryId: string,
): Promise<ProductFixture> {
  const slug = unique("module15-review-product").toLowerCase();
  const productResponse = await context.post(`${apiBase}/seller/products`, {
    headers: bearer(seller.accessToken),
    data: {
      storeId: seller.store.id,
      categoryId,
      brandId: null,
      slug,
      name: "Module 15 Review Product",
      description: "Published Product used by the Module 15 Reviews E2E workflow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M15-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 15 Variant",
      price: "150.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 15 Product response did not contain the new variant.");

  const publishResponse = await context.post(`${apiBase}/seller/products/${product.id}/publish`, {
    headers: bearer(seller.accessToken),
    data: {},
  });
  expect(publishResponse.status()).toBe(200);

  const stockResponse = await context.post(`${apiBase}/seller/inventory/${variant.id}/adjust`, {
    headers: bearer(seller.accessToken),
    data: { quantityDelta: 20 },
  });
  expect(stockResponse.status()).toBe(200);
  return { product: { ...product, slug }, variant };
}

/** Adds the sellable Product variant to one customer's persistent Cart. */
async function addCartItem(
  context: APIRequestContext,
  customerToken: string,
  variantId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/cart/items`, {
    headers: bearer(customerToken),
    data: { variantId, quantity: 1 },
  });
  expect(response.status()).toBe(200);
}

/** Signs in through the real React form so browser requests use normal auth handling. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/u);
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
  const select = page.getByLabel(/Shipping method for/u).first();
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
  const quote = ((await (await quoteResponsePromise).json()) as ApiEnvelope<CheckoutQuote>).data;

  const confirmResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/checkout/quote/${quote.id}/confirm`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm & pay" }).click();
  const confirmResponse = await confirmResponsePromise;
  expect(confirmResponse.status()).toBe(200);
  const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 15 Order.");
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

/** Builds the provider event shape consumed by the production Stripe adapter. */
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
): Promise<void> {
  const response = await context.post(`${apiBase}/payments/webhooks/stripe`, {
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripeSignature(rawBody),
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

/** Creates one Shipment against the real seller fulfillment API. */
async function createShipment(
  context: APIRequestContext,
  sellerToken: string,
  sellerOrderId: string,
  orderItemId: string,
): Promise<SellerShipment> {
  const response = await context.post(`${apiBase}/seller/orders/${sellerOrderId}/shipments`, {
    headers: {
      ...bearer(sellerToken),
      "Idempotency-Key": `module15-create-shipment-${randomUUID()}`,
    },
    data: { items: [{ orderItemId, quantity: 1 }] },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerShipment>).data;
}

/** Sets tracking before the Shipment can move to shipped. */
async function updateTracking(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/seller/shipments/${shipmentId}/tracking`, {
    headers: bearer(sellerToken),
    data: {
      carrier: "Module 15 Carrier",
      trackingNo: `M15-${unique("TRACK").toUpperCase()}`,
      serviceLevel: "Reviews E2E",
    },
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment shipped through the explicit fulfillment command. */
async function markShipped(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-shipped`, {
    headers: {
      ...bearer(sellerToken),
      "Idempotency-Key": `module15-ship-${randomUUID()}`,
    },
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment delivered so the purchased Order Item becomes Review-eligible. */
async function markDelivered(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-delivered`, {
    headers: {
      ...bearer(sellerToken),
      "Idempotency-Key": `module15-deliver-${randomUUID()}`,
    },
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Creates one paid, accepted, shipped, and fully delivered Order Item for Review eligibility. */
async function createDeliveredOrder(
  browser: Browser,
  context: APIRequestContext,
  seller: SellerFixture,
  variantId: string,
): Promise<{
  customerEmail: string;
  customerPassword: string;
  customerToken: string;
  order: OrderDetail;
  sellerOrder: SellerOrder;
  orderItem: OrderItem;
}> {
  const customerPassword = "Module15-Customer!123";
  const customer = await registerCustomer(context, "module15-customer", customerPassword);
  const customerToken = (await apiLogin(context, customer.email, customerPassword)).accessToken;
  await createAddress(context, customerToken);
  await addCartItem(context, customerToken, variantId);

  const browserSession = await authenticatedPage(browser, customer.email, customerPassword);
  try {
    const { quote, attempt } = await checkoutThroughBrowser(browserSession.page);
    const orderId = attempt.orderId!;
    const intent = await createPaymentIntentThroughBrowser(browserSession.page, orderId);
    expect(intent).toMatchObject({ orderId, amount: quote.grandTotal, status: "pending" });

    const captured = await captureAtProvider(context, intent.providerPaymentId);
    const rawWebhook = succeededWebhookBody(
      captured,
      `evt_module15_${randomUUID().replaceAll("-", "")}`,
    );
    await sendStripeWebhook(context, rawWebhook);

    const order = await readOrder(context, customerToken, orderId);
    expect(order.paymentStatus).toBe("captured");
    const sellerOrder = order.sellerOrders.find((entry) => entry.sellerId === seller.sellerId);
    if (!sellerOrder) throw new Error("Module 15 Order did not contain the expected Seller Order.");
    const orderItem = sellerOrder.items[0];
    if (!orderItem) throw new Error("Module 15 Seller Order did not contain its Order Item.");

    await acceptSellerOrder(context, seller.accessToken, sellerOrder.id);
    const shipment = await createShipment(context, seller.accessToken, sellerOrder.id, orderItem.id);
    await updateTracking(context, seller.accessToken, shipment.id);
    await markShipped(context, seller.accessToken, shipment.id);
    await markDelivered(context, seller.accessToken, shipment.id);

    return {
      customerEmail: customer.email,
      customerPassword,
      customerToken,
      order,
      sellerOrder,
      orderItem,
    };
  } finally {
    await browserSession.close();
  }
}

/** Reads public Product Reviews without exposing customer or Order identity. */
async function readProductReviews(
  context: APIRequestContext,
  productId: string,
): Promise<PublicReviewsData> {
  const response = await context.get(`${apiBase}/products/${productId}/reviews`, {
    params: { page: 1, pageSize: 20 },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<PublicReviewsData>).data;
}

/** Reads public Store Reviews and its canonical Seller rating aggregate. */
async function readStoreReviews(
  context: APIRequestContext,
  storeId: string,
): Promise<PublicReviewsData> {
  const response = await context.get(`${apiBase}/stores/${storeId}/reviews`, {
    params: { page: 1, pageSize: 20 },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<PublicReviewsData>).data;
}

/** Polls the eventually-consistent Search read model until one Product reaches the expected rating. */
async function waitForSearchRating(
  context: APIRequestContext,
  productName: string,
  productId: string,
  expectedAverage: number,
  expectedCount: number,
): Promise<void> {
  await expect.poll(async () => {
    const response = await context.get(`${apiBase}/search/products`, {
      params: { q: productName, page: 1, pageSize: 20, sort: "relevance" },
    });
    if (response.status() !== 200) return "search-error";
    const data = ((await response.json()) as ApiEnvelope<SearchProductsData>).data;
    const product = data.items.find((item) => item.productId === productId);
    return product ? `${product.ratingAvg}:${product.ratingCount}` : "missing";
  }, { timeout: 15_000 }).toBe(`${expectedAverage}:${expectedCount}`);
}

/** Uses the real admin moderation page to read the approved queue and submit one explicit command. */
async function moderateReviewThroughAdminUi(
  page: Page,
  reviewId: string,
  currentStatus: "pending" | "published" | "hidden",
  command: "hide" | "publish",
  reason: string,
): Promise<ReviewRecord> {
  await page.goto("/admin/reviews");
  await expect(page.getByRole("heading", { name: "Review moderation" })).toBeVisible();

  const listResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/api/v1/admin/reviews") &&
      url.searchParams.get("status") === currentStatus &&
      response.request().method() === "GET"
    );
  });
  await page.getByLabel("Review status filter").selectOption(currentStatus);
  await page.getByRole("button", { name: "Apply filters" }).click();
  expect((await listResponsePromise).status()).toBe(200);
  await expect(page.getByText("Excellent verified purchase")).toBeVisible();

  const commandResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/admin/reviews/${reviewId}/${command}`) &&
      response.request().method() === "POST",
  );
  const actionLabel = command === "hide" ? "Hide Review" : "Publish Review";
  await page.getByLabel(`${actionLabel} reason`).fill(reason);
  await page.getByRole("button", { name: actionLabel }).click();

  const commandResponse = await commandResponsePromise;
  expect(commandResponse.status()).toBe(200);
  return ((await commandResponse.json()) as ApiEnvelope<ReviewRecord>).data;
}

test.describe("Module 15 Reviews & Ratings E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let seller: SellerFixture;
  let product: ProductFixture;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    await configureCommerce(apiContext, adminToken);
    seller = await createSellerFixture(apiContext, adminToken);
    const category = await createCategory(apiContext, adminToken);
    product = await createProductFixture(apiContext, seller, category.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("creates a verified Review, propagates ratings, handles Helpful, and preserves moderation truth", async ({ browser }) => {
    const delivered = await createDeliveredOrder(browser, apiContext, seller, product.variant.id);
    const customerBrowser = await authenticatedPage(
      browser,
      delivered.customerEmail,
      delivered.customerPassword,
    );

    let created: ReviewRecord;
    try {
      await customerBrowser.page.goto(`/orders/${delivered.order.id}`);
      const writeReview = customerBrowser.page.getByRole("link", { name: "Write Review" });
      await expect(writeReview).toBeVisible();
      await writeReview.click();
      await expect(customerBrowser.page.getByRole("heading", { name: "Review your purchase" })).toBeVisible();
      await customerBrowser.page.getByLabel("Review rating").selectOption("5");
      await customerBrowser.page.getByLabel("Review title").fill("Excellent verified purchase");
      await customerBrowser.page.getByLabel("Review body").fill("Delivered correctly and reviewed through Module 15 E2E.");

      const createResponsePromise = customerBrowser.page.waitForResponse(
        (response) => response.url().endsWith("/api/v1/reviews") && response.request().method() === "POST",
      );
      await customerBrowser.page.getByRole("button", { name: "Submit Review" }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      created = ((await createResponse.json()) as ApiEnvelope<ReviewRecord>).data;
      expect(created).toMatchObject({
        orderItemId: delivered.orderItem.id,
        productId: product.product.id,
        sellerId: seller.sellerId,
        storeId: seller.store.id,
        rating: 5,
        status: "published",
        verifiedPurchase: true,
      });
      await expect(customerBrowser.page.getByText("Review saved. Current status:")).toBeVisible();

      const duplicate = await apiContext.post(`${apiBase}/reviews`, {
        headers: bearer(delivered.customerToken),
        data: { orderItemId: delivered.orderItem.id, rating: 4, title: "Duplicate must fail" },
      });
      expect(duplicate.status()).toBe(409);
      expect(((await duplicate.json()) as ApiEnvelope<never>).error?.code).toBe("REVIEW_ALREADY_EXISTS");

      const sellerEdit = await apiContext.patch(`${apiBase}/reviews/${created.id}`, {
        headers: bearer(seller.accessToken),
        data: { rating: 1 },
      });
      expect(sellerEdit.status()).toBe(403);

      const strangerPassword = "Module15-Stranger!123";
      const stranger = await registerCustomer(apiContext, "module15-stranger", strangerPassword);
      const strangerToken = (await apiLogin(apiContext, stranger.email, strangerPassword)).accessToken;
      const foreignCreate = await apiContext.post(`${apiBase}/reviews`, {
        headers: bearer(strangerToken),
        data: { orderItemId: delivered.orderItem.id, rating: 1 },
      });
      expect(foreignCreate.status()).toBe(409);
      expect(((await foreignCreate.json()) as ApiEnvelope<never>).error?.code).toBe("REVIEW_NOT_ELIGIBLE");

      await customerBrowser.page.goto(`/products/${product.product.slug}`);
      await expect(customerBrowser.page.getByText("Excellent verified purchase")).toBeVisible();
      await expect(customerBrowser.page.getByLabel("5 out of 5 stars")).toBeVisible();

      const productReviews = await readProductReviews(apiContext, product.product.id);
      expect(productReviews.rating).toEqual({ ratingAvg: 5, ratingCount: 1 });
      expect(productReviews.reviews[0]).toMatchObject({ id: created.id, verifiedPurchase: true });
      expect(productReviews.reviews[0]).not.toHaveProperty("customerUserId");
      expect(productReviews.reviews[0]).not.toHaveProperty("orderItemId");

      const storeReviews = await readStoreReviews(apiContext, seller.store.id);
      expect(storeReviews.rating).toEqual({ ratingAvg: 5, ratingCount: 1 });
      await waitForSearchRating(apiContext, product.product.name, product.product.id, 5, 1);

      const helpfulPassword = "Module15-Helpful!123";
      const helpfulUser = await registerCustomer(apiContext, "module15-helpful", helpfulPassword);
      const helpfulBrowser = await authenticatedPage(browser, helpfulUser.email, helpfulPassword);
      try {
        await helpfulBrowser.page.goto(`/products/${product.product.slug}`);
        const helpfulResponsePromise = helpfulBrowser.page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/v1/reviews/${created.id}/helpful`) &&
            response.request().method() === "POST",
        );
        await helpfulBrowser.page.getByRole("button", { name: "Helpful", exact: true }).click();
        expect((await helpfulResponsePromise).status()).toBe(200);
        await expect(helpfulBrowser.page.getByRole("button", { name: "Marked helpful" })).toBeVisible();
      } finally {
        await helpfulBrowser.close();
      }

      const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);
      try {
        const hidden = await moderateReviewThroughAdminUi(
          adminBrowser.page,
          created.id,
          "published",
          "hide",
          "Module 15 E2E moderation hide proof",
        );
        expect(hidden.status).toBe("hidden");
        await expect.poll(async () => (await readProductReviews(apiContext, product.product.id)).reviews.length).toBe(0);
        await waitForSearchRating(apiContext, product.product.name, product.product.id, 0, 0);

        const published = await moderateReviewThroughAdminUi(
          adminBrowser.page,
          created.id,
          "hidden",
          "publish",
          "Module 15 E2E moderation republish proof",
        );
        expect(published.status).toBe("published");
        await expect.poll(async () => (await readProductReviews(apiContext, product.product.id)).reviews.length).toBe(1);
        await waitForSearchRating(apiContext, product.product.name, product.product.id, 5, 1);
      } finally {
        await adminBrowser.close();
      }

      await customerBrowser.page.goto(`/stores/${seller.store.slug}`);
      await expect(customerBrowser.page.getByText("Excellent verified purchase")).toBeVisible();
      await expect(customerBrowser.page.getByText("1 review", { exact: true })).toBeVisible();
    } finally {
      await customerBrowser.close();
    }
  });
});
