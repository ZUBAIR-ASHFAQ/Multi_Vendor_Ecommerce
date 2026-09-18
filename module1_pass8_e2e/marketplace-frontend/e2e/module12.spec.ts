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
const internalApiKey =
  process.env.E2E_INTERNAL_API_KEY ?? "e2e-ci-internal-api-key-that-is-at-least-32-characters";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  requestId?: string;
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

interface CustomerPaymentStatus {
  paymentId: string;
  orderId: string;
  providerPaymentId: string | null;
  status: string;
  currency: string;
  amountCaptured: string;
  amountRefunded: string;
}

interface OrderDetail {
  id: string;
  paymentStatus: string;
  orderStatus: string;
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

interface RefundTransaction {
  id: string;
  type: "refund";
  providerTxnId: string | null;
  amount: string;
  status: string;
}

/** Creates a short collision-resistant suffix for the Module 12 browser fixtures. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds one normal Bearer authorization header for public authenticated APIs. */
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

/** Registers one customer identity used by the real Checkout and Payment flow. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 12 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Keeps the test Order currency/tax deterministic through the published Administration API. */
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

/** Creates the customer address required by the Checkout quote. */
async function createAddress(
  context: APIRequestContext,
  customerToken: string,
): Promise<CustomerAddress> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label: "Payments Home",
      recipientName: "Module 12 Customer",
      phone: "+1 555 0120",
      line1: "12 Payments Avenue",
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

/** Creates and approves one seller, then creates one active seller store. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
): Promise<SellerFixture> {
  const password = "Module12Seller!123";
  const customer = await registerCustomer(context, "module12-seller", password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: "Module 12 Seller Legal Ltd",
      displayName: "Module 12 Seller",
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
  const slug = unique("module12-store").toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: "Module 12 Store",
      description: "Store used by the Module 12 provider-authoritative Payment flow.",
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

/** Creates the active Catalog category used by the Payment test Product. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module12-category").toLowerCase(),
      name: "Module 12 Payments Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates one seller-owned Product and one active USD variant. */
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
      slug: unique("module12-product").toLowerCase(),
      name: "Module 12 Payment Product",
      description: "Published Product used by the Module 12 E2E flow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M12-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 12 Variant",
      price: "120.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 12 Product response did not contain the new variant.");

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
  return variant;
}

/** Adds the sellable variant to the customer's persistent Cart. */
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

/** Signs in through the real React form so browser requests use the normal auth client. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Selects the deterministic Shipping Core row seeded by the cross-module E2E runner. */
async function chooseShippingMethod(page: Page): Promise<void> {
  const select = page.getByLabel(/Shipping method for store/).first();
  await expect(select).toBeVisible();
  const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error("The seeded Shipping Core option was not available.");
  await select.selectOption(value);
}

/** Uses the actual Checkout page to create the immutable parent Order required by Payments. */
async function checkoutThroughBrowser(page: Page): Promise<{ quote: CheckoutQuote; attempt: CheckoutAttempt }> {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await chooseShippingMethod(page);

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
  const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 12 Order.");

  await expect(page.getByRole("heading", { name: "Secure payment" })).toBeVisible();
  return { quote, attempt };
}

/** Creates the PaymentIntent through the real React button and captures its safe API response. */
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

/** Marks the local Stripe-compatible provider PaymentIntent as captured for the signed webhook. */
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

/** Creates a real Stripe-style HMAC header over the exact webhook body bytes. */
function stripeSignature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Builds the small signed Stripe event shape consumed by the production Stripe adapter. */
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

/** Sends one exact raw signed webhook body to the public provider endpoint. */
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

/** Creates an isolated browser context and logs in through normal React authentication. */
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

