import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Reads one UTF-8 project file for dependency-free structural verification. */
function readProjectFile(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

/** Requires one source fragment so contract drift fails loudly. */
function requireText(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`${label} is missing required fragment: ${fragment}`);
  }
}

/** Requires one project path to exist for the current pass. */
function requirePresent(relativePath, label) {
  if (!existsSync(join(root, relativePath))) {
    throw new Error(`${label} is missing: ${relativePath}`);
  }
}

/** Runs the released Module 11 structural gate before Module 12 checks. */
function verifyOrdersPrerequisite() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module11-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Module 11 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms frontend/backend remain independent projects rather than a root workspace. */
function verifyIndependentProjects() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }
}

/** Confirms the approved patch still freezes the Pass 4 provider/service decisions. */
function verifyPaymentsContractPatch() {
  const patch = readProjectFile("REQUIREMENTS_PATCH_0006.md");

  for (const decision of [
    "**Status: APPROVED additive contract patch for the current implementation.**",
    "Pass 4 — service/provider adapter",
    "capture_method = automatic",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_CURRENCY_EXPONENTS_JSON",
    "mkt_pi_<sha256(\"payments-intent-v1|<paymentId>|<normalized-key>\")>",
    "mkt_re_<sha256(\"payments-refund-v1|<paymentId>|<sourceKey>\")>",
    "Payments must not import the Orders repository.",
    "paymentExpiresAt = checkout_attempts.expires_at",
    "Provider capture when Order confirmation cannot complete",
    "pending provider refunds reserve their requested amount",
  ]) {
    requireText(patch, decision, "Module 12 approved Pass 4 decision");
  }
}

/** Confirms the completed Module 12 release keeps every required backend, frontend, and E2E layer. */
function verifyPassBoundary() {
  for (const path of [
    "marketplace-backend/src/modules/payments/payments.constants.ts",
    "marketplace-backend/src/modules/payments/payments.schema.ts",
    "marketplace-backend/src/modules/payments/payments.repository.ts",
    "marketplace-backend/src/modules/payments/payments.service.ts",
    "marketplace-backend/src/modules/payments/payments.jobs.ts",
    "marketplace-backend/src/modules/payments/payments.controller.ts",
    "marketplace-backend/src/modules/payments/payments.routes.ts",
    "marketplace-backend/src/modules/payments/index.ts",
    "marketplace-backend/src/integrations/payments/payment-provider.contract.ts",
    "marketplace-backend/src/integrations/payments/stripe/stripe-payment-provider.adapter.ts",
    "marketplace-backend/tests/module12/module12.schemas.test.ts",
    "marketplace-backend/tests/module12/module12.prerequisite-services.test.ts",
    "marketplace-backend/tests/module12/module12.repository.test.ts",
    "marketplace-backend/tests/module12/module12.service.test.ts",
    "marketplace-backend/tests/module12/module12.provider.test.ts",
    "marketplace-backend/tests/module12/module12.http.test.ts",
    "marketplace-backend/tests/module12/module12.integration.test.ts",
    "marketplace-backend/tests/module12/module12.test-helpers.ts",
    "marketplace-backend/scripts/run-module12-tests.mjs",
    "marketplace-frontend/src/features/payments/payments.constants.ts",
    "marketplace-frontend/src/features/payments/api/payments.api.ts",
    "marketplace-frontend/src/features/payments/hooks/use-payments.ts",
    "marketplace-frontend/src/features/payments/components/checkout-payment.tsx",
    "marketplace-frontend/src/features/payments/forms/payment-element-form.tsx",
    "marketplace-frontend/src/features/payments/components/payment-timeline.tsx",
    "marketplace-frontend/src/features/payments/forms/admin-payment-filter.form.tsx",
    "marketplace-frontend/src/features/payments/pages/payment-status.page.tsx",
    "marketplace-frontend/src/features/payments/pages/admin-payments.page.tsx",
    "marketplace-frontend/src/features/payments/pages/admin-payment-detail.page.tsx",
    "marketplace-frontend/src/features/payments/schemas/payments.schemas.ts",
    "marketplace-frontend/src/features/payments/types/payments.types.ts",
    "marketplace-frontend/src/app/routes/payments.routes.tsx",
    "marketplace-frontend/tests/module12-payments.test.tsx",
    "marketplace-frontend/e2e/module12.spec.ts",
    "marketplace-frontend/e2e/support/fake-stripe-server.mjs",
    "marketplace-backend/scripts/verify-module12-release-data.mjs",
    "scripts/verify-module12.mjs",
  ]) {
    requirePresent(path, "Module 12 completed artifact");
  }

  const migrationDirectory = join(root, "marketplace-backend/drizzle");
  const migrations = readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  if (!migrations.includes("0024_payments_persistence.sql")) {
    throw new Error("Module 12 release must retain migration 0024_payments_persistence.sql.");
  }
  const migrationNumbers = migrations
    .map((name) => Number(name.slice(0, 4)))
    .sort((left, right) => left - right);
  if (migrationNumbers.some((number, index) => index > 0 && number <= migrationNumbers[index - 1])) {
    throw new Error("Marketplace migrations must remain append-only and uniquely numbered.");
  }

  const backendPackage = readProjectFile("marketplace-backend/package.json");
  const frontendPackage = readProjectFile("marketplace-frontend/package.json");
  requireText(backendPackage, '"stripe":', "Backend Stripe runtime dependency");
  requireText(frontendPackage, '"@stripe/stripe-js":', "Frontend Stripe.js dependency");
  requireText(frontendPackage, '"@stripe/react-stripe-js":', "Frontend React Stripe.js dependency");
  requireText(frontendPackage, '"test:module12": "vitest run tests/module12-payments.test.tsx"', "Focused Module 12 frontend test command");
  requireText(frontendPackage, '"test:e2e:module12": "playwright test e2e/module12.spec.ts"', "Focused Module 12 Playwright command");
  requireText(backendPackage, '"test:module12:release-data": "node scripts/verify-module12-release-data.mjs"', "Module 12 release-data command");
}

