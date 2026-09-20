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

interface CurrentActor {
  scopes: {
    sellerIds: string[];
    storeIds: string[];
  };
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

interface OrderItem {
  id: string;
}

interface SellerOrder {
  id: string;
  sellerId: string;
  items: OrderItem[];
}

interface OrderDetail {
  id: string;
  paymentStatus: string;
  orderStatus: string;
  sellerOrders: SellerOrder[];
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

interface CommissionRule {
  id: string;
  priority: number;
  ratePercent: string;
  startAt: string;
}

interface CommissionCommandResult {
  orderId: string;
  entryIds: string[];
}

interface CommissionEntry {
  id: string;
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  type: "sale" | "refund" | "adjustment";
  grossAmount: string;
  commissionAmount: string;
  sellerNetAmount: string;
  currency: string;
}

interface PaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

interface RefundTransaction {
  id: string;
  type: "refund";
  providerTxnId: string | null;
  amount: string;
  status: string;
}

/** Creates a collision-resistant fixture suffix without adding a shared test abstraction. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the normal Bearer header used by authenticated setup and verification requests. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Formats one Date for the browser's datetime-local control. */
function localDateTimeInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
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

/** Reads the server-derived seller scopes for one authenticated seller account. */
async function readCurrentActor(
  context: APIRequestContext,
  accessToken: string,
): Promise<CurrentActor> {
  const response = await context.get(`${apiBase}/auth/me`, { headers: bearer(accessToken) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CurrentActor>).data;
}

/** Registers one real customer identity for the Module 16 cross-module flow. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 16 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Keeps USD and tax configuration deterministic through the public Administration API. */
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

/** Creates the customer address required for the real Checkout flow. */
async function createAddress(
  context: APIRequestContext,
  customerToken: string,
): Promise<CustomerAddress> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label: "Commission Home",
      recipientName: "Module 16 Customer",
      phone: "+1 555 0160",
      line1: "16 Commission Avenue",
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

/** Creates and approves one seller owner, then returns the server-derived seller identity. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<SellerFixture> {
  const password = `Module16-${label}-Seller!123`;
  const customer = await registerCustomer(context, `module16-${label}-seller`, password);
  const initialSession = await apiLogin(context, customer.email, password);

  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(initialSession.accessToken),
    data: {
      legalName: `Module 16 ${label} Seller Legal Ltd`,
      displayName: `Module 16 ${label} Seller`,
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
  if (!sellerId) throw new Error("Approved seller session did not contain a seller scope.");

  const slug = unique(`module16-${label}-store`).toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: `Module 16 ${label} Store`,
      description: `Store used by the Module 16 ${label} Commission E2E workflow.`,
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

/** Creates the active Catalog category used by the Commission test Product. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module16-category").toLowerCase(),
      name: "Module 16 Commission Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates, publishes, and stocks one seller-owned Product variant. */
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
      slug: unique("module16-product").toLowerCase(),
      name: "Module 16 Commission Product",
      description: "Published Product used by the Module 16 Commission E2E flow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M16-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 16 Variant",
      price: "120.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 16 Product response did not contain the new variant.");

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

/** Adds the sellable Product variant to the customer's persistent Cart. */
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

/** Signs in through the real React form so UI requests use the normal auth client. */
async function browserLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Creates an isolated authenticated browser context for one marketplace actor. */
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

/** Creates one Commission rule through the real admin React form and returns its API response. */
async function createRuleThroughBrowser(
  page: Page,
  input: { priority: number; ratePercent: string; fixedFee: string; startAt: Date },
): Promise<CommissionRule> {
  await page.goto("/admin/commissions/rules");
  await expect(page.getByRole("heading", { name: "Commission rule manager" })).toBeVisible();
  await page.getByRole("button", { name: "Create rule", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Commission rule" })).toBeVisible();
  await page.getByLabel("Commission rule priority").fill(String(input.priority));
  await page.getByLabel("Commission rate percent").fill(input.ratePercent);
  await page.getByLabel("Commission fixed fee").fill(input.fixedFee);
  await page.getByLabel("Commission rule start time").fill(localDateTimeInput(input.startAt));

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/admin/commissions/rules") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create rule", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CommissionRule>).data;
}

/** Edits one still-future Commission rule through the real React rule manager. */
async function updateFutureRuleThroughBrowser(
  page: Page,
  currentRatePercent: string,
  nextRatePercent: string,
): Promise<CommissionRule> {
  const row = page.getByRole("row").filter({ hasText: `${currentRatePercent}%` });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit future rule" }).click();
  await expect(page.getByRole("heading", { name: "Edit future-effective Commission rule" })).toBeVisible();
  await page.getByLabel("Commission rate percent").fill(nextRatePercent);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/admin/commissions/rules/") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save rule" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CommissionRule>).data;
}

/** Selects the deterministic Shipping Core method seeded by the release runner. */
async function chooseShippingMethod(page: Page): Promise<void> {
  const select = page.getByLabel(/Shipping method for/).first();
  await expect(select).toBeVisible();
  const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error("The seeded Shipping Core option was not available.");
  await select.selectOption(value);
}

/** Creates the immutable Order through the real Checkout React workflow. */
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
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 16 Order.");
  await expect(page.getByRole("heading", { name: "Secure payment" })).toBeVisible();
  return { quote, attempt };
}

/** Creates the PaymentIntent through the normal customer React payment action. */
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

/** Marks the local Stripe-compatible PaymentIntent captured before the signed webhook is sent. */
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

/** Creates the Stripe-style HMAC signature over the exact webhook body bytes. */
function stripeSignature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Builds the minimal successful Stripe event shape consumed by the production adapter. */
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

/** Sends one exact raw signed Payment webhook to establish provider-authoritative capture. */
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

/** Runs the trusted idempotent Commission Order settlement command. */
async function settleCommission(
  context: APIRequestContext,
  sourceKey: string,
  orderId: string,
): Promise<CommissionCommandResult> {
  const response = await context.post(`${apiBase}/internal/commissions/order-settle`, {
    headers: { "x-internal-api-key": internalApiKey },
    data: { sourceKey, orderId },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CommissionCommandResult>).data;
}

/** Runs the trusted idempotent full-refund Commission adjustment command. */
async function adjustRefundCommission(
  context: APIRequestContext,
  sourceKey: string,
  orderId: string,
  refundPaymentTransactionId: string,
): Promise<CommissionCommandResult> {
  const response = await context.post(`${apiBase}/internal/commissions/refund-adjust`, {
    headers: { "x-internal-api-key": internalApiKey },
    data: { sourceKey, orderId, refundPaymentTransactionId },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CommissionCommandResult>).data;
}

/** Reads immutable finance entries for one Seller Order through the documented admin API. */
async function listCommissionEntries(
  context: APIRequestContext,
  adminToken: string,
  sellerOrderId: string,
): Promise<CommissionEntry[]> {
  const response = await context.get(`${apiBase}/admin/commissions/entries`, {
    headers: bearer(adminToken),
    params: { sellerOrderId, page: 1, pageSize: 20, sort: "occurredAt", order: "asc" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as PaginatedEnvelope<CommissionEntry>).data;
}

test.describe("Module 16 Commissions E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let customerEmail = "";
  const customerPassword = "Module16Customer!123";
  let customerToken = "";
  let sellerA: SellerFixture;
  let sellerB: SellerFixture;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    await configureCommerce(apiContext, adminToken);

    const customer = await registerCustomer(apiContext, "module16-customer", customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await createAddress(apiContext, customerToken);

    sellerA = await createSellerFixture(apiContext, adminToken, "a");
    sellerB = await createSellerFixture(apiContext, adminToken, "b");
    const category = await createCategory(apiContext, adminToken);
    const variant = await createProductFixture(apiContext, sellerA, category.id);
    await addCartItem(apiContext, customerToken, variant.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test(
    "snapshots one captured Order Commission, replays settlement once, preserves history across future rule edits, and appends a full-refund reversal",
    async ({ browser }) => {
      const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);
      const customerBrowser = await authenticatedPage(browser, customerEmail, customerPassword);
      try {
        const activeRule = await createRuleThroughBrowser(adminBrowser.page, {
          priority: 100,
          ratePercent: "10.000000",
          fixedFee: "1.0000",
          startAt: new Date(Date.now() - 60 * 60 * 1000),
        });
        expect(activeRule.ratePercent).toBe("10.000000");

        const { quote, attempt } = await checkoutThroughBrowser(customerBrowser.page);
        const orderId = attempt.orderId!;
        const intent = await createPaymentIntentThroughBrowser(customerBrowser.page, orderId);
        expect(intent).toMatchObject({ orderId, status: "pending", amount: quote.grandTotal });

        const capturedIntent = await captureAtProvider(apiContext, intent.providerPaymentId);
        const eventId = `evt_e2e_${randomUUID().replaceAll("-", "")}`;
        const rawWebhook = succeededWebhookBody(capturedIntent, eventId);
        await sendStripeWebhook(apiContext, rawWebhook, stripeSignature(rawWebhook));

        const orderResponse = await apiContext.get(`${apiBase}/orders/${orderId}`, {
          headers: bearer(customerToken),
        });
        expect(orderResponse.status()).toBe(200);
        const order = ((await orderResponse.json()) as ApiEnvelope<OrderDetail>).data;
        expect(order).toMatchObject({ paymentStatus: "captured", orderStatus: "processing" });
        const sellerOrder = order.sellerOrders.find((entry) => entry.sellerId === sellerA.sellerId);
        if (!sellerOrder) throw new Error("Captured Order did not contain Seller A's Seller Order.");

        const settleSourceKey = unique("module16-e2e-settle");
        const firstSettlement = await settleCommission(apiContext, settleSourceKey, orderId);
        const replayedSettlement = await settleCommission(apiContext, settleSourceKey, orderId);
        expect(replayedSettlement).toEqual(firstSettlement);
        expect(firstSettlement.entryIds).toHaveLength(sellerOrder.items.length);

        const saleEntries = await listCommissionEntries(apiContext, adminToken, sellerOrder.id);
        expect(saleEntries).toHaveLength(1);
        const sale = saleEntries[0]!;
        expect(sale).toMatchObject({
          sellerId: sellerA.sellerId,
          sellerOrderId: sellerOrder.id,
          type: "sale",
          grossAmount: "120.0000",
          commissionAmount: "13.0000",
          sellerNetAmount: "107.0000",
          currency: "USD",
        });

        const sellerABrowser = await authenticatedPage(browser, sellerA.email, sellerA.password);
        try {
          await sellerABrowser.page.goto("/seller/commissions");
          await expect(sellerABrowser.page.getByRole("heading", { name: "Seller fee statement" })).toBeVisible();
          await expect(sellerABrowser.page.getByText(sellerOrder.id, { exact: true }).first()).toBeVisible();
          await expect(sellerABrowser.page.getByText("13.0000 USD", { exact: true }).first()).toBeVisible();
          await expect(sellerABrowser.page.getByText("107.0000 USD", { exact: true }).first()).toBeVisible();
        } finally {
          await sellerABrowser.close();
        }

        const sellerBBrowser = await authenticatedPage(browser, sellerB.email, sellerB.password);
        try {
          await sellerBBrowser.page.goto("/seller/commissions");
          await expect(sellerBBrowser.page.getByRole("heading", { name: "Seller fee statement" })).toBeVisible();
          await expect(sellerBBrowser.page.getByText(sellerOrder.id, { exact: true })).toHaveCount(0);
        } finally {
          await sellerBBrowser.close();
        }

        const futureRule = await createRuleThroughBrowser(adminBrowser.page, {
          priority: 200,
          ratePercent: "15.000000",
          fixedFee: "0.0000",
          startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        expect(futureRule.ratePercent).toBe("15.000000");
        const updatedFutureRule = await updateFutureRuleThroughBrowser(
          adminBrowser.page,
          "15.000000",
          "16.000000",
        );
        expect(updatedFutureRule.ratePercent).toBe("16.000000");

        const afterRuleEdit = await listCommissionEntries(apiContext, adminToken, sellerOrder.id);
        expect(afterRuleEdit).toEqual(saleEntries);

        const refundResponse = await apiContext.post(
          `${apiBase}/internal/payments/${intent.paymentId}/refund`,
          {
            headers: { "x-internal-api-key": internalApiKey },
            data: {
              sourceKey: unique("module16-e2e-payment-refund"),
              amount: quote.grandTotal,
              note: "Module 16 full-refund Commission reversal E2E",
              requestedByUserId: null,
            },
          },
        );
        expect(refundResponse.status()).toBe(200);
        const refund = ((await refundResponse.json()) as ApiEnvelope<RefundTransaction>).data;
        expect(refund).toMatchObject({ type: "refund", amount: quote.grandTotal, status: "succeeded" });

        const refundSourceKey = unique("module16-e2e-commission-refund");
        const firstAdjustment = await adjustRefundCommission(
          apiContext,
          refundSourceKey,
          orderId,
          refund.id,
        );
        const replayedAdjustment = await adjustRefundCommission(
          apiContext,
          refundSourceKey,
          orderId,
          refund.id,
        );
        expect(replayedAdjustment).toEqual(firstAdjustment);
        expect(firstAdjustment.entryIds).toHaveLength(sellerOrder.items.length);

        const finalEntries = await listCommissionEntries(apiContext, adminToken, sellerOrder.id);
        expect(finalEntries).toHaveLength(2);
        const finalSale = finalEntries.find((entry) => entry.type === "sale");
        const reversal = finalEntries.find((entry) => entry.type === "refund");
        expect(finalSale).toEqual(sale);
        expect(reversal).toMatchObject({
          grossAmount: "-120.0000",
          commissionAmount: "-13.0000",
          sellerNetAmount: "-107.0000",
          currency: "USD",
        });

        await adminBrowser.page.goto("/admin/commissions/entries");
        await expect(adminBrowser.page.getByRole("heading", { name: "Finance Commission ledger" })).toBeVisible();
        await adminBrowser.page.getByLabel("Finance Commission order UUID").fill(sellerOrder.id);
        await adminBrowser.page.getByRole("button", { name: "Apply filters" }).click();
        await expect(adminBrowser.page.getByText(sellerOrder.id, { exact: true }).first()).toBeVisible();
        await expect(adminBrowser.page.getByText("Sale", { exact: true }).first()).toBeVisible();
        await expect(adminBrowser.page.getByText("Refund", { exact: true }).first()).toBeVisible();

        const finalSellerBrowser = await authenticatedPage(browser, sellerA.email, sellerA.password);
        try {
          await finalSellerBrowser.page.goto("/seller/commissions");
          await finalSellerBrowser.page.getByLabel("Seller Commission order UUID").fill(sellerOrder.id);
          await finalSellerBrowser.page.getByRole("button", { name: "Apply filters" }).click();
          await expect(finalSellerBrowser.page.getByText("Sale", { exact: true })).toBeVisible();
          await expect(finalSellerBrowser.page.getByText("Refund", { exact: true })).toBeVisible();
          await expect(finalSellerBrowser.page.getByText("-13.0000 USD", { exact: true })).toBeVisible();
          await expect(finalSellerBrowser.page.getByText("-107.0000 USD", { exact: true })).toBeVisible();
        } finally {
          await finalSellerBrowser.close();
        }
      } finally {
        await customerBrowser.close();
        await adminBrowser.close();
      }
    },
  );
});
