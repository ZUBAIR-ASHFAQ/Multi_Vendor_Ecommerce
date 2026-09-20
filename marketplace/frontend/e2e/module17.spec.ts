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

interface WalletBalance {
  sellerId: string;
  currency: string;
  pendingBalance: string;
  availableBalance: string;
  heldBalance: string;
  negativeBalance: string;
}

interface WalletEntry {
  id: string;
  type: string;
  amount: string;
  balanceBucket: string;
  sourceType: string;
  sourceId: string;
}

interface PayoutAccount {
  id: string;
  providerType: string;
  maskedDetails: string;
  status: string;
}

interface SellerWalletRead {
  wallets: WalletBalance[];
  entries: WalletEntry[];
  payoutAccounts: PayoutAccount[];
}

interface Payout {
  id: string;
  payoutNo: string;
  sellerId: string;
  amount: string;
  currency: string;
  accountId: string;
  status: "requested" | "approved" | "processing" | "paid" | "failed";
  providerRef: string | null;
  allocations: Array<{ walletEntryId: string; amount: string }>;
}

interface ReturnRequest {
  id: string;
  items: Array<{ id: string; orderItemId: string; quantity: number }>;
}

interface CommissionEntry {
  id: string;
  type: "sale" | "refund" | "adjustment";
  sellerNetAmount: string;
}

/** Creates one short unique value for live-server fixture names and idempotency keys. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the standard Bearer header used by authenticated setup requests. */
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Converts one scale-4 money string into an exact integer for E2E assertions. */
function moneyUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const units = BigInt(whole) * 10_000n + BigInt(`${fraction}0000`.slice(0, 4));
  return negative ? -units : units;
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

/** Reads the seller identity derived by the backend after seller approval. */
async function readCurrentActor(
  context: APIRequestContext,
  accessToken: string,
): Promise<CurrentActor> {
  const response = await context.get(`${apiBase}/auth/me`, { headers: bearer(accessToken) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<CurrentActor>).data;
}

/** Registers one customer identity through the public registration endpoint. */
async function registerCustomer(
  context: APIRequestContext,
  label: string,
  password: string,
): Promise<RegisteredCustomer> {
  const suffix = unique(label);
  const response = await context.post(`${apiBase}/auth/register`, {
    data: {
      email: `${suffix}@example.test`,
      displayName: `Module 17 ${suffix.slice(-6)}`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<RegisteredCustomer>).data;
}

/** Configures one currency, tax rate, and one-day Return/Wallet hold window. */
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
        { key: "returns.window_days", value: 1 },
      ],
    },
  });
  expect(response.status()).toBe(200);
}