/** Confirms the approved Payment permissions, runtime routes, OpenAPI paths, and schemas remain intact. */
function verifyPaymentContracts() {
  const constants = readProjectFile("marketplace-backend/src/modules/payments/payments.constants.ts");
  const routes = readProjectFile("marketplace-backend/src/modules/payments/payments.routes.ts");
  const schema = readProjectFile("marketplace-backend/src/modules/payments/payments.schema.ts");

  for (const permission of [
    "payments.read_own",
    "admin.payments.read",
    "admin.payments.refund",
    "system.payments.webhook",
  ]) {
    requireText(constants, permission, "Module 12 permission");
  }

  // Verify the executable route definitions instead of keeping a second, unused path constant map.
  for (const route of [
    '"/order/:orderId/intent"',
    '"/order/:orderId"',
    '"/webhooks/stripe"',
    '"/:id/refund"',
    '"/api/v1/payments/order/{orderId}/intent"',
    '"/api/v1/payments/order/{orderId}"',
    '"/api/v1/payments/webhooks/stripe"',
    '"/api/v1/admin/payments"',
    '"/api/v1/admin/payments/{id}"',
    '"/api/v1/internal/payments/{id}/refund"',
  ]) {
    requireText(routes, route, "Module 12 executable/OpenAPI route");
  }

  for (const contract of [
    "paymentMoneySchema",
    "paymentIntentHeadersSchema",
    "stripeWebhookHeadersSchema",
    "paymentIntentResponseSchema",
    "customerPaymentStatusSchema",
    "adminPaymentListQuerySchema",
    "adminPaymentDetailSchema",
    "internalRefundBodySchema",
  ]) {
    requireText(schema, contract, "Module 12 Zod contract");
  }

  requireText(schema, 'clientSecret: z.string().min(1).nullable()', "Intent-only client secret");
  if (/customerPaymentStatusSchema[\s\S]{0,800}clientSecret/.test(schema)) {
    throw new Error("Ordinary customer Payment status must not expose clientSecret.");
  }
}