test.describe("Module 12 Payments E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let customerEmail = "";
  const customerPassword = "Module12Customer!123";
  let customerToken = "";
  let adminToken = "";

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    await configureCommerce(apiContext, adminToken);

    const customer = await registerCustomer(apiContext, "module12-customer", customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await createAddress(apiContext, customerToken);

    const seller = await createSellerFixture(apiContext, adminToken);
    const category = await createCategory(apiContext, adminToken);
    const variant = await createProductFixture(apiContext, seller, category.id);
    await addCartItem(apiContext, customerToken, variant.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test(
    "keeps browser redirect state non-authoritative, processes duplicate signed capture once, and reconciles refund history",
    async ({ browser }) => {
      const customerBrowser = await authenticatedPage(browser, customerEmail, customerPassword);
      try {
        const { quote, attempt } = await checkoutThroughBrowser(customerBrowser.page);
        const orderId = attempt.orderId!;
        const intent = await createPaymentIntentThroughBrowser(customerBrowser.page, orderId);

        expect(intent).toMatchObject({
          orderId,
          status: "pending",
          currency: "USD",
          amount: quote.grandTotal,
        });

        // A forged browser success query must still render the backend's pending Payment truth.
        await customerBrowser.page.goto(
          `/payments/orders/${orderId}?redirect_status=succeeded&payment_intent=${intent.providerPaymentId}`,
        );
        await expect(customerBrowser.page.getByRole("heading", { name: "Payment status" })).toBeVisible();
        await expect(
          customerBrowser.page.getByText("Browser redirect parameters never mark an Order paid."),
        ).toBeVisible();
        await expect(customerBrowser.page.getByText("Pending", { exact: true })).toBeVisible();

        const orderBeforeWebhook = await apiContext.get(`${apiBase}/orders/${orderId}`, {
          headers: bearer(customerToken),
        });
        expect(orderBeforeWebhook.status()).toBe(200);
        expect(((await orderBeforeWebhook.json()) as ApiEnvelope<OrderDetail>).data.paymentStatus).toBe(
          "pending",
        );

        const capturedIntent = await captureAtProvider(apiContext, intent.providerPaymentId);
        const eventId = `evt_e2e_${randomUUID().replaceAll("-", "")}`;
        const rawWebhook = succeededWebhookBody(capturedIntent, eventId);
        const signature = stripeSignature(rawWebhook);

        await sendStripeWebhook(apiContext, rawWebhook, signature);
        await sendStripeWebhook(apiContext, rawWebhook, signature);

        await expect(customerBrowser.page.getByText("Captured", { exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await expect(customerBrowser.page.getByText("Payment captured.", { exact: false })).toBeVisible();

        const paymentResponse = await apiContext.get(`${apiBase}/payments/order/${orderId}`, {
          headers: bearer(customerToken),
        });
        expect(paymentResponse.status()).toBe(200);
        const payment = ((await paymentResponse.json()) as ApiEnvelope<CustomerPaymentStatus>).data;
        expect(payment).toMatchObject({
          paymentId: intent.paymentId,
          providerPaymentId: intent.providerPaymentId,
          status: "captured",
          amountCaptured: quote.grandTotal,
          amountRefunded: "0.0000",
        });

        const orderAfterWebhook = await apiContext.get(`${apiBase}/orders/${orderId}`, {
          headers: bearer(customerToken),
        });
        expect(orderAfterWebhook.status()).toBe(200);
        expect(((await orderAfterWebhook.json()) as ApiEnvelope<OrderDetail>).data).toMatchObject({
          paymentStatus: "captured",
          orderStatus: "processing",
        });

        const refundAmount = "10.0000";
        const refundResponse = await apiContext.post(
          `${apiBase}/internal/payments/${intent.paymentId}/refund`,
          {
            headers: { "x-internal-api-key": internalApiKey },
            data: {
              sourceKey: unique("module12-e2e-refund"),
              amount: refundAmount,
              note: "Module 12 provider-test E2E partial refund",
              requestedByUserId: null,
            },
          },
        );
        expect(refundResponse.status()).toBe(200);
        const refund = ((await refundResponse.json()) as ApiEnvelope<RefundTransaction>).data;
        expect(refund).toMatchObject({ type: "refund", amount: refundAmount, status: "succeeded" });
        expect(refund.providerTxnId).toMatch(/^re_e2e_/);

        const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);
        try {
          await adminBrowser.page.goto("/admin/payments");
          await expect(adminBrowser.page.getByRole("heading", { name: "Payment search" })).toBeVisible();
          const paymentRow = adminBrowser.page.getByRole("row").filter({
            hasText: intent.providerPaymentId,
          });
          await expect(paymentRow).toBeVisible();
          await paymentRow.getByRole("link", { name: "View" }).click();
          await expect(adminBrowser.page.getByRole("heading", { name: intent.providerPaymentId })).toBeVisible();
          await expect(adminBrowser.page.getByRole("heading", { name: "Transaction timeline" })).toBeVisible();
          await expect(adminBrowser.page.getByText("Refund reference:", { exact: false })).toBeVisible();
          await expect(adminBrowser.page.getByText(refund.providerTxnId!, { exact: true })).toBeVisible();
        } finally {
          await adminBrowser.close();
        }
      } finally {
        await customerBrowser.close();
      }
    },
  );
});
