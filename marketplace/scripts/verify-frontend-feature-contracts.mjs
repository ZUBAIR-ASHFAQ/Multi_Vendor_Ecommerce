import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const frontendRoot = join(root, "frontend");

/** Reads one required UTF-8 frontend file and reports a useful relative path when missing. */
function readFrontendFile(relativePath) {
  const absolutePath = join(frontendRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required frontend file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Requires one stable source fragment that proves an intended frontend behavior. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required behavior: ${expected}`);
  }
}

/** Rejects one source fragment that would recreate an unnecessary frontend dependency or pass artifact. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Confirms the independent frontend still uses the required React/TanStack/Zod/Axios stack. */
function verifyRequiredStack() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const dependencies = packageJson.dependencies ?? {};

  for (const dependency of [
    "react",
    "@tanstack/react-router",
    "@tanstack/react-query",
    "@tanstack/react-form",
    "zod",
    "axios",
  ]) {
    if (!dependencies[dependency]) {
      throw new Error(`Required frontend dependency is missing: ${dependency}`);
    }
  }

  for (const unnecessaryStore of ["redux", "@reduxjs/toolkit", "zustand", "mobx"]) {
    if (dependencies[unnecessaryStore]) {
      throw new Error(`Server state must remain in TanStack Query; remove ${unnecessaryStore}.`);
    }
  }
}

/** Confirms every currently released business feature keeps its API/hooks/forms/pages organization. */
function verifyReleasedFeatureFolders() {
  const featureFolders = [
    "administration",
    "auth",
    "customers",
    "sellers",
    "catalog-taxonomy",
    "products",
    "inventory",
    "search-discovery",
    "cart-wishlist",
    "promotions",
    "checkout",
    "orders",
    "payments",
    "shipping",
    "returns-refunds",
    "commissions",
    "seller-wallet-payouts",
    "reviews",
    "notifications",
    "reports",
    "dashboard",
    "documents-audit",
  ];

  for (const feature of featureFolders) {
    const featurePath = join(frontendRoot, "src/features", feature);
    if (!existsSync(featurePath) || !statSync(featurePath).isDirectory()) {
      throw new Error(`Released frontend feature folder is missing: src/features/${feature}`);
    }
  }

  const requiredTests = [
    "tests/module2-auth.test.tsx",
    "tests/module2-administration.test.tsx",
    "tests/module21-documents-audit.test.tsx",
    "tests/module3-customers.test.tsx",
    "tests/module4-sellers.test.tsx",
    "tests/module5-catalog-taxonomy.test.tsx",
    "tests/module6-products.test.tsx",
    "tests/module7-inventory.test.tsx",
    "tests/module19-search-discovery.test.tsx",
    "tests/module8-cart-wishlist.test.tsx",
    "tests/module9-promotions.test.tsx",
    "tests/module10-checkout.test.tsx",
    "tests/module11-orders.test.tsx",
    "tests/module12-payments.test.tsx",
    "tests/module13-shipping.test.tsx",
    "tests/module14-returns-refunds.test.tsx",
    "tests/module16-commissions.test.tsx",
    "tests/module17-seller-wallet-payouts.test.tsx",
    "tests/module15-reviews.test.tsx",
    "tests/module18-notifications.test.tsx",
    "tests/module20-reports.test.tsx",
    "tests/module1-dashboard.test.tsx",
  ];

  for (const testFile of requiredTests) readFrontendFile(testFile);
}

/** Collects frontend TypeScript source files recursively for lightweight quality checks. */
function frontendSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...frontendSourceFiles(absolutePath));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

/** Confirms feature code stays simple, commented, stack-aligned, and free of obvious dead scaffolding. */
function verifyFrontendSourceHygiene() {
  const sourceRoot = join(frontendRoot, "src");
  const featureRoot = join(sourceRoot, "features");
  const sourceFiles = frontendSourceFiles(sourceRoot);
  const featureFiles = frontendSourceFiles(featureRoot);

  for (const file of featureFiles) {
    const source = readFileSync(file, "utf8");
    const relativePath = file.slice(frontendRoot.length + 1);

    if (source.trim().length === 0) {
      throw new Error(`Empty frontend source file should be deleted: ${relativePath}`);
    }
    if (source.includes("marketplace-backend") || source.includes("@/../marketplace-backend")) {
      throw new Error(`Frontend must not import backend source: ${relativePath}`);
    }
    if (source.includes("apiClient.") && !relativePath.includes("/api/")) {
      throw new Error(`Feature API calls must stay inside the feature api/ folder: ${relativePath}`);
    }
    if (/\/hooks\/use-[^/]+\.ts$/.test(relativePath) && !source.includes("@tanstack/react-query")) {
      throw new Error(`Feature server-state hook must use TanStack Query: ${relativePath}`);
    }
    if (/\/forms\/.*\.tsx$/.test(relativePath) && !relativePath.endsWith("payment-element-form.tsx")) {
      if (!source.includes("useForm({")) {
        throw new Error(`Feature form must use TanStack Form: ${relativePath}`);
      }
      if (!source.includes("validators:")) {
        throw new Error(`Feature form must connect its Zod validation contract: ${relativePath}`);
      }
    }
  }

  const namedFunctionPatterns = [
    /^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    /^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()\n]*\)|[A-Za-z_$][\w$]*)\s*=>/gm,
  ];

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const pattern of namedFunctionPatterns) {
      for (const match of source.matchAll(pattern)) {
        const lineIndex = source.slice(0, match.index).split("\n").length - 1;
        let previous = lineIndex - 1;
        while (previous >= 0 && lines[previous].trim() === "") previous -= 1;
        const previousLine = previous >= 0 ? lines[previous].trim() : "";
        const hasComment =
          previousLine.startsWith("//") ||
          previousLine.startsWith("/*") ||
          previousLine.endsWith("*/");
        if (!hasComment) {
          const relativePath = file.slice(frontendRoot.length + 1);
          throw new Error(`Named function ${match[2]} needs a short purpose comment: ${relativePath}`);
        }
      }
    }
  }

  const paymentSchemas = readFrontendFile("src/features/payments/schemas/payments.schemas.ts");
  rejectText(paymentSchemas, "AdminPaymentFilterValues", "Dead Payment filter type cleanup");
}

/** Confirms list-style administration pages expose a clear empty state instead of a blank panel. */
function verifyAdministrationEmptyStates() {
  const rolesPage = readFrontendFile("src/features/administration/pages/roles.page.tsx");
  const tests = readFrontendFile("tests/module2-administration.test.tsx");

  requireText(rolesPage, "roles.data?.items.length === 0", "Administration Roles empty state");
  requireText(rolesPage, "No roles found.", "Administration Roles empty-state message");
  requireText(
    tests,
    "shows an explicit empty state when the role catalog has no rows",
    "Administration Roles empty-state regression test",
  );
}

/** Confirms Search form validation is visible on the field that the user must correct. */
function verifySearchValidation() {
  const form = readFrontendFile(
    "src/features/search-discovery/forms/search-filters.form.tsx",
  );
  const schema = readFrontendFile(
    "src/features/search-discovery/schemas/search-discovery.schemas.ts",
  );
  const tests = readFrontendFile("tests/module19-search-discovery.test.tsx");

  requireText(form, 'name="maxPrice"', "Search maximum-price field");
  requireText(form, "const error = firstFieldError(field.state.meta.errors);", "Search field validation UI");
  requireText(form, 'aria-invalid={Boolean(error)}', "Search accessible maximum-price error state");
  requireText(schema, 'path: ["maxPrice"]', "Search price-range validation path");
  requireText(
    schema,
    "Maximum price must be greater than or equal to minimum price.",
    "Search price-range validation message",
  );
  requireText(tests, "invalid maximum price and an inverted price range", "Search validation regression test");
  requireText(tests, 'toHaveAttribute("aria-invalid", "true")', "Search accessible validation test");
}

/** Confirms safe API request IDs reach generic form and Search error states for support/debugging. */
function verifyRequestIdErrors() {
  const formError = readFrontendFile("src/features/auth/components/form-error.tsx");
  const productPage = readFrontendFile(
    "src/features/search-discovery/pages/search-products.page.tsx",
  );
  const storePage = readFrontendFile(
    "src/features/search-discovery/pages/search-stores.page.tsx",
  );
  const feedbackTests = readFrontendFile("tests/feedback.test.tsx");
  const searchTests = readFrontendFile("tests/module19-search-discovery.test.tsx");

  requireText(formError, "Request ID: {requestId}", "Generic form error support reference");
  requireText(productPage, "requestId={results.error instanceof ApiClientError", "Product Search request ID");
  requireText(storePage, "requestId={stores.error instanceof ApiClientError", "Store Search request ID");
  requireText(feedbackTests, "req-form-123", "Generic form request-ID regression test");
  requireText(searchTests, "req-search-123", "Search request-ID regression test");
}


/** Confirms protected frontend query failures expose safe support context and an explicit retry path. */
function verifyProtectedQueryRecovery() {
  const authenticatedPanel = readFrontendFile(
    "src/features/auth/components/authenticated-panel.tsx",
  );
  const usersPage = readFrontendFile(
    "src/features/administration/pages/users.page.tsx",
  );
  const rolesPage = readFrontendFile(
    "src/features/administration/pages/roles.page.tsx",
  );
  const settingsPage = readFrontendFile(
    "src/features/administration/pages/settings.page.tsx",
  );
  const userDetailPage = readFrontendFile(
    "src/features/administration/pages/user-detail.page.tsx",
  );
  const roleDetailPage = readFrontendFile(
    "src/features/administration/pages/role-detail.page.tsx",
  );
  const authTests = readFrontendFile("tests/module2-auth.test.tsx");
  const administrationTests = readFrontendFile(
    "tests/module2-administration.test.tsx",
  );

  requireText(
    authenticatedPanel,
    "onRetry={() => void currentUser.refetch()}",
    "Authenticated account retry state",
  );
  requireText(
    authenticatedPanel,
    "currentUser.error.requestId",
    "Authenticated account request ID",
  );

  for (const [source, queryName, label] of [
    [usersPage, "users", "Administration users"],
    [rolesPage, "roles", "Administration roles"],
    [settingsPage, "query", "Administration settings"],
    [userDetailPage, "user", "Administration user detail"],
    [roleDetailPage, "role", "Administration role detail"],
  ]) {
    requireText(source, `onRetry={() => void ${queryName}.refetch()}`, `${label} retry state`);
  }

  requireText(
    userDetailPage,
    "onRetry={() => void roles.refetch()}",
    "Administration user-role catalog retry state",
  );
  requireText(
    roleDetailPage,
    "onRetry={() => void permissions.refetch()}",
    "Administration permission-matrix retry state",
  );
  requireText(
    authTests,
    "shows a safe account error and retries the authenticated actor request",
    "Authenticated account retry regression test",
  );
  requireText(
    administrationTests,
    "shows a safe users error and retries the failed query",
    "Administration query retry regression test",
  );
}

/** Confirms Module 8 frontend state remains TanStack-owned, preview-only, and route-compatible. */
function verifyCartWishlistFeature() {
  const api = readFrontendFile(
    "src/features/cart-wishlist/api/cart-wishlist.api.ts",
  );
  const hooks = readFrontendFile(
    "src/features/cart-wishlist/hooks/use-cart-wishlist.ts",
  );
  const quantityForm = readFrontendFile(
    "src/features/cart-wishlist/forms/cart-quantity.form.tsx",
  );
  const cartPage = readFrontendFile(
    "src/features/cart-wishlist/pages/cart.page.tsx",
  );
  const wishlistCard = readFrontendFile(
    "src/features/cart-wishlist/components/wishlist-item-card.tsx",
  );
  const miniCart = readFrontendFile(
    "src/features/cart-wishlist/components/mini-cart.tsx",
  );
  const layout = readFrontendFile(
    "src/features/cart-wishlist/components/cart-wishlist-layout.tsx",
  );
  const tests = readFrontendFile("tests/module8-cart-wishlist.test.tsx");

  for (const endpoint of [
    'apiClient.get("/cart")',
    'apiClient.post("/cart/items", input)',
    'apiClient.delete("/cart")',
    'apiClient.get("/wishlist")',
    'apiClient.post("/wishlist/items", input)',
  ]) {
    requireText(api, endpoint, "Module 8 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 8 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 8 TanStack mutation ownership");
  requireText(
    hooks,
    "const cart = await cartWishlistApi.addCartItem",
    "Wishlist move-to-Cart first step",
  );
  requireText(
    hooks,
    "const wishlist = await cartWishlistApi.removeWishlistItem",
    "Wishlist move-to-Cart safe second step",
  );
  requireText(quantityForm, "useForm({", "Module 8 TanStack Form quantity validation");
  requireText(
    quantityForm,
    "cartQuantityFormSchema",
    "Module 8 Zod quantity validation",
  );
  requireText(
    cartPage,
    "Shipping, promotions, tax, final pricing and stock are confirmed during Checkout.",
    "Cart preview-only language",
  );
  requireText(
    cartPage,
    "Inventory is not reserved yet.",
    "Cart Inventory non-reservation language",
  );
  requireText(wishlistCard, "Move to Cart", "Wishlist move action");
  requireText(miniCart, "load = true", "Mini Cart active/passive mode");
  requireText(miniCart, "useCartQuery(load)", "Global cached mini Cart subscription");
  requireText(
    layout,
    'const isCustomer = user.accountType === "customer";',
    "Module 8 account-type permission guard",
  );
  for (const [testName, label] of [
    [
      "keeps the Wishlist item when move-to-Cart fails",
      "Wishlist safe move conflict state",
    ],
    [
      "does not preload Cart data for a non-customer actor even if a stale permission is present",
      "Module 8 permission-state regression test",
    ],
    [
      "blocks an invalid Cart quantity before the PATCH request",
      "Module 8 validation-state regression test",
    ],
    [
      "shows the safe request ID and retries Cart loading",
      "Module 8 retry-state regression test",
    ],
  ]) {
    requireText(tests, testName, label);
  }
}

/** Confirms Module 9 owns the required frontend feature surface without inventing Checkout or extra APIs. */
function verifyPromotionsFeature() {
  const api = readFrontendFile("src/features/promotions/api/promotions.api.ts");
  const hooks = readFrontendFile("src/features/promotions/hooks/use-promotions.ts");
  const form = readFrontendFile("src/features/promotions/forms/promotion.form.tsx");
  const schemas = readFrontendFile("src/features/promotions/schemas/promotions.schemas.ts");
  const scopeSelector = readFrontendFile("src/features/promotions/components/promotion-scope-selector.tsx");
  const couponManager = readFrontendFile("src/features/promotions/components/coupon-manager.tsx");
  const couponField = readFrontendFile("src/features/promotions/components/coupon-field.tsx");
  const discountBreakdown = readFrontendFile("src/features/promotions/components/discount-breakdown.tsx");
  const adminPage = readFrontendFile("src/features/promotions/pages/admin-promotions.page.tsx");
  const sellerPage = readFrontendFile("src/features/promotions/pages/seller-promotions.page.tsx");
  const routes = readFrontendFile("src/app/routes/promotions.routes.tsx");
  const cartPage = readFrontendFile("src/features/cart-wishlist/pages/cart.page.tsx");
  const tests = readFrontendFile("tests/module9-promotions.test.tsx");

  for (const endpoint of [
    'apiClient.get("/admin/promotions"',
    'apiClient.post("/admin/promotions", input)',
    'apiClient.patch(`/admin/promotions/${promotionId}`, input)',
    'apiClient.get("/seller/promotions"',
    'apiClient.post("/seller/promotions", input)',
    'apiClient.get("/promotions/validate"',
    'apiClient.post(`/admin/promotions/${promotionId}/activate`, {})',
    'apiClient.post(`/admin/promotions/${promotionId}/deactivate`, {})',
  ]) {
    requireText(api, endpoint, "Module 9 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 9 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 9 TanStack mutation ownership");
  requireText(form, "useForm({", "Module 9 TanStack Form editor");
  requireText(form, "promotionFormSchema", "Module 9 Zod form validation");
  requireText(form, "Ownership, funding owner, and lifecycle status are derived by the server", "Module 9 client-authority warning");
  requireText(schemas, "Percentage promotion value must not exceed 100.", "Module 9 percentage validation");
  requireText(scopeSelector, "Eligibility scopes", "Module 9 eligibility scope selector");
  requireText(couponManager, "Coupon manager", "Module 9 coupon manager");
  requireText(couponField, "Checkout coupon code", "Module 9 reusable Checkout coupon field");
  requireText(discountBreakdown, "Preview only. Checkout must revalidate", "Module 9 discount preview boundary");
  requireText(adminPage, "Promotions & Coupons", "Module 9 platform promotion list/editor");
  requireText(adminPage, "onRetry={() => void promotions.refetch()}", "Module 9 list retry state");
  requireText(adminPage, "requestId={promotions.error instanceof ApiClientError", "Module 9 safe request-ID state");
  requireText(sellerPage, "Lifecycle changes remain platform-controlled", "Module 9 seller lifecycle authority boundary");
  requireText(sellerPage, "Campaigns", "Module 9 seller promotion history");
  requireText(routes, 'path: "/admin/promotions"', "Module 9 admin route");
  requireText(routes, 'path: "/seller/promotions"', "Module 9 seller route");
  requireText(cartPage, "<CouponField />", "Module 9 coupon field composition with current Cart");

  for (const proof of [
    "creates a platform promotion without sending client-owned funding or seller authority",
    "blocks an invalid percentage before the promotion API request",
    "shows safe list request context and retries a failed administrator query",
    "creates a seller-funded promotion without exposing seller ownership fields in the form payload",
    "validates a checkout coupon from the current Cart and renders the server discount breakdown",
    "shows a coupon conflict with its safe request ID",
  ]) {
    requireText(tests, proof, "Module 9 frontend regression test");
  }

  rejectText(api, 'apiClient.delete(', "Module 9 no generic delete API");
  rejectText(routes, "/checkout", "Module 9 no fake Checkout route");
}


/** Confirms Module 10 owns the required React Checkout surface while Payment remains downstream. */
function verifyCheckoutFeature() {
  const api = readFrontendFile("src/features/checkout/api/checkout.api.ts");
  const hooks = readFrontendFile("src/features/checkout/hooks/use-checkout.ts");
  const form = readFrontendFile("src/features/checkout/forms/checkout-quote.form.tsx");
  const schemas = readFrontendFile("src/features/checkout/schemas/checkout.schemas.ts");
  const page = readFrontendFile("src/features/checkout/pages/checkout.page.tsx");
  const summary = readFrontendFile("src/features/checkout/components/checkout-quote-summary.tsx");
  const warning = readFrontendFile("src/features/checkout/components/checkout-change-warning.tsx");
  const routes = readFrontendFile("src/app/routes/checkout.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const cartPage = readFrontendFile("src/features/cart-wishlist/pages/cart.page.tsx");
  const tests = readFrontendFile("tests/module10-checkout.test.tsx");
  const packageJson = JSON.parse(readFrontendFile("package.json"));

  for (const endpoint of [
    'apiClient.get("/checkout/shipping-options"',
    'apiClient.post("/checkout/quote", input)',
    'apiClient.get(`/checkout/quote/${quoteId}`)',
    'apiClient.post(',
    '`/checkout/quote/${quoteId}/confirm`',
    'apiClient.get(`/checkout/${attemptId}/status`)',
  ]) {
    requireText(api, endpoint, "Module 10 frontend API");
  }
  requireText(api, '"Idempotency-Key": idempotencyKey', "Checkout idempotency header");
  requireText(hooks, "useQuery({", "Module 10 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 10 TanStack mutation ownership");
  requireText(form, "useForm({", "Module 10 TanStack Form ownership");
  requireText(form, "checkoutQuoteFormSchema", "Module 10 Zod form validation");
  requireText(form, "Choose one delivery method for every seller in your order.", "Checkout seller shipment groups");
  requireText(schemas, "checkoutShippingSelectionFormSchema", "Checkout shipping-selection validation");
  requireText(page, "Your order is created only after the latest price and stock checks pass.", "Checkout authoritative recalculation language");
  requireText(page, "Confirm & pay", "Checkout confirm-and-pay action");
  requireText(page, "Payment is completed only after secure confirmation from Stripe.", "Checkout Payment state separation");
  requireText(summary, "Totals are locked to this short-lived review.", "Checkout authoritative quote summary");
  requireText(summary, "checkout-summary-delivery", "Checkout seller shipment summary");
  requireText(warning, "Please review the latest totals before placing your order.", "Checkout stale-state warning");
  requireText(routes, 'path: "/checkout"', "Checkout customer route");
  requireText(router, "checkoutRoute", "Checkout router registration");
  requireText(cartPage, '<Link to="/checkout">Proceed to Checkout</Link>', "Cart to Checkout navigation");

  for (const proof of [
    "creates an authoritative quote without sending client totals and confirms it with the required retry key",
    "shows a quote-change warning with the safe request ID when confirmation detects a stale price",
    "shows an expired-quote warning and disables confirmation until the customer recalculates",
    "blocks the Checkout feature before Cart or address reads when the customer lacks checkout.create_own",
    "requires an active saved address before requesting Shipping Core options",
  ]) {
    requireText(tests, proof, "Module 10 frontend regression test");
  }

  if (packageJson.scripts?.["test:module10"] !== "vitest run tests/module10-checkout.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 10 RTL/MSW suite.");
  }
  if (packageJson.scripts?.["test:e2e:module10"] !== "playwright test e2e/module10.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 10 Playwright suite.");
  }

  rejectText(page, "Payment successful", "Checkout must not claim Payment success");
}


/** Confirms Module 11 owns customer, seller, admin, and released browser Order workflows without Payment UI leakage. */
function verifyOrdersFeature() {
  const api = readFrontendFile("src/features/orders/api/orders.api.ts");
  const hooks = readFrontendFile("src/features/orders/hooks/use-orders.ts");
  const schemas = readFrontendFile("src/features/orders/schemas/orders.schemas.ts");
  const cancellation = readFrontendFile("src/features/orders/forms/order-cancellation.form.tsx");
  const customerList = readFrontendFile("src/features/orders/pages/customer-orders.page.tsx");
  const customerDetail = readFrontendFile("src/features/orders/pages/customer-order-detail.page.tsx");
  const sellerList = readFrontendFile("src/features/orders/pages/seller-orders.page.tsx");
  const sellerDetail = readFrontendFile("src/features/orders/pages/seller-order-detail.page.tsx");
  const adminPage = readFrontendFile("src/features/orders/pages/admin-orders.page.tsx");
  const routes = readFrontendFile("src/app/routes/orders.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const tests = readFrontendFile("tests/module11-orders.test.tsx");
  const packageJson = JSON.parse(readFrontendFile("package.json"));

  for (const endpoint of [
    'apiClient.get("/orders"',
    'apiClient.get(`/orders/${orderId}`)',
    'apiClient.post(`/orders/${orderId}/cancel`',
    'apiClient.get("/seller/orders"',
    'apiClient.get(`/seller/orders/${sellerOrderId}`)',
    'apiClient.post(`/seller/orders/${sellerOrderId}/accept`, {})',
    'apiClient.get("/admin/orders"',
    'apiClient.post(`/admin/orders/${orderId}/cancel`',
  ]) {
    requireText(api, endpoint, "Module 11 frontend API");
  }
  requireText(api, '"Idempotency-Key": idempotencyKey', "Orders cancellation idempotency header");
  requireText(hooks, "useQuery({", "Module 11 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 11 TanStack mutation ownership");
  requireText(schemas, "customerOrderDetailSchema", "Module 11 customer Order response validation");
  requireText(schemas, "sellerOrderDetailSchema", "Module 11 Seller Order response validation");
  requireText(cancellation, "useForm({", "Module 11 TanStack Form cancellation flow");
  requireText(cancellation, "orderCancellationFormSchema", "Module 11 Zod cancellation validation");
  requireText(customerList, 'title="Your Orders"', "Module 11 parent/child UI separation");
  requireText(customerDetail, "Order timeline", "Module 11 customer timeline");
  requireText(sellerList, "Seller Order queue", "Module 11 seller queue");
  requireText(sellerDetail, "Accept Seller Order", "Module 11 seller acceptance command");
  requireText(adminPage, "Order support", "Module 11 admin support search");

  for (const route of [
    'path: "/orders"',
    'path: "/orders/$orderId"',
    'path: "/seller/orders"',
    'path: "/seller/orders/$sellerOrderId"',
    'path: "/admin/orders"',
  ]) {
    requireText(routes, route, "Module 11 frontend route");
  }
  for (const registration of [
    "customerOrdersRoute",
    "customerOrderDetailRoute",
    "sellerOrdersRoute",
    "sellerOrderDetailRoute",
    "adminOrdersRoute",
  ]) {
    requireText(router, registration, "Module 11 router registration");
  }

  for (const proof of [
    "renders customer parent Order history without treating Seller Orders as the customer list model",
    "renders immutable customer Order detail and sends a partial cancellation with a retry key",
    "blocks customer Order reads before calling the API when orders.read_own is missing",
    "renders only seller-scoped Seller Orders and accepts one paid fulfillment unit without client status fields",
    "hides Seller Order acceptance when the actor has read permission but not seller.orders.manage",
    "searches admin Orders with allow-listed filters and performs privileged whole-Order cancellation",
    "shows the safe request ID when customer Order history fails",
  ]) {
    requireText(tests, proof, "Module 11 frontend regression test");
  }

  if (packageJson.scripts?.["test:module11"] !== "vitest run tests/module11-orders.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 11 RTL/MSW suite.");
  }
  const e2e = readFrontendFile("e2e/module11.spec.ts");
  requireText(e2e, "Module 11 Orders E2E", "Module 11 Playwright suite");
  if (packageJson.scripts?.["test:e2e:module11"] !== "playwright test e2e/module11.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 11 Playwright suite.");
  }
  rejectText(api, "/internal/orders", "Module 11 frontend must not call trusted internal Payment routes");
  rejectText(sellerDetail, "payment-confirmed", "Seller UI must not fake Payment confirmation");
}

/** Confirms Module 12 owns the approved Stripe handoff/status/finance UI without trusted-route leakage. */
function verifyPaymentsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/payments/api/payments.api.ts");
  const hooks = readFrontendFile("src/features/payments/hooks/use-payments.ts");
  const element = readFrontendFile("src/features/payments/forms/payment-element-form.tsx");
  const checkoutPayment = readFrontendFile("src/features/payments/components/checkout-payment.tsx");
  const statusPage = readFrontendFile("src/features/payments/pages/payment-status.page.tsx");
  const adminPage = readFrontendFile("src/features/payments/pages/admin-payments.page.tsx");
  const detailPage = readFrontendFile("src/features/payments/pages/admin-payment-detail.page.tsx");
  const filter = readFrontendFile("src/features/payments/forms/admin-payment-filter.form.tsx");
  const timeline = readFrontendFile("src/features/payments/components/payment-timeline.tsx");
  const routes = readFrontendFile("src/app/routes/payments.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const tests = readFrontendFile("tests/module12-payments.test.tsx");
  const envSource = readFrontendFile("src/lib/env.ts");
  const envExample = readFrontendFile(".env.example");

  for (const dependency of ["@stripe/react-stripe-js", "@stripe/stripe-js"]) {
    if (!packageJson.dependencies?.[dependency]) {
      throw new Error(`Module 12 frontend dependency is missing: ${dependency}`);
    }
  }

  for (const endpoint of [
    '`/payments/order/${orderId}/intent`',
    '`/payments/order/${orderId}`',
    '"/admin/payments"',
    '`/admin/payments/${paymentId}`',
  ]) {
    requireText(api, endpoint, "Module 12 frontend API");
  }
  rejectText(api, "/internal/payments", "Module 12 browser API");
  rejectText(api, "/internal/orders", "Module 12 browser API");
  requireText(api, '"Idempotency-Key": idempotencyKey', "Module 12 PaymentIntent retry key");
  requireText(hooks, "useQuery({", "Module 12 TanStack Query state");
  requireText(hooks, "useMutation({", "Module 12 TanStack mutation state");
  requireText(filter, "useForm({", "Module 12 TanStack Form filters");
  requireText(filter, "adminPaymentFilterSchema", "Module 12 Zod filter validation");
  requireText(checkoutPayment, "<Elements", "Module 12 Stripe Elements provider");
  requireText(element, "<PaymentElement", "Module 12 Stripe Payment Element");
  requireText(element, 'redirect: "if_required"', "Module 12 Stripe redirect policy");
  requireText(statusPage, "Browser redirect parameters never mark an Order paid", "Module 12 provider-authoritative status");
  requireText(adminPage, "Payment search", "Module 12 finance search");
  requireText(detailPage, "Transaction timeline", "Module 12 finance detail");
  requireText(timeline, "Refund reference:", "Module 12 refund reference display");

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

  requireText(envSource, "VITE_STRIPE_PUBLISHABLE_KEY", "Module 12 frontend Stripe configuration");
  requireText(envExample, "VITE_STRIPE_PUBLISHABLE_KEY=pk_test_", "Module 12 publishable-key example");
  rejectText(envExample, "STRIPE_SECRET_KEY", "Frontend environment");
  rejectText(envExample, "STRIPE_WEBHOOK_SECRET", "Frontend environment");
  rejectText(envExample, "sk_test_", "Frontend environment");

  for (const proof of [
    "redirect query says succeeded",
    "payments.read_own is missing",
    "searches finance Payments",
    "refund provider reference",
    "lets Stripe.js handle card confirmation",
  ]) {
    requireText(tests, proof, "Module 12 RTL/MSW regression test");
  }

  if (packageJson.scripts?.["test:module12"] !== "vitest run tests/module12-payments.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 12 RTL/MSW suite.");
  }
  const e2e = readFrontendFile("e2e/module12.spec.ts");
  requireText(e2e, "Module 12 Payments E2E", "Module 12 Playwright suite");
  requireText(
    e2e,
    "Browser redirect parameters never mark an Order paid.",
    "Module 12 browser redirect non-authority proof",
  );
  requireText(e2e, "sendStripeWebhook", "Module 12 signed webhook proof");
  requireText(e2e, "/internal/payments/${intent.paymentId}/refund", "Module 12 refund handoff proof");
  if (packageJson.scripts?.["test:e2e:module12"] !== "playwright test e2e/module12.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 12 Playwright suite.");
  }
}

/** Confirms Module 16 owns rule management, seller statement, order breakdown, and finance ledger UI without trusted-route leakage. */
function verifyCommissionsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/commissions/api/commissions.api.ts");
  const hooks = readFrontendFile("src/features/commissions/hooks/use-commissions.ts");
  const ruleForm = readFrontendFile("src/features/commissions/forms/commission-rule.form.tsx");
  const sellerFilter = readFrontendFile("src/features/commissions/forms/seller-commission-filter.form.tsx");
  const rulePage = readFrontendFile("src/features/commissions/pages/admin-commission-rules.page.tsx");
  const sellerPage = readFrontendFile("src/features/commissions/pages/seller-commission-statement.page.tsx");
  const ledgerPage = readFrontendFile("src/features/commissions/pages/admin-commission-ledger.page.tsx");
  const breakdown = readFrontendFile("src/features/commissions/components/order-commission-breakdown.tsx");
  const routes = readFrontendFile("src/app/routes/commissions.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const tests = readFrontendFile("tests/module16-commissions.test.tsx");

  for (const endpoint of [
    '"/admin/commissions/rules"',
    '`/admin/commissions/rules/${ruleId}`',
    '"/seller/commissions"',
    '"/admin/commissions/entries"',
  ]) {
    requireText(api, endpoint, "Module 16 frontend API");
  }
  rejectText(api, "/internal/commissions", "Module 16 browser API");
  requireText(hooks, "useQuery({", "Module 16 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 16 TanStack mutation ownership");
  requireText(ruleForm, "useForm({", "Module 16 TanStack Form rule editor");
  requireText(ruleForm, "commissionRuleFormSchema", "Module 16 Zod rule validation");
  requireText(ruleForm, 'aria-label="Commission rule status"', "Module 16 status selector");
  requireText(ruleForm, "COMMISSION_RULE_STATUS.INACTIVE", "Module 16 inactive status option");
  rejectText(ruleForm, "fundingRulesJson:", "Module 16 core funding configuration");
  requireText(sellerFilter, "without exposing any seller-id input", "Module 16 seller-scope form language");
  rejectText(sellerFilter, 'name="sellerId"', "Module 16 seller-owned statement filter");
  requireText(rulePage, "Commission rule manager", "Module 16 Commission rule manager");
  requireText(sellerPage, "Seller fee statement", "Module 16 seller statement");
  requireText(ledgerPage, "Finance Commission ledger", "Module 16 finance ledger");
  requireText(breakdown, "Per-order Commission breakdown", "Module 16 per-order breakdown");
  rejectText(rulePage, "delete", "Module 16 immutable finance UI");
  rejectText(ledgerPage, "/internal/", "Module 16 finance browser surface");

  for (const route of [
    'path: "/admin/commissions/rules"',
    'path: "/admin/commissions/entries"',
    'path: "/seller/commissions"',
  ]) {
    requireText(routes, route, "Module 16 frontend route");
  }
  for (const registration of [
    "adminCommissionRulesRoute",
    "adminCommissionLedgerRoute",
    "sellerCommissionStatementRoute",
  ]) {
    requireText(router, registration, "Module 16 router registration");
  }

  for (const proof of [
    "rule manager read-only",
    "future-effective rule",
    'selectOptions(screen.getByLabelText("Commission rule status"), "inactive")',
    'not.toHaveProperty("fundingRulesJson")',
    "without ever sending a sellerId",
    "seller.commissions.read is missing",
    "filters the finance Commission ledger",
  ]) {
    requireText(tests, proof, "Module 16 RTL/MSW regression test");
  }

  if (packageJson.scripts?.["test:module16"] !== "vitest run tests/module16-commissions.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 16 RTL/MSW suite.");
  }

  const e2ePath = join(frontendRoot, "e2e/module16.spec.ts");
  if (!existsSync(e2ePath)) {
    throw new Error("Module 16 Playwright coverage is required after Pass 8.");
  }
  const e2e = readFrontendFile("e2e/module16.spec.ts");
  for (const proof of [
    "order-settle",
    "refund-adjust",
    "replayedSettlement",
    "updatedFutureRule",
    "sellerB",
    "full-refund Commission reversal",
  ]) {
    requireText(e2e, proof, "Module 16 Playwright proof");
  }
  if (packageJson.scripts?.["test:e2e:module16"] !== "playwright test e2e/module16.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 16 Playwright suite.");
  }
}

/** Confirms Module 13 frontend uses only approved Shipping APIs and server-owned lifecycle commands. */
function verifyShippingFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/shipping/api/shipping.api.ts");
  const hooks = readFrontendFile("src/features/shipping/hooks/use-shipping.ts");
  const createForm = readFrontendFile("src/features/shipping/forms/create-shipment.form.tsx");
  const trackingForm = readFrontendFile("src/features/shipping/forms/shipment-tracking.form.tsx");
  const routes = readFrontendFile("src/app/routes/shipping.routes.tsx");
  const tests = readFrontendFile("tests/module13-shipping.test.tsx");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.get("/seller/shipments"',
    'apiClient.post(`/seller/orders/${sellerOrderId}/shipments`',
    'apiClient.patch(`/seller/shipments/${shipmentId}/tracking`',
    'apiClient.post(`/seller/shipments/${shipmentId}/mark-shipped`',
    'apiClient.post(`/seller/shipments/${shipmentId}/mark-delivered`',
    'apiClient.get(`/orders/${orderId}/shipments`',
  ]) {
    requireText(api, endpoint, "Module 13 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 13 TanStack Query server-state ownership");
  requireText(hooks, "useMutation({", "Module 13 TanStack Query command ownership");
  requireText(createForm, "useForm({", "Module 13 TanStack Form creation state");
  requireText(createForm, "createShipmentFormSchema", "Module 13 Zod creation validation");
  requireText(trackingForm, "shipmentTrackingFormSchema", "Module 13 Zod tracking validation");
  requireText(trackingForm, "status", "Module 13 tracking source scan");

  for (const route of [
    'path: "/seller/shipments"',
    'path: "/seller/orders/$sellerOrderId/shipping"',
    'path: "/orders/$orderId/shipping"',
  ]) {
    requireText(routes, route, "Module 13 frontend route");
  }

  requireText(tests, "idempotent command", "Module 13 idempotency UI proof");
  requireText(tests, "customer-safe shipped/delivered", "Module 13 customer-safe UI proof");

  if (packageJson.scripts?.["test:module13"] !== "vitest run tests/module13-shipping.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 13 RTL/MSW suite.");
  }

  requireText(ci, "Run Module 13 Shipping frontend tests", "Module 13 frontend CI step");
  requireText(ci, "run: npm run test:module13", "Module 13 frontend CI command");
}

/** Confirms Module 14 frontend keeps Return/refund authority on the approved APIs and forms. */
function verifyReturnsRefundsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/returns-refunds/api/returns-refunds.api.ts");
  const hooks = readFrontendFile("src/features/returns-refunds/hooks/use-returns-refunds.ts");
  const requestForm = readFrontendFile("src/features/returns-refunds/forms/return-request.form.tsx");
  const inspectionForm = readFrontendFile("src/features/returns-refunds/forms/return-inspection.form.tsx");
  const refundForm = readFrontendFile("src/features/returns-refunds/forms/return-refund.form.tsx");
  const routes = readFrontendFile("src/app/routes/returns-refunds.routes.tsx");
  const tests = readFrontendFile("tests/module14-returns-refunds.test.tsx");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.post(`/orders/${orderId}/returns`',
    'apiClient.get("/returns"',
    'apiClient.get("/seller/returns"',
    'apiClient.post(`/seller/returns/${returnId}/approve`',
    'apiClient.post(`/seller/returns/${returnId}/reject`',
    'apiClient.post(`/seller/returns/${returnId}/receive`',
    'apiClient.post(`/returns/${returnId}/refund`',
    'apiClient.get("/admin/returns"',
  ]) {
    requireText(api, endpoint, "Module 14 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 14 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 14 TanStack Query commands");
  requireText(requestForm, "useForm({", "Module 14 Return Request form");
  requireText(requestForm, "returnRequestFormSchema", "Module 14 Zod Return Request validation");
  requireText(inspectionForm, "receiveReturnFormSchema", "Module 14 inspection validation");
  requireText(refundForm, "crypto.randomUUID()", "Module 14 refund idempotency key");

  for (const route of [
    'path: "/returns"',
    'path: "/orders/$orderId/returns/$sellerOrderId/new"',
    'path: "/seller/returns"',
    'path: "/admin/returns"',
  ]) {
    requireText(routes, route, "Module 14 frontend route");
  }

  requireText(tests, "potentially delivered quantity", "Module 14 customer eligibility UI proof");
  requireText(tests, "explicit server-owned commands", "Module 14 seller command UI proof");
  requireText(tests, "retry-safe key", "Module 14 refund idempotency UI proof");

  if (packageJson.scripts?.["test:module14"] !== "vitest run tests/module14-returns-refunds.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 14 RTL/MSW suite.");
  }
  requireText(ci, "Run Module 14 Returns/refunds frontend tests", "Module 14 frontend CI step");
  requireText(ci, "run: npm run test:module14", "Module 14 frontend CI command");
}

/** Confirms Module 15 frontend keeps Review authority server-side and uses only approved API operations. */
function verifyReviewsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/reviews/api/reviews.api.ts");
  const hooks = readFrontendFile("src/features/reviews/hooks/use-reviews.ts");
  const form = readFrontendFile("src/features/reviews/forms/review-editor.form.tsx");
  const publicSection = readFrontendFile("src/features/reviews/components/public-reviews-section.tsx");
  const moderation = readFrontendFile("src/features/reviews/components/admin-review-moderation-actions.tsx");
  const adminPage = readFrontendFile("src/features/reviews/pages/admin-reviews.page.tsx");
  const adminFilter = readFrontendFile("src/features/reviews/forms/admin-review-filter.form.tsx");
  const reviewRoute = readFrontendFile("src/app/routes/reviews.routes.tsx");
  const adminLayout = readFrontendFile("src/features/administration/components/admin-layout.tsx");
  const orderPage = readFrontendFile("src/features/orders/pages/customer-order-detail.page.tsx");
  const productPage = readFrontendFile("src/features/products/pages/public-product-detail.page.tsx");
  const storePage = readFrontendFile("src/features/sellers/pages/public-store.page.tsx");
  const tests = readFrontendFile("tests/module15-reviews.test.tsx");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.post("/reviews", input)',
    'apiClient.patch(`/reviews/${reviewId}`, input)',
    'apiClient.get(`/products/${productId}/reviews`',
    'apiClient.get(`/stores/${storeId}/reviews`',
    'apiClient.post(`/reviews/${reviewId}/helpful`, {})',
    'apiClient.get("/admin/reviews"',
    'apiClient.post(`/admin/reviews/${reviewId}/hide`, input)',
    'apiClient.post(`/admin/reviews/${reviewId}/publish`, input)',
  ]) {
    requireText(api, endpoint, "Module 15 frontend API");
  }

  requireText(hooks, "useAdminReviewsQuery", "Module 15 moderation queue query");
  requireText(hooks, "useQuery({", "Module 15 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 15 TanStack Query commands");
  requireText(form, "useForm({", "Module 15 TanStack Form editor");
  requireText(form, "reviewEditorFormSchema", "Module 15 Zod form validation");
  requireText(form, "orderItemId", "Module 15 purchased item submission");
  rejectText(form, "verifiedPurchase:", "Module 15 client-owned verified purchase");
  rejectText(form, "sellerId:", "Module 15 client-owned seller identity");
  rejectText(form, "status:", "Module 15 client-owned Review status");
  requireText(publicSection, "Only published verified-purchase Reviews are shown.", "Module 15 public list state");
  requireText(moderation, "useHideReviewMutation", "Module 15 hide moderation UI");
  requireText(moderation, "usePublishReviewMutation", "Module 15 publish moderation UI");
  requireText(adminPage, "Review moderation", "Module 15 admin moderation queue page");
  requireText(adminPage, "REVIEWS_PERMISSION.ADMIN_MODERATE", "Module 15 admin page permission gate");
  requireText(adminFilter, "adminReviewFilterFormSchema", "Module 15 admin queue filter validation");
  requireText(reviewRoute, 'path: "/admin/reviews"', "Module 15 admin moderation route");
  requireText(adminLayout, 'to="/admin/reviews"', "Module 15 admin navigation");
  requireText(reviewRoute, 'path: "/orders/$orderId/reviews/$orderItemId/new"', "Module 15 customer editor route");
  requireText(orderPage, "Write Review", "Module 15 delivered Order entry point");
  requireText(productPage, "ProductReviewsSection", "Module 15 Product Review integration");
  requireText(storePage, "StoreReviewsSection", "Module 15 Store Review integration");
  requireText(tests, "privacy-safe fields", "Module 15 public privacy regression");
  requireText(tests, "only Order Item and authored fields", "Module 15 request-authority regression");
  requireText(tests, "approved read route without customer identity", "Module 15 moderation queue privacy regression");
  requireText(tests, "two approved command endpoints", "Module 15 moderation command regression");

  if (packageJson.scripts?.["test:module15"] !== "vitest run tests/module15-reviews.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 15 RTL/MSW suite.");
  }
  requireText(ci, "Run Module 15 Reviews/Ratings frontend tests", "Module 15 frontend CI step");
  requireText(ci, "run: npm run test:module15", "Module 15 frontend CI command");
}


/** Confirms Module 18 frontend owns server-state queries, validated preferences, unread UI, and privacy-safe admin retries. */
function verifyNotificationsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/notifications/api/notifications.api.ts");
  const hooks = readFrontendFile("src/features/notifications/hooks/use-notifications.ts");
  const form = readFrontendFile("src/features/notifications/forms/notification-preference.form.tsx");
  const bell = readFrontendFile("src/features/notifications/components/notification-bell.tsx");
  const listPage = readFrontendFile("src/features/notifications/pages/notifications.page.tsx");
  const preferencesPage = readFrontendFile("src/features/notifications/pages/notification-preferences.page.tsx");
  const adminPage = readFrontendFile("src/features/notifications/pages/admin-notification-deliveries.page.tsx");
  const routes = readFrontendFile("src/app/routes/notifications.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const marketplaceHeader = readFrontendFile("src/components/layout/marketplace-header.tsx");
  const adminLayout = readFrontendFile("src/features/administration/components/admin-layout.tsx");
  const tests = readFrontendFile("tests/module18-notifications.test.tsx");
  const e2e = readFrontendFile("e2e/module18.spec.ts");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.get("/notifications"',
    'apiClient.post(`/notifications/${notificationId}/read`, {})',
    'apiClient.post("/notifications/read-all", {})',
    'apiClient.get("/notifications/preferences")',
    'apiClient.put("/notifications/preferences", input)',
    'apiClient.get("/admin/notification-deliveries"',
    'apiClient.post(`/admin/notification-deliveries/${deliveryId}/retry`, {})',
  ]) {
    requireText(api, endpoint, "Module 18 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 18 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 18 TanStack Query commands");
  requireText(hooks, "invalidateQueries", "Module 18 cache invalidation");
  requireText(form, "useForm({", "Module 18 TanStack Form preferences");
  requireText(form, "notificationPreferenceFormSchema", "Module 18 preference Zod validation");
  requireText(bell, "unreadCount", "Module 18 notification bell unread badge");
  requireText(listPage, "Mark all read", "Module 18 read-all UI");
  requireText(preferencesPage, "Mandatory security or transactional channels", "Module 18 server-authoritative preference policy copy");
  requireText(adminPage, "destinationMasked", "Module 18 privacy-safe admin delivery rendering");
  requireText(adminPage, "NOTIFICATIONS_PERMISSION.ADMIN_RETRY", "Module 18 admin retry permission hiding");
  requireText(routes, 'path: "/notifications"', "Module 18 list route");
  requireText(routes, 'path: "/notifications/preferences"', "Module 18 preferences route");
  requireText(routes, 'path: "/admin/notification-deliveries"', "Module 18 admin delivery route");
  requireText(router, "notificationsRoute", "Module 18 router registration");
  requireText(marketplaceHeader, "NotificationBell", "Module 18 global bell entry point");
  requireText(adminLayout, 'to="/admin/notification-deliveries"', "Module 18 admin navigation");
  requireText(tests, "bell unread count", "Module 18 unread/read-state regression");
  requireText(tests, "without sending user identity", "Module 18 preference authority regression");
  requireText(tests, "only masked failed-delivery data", "Module 18 delivery privacy regression");
  requireText(tests, "hides the privileged retry command", "Module 18 retry permission regression");
  requireText(e2e, "Module 18 Notifications E2E", "Module 18 browser workflow");
  requireText(e2e, "waitForNotification", "Module 18 asynchronous outbox/BullMQ proof");
  requireText(e2e, 'page.goto("/admin/notification-deliveries")', "Module 18 admin retry browser proof");

  if (packageJson.scripts?.["test:module18"] !== "vitest run tests/module18-notifications.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 18 RTL/MSW suite.");
  }
  if (packageJson.scripts?.["test:e2e:module18"] !== "playwright test e2e/module18.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 18 Playwright suite.");
  }
  requireText(ci, "Run Module 18 Notifications frontend tests", "Module 18 frontend CI step");
  requireText(ci, "run: npm run test:module18", "Module 18 frontend CI command");
}

/** Confirms the independent frontend owns a real cross-repository Playwright release gate. */
function verifyE2eReleaseGate() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const workflow = readFrontendFile(".github/workflows/e2e.yml");
  const runner = readFrontendFile("e2e/run-e2e-ci.mjs");

  if (packageJson.scripts?.["test:e2e:ci"] !== "node e2e/run-e2e-ci.mjs") {
    throw new Error("Frontend package.json must expose the permanent test:e2e:ci runner.");
  }

  requireText(
    workflow,
    "MARKETPLACE_BACKEND_REPOSITORY",
    "Cross-repository E2E workflow configuration",
  );
  requireText(workflow, "repository: ${{ env.BACKEND_REPOSITORY }}", "Independent backend checkout");
  requireText(workflow, "path: backend", "Independent backend checkout directory");
  requireText(workflow, "path: frontend", "Independent frontend checkout directory");
  requireText(
    workflow,
    "npx playwright install --with-deps chromium",
    "Playwright browser installation",
  );
  requireText(workflow, "node e2e/run-e2e-ci.mjs", "CI browser release runner");
  requireText(workflow, "actions/upload-artifact@v4", "Playwright failure artifacts");

  requireText(runner, '"docker", ["compose", "--profile", "module21"', "Disposable E2E infrastructure");
  requireText(runner, '"db:seed:module21-e2e"', "Deterministic browser fixture seed");
  requireText(runner, '"db:seed:module10-e2e"', "Module 10 Shipping Core E2E seed");
  requireText(runner, '"db:seed:module18-e2e"', "Module 18 failed-delivery E2E seed");
  requireText(runner, '"e2e/module2.spec.ts"', "Module 2 Playwright coverage");
  requireText(runner, '"e2e/module21.spec.ts"', "Module 21 Playwright coverage");
  requireText(runner, '"e2e/module3.spec.ts"', "Module 3 Playwright coverage");
  requireText(runner, '"e2e/module4.spec.ts"', "Module 4 Playwright coverage");
  requireText(runner, '"e2e/module5.spec.ts"', "Module 5 Playwright coverage");
  requireText(runner, '"e2e/module6.spec.ts"', "Module 6 Playwright coverage");
  requireText(runner, '"e2e/module7.spec.ts"', "Module 7 Playwright coverage");
  requireText(runner, '"e2e/module19.spec.ts"', "Module 19 Playwright coverage");
  requireText(runner, '"e2e/module8.spec.ts"', "Module 8 Playwright coverage");
  requireText(runner, '"e2e/module9.spec.ts"', "Module 9 Playwright coverage");
  requireText(runner, '"e2e/module10.spec.ts"', "Module 10 Playwright coverage");
  requireText(runner, '"e2e/module11.spec.ts"', "Module 11 Playwright coverage");
  requireText(runner, '"e2e/module12.spec.ts"', "Module 12 Playwright coverage");
  requireText(runner, '"e2e/module16.spec.ts"', "Module 16 Playwright coverage");
  requireText(runner, '"e2e/module13.spec.ts"', "Module 13 Playwright coverage");
  requireText(runner, '"e2e/module14.spec.ts"', "Module 14 Playwright coverage");
  requireText(runner, '"e2e/module18.spec.ts"', "Module 18 Playwright coverage");
  requireText(runner, '"test:module6:release-data"', "Product post-E2E integrity gate");
  requireText(runner, '"test:module7:release-data"', "Inventory post-E2E integrity gate");
  requireText(runner, '"test:module19:release-data"', "Search post-E2E integrity gate");
  requireText(runner, '"test:module8:release-data"', "Cart/Wishlist post-E2E integrity gate");
  requireText(runner, '"test:module9:release-data"', "Promotions post-E2E integrity gate");
  requireText(runner, '"test:module10:release-data"', "Checkout post-E2E integrity gate");
  requireText(runner, '"test:module11:release-data"', "Orders post-E2E integrity gate");
  requireText(runner, '"test:module12:release-data"', "Payments post-E2E integrity gate");
  requireText(runner, '"test:module16:release-data"', "Commissions post-E2E integrity gate");
  requireText(runner, '"test:module13:release-data"', "Shipping post-E2E integrity gate");
  requireText(runner, '"test:module14:release-data"', "Returns/refunds post-E2E integrity gate");
  requireText(runner, '"test:module18:release-data"', "Notifications post-E2E integrity gate");
  requireText(runner, '"test:module12"', "Payments backend regression gate");
  requireText(runner, '"test:module16"', "Commissions backend regression gate");
  requireText(runner, '"test:module13"', "Shipping backend regression gate");
  requireText(runner, '"test:module14"', "Returns/refunds backend regression gate");
  requireText(runner, '"test:module18"', "Notifications backend regression gate");
  requireText(runner, '"verify"', "Frontend full regression gate");
  requireText(runner, "fakeStripeServer", "Local Stripe-compatible provider-test server");
  requireText(runner, "buildReleaseContainers();", "Independent container build gate");
  requireText(runner, '"down", "-v"', "Disposable E2E infrastructure cleanup");
}


/** Confirms Module 20 frontend calls only the approved Reports API and keeps report authority on the server. */
function verifyReportsFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/reports/api/reports.api.ts");
  const hooks = readFrontendFile("src/features/reports/hooks/use-reports.ts");
  const form = readFrontendFile("src/features/reports/forms/report-filter.form.tsx");
  const routes = readFrontendFile("src/app/routes/reports.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const auditPage = readFrontendFile("src/features/documents-audit/pages/audit.page.tsx");
  const savedFilters = readFrontendFile("src/features/reports/components/saved-report-filters.tsx");
  const tests = readFrontendFile("tests/module20-reports.test.tsx");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.get("/reports/catalog")',
    'apiClient.get("/reports/sales"',
    'apiClient.get("/reports/sellers"',
    'apiClient.get("/reports/inventory"',
    'apiClient.get("/reports/refunds"',
    'apiClient.get("/reports/commissions"',
    'apiClient.get("/reports/payouts"',
    'apiClient.post("/reports/runs", input)',
    'apiClient.get(`/reports/runs/${runId}`)',
  ]) {
    requireText(api, endpoint, "Module 20 frontend API");
  }
  rejectText(api, "/audit/export", "Module 20 browser API");
  requireText(hooks, "useQuery({", "Module 20 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 20 TanStack Query exports");
  requireText(form, "useForm({", "Module 20 TanStack Form filters");
  requireText(form, "reportFilterFormSchema", "Module 20 Zod filter validation");
  requireText(form, 'user.accountType === "platform_admin"', "Module 20 seller-scope UI guard");
  requireText(savedFilters, "window.localStorage", "Module 20 browser-local saved filters");
  requireText(savedFilters, "approved Reports API has no saved-filter routes", "Module 20 saved-filter API boundary");

  for (const route of [
    'path: "/reports"',
    'path: "/reports/sales"',
    'path: "/reports/sellers"',
    'path: "/reports/inventory"',
    'path: "/reports/refunds"',
    'path: "/reports/commissions"',
    'path: "/reports/payouts"',
    'path: "/reports/runs/$runId"',
  ]) {
    requireText(routes, route, "Module 20 frontend route");
  }
  for (const registration of [
    "reportsCatalogRoute",
    "salesReportRoute",
    "sellersReportRoute",
    "inventoryReportRoute",
    "refundsReportRoute",
    "commissionsReportRoute",
    "payoutsReportRoute",
    "reportRunRoute",
  ]) {
    requireText(router, registration, "Module 20 router registration");
  }

  requireText(auditPage, "REPORT_CODE.AUDIT_LOG", "Approved Module 21 audit-export UI ownership");
  requireText(auditPage, "ReportExportControls", "Approved Module 21 audit-export action");
  rejectText(auditPage, "/audit/export", "Module 21 audit export route");

  for (const proof of [
    "permission-filtered report catalog",
    "GMV, captured cash, and refunds separately",
    "without pagination or sort",
    "browser-local saved filters",
    "Audit export action through Module 20",
  ]) {
    requireText(tests, proof, "Module 20 RTL/MSW regression test");
  }

  if (packageJson.scripts?.["test:module20"] !== "vitest run tests/module20-reports.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 20 RTL/MSW suite.");
  }
  requireText(ci, "Run Module 20 Reports frontend tests", "Module 20 frontend CI step");
  requireText(ci, "run: npm run test:module20", "Module 20 frontend CI command");
}

/** Confirms Module 1 frontend consumes only the documented Dashboard API with permission-safe server state. */
function verifyDashboardFeature() {
  const packageJson = JSON.parse(readFrontendFile("package.json"));
  const api = readFrontendFile("src/features/dashboard/api/dashboard.api.ts");
  const hooks = readFrontendFile("src/features/dashboard/hooks/use-dashboard.ts");
  const filterForm = readFrontendFile("src/features/dashboard/forms/dashboard-filter.form.tsx");
  const preferencesForm = readFrontendFile("src/features/dashboard/forms/dashboard-preferences.form.tsx");
  const savedFilters = readFrontendFile("src/features/dashboard/components/saved-dashboard-filters.tsx");
  const page = readFrontendFile("src/features/dashboard/pages/dashboard.page.tsx");
  const routes = readFrontendFile("src/app/routes/dashboard.routes.tsx");
  const router = readFrontendFile("src/app/router/router.tsx");
  const tests = readFrontendFile("tests/module1-dashboard.test.tsx");
  const ci = readFrontendFile(".github/workflows/ci.yml");

  for (const endpoint of [
    'apiClient.get("/dashboard/summary"',
    'apiClient.get("/dashboard/orders"',
    'apiClient.get("/dashboard/sellers"',
    'apiClient.get("/dashboard/alerts"',
    'apiClient.patch("/dashboard/preferences"',
  ]) {
    requireText(api, endpoint, "Module 1 frontend API");
  }
  rejectText(api, 'apiClient.post("/dashboard', "Module 1 frontend API");
  rejectText(api, 'apiClient.delete("/dashboard', "Module 1 frontend API");
  requireText(hooks, "useQuery({", "Module 1 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 1 TanStack Query preference write");
  requireText(filterForm, "useForm({", "Module 1 TanStack Form filters");
  requireText(filterForm, "dashboardFilterFormSchema", "Module 1 Zod filter validation");
  requireText(filterForm, 'user.accountType === "platform_admin"', "Module 1 seller-scope UI guard");
  requireText(preferencesForm, "dashboardPreferencesFormSchema", "Module 1 preference validation");
  requireText(savedFilters, "PATCH /dashboard/preferences", "Module 1 saved-filter API boundary");

  for (const requirement of [
    "Executive KPIs",
    "Orders & GMV trend",
    "Seller performance",
    "Operational alerts",
    "Refund & return summary",
    "Commission & payout summary",
  ]) {
    requireText(page + readFrontendFile("src/features/dashboard/components/dashboard-kpi-cards.tsx")
      + readFrontendFile("src/features/dashboard/components/dashboard-orders-trend.tsx")
      + readFrontendFile("src/features/dashboard/components/dashboard-seller-table.tsx")
      + readFrontendFile("src/features/dashboard/components/dashboard-alerts.tsx")
      + readFrontendFile("src/features/dashboard/components/dashboard-finance-summary.tsx"), requirement, "Module 1 Dashboard UI");
  }

  requireText(routes, 'path: "/dashboard"', "Module 1 frontend route");
  requireText(router, "dashboardRoute", "Module 1 router registration");
  for (const proof of [
    "Executive KPIs, trend, seller performance, alerts, refund/return, and separate finance values",
    "keeps seller identity server-derived and hides finance values without finance permission",
    "single documented preferences command without sending user identity",
    "widget-unavailable state instead of fabricating unsupported category history",
  ]) {
    requireText(tests, proof, "Module 1 RTL/MSW regression test");
  }

  if (packageJson.scripts?.["test:module1"] !== "vitest run tests/module1-dashboard.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 1 RTL/MSW suite.");
  }
  requireText(ci, "Run Module 1 Dashboard frontend tests", "Module 1 frontend CI step");
  requireText(ci, "run: npm run test:module1", "Module 1 frontend CI command");
}

/** Confirms production frontend source contains no historical pass/evidence narration. */
function verifyProductionCommentsStayBusinessFocused() {
  const sourceRoot = join(frontendRoot, "src");
  const files = [];

  /** Recursively collects frontend TypeScript files for the lightweight contract scan. */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(absolutePath);
    }
  }

  walk(sourceRoot);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    rejectText(source, "Pass 0", file);
    rejectText(source, "Pass 1", file);
    rejectText(source, "Pass 2", file);
    rejectText(source, "Pass 3", file);
    rejectText(source, "Pass 4", file);
    rejectText(source, "Pass 5", file);
    rejectText(source, "Pass 6", file);
    rejectText(source, "Pass 7", file);
    rejectText(source, "Pass 8", file);
    rejectText(source, "pass evidence", file);
  }
}

/** Runs the permanent frontend feature/readability contract gate. */
function main() {
  verifyRequiredStack();
  verifyReleasedFeatureFolders();
  verifyFrontendSourceHygiene();
  verifyAdministrationEmptyStates();
  verifySearchValidation();
  verifyRequestIdErrors();
  verifyProtectedQueryRecovery();
  verifyCartWishlistFeature();
  verifyPromotionsFeature();
  verifyCheckoutFeature();
  verifyOrdersFeature();
  verifyPaymentsFeature();
  verifyShippingFeature();
  verifyReturnsRefundsFeature();
  verifyReviewsFeature();
  verifyNotificationsFeature();
  verifyCommissionsFeature();
  verifyReportsFeature();
  verifyDashboardFeature();
  verifyE2eReleaseGate();
  verifyProductionCommentsStayBusinessFocused();
  console.log("Frontend feature-contract verification passed.");
}

main();