/** Confirms Stripe SDK types remain behind the provider-neutral adapter boundary. */
function verifyProviderBoundary() {
  const providerContractPath = "marketplace-backend/src/integrations/payments/payment-provider.contract.ts";
  const stripeAdapterPath =
    "marketplace-backend/src/integrations/payments/stripe/stripe-payment-provider.adapter.ts";
  const provider = readProjectFile(providerContractPath);
  const stripe = readProjectFile(stripeAdapterPath);

  for (const method of [
    "createPaymentIntent",
    "retrievePaymentIntent",
    "cancelPaymentIntent",
    "verifyAndParseWebhook",
    "createRefund",
    "retrieveRefund",
  ]) {
    requireText(provider, method, "Payment provider-neutral adapter method");
    requireText(stripe, method, "Stripe adapter implementation");
  }

  requireText(provider, "ProviderMinorAmount = string", "Exact provider minor-unit representation");
  if (/from\s+["']stripe["']|Stripe\.[A-Za-z_]/.test(provider)) {
    throw new Error("Provider-neutral Payment contract must not depend on Stripe SDK types.");
  }

  for (const fragment of [
    'import Stripe from "stripe"',
    'capture_method: "automatic"',
    "automatic_payment_methods",
    "this.client.webhooks.constructEvent",
    "metadata: {",
    "paymentId: input.metadata.paymentId",
    "orderId: input.metadata.orderId",
    "idempotencyKey: input.providerIdempotencyKey",
    'status === "requires_capture"',
    "BigInt(value)",
  ]) {
    requireText(stripe, fragment, "Stripe Pass 4 adapter behavior");
  }

  const sourceRoots = [
    join(root, "marketplace-backend/src/modules/payments"),
    join(root, "marketplace-backend/src/integrations/payments"),
  ];
  for (const sourceRoot of sourceRoots) {
    for (const file of walkFiles(sourceRoot)) {
      if (file.endsWith("stripe-payment-provider.adapter.ts")) continue;
      const text = readFileSync(file, "utf8");
      if (/from\s+["']stripe["']|Stripe\.[A-Za-z_]/.test(text)) {
        throw new Error(`Stripe SDK usage leaked outside the adapter: ${file}`);
      }
    }
  }
}

/** Recursively lists ordinary files for small dependency-free source checks. */
function walkFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}

/** Confirms Module 11 exposes only service boundaries required by Payments. */
function verifyOrdersPaymentBoundary() {
  const service = readProjectFile("marketplace-backend/src/modules/orders/orders.service.ts");

  for (const fragment of [
    "export interface OrderPaymentSnapshot",
    "getPaymentSnapshot(",
    "listOverduePaymentOrderCandidates(",
    "expireUnpaidOrder(",
    "confirmPayment(",
    "static using(transaction",
    "paymentExpiresAt: boundary.paymentExpiresAt.toISOString()",
  ]) {
    requireText(service, fragment, "Orders Payment service boundary");
  }

  for (const file of [
    "marketplace-backend/src/modules/payments/payments.constants.ts",
    "marketplace-backend/src/modules/payments/payments.schema.ts",
    "marketplace-backend/src/modules/payments/payments.repository.ts",
    "marketplace-backend/src/modules/payments/payments.service.ts",
    "marketplace-backend/src/modules/payments/payments.jobs.ts",
    "marketplace-backend/src/modules/payments/payments.controller.ts",
    "marketplace-backend/src/modules/payments/payments.routes.ts",
    "marketplace-backend/src/modules/payments/index.ts",
  ]) {
    const content = readProjectFile(file);
    if (content.includes("orders.repository")) {
      throw new Error(`Payments must not import OrdersRepository: ${file}`);
    }
  }
}

/** Confirms the Pass 3 repository primitives needed by service/refund reconciliation remain present. */
function verifyPaymentsRepository() {
  const repository = readProjectFile("marketplace-backend/src/modules/payments/payments.repository.ts");

  for (const method of [
    "createPayment(",
    "findPaymentForCustomer(",
    "lockPaymentById(",
    "lockPaymentByProviderPaymentId(",
    "attachProviderPayment(",
    "updatePaymentTotals(",
    "createTransaction(",
    "findTransactionById(",
    "lockTransactionById(",
    "updateTransactionResult(",
    "findTransactionBySourceKey(",
    "findTransactionByProviderTxnId(",
    "getPendingRefundTotal(",
    "createWebhookEvent(",
    "lockWebhookEvent(",
    "markWebhookProcessing(",
    "markWebhookFinished(",
    "markWebhookFailed(",
  ]) {
    requireText(repository, method, "Module 12 repository method");
  }

  requireText(repository, ".onConflictDoNothing", "Race-safe Payment/webhook creation");
  requireText(repository, "processedAt: null", "Webhook retry state cleanup");
  requireText(repository, "PAYMENT_TRANSACTION_STATUS.PENDING", "Pending refund reservation query");

  for (const forbidden of [
    'from "stripe"',
    "verifyAndParseWebhook",
    "OrdersService",
    "OutboxService",
    "AuditService",
    'from "express"',
  ]) {
    if (repository.includes(forbidden)) {
      throw new Error(`Payments repository contains a forbidden service/provider concern: ${forbidden}`);
    }
  }
}

/** Confirms Pass 4 service implements authoritative intent, webhook, refund, expiry, and reconciliation logic. */
function verifyPaymentsService() {
  const service = readProjectFile("marketplace-backend/src/modules/payments/payments.service.ts");

  for (const method of [
    "async createPaymentIntent(",
    "async getCustomerPaymentStatus(",
    "async listAdminPayments(",
    "async getAdminPaymentDetail(",
    "async processStripeWebhook(",
    "async refundPayment(",
    "async reconcileCapture(",
    "async reconcileRefund(",
    "async expireUnpaidPayment(",
    "async expireOverdueOrders(",
  ]) {
    requireText(service, method, "Payments Pass 4 service method");
  }

  for (const behavior of [
    "new IdempotencyService()",
    "AuditService.using(db)",
    "OutboxService.using(transaction)",
    "AdministrationService",
    "OrdersService.using(transaction)",
    "PAYMENT_IDEMPOTENCY_SCOPE_PREFIX",
    "JSON.stringify({ version: PAYMENT_REQUEST_VERSION.INTENT, orderId })",
    "sha256(normalizedKey)",
    "mkt_pi_${sha256(",
    "mkt_re_${sha256(",
    "BigInt(",
    "getPendingRefundTotal(payment.id)",
    "PAYMENTS_OUTBOX_EVENT.CAPTURED",
    "PAYMENTS_OUTBOX_EVENT.REFUNDED",
    "PAYMENTS_OUTBOX_EVENT.WEBHOOK_FAILED",
    "enqueueCaptureReconciliation",
    "enqueueRefundReconciliation",
    "enqueueExpiry",
    "ordersUsingTransaction(savepoint).confirmPayment",
    "PAYMENTS_RECONCILIATION_ERROR_CODE.ORDER_CONFIRMATION_FAILED",
    "provider.verifyAndParseWebhook",
    "provider.cancelPaymentIntent",
    "listOverduePaymentOrderCandidates(context, limit)",
    "payments:order-expiry:${candidate.orderId}",
  ]) {
    requireText(service, behavior, "Payments Pass 4 service behavior");
  }

  if (/parseFloat|parseInt\([^,]*amount|Number\([^)]*(amount|grandTotal|amountCaptured|amountRefunded)/.test(service)) {
    throw new Error("Payments service must not use floating-point/Number money arithmetic.");
  }
  if (/from\s+["']stripe["']|Stripe\.[A-Za-z_]/.test(service)) {
    throw new Error("Payments service must stay provider-neutral and must not import Stripe SDK types.");
  }
  if (/clientSecret[^\n]*audit|metadata:\s*\{[^}]*clientSecret/s.test(service)) {
    throw new Error("Payments service must not audit/persist client secrets.");
  }
}

/** Confirms the Payments worker is now composed with the shared service and closes cleanly. */
function verifyPaymentsJobs() {
  const constants = readProjectFile("marketplace-backend/src/modules/payments/payments.constants.ts");
  const jobs = readProjectFile("marketplace-backend/src/modules/payments/payments.jobs.ts");
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const server = readProjectFile("marketplace-backend/src/server.ts");

  for (const name of [
    "payments-reconciliation",
    "capture-order-reconciliation",
    "refund-provider-reconciliation",
    "expire-unpaid-payment",
    "scan-overdue-unpaid-orders",
  ]) {
    requireText(constants, name, "Payments job constant");
  }
  for (const fn of [
    "enqueuePaymentCaptureReconciliationJob",
    "enqueuePaymentRefundReconciliationJob",
    "enqueuePaymentExpiryJob",
    "createPaymentsWorker",
    "startPaymentsRuntime",
    "upsertJobScheduler",
  ]) {
    requireText(jobs, fn, "Payments job boundary");
  }

  requireText(app, "paymentsService = defaultComposition.paymentsService", "Shared Payments service export");
  requireText(server, "startPaymentsRuntime(paymentsService)", "Payments runtime startup composition");
  requireText(server, "await paymentsRuntime.close()", "Payments runtime graceful shutdown");
}

/** Confirms Pass 5 publishes exactly six thin HTTP operations with raw Stripe webhook handling. */
function verifyPaymentsHttp() {
  const controller = readProjectFile("marketplace-backend/src/modules/payments/payments.controller.ts");
  const routes = readProjectFile("marketplace-backend/src/modules/payments/payments.routes.ts");
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const openApi = readProjectFile("marketplace-backend/src/http/openapi/openapi.document.ts");
  const seed = readProjectFile("marketplace-backend/src/database/seeds/platform-rbac.seed.ts");

  for (const method of [
    "createPaymentIntent = async",
    "getCustomerPaymentStatus = async",
    "processStripeWebhook = async",
    "listAdminPayments = async",
    "getAdminPaymentDetail = async",
    "refundPayment = async",
  ]) {
    requireText(controller, method, "Payments controller method");
  }

  for (const runtimeRoute of [
    'router.post(\n    "/order/:orderId/intent"',
    'router.get(\n    "/order/:orderId"',
    '"/webhooks/stripe"',
    'router.get(\n    "/"',
    'router.get(\n    "/:id"',
    'router.post("/:id/refund"',
  ]) {
    requireText(routes, runtimeRoute, "Payments runtime route");
  }

  for (const security of [
    "requirePermission(PAYMENTS_PERMISSION.READ_OWN)",
    "requirePermission(PAYMENTS_PERMISSION.ADMIN_READ)",
    "router.use(internalServiceMiddleware)",
    'express.raw({ type: "application/json", limit: appConfig.bodyLimit })',
  ]) {
    requireText(routes, security, "Payments HTTP security/raw-body wiring");
  }

  for (const path of [
    '"/api/v1/payments/order/{orderId}/intent"',
    '"/api/v1/payments/order/{orderId}"',
    '"/api/v1/payments/webhooks/stripe"',
    '"/api/v1/admin/payments"',
    '"/api/v1/admin/payments/{id}"',
    '"/api/v1/internal/payments/{id}/refund"',
  ]) {
    requireText(routes, path, "Payments OpenAPI path");
  }

  const rawMount = 'app.use(`${API_V1_PREFIX}/payments`, paymentsWebhookRouter);';
  requireText(app, rawMount, "Raw Stripe webhook application mount");
  requireText(app, 'app.use(`${API_V1_PREFIX}/payments`, paymentsRouter);', "Customer Payments application mount");
  requireText(app, 'app.use(`${API_V1_PREFIX}/admin/payments`, adminPaymentsRouter);', "Admin Payments application mount");
  requireText(app, 'app.use(`${API_V1_PREFIX}/internal/payments`, internalPaymentsRouter);', "Internal Payments application mount");

  if (app.indexOf(rawMount) > app.indexOf("app.use(express.json")) {
    throw new Error("Stripe webhook raw-body router must be mounted before express.json().");
  }

  requireText(openApi, "...paymentsOpenApiPaths", "Central Payments OpenAPI registration");
  requireText(seed, "...PAYMENTS_PERMISSION_CATALOG", "Payments RBAC permission catalog composition");
  requireText(seed, "PAYMENTS_PERMISSION.READ_OWN", "Customer payments.read_own grant");
  requireText(seed, "permission.code !== PAYMENTS_PERMISSION.SYSTEM_WEBHOOK", "System webhook permission user-role exclusion");

  for (const forbidden of [".repository.js", "/database/", 'from "stripe"']) {
    if (controller.includes(forbidden)) {
      throw new Error(`Payments controller bypasses the service/provider boundary through ${forbidden}.`);
    }
  }
}

/** Confirms backend-only Stripe runtime configuration and secret redaction are present. */
function verifyStripeConfigurationAndRedaction() {
  const envFile = readProjectFile("marketplace-backend/src/config/env.ts");
  const envExample = readProjectFile("marketplace-backend/.env.example");
  const logger = readProjectFile("marketplace-backend/src/common/logger/logger.ts");
  const frontendEnv = existsSync(join(root, "marketplace-frontend/.env.example"))
    ? readProjectFile("marketplace-frontend/.env.example")
    : "";

  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_CURRENCY_EXPONENTS_JSON",
  ]) {
    requireText(envFile, key, "Stripe backend environment schema");
    requireText(envExample, key, "Stripe backend environment example");
  }

  for (const redaction of [
    "req.headers.stripe-signature",
    "req.headers.idempotency-key",
    "clientSecret",
    "client_secret",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    requireText(logger, redaction, "Payment secret logger redaction");
  }

  if (frontendEnv.includes("STRIPE_SECRET_KEY") || frontendEnv.includes("STRIPE_WEBHOOK_SECRET")) {
    throw new Error("Stripe backend secrets must never appear in the frontend environment example.");
  }
}

/** Confirms Pass 7 implements only the approved Stripe handoff/status/admin/timeline React surface. */
function verifyPaymentsFrontend() {
  const api = readProjectFile("marketplace-frontend/src/features/payments/api/payments.api.ts");
  const hooks = readProjectFile("marketplace-frontend/src/features/payments/hooks/use-payments.ts");
  const checkout = readProjectFile("marketplace-frontend/src/features/payments/components/checkout-payment.tsx");
  const element = readProjectFile("marketplace-frontend/src/features/payments/forms/payment-element-form.tsx");
  const statusPage = readProjectFile("marketplace-frontend/src/features/payments/pages/payment-status.page.tsx");
  const adminPage = readProjectFile("marketplace-frontend/src/features/payments/pages/admin-payments.page.tsx");
  const detailPage = readProjectFile("marketplace-frontend/src/features/payments/pages/admin-payment-detail.page.tsx");
  const timeline = readProjectFile("marketplace-frontend/src/features/payments/components/payment-timeline.tsx");
  const filter = readProjectFile("marketplace-frontend/src/features/payments/forms/admin-payment-filter.form.tsx");
  const routes = readProjectFile("marketplace-frontend/src/app/routes/payments.routes.tsx");
  const router = readProjectFile("marketplace-frontend/src/app/router/router.tsx");
  const checkoutPage = readProjectFile("marketplace-frontend/src/features/checkout/pages/checkout.page.tsx");
  const test = readProjectFile("marketplace-frontend/tests/module12-payments.test.tsx");
  const envSource = readProjectFile("marketplace-frontend/src/lib/env.ts");
  const envExample = readProjectFile("marketplace-frontend/.env.example");

  for (const endpoint of [
    '`/payments/order/${orderId}/intent`',
    '`/payments/order/${orderId}`',
    '"/admin/payments"',
    '`/admin/payments/${paymentId}`',
  ]) {
    requireText(api, endpoint, "Module 12 frontend API");
  }
  requireText(api, '"Idempotency-Key": idempotencyKey', "PaymentIntent retry header");
  if (api.includes("/internal/payments") || api.includes("/internal/orders")) {
    throw new Error("Module 12 frontend must never call trusted internal Payment/Order routes.");
  }

  requireText(hooks, "useQuery({", "Module 12 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 12 TanStack mutation ownership");
  requireText(filter, "useForm({", "Module 12 TanStack Form finance filters");
  requireText(filter, "adminPaymentFilterSchema", "Module 12 Zod finance filters");
  requireText(checkout, "<Elements", "Checkout Stripe Elements provider");
  requireText(checkout, "Continue to secure payment", "Checkout Payment handoff");
  requireText(element, "<PaymentElement", "Stripe Payment Element");
  requireText(element, 'redirect: "if_required"', "Stripe confirm redirect behavior");
  requireText(element, '/payments/orders/${orderId}', "Provider return URL");
  requireText(statusPage, "Browser redirect parameters never mark an Order paid", "Provider-authoritative status wording");
  requireText(adminPage, "Payment search", "Finance Payment search UI");
  requireText(detailPage, "Transaction timeline", "Finance transaction timeline UI");
  requireText(timeline, "Refund reference:", "Refund reference display");
  requireText(checkoutPage, "<CheckoutPayment orderId={attemptStatus.data.orderId}", "Checkout-to-Payments integration");

  for (const route of [
    'path: "/payments/orders/$orderId"',
    'path: "/admin/payments"',
    'path: "/admin/payments/$paymentId"',
  ]) {
    requireText(routes, route, "Module 12 frontend route");
  }
  for (const registration of ["paymentStatusRoute", "adminPaymentsRoute", "adminPaymentDetailRoute"]) {
    requireText(router, registration, "Module 12 router registration");
  }

  requireText(envSource, "VITE_STRIPE_PUBLISHABLE_KEY", "Frontend Stripe publishable-key validation");
  requireText(envExample, "VITE_STRIPE_PUBLISHABLE_KEY=pk_test_", "Frontend Stripe publishable-key example");
  for (const forbidden of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "sk_test_", "whsec_"]) {
    if (envExample.includes(forbidden)) {
      throw new Error(`Frontend environment example contains backend Stripe secret material: ${forbidden}`);
    }
  }

  for (const proof of [
    "redirect query says succeeded",
    "payments.read_own is missing",
    "searches finance Payments",
    "refund provider reference",
    "lets Stripe.js handle card confirmation",
  ]) {
    requireText(test, proof, "Module 12 RTL/MSW proof");
  }
}

/** Confirms Pass 6 covers service/provider/Supertest/PostgreSQL/idempotency/refund/reconciliation behavior. */
function verifyFocusedTests() {
  const packageJson = readProjectFile("marketplace-backend/package.json");
  const repositoryTest = readProjectFile("marketplace-backend/tests/module12/module12.repository.test.ts");
  const serviceTest = readProjectFile("marketplace-backend/tests/module12/module12.service.test.ts");
  const providerTest = readProjectFile("marketplace-backend/tests/module12/module12.provider.test.ts");
  const httpTest = readProjectFile("marketplace-backend/tests/module12/module12.http.test.ts");
  const integrationTest = readProjectFile("marketplace-backend/tests/module12/module12.integration.test.ts");
  const runner = readProjectFile("marketplace-backend/scripts/run-module12-tests.mjs");
  const loggerTest = readProjectFile("marketplace-backend/tests/unit/logger-redaction.test.ts");

  for (const script of [
    '"test:module12:service"',
    '"test:module12:http"',
    '"test:module12:integration"',
    '"test:module12:specs"',
    '"test:module12": "node scripts/run-module12-tests.mjs"',
  ]) {
    requireText(packageJson, script, "Module 12 Pass 6 test command");
  }

  for (const proof of [
    "duplicate Payment creation without leaking a database uniqueness error",
    "webhook replay identity and exactly-once transaction source lookups",
    "sums only pending refund reservations with exact database numeric arithmetic",
  ]) {
    requireText(repositoryTest, proof, "Module 12 retained repository proof");
  }

  for (const proof of [
    "exact provider minor units",
    "Foundation idempotency replay",
    "Foundation idempotency conflict",
    "already-captured Payment",
    "without querying the provider",
    "expires an overdue Order even when the customer never created a Payment row",
    "provider-aware Payment expiry path",
    "lacks payments.read_own",
  ]) {
    requireText(serviceTest, proof, "Module 12 focused service proof");
  }

  for (const proof of [
    "automatic-capture PaymentIntents",
    "requires_capture",
    "exact raw webhook bytes/signature",
    "provider Refund status/identity",
  ]) {
    requireText(providerTest, proof, "Module 12 provider-adapter proof");
  }

  for (const proof of [
    "approved authentication boundaries",
    "rejects client-controlled PaymentIntent fields",
    "never exposes client secrets",
    "finance search/detail",
    "forbiddenCustomer",
    "before persisting unverified webhook payloads",
    "trusted internal refund body",
  ]) {
    requireText(httpTest, proof, "Module 12 Supertest HTTP proof");
  }

  for (const proof of [
    "reuses an active provider intent",
    "duplicate webhooks as replay",
    "without marking Payment or Order paid",
    "preserves provider capture when Order confirmation fails",
    "partial/full refunds",
    "concurrent refunds",
    "authoritative reconciliation result once",
    "expires an overdue unpaid Payment",
    "expires an overdue unpaid Order with no Payment row exactly once and releases its Inventory reservation",
    "source-key reuse with a different amount",
  ]) {
    requireText(integrationTest, proof, "Module 12 PostgreSQL regression proof");
  }

  for (const proof of [
    "test:module12:migrations",
    "test:module12:specs",
    "test:module11:specs",
    "test:regression:contracts",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, proof, "Module 12 full backend gate");
  }

  for (const secret of [
    '"stripe-signature": "should-never-appear"',
    '"idempotency-key": "should-never-appear"',
    'clientSecret: "should-never-appear"',
    'STRIPE_SECRET_KEY: "should-never-appear"',
    'STRIPE_WEBHOOK_SECRET: "should-never-appear"',
  ]) {
    requireText(loggerTest, secret, "Module 12 logger-redaction proof");
  }
}


/** Confirms the final browser/provider workflow and post-browser data gate prove Module 12 invariants. */
function verifyPass8ReleaseGate() {
  const e2e = readProjectFile("marketplace-frontend/e2e/module12.spec.ts");
  const providerTestServer = readProjectFile("marketplace-frontend/e2e/support/fake-stripe-server.mjs");
  const runner = readProjectFile("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const releaseData = readProjectFile("marketplace-backend/scripts/verify-module12-release-data.mjs");
  const releaseVerifier = readProjectFile("scripts/verify-module12.mjs");
  const env = readProjectFile("marketplace-backend/src/config/env.ts");
  const adapter = readProjectFile(
    "marketplace-backend/src/integrations/payments/stripe/stripe-payment-provider.adapter.ts",
  );

  for (const proof of [
    "Browser redirect parameters never mark an Order paid.",
    "redirect_status=succeeded",
    "await sendStripeWebhook(apiContext, rawWebhook, signature);",
    "/internal/payments/${intent.paymentId}/refund",
    'getByRole("heading", { name: "Payment search" })',
    'getByRole("heading", { name: "Transaction timeline" })',
  ]) {
    requireText(e2e, proof, "Module 12 Playwright release proof");
  }
  if ((e2e.match(/await sendStripeWebhook\(apiContext, rawWebhook, signature\);/g) ?? []).length < 2) {
    throw new Error("Module 12 Playwright must replay the exact signed webhook at least twice.");
  }

  for (const proof of [
    'url.pathname === "/v1/payment_intents"',
    "const paymentIntentMatch = url.pathname.match",
    'url.pathname === "/v1/refunds"',
    "const succeedMatch = url.pathname.match",
  ]) {
    requireText(providerTestServer, proof, "Local Stripe-compatible provider-test server");
  }

  for (const proof of [
    '"test:module12"',
    '"verify"',
    '"e2e/module12.spec.ts"',
    '"test:module12:release-data"',
    "verifyLiveOpenApi",
    "buildReleaseContainers",
    "fakeStripeServer",
  ]) {
    requireText(runner, proof, "Module 12 cumulative E2E release runner");
  }

  for (const proof of [
    "Module 12 provider-test PaymentIntent E2E",
    "Module 12 processed signed Stripe webhook E2E",
    "Payment to Order amount/currency reconciliation",
    "Payment aggregate capture/refund reconciliation",
    "Duplicate signed capture side effects",
    "Module 12 post-E2E Payments integrity verification passed.",
  ]) {
    requireText(releaseData, proof, "Module 12 post-browser database proof");
  }

  requireText(env, "STRIPE_API_BASE_URL", "Non-production Stripe provider-test configuration");
  requireText(
    env,
    "STRIPE_API_BASE_URL is only allowed outside production",
    "Production Stripe provider-test restriction",
  );
  requireText(adapter, "env.STRIPE_API_BASE_URL", "Stripe adapter provider-test endpoint support");
  for (const proof of [
    '"verify-module12-static.mjs"',
    '"verify-frontend-feature-contracts.mjs"',
    '["run", "test:e2e:ci"]',
    "Module 12 Payments full release verification completed successfully.",
  ]) {
    requireText(releaseVerifier, proof, "Module 12 final release verifier");
  }
}

verifyOrdersPrerequisite();
verifyIndependentProjects();
verifyPaymentsContractPatch();
verifyPassBoundary();
verifyPaymentContracts();
verifyProviderBoundary();
verifyOrdersPaymentBoundary();
verifyPaymentsRepository();
verifyPaymentsService();
verifyPaymentsJobs();
verifyPaymentsHttp();
verifyStripeConfigurationAndRedaction();
verifyPaymentsFrontend();
verifyFocusedTests();
verifyPass8ReleaseGate();

console.log("Module 12 Pass 8 E2E/release verification passed.");