/** Ensures one deterministic default Commission rule exists for Wallet credit/refund proof. */
async function ensureCommissionRule(
  context: APIRequestContext,
  adminToken: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/admin/commissions/rules`, {
    headers: bearer(adminToken),
    data: {
      priority: 170000,
      scopeType: "default",
      scopeId: null,
      ratePercent: "10.000000",
      fixedFee: "1.0000",
      startAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      endAt: null,
      status: "active",
    },
  });
  if (response.status() !== 201 && response.status() !== 409) {
    throw new Error(`Module 17 Commission rule setup returned ${response.status()}.`);
  }
}

/** Creates the customer address required by Checkout. */
async function createAddress(
  context: APIRequestContext,
  customerToken: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/customers/me/addresses`, {
    headers: bearer(customerToken),
    data: {
      label: "Wallet Home",
      recipientName: "Module 17 Customer",
      phone: "+1 555 0170",
      line1: "17 Wallet Avenue",
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

/** Creates and approves one seller owner, then creates its first USD store. */
async function createSellerFixture(
  context: APIRequestContext,
  adminToken: string,
): Promise<SellerFixture> {
  const password = "Module17-Seller!123";
  const customer = await registerCustomer(context, "module17-seller", password);
  const customerSession = await apiLogin(context, customer.email, password);
  const applicationResponse = await context.post(`${apiBase}/sellers/applications`, {
    headers: bearer(customerSession.accessToken),
    data: {
      legalName: "Module 17 Seller Legal Ltd",
      displayName: "Module 17 Seller",
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
  if (!sellerId) throw new Error("Approved Module 17 seller did not receive seller scope.");

  const slug = unique("module17-store").toLowerCase();
  const storeResponse = await context.post(`${apiBase}/sellers/me/stores`, {
    headers: bearer(sellerSession.accessToken),
    data: {
      slug,
      name: "Module 17 Store",
      description: "Store used by the Seller Wallet and Payout E2E release workflow.",
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

/** Creates the active Catalog category used by the Wallet source Order. */
async function createCategory(
  context: APIRequestContext,
  adminToken: string,
): Promise<CategoryRecord> {
  const response = await context.post(`${apiBase}/admin/catalog/categories`, {
    headers: bearer(adminToken),
    data: {
      parentId: null,
      slug: unique("module17-category").toLowerCase(),
      name: "Module 17 Wallet Category",
      status: "active",
      sortOrder: 0,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<CategoryRecord>).data;
}

/** Creates, publishes, and stocks one seller Product that can generate Wallet earnings. */
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
      slug: unique("module17-product").toLowerCase(),
      name: "Module 17 Wallet Product",
      description: "Published Product used by the Module 17 Wallet/Payout E2E workflow.",
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = ((await productResponse.json()) as ApiEnvelope<ProductRecord>).data;

  const sku = `M17-${unique("SKU")}`.toUpperCase();
  const variantResponse = await context.post(`${apiBase}/seller/products/${product.id}/variants`, {
    headers: bearer(seller.accessToken),
    data: {
      sku,
      title: "Module 17 Variant",
      price: "200.0000",
      currency: "USD",
      status: "active",
    },
  });
  expect(variantResponse.status()).toBe(201);
  const updated = ((await variantResponse.json()) as ApiEnvelope<ProductRecord>).data;
  const variant = updated.variants?.find((entry) => entry.sku === sku);
  if (!variant) throw new Error("Module 17 Product did not return the new variant.");

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

/** Adds the sellable Product to the customer Cart. */
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

/** Creates one isolated authenticated browser page. */
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

/** Selects the deterministic Shipping Core rate seeded by the cumulative E2E runner. */
async function chooseShippingMethod(page: Page): Promise<void> {
  const select = page.getByLabel(/Shipping method for/u).first();
  await expect(select).toBeVisible();
  const option = select.locator("option").filter({ hasText: "E2E Checkout Standard" }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error("The seeded Shipping option was not available.");
  await select.selectOption(value);
}

/** Uses the real Checkout UI to create the authoritative Order. */
async function checkoutThroughBrowser(
  page: Page,
): Promise<{ quote: CheckoutQuote; attempt: CheckoutAttempt }> {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await chooseShippingMethod(page);

  const quotePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/checkout/quote") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Review order" }).click();
  const quote = ((await (await quotePromise).json()) as ApiEnvelope<CheckoutQuote>).data;

  const confirmPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/checkout/quote/${quote.id}/confirm`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm & pay" }).click();
  const confirmResponse = await confirmPromise;
  expect(confirmResponse.status()).toBe(200);
  const attempt = ((await confirmResponse.json()) as ApiEnvelope<CheckoutAttempt>).data;
  if (!attempt.orderId) throw new Error("Checkout did not create the Module 17 Order.");
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

/** Marks the local Stripe-compatible intent captured before the signed webhook is sent. */
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

/** Creates the Stripe-style webhook signature for the exact raw bytes. */
function stripeSignature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Builds the provider-authoritative Payment success event consumed by Module 12. */
function succeededWebhookBody(intent: FakeStripePaymentIntent): string {
  return JSON.stringify({
    id: `evt_module17_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: intent },
  });
}

/** Sends the exact signed Stripe webhook to establish captured Payment truth. */
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

/** Reads the customer-owned Order after Payment confirmation. */
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

/** Runs the trusted Commission settlement so the outbox can drive the Wallet source worker. */
async function settleCommission(
  context: APIRequestContext,
  orderId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/internal/commissions/order-settle`, {
    headers: { "x-internal-api-key": internalApiKey },
    data: { sourceKey: unique("module17-commission-settle"), orderId },
  });
  expect(response.status()).toBe(200);
}

/** Accepts one captured Seller Order. */
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

/** Creates one full-quantity Shipment for the Wallet source Order Item. */
async function createShipment(
  context: APIRequestContext,
  sellerToken: string,
  sellerOrderId: string,
  orderItemId: string,
): Promise<SellerShipment> {
  const response = await context.post(`${apiBase}/seller/orders/${sellerOrderId}/shipments`, {
    headers: {
      ...bearer(sellerToken),
      "Idempotency-Key": unique("module17-create-shipment"),
    },
    data: { items: [{ orderItemId, quantity: 1 }] },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<SellerShipment>).data;
}

/** Adds tracking data required before Shipment dispatch. */
async function updateTracking(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.patch(`${apiBase}/seller/shipments/${shipmentId}/tracking`, {
    headers: bearer(sellerToken),
    data: {
      carrier: "Module 17 Carrier",
      trackingNo: unique("M17-TRACK").toUpperCase(),
      serviceLevel: "Wallet E2E",
    },
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment shipped so Inventory issue and fulfillment evidence are persisted. */
async function markShipped(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-shipped`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": unique("module17-ship") },
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Marks one Shipment delivered so Module 17 can validate its availability gate. */
async function markDelivered(
  context: APIRequestContext,
  sellerToken: string,
  shipmentId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/shipments/${shipmentId}/mark-delivered`, {
    headers: { ...bearer(sellerToken), "Idempotency-Key": unique("module17-deliver") },
    data: {},
  });
  expect(response.status()).toBe(200);
}

/** Reads the authenticated seller's authoritative Wallet snapshot, ledger, and safe accounts. */
async function readSellerWallet(
  context: APIRequestContext,
  sellerToken: string,
): Promise<SellerWalletRead> {
  const response = await context.get(`${apiBase}/seller/wallet`, {
    headers: bearer(sellerToken),
    params: { page: 1, pageSize: 100, sort: "occurredAt", order: "asc" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<SellerWalletRead>).data;
}

/** Waits for the asynchronous Commission event consumer to create the pending Wallet credit. */
async function waitForPendingCredit(
  context: APIRequestContext,
  sellerToken: string,
): Promise<WalletBalance> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wallet = await readSellerWallet(context, sellerToken);
    const usd = wallet.wallets.find((entry) => entry.currency === "USD");
    if (usd && moneyUnits(usd.pendingBalance) > 0n) return usd;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the Commission event to credit the seller Wallet.");
}

/** Runs the trusted bounded settlement command after delivery and the E2E logical hold window. */
async function settleWallet(
  context: APIRequestContext,
): Promise<void> {
  const response = await context.post(`${apiBase}/internal/wallet/settle`, {
    headers: {
      "x-internal-api-key": internalApiKey,
      "Idempotency-Key": unique("module17-wallet-settle"),
    },
    data: { limit: 100 },
  });
  expect(response.status()).toBe(200);
}

/** Waits until the seller has positive available money and no pending source remains. */
async function waitForAvailableBalance(
  context: APIRequestContext,
  sellerToken: string,
): Promise<WalletBalance> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wallet = await readSellerWallet(context, sellerToken);
    const usd = wallet.wallets.find((entry) => entry.currency === "USD");
    if (usd && moneyUnits(usd.availableBalance) > 0n && moneyUnits(usd.pendingBalance) === 0n) {
      return usd;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for pending Wallet money to become available.");
}

/** Creates one deterministic payout account through the approved seller API. */
async function createPayoutAccount(
  context: APIRequestContext,
  sellerToken: string,
  providerAccountRef: string,
): Promise<PayoutAccount> {
  const response = await context.post(`${apiBase}/seller/payout-accounts`, {
    headers: bearer(sellerToken),
    data: { providerType: "e2e", providerAccountRef },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<PayoutAccount>).data;
}

/** Creates one seller Payout request with an explicit idempotency key. */
async function requestPayout(
  context: APIRequestContext,
  sellerToken: string,
  accountId: string,
  amount: string,
): Promise<Payout> {
  const response = await context.post(`${apiBase}/seller/payouts`, {
    headers: {
      ...bearer(sellerToken),
      "Idempotency-Key": unique("module17-payout-request"),
    },
    data: { accountId, amount, currency: "USD" },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ApiEnvelope<Payout>).data;
}

/** Finance-approves one requested Payout and reserves exact available money into held. */
async function approvePayout(
  context: APIRequestContext,
  adminToken: string,
  payoutId: string,
): Promise<Payout> {
  const response = await context.post(`${apiBase}/admin/payouts/${payoutId}/approve`, {
    headers: {
      ...bearer(adminToken),
      "Idempotency-Key": unique("module17-payout-approve"),
    },
    data: {},
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as ApiEnvelope<Payout>).data;
}

/** Executes one provider send/reconciliation attempt and returns its HTTP response. */
async function sendPayout(
  context: APIRequestContext,
  adminToken: string,
  payoutId: string,
) {
  return context.post(`${apiBase}/admin/payouts/${payoutId}/send`, {
    headers: {
      ...bearer(adminToken),
      "Idempotency-Key": unique("module17-payout-send"),
    },
    data: {},
  });
}

/** Reads one Payout from seller history after provider reconciliation. */
async function readSellerPayout(
  context: APIRequestContext,
  sellerToken: string,
  payoutId: string,
): Promise<Payout> {
  const response = await context.get(`${apiBase}/seller/payouts`, {
    headers: bearer(sellerToken),
    params: { page: 1, pageSize: 100, sort: "requestedAt", order: "desc" },
  });
  expect(response.status()).toBe(200);
  const payouts = ((await response.json()) as PaginatedEnvelope<Payout>).data;
  const payout = payouts.find((entry) => entry.id === payoutId);
  if (!payout) throw new Error(`Seller Payout ${payoutId} was not found.`);
  return payout;
}

/** Creates one Return Request for the delivered source Order Item. */
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

/** Approves the customer Return so the admin refund command becomes eligible. */
async function approveReturn(
  context: APIRequestContext,
  sellerToken: string,
  returnId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/seller/returns/${returnId}/approve`, {
    headers: bearer(sellerToken),
    data: { note: "Approved for Module 17 post-payout refund proof" },
  });
  expect(response.status()).toBe(200);
}

/** Issues the provider-authoritative Return refund with Foundation idempotency. */
async function issueRefund(
  context: APIRequestContext,
  adminToken: string,
  returnId: string,
): Promise<void> {
  const response = await context.post(`${apiBase}/returns/${returnId}/refund`, {
    headers: {
      ...bearer(adminToken),
      "Idempotency-Key": unique("module17-return-refund"),
    },
    data: { note: "Module 17 refund after paid payout" },
  });
  expect(response.status()).toBe(200);
}

/** Waits until the refund Commission event appends a negative Wallet adjustment. */
async function waitForNegativeAdjustment(
  context: APIRequestContext,
  sellerToken: string,
): Promise<SellerWalletRead> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wallet = await readSellerWallet(context, sellerToken);
    const usd = wallet.wallets.find((entry) => entry.currency === "USD");
    const adjustment = wallet.entries.find((entry) => entry.type === "commission_adjustment");
    if (usd && adjustment && moneyUnits(usd.negativeBalance) < 0n) return wallet;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the refund Commission event to adjust the Wallet.");
}

/** Reads immutable Commission rows to prove the refund is a new source rather than a payout rewrite. */
async function listCommissionEntries(
  context: APIRequestContext,
  adminToken: string,
  sellerOrderId: string,
): Promise<CommissionEntry[]> {
  const response = await context.get(`${apiBase}/admin/commissions/entries`, {
    headers: bearer(adminToken),
    params: { sellerOrderId, page: 1, pageSize: 100, sort: "occurredAt", order: "asc" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as PaginatedEnvelope<CommissionEntry>).data;
}

test.describe("Module 17 Seller Wallet & Payouts E2E", () => {
  test.describe.configure({ mode: "serial" });

  let apiContext: APIRequestContext;
  let adminToken = "";
  let seller: SellerFixture;
  let customerEmail = "";
  let customerPassword = "Module17-Customer!123";
  let customerToken = "";
  let sourceOrder: OrderDetail;
  let sourceSellerOrder: SellerOrder;
  let sourceOrderItem: OrderItem;
  let paidPayout: Payout;

  test.beforeAll(async () => {
    apiContext = await requestFactory.newContext();
    adminToken = (await apiLogin(apiContext, adminEmail, adminPassword)).accessToken;
    await configureCommerce(apiContext, adminToken);
    await ensureCommissionRule(apiContext, adminToken);

    seller = await createSellerFixture(apiContext, adminToken);
    const category = await createCategory(apiContext, adminToken);
    const variant = await createProductFixture(apiContext, seller, category.id);

    const customer = await registerCustomer(apiContext, "module17-customer", customerPassword);
    customerEmail = customer.email;
    customerToken = (await apiLogin(apiContext, customerEmail, customerPassword)).accessToken;
    await createAddress(apiContext, customerToken);
    await addCartItem(apiContext, customerToken, variant.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test("moves Commission earnings through delivery, hold, available, reservation, and paid Payout history", async ({ browser }) => {
    const customerBrowser = await authenticatedPage(browser, customerEmail, customerPassword);
    try {
      const { quote, attempt } = await checkoutThroughBrowser(customerBrowser.page);
      const orderId = attempt.orderId!;
      const intent = await createPaymentIntentThroughBrowser(customerBrowser.page, orderId);
      expect(intent).toMatchObject({ orderId, amount: quote.grandTotal, status: "pending" });

      const captured = await captureAtProvider(apiContext, intent.providerPaymentId);
      await sendStripeWebhook(apiContext, succeededWebhookBody(captured));
      await settleCommission(apiContext, orderId);

      const pending = await waitForPendingCredit(apiContext, seller.accessToken);
      expect(moneyUnits(pending.pendingBalance)).toBeGreaterThan(0n);
      expect(moneyUnits(pending.availableBalance)).toBe(0n);

      sourceOrder = await readOrder(apiContext, customerToken, orderId);
      expect(sourceOrder.paymentStatus).toBe("captured");
      const sellerOrder = sourceOrder.sellerOrders.find((entry) => entry.sellerId === seller.sellerId);
      if (!sellerOrder) throw new Error("Module 17 source Order did not contain the expected Seller Order.");
      const orderItem = sellerOrder.items[0];
      if (!orderItem) throw new Error("Module 17 source Seller Order did not contain an Order Item.");
      sourceSellerOrder = sellerOrder;
      sourceOrderItem = orderItem;

      await acceptSellerOrder(apiContext, seller.accessToken, sellerOrder.id);
      const shipment = await createShipment(apiContext, seller.accessToken, sellerOrder.id, orderItem.id);
      await updateTracking(apiContext, seller.accessToken, shipment.id);
      await markShipped(apiContext, seller.accessToken, shipment.id);
      await markDelivered(apiContext, seller.accessToken, shipment.id);
      await settleWallet(apiContext);

      const available = await waitForAvailableBalance(apiContext, seller.accessToken);
      expect(moneyUnits(available.availableBalance)).toBeGreaterThan(0n);

      const sellerBrowser = await authenticatedPage(browser, seller.email, seller.password);
      const adminBrowser = await authenticatedPage(browser, adminEmail, adminPassword);
      try {
        await sellerBrowser.page.goto("/seller/wallet");
        await expect(sellerBrowser.page.getByRole("heading", { name: "Seller wallet" })).toBeVisible();
        await expect(sellerBrowser.page.getByText("Commission credit", { exact: true }).first()).toBeVisible();
        await expect(sellerBrowser.page.getByText("Available", { exact: true }).first()).toBeVisible();

        const accountResponsePromise = sellerBrowser.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/seller/payout-accounts") &&
            response.request().method() === "POST",
        );
        await sellerBrowser.page.getByLabel("Payout provider type").fill("e2e");
        await sellerBrowser.page.getByLabel("Provider account reference").fill("paid:module17-main-1234");
        await sellerBrowser.page.getByRole("button", { name: "Add Payout Account" }).click();
        const accountResponse = await accountResponsePromise;
        expect(accountResponse.status()).toBe(201);
        const account = ((await accountResponse.json()) as ApiEnvelope<PayoutAccount>).data;

        await sellerBrowser.page.goto("/seller/payouts");
        await expect(sellerBrowser.page.getByRole("heading", { name: "Seller payouts" })).toBeVisible();
        await sellerBrowser.page.getByLabel("Payout account").selectOption(account.id);
        await sellerBrowser.page.getByLabel("Payout amount").fill("40.0000");
        await sellerBrowser.page.getByLabel("Payout currency").fill("USD");
        const requestPromise = sellerBrowser.page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/seller/payouts") &&
            response.request().method() === "POST",
        );
        await sellerBrowser.page.getByRole("button", { name: "Request Payout" }).click();
        const requestResponse = await requestPromise;
        expect(requestResponse.status()).toBe(201);
        const requested = ((await requestResponse.json()) as ApiEnvelope<Payout>).data;

        await adminBrowser.page.goto("/admin/payouts");
        await expect(adminBrowser.page.getByRole("heading", { name: "Finance payout queue" })).toBeVisible();
        const payoutCard = adminBrowser.page.locator("article").filter({ hasText: requested.payoutNo });
        await expect(payoutCard).toBeVisible();

        const approvePromise = adminBrowser.page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/v1/admin/payouts/${requested.id}/approve`) &&
            response.request().method() === "POST",
        );
        await payoutCard.getByRole("button", { name: "Approve & Reserve" }).click();
        expect((await approvePromise).status()).toBe(200);
        await expect(payoutCard.getByText("Approved", { exact: true }).first()).toBeVisible();

        const sendPromise = adminBrowser.page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/v1/admin/payouts/${requested.id}/send`) &&
            response.request().method() === "POST",
        );
        await payoutCard.getByRole("button", { name: "Send Payout" }).click();
        const sendResponse = await sendPromise;
        expect(sendResponse.status()).toBe(200);
        paidPayout = ((await sendResponse.json()) as ApiEnvelope<Payout>).data;
        expect(paidPayout).toMatchObject({ status: "paid", amount: "40.0000" });
        expect(paidPayout.providerRef).toBe(`e2e-payout-${paidPayout.id}`);
        await expect(payoutCard.getByText("Paid", { exact: true }).first()).toBeVisible();
      } finally {
        await Promise.all([sellerBrowser.close(), adminBrowser.close()]);
      }
    } finally {
      await customerBrowser.close();
    }
  });

  test("reconciles provider failure and unknown results without losing or prematurely releasing held money", async () => {
    const before = await readSellerWallet(apiContext, seller.accessToken);
    const beforeUsd = before.wallets.find((entry) => entry.currency === "USD");
    if (!beforeUsd) throw new Error("Module 17 USD Wallet was not available for provider reconciliation proof.");

    const failedAccount = await createPayoutAccount(
      apiContext,
      seller.accessToken,
      "failed:module17-failed-5678",
    );
    const failedRequested = await requestPayout(
      apiContext,
      seller.accessToken,
      failedAccount.id,
      "20.0000",
    );
    const failedApproved = await approvePayout(apiContext, adminToken, failedRequested.id);
    expect(failedApproved.status).toBe("approved");

    const failedSend = await sendPayout(apiContext, adminToken, failedRequested.id);
    expect(failedSend.status()).toBe(502);
    const failed = await readSellerPayout(apiContext, seller.accessToken, failedRequested.id);
    expect(failed.status).toBe("failed");

    const afterFailure = await readSellerWallet(apiContext, seller.accessToken);
    const afterFailureUsd = afterFailure.wallets.find((entry) => entry.currency === "USD");
    if (!afterFailureUsd) throw new Error("USD Wallet disappeared after provider failure.");
    expect(afterFailureUsd.heldBalance).toBe(beforeUsd.heldBalance);
    expect(afterFailureUsd.availableBalance).toBe(beforeUsd.availableBalance);

    const unknownAccount = await createPayoutAccount(
      apiContext,
      seller.accessToken,
      "unknown_then_paid:module17-unknown-9999",
    );
    const unknownRequested = await requestPayout(
      apiContext,
      seller.accessToken,
      unknownAccount.id,
      "10.0000",
    );
    await approvePayout(apiContext, adminToken, unknownRequested.id);

    const unknownSend = await sendPayout(apiContext, adminToken, unknownRequested.id);
    expect(unknownSend.status()).toBe(502);
    const processing = await readSellerPayout(apiContext, seller.accessToken, unknownRequested.id);
    expect(processing.status).toBe("processing");

    const duringUnknown = await readSellerWallet(apiContext, seller.accessToken);
    const duringUnknownUsd = duringUnknown.wallets.find((entry) => entry.currency === "USD");
    if (!duringUnknownUsd) throw new Error("USD Wallet disappeared during unknown provider state.");
    expect(moneyUnits(duringUnknownUsd.heldBalance) - moneyUnits(afterFailureUsd.heldBalance)).toBe(100_000n);

    const reconciledSend = await sendPayout(apiContext, adminToken, unknownRequested.id);
    expect(reconciledSend.status()).toBe(200);
    const reconciled = ((await reconciledSend.json()) as ApiEnvelope<Payout>).data;
    expect(reconciled.status).toBe("paid");

    const afterReconcile = await readSellerWallet(apiContext, seller.accessToken);
    const afterReconcileUsd = afterReconcile.wallets.find((entry) => entry.currency === "USD");
    if (!afterReconcileUsd) throw new Error("USD Wallet disappeared after provider reconciliation.");
    expect(afterReconcileUsd.heldBalance).toBe(beforeUsd.heldBalance);
  });

  test("appends a refund Commission/Wallet adjustment after payout without rewriting paid history", async () => {
    const paidBeforeRefund = await readSellerPayout(apiContext, seller.accessToken, paidPayout.id);
    expect(paidBeforeRefund.status).toBe("paid");

    const createdReturn = await createReturnRequest(
      apiContext,
      customerToken,
      sourceOrder.id,
      sourceSellerOrder.id,
      sourceOrderItem.id,
    );
    await approveReturn(apiContext, seller.accessToken, createdReturn.id);
    await issueRefund(apiContext, adminToken, createdReturn.id);

    const adjustedWallet = await waitForNegativeAdjustment(apiContext, seller.accessToken);
    const usd = adjustedWallet.wallets.find((entry) => entry.currency === "USD");
    if (!usd) throw new Error("USD Wallet disappeared after post-payout refund adjustment.");
    expect(moneyUnits(usd.negativeBalance)).toBeLessThan(0n);

    const commissionEntries = await listCommissionEntries(
      apiContext,
      adminToken,
      sourceSellerOrder.id,
    );
    expect(commissionEntries.some((entry) => entry.type === "sale")).toBe(true);
    expect(commissionEntries.some((entry) => entry.type === "refund")).toBe(true);

    const paidAfterRefund = await readSellerPayout(apiContext, seller.accessToken, paidPayout.id);
    expect(paidAfterRefund).toEqual(paidBeforeRefund);
  });
});
