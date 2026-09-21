import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const IMPLEMENTED_OPERATION_COUNT = 170;

/** Reads one UTF-8 project file and fails with a useful message when it is missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Normalizes path-parameter names so frontend templates can be compared with OpenAPI paths. */
function normalizedApiRoute(method, path) {
  const normalizedPath = path
    .replace(/\$\{[^}]+\}/g, "{}")
    .replace(/\{[^}]+\}/g, "{}");
  return `${method.toUpperCase()} ${normalizedPath}`;
}

/** Collects TypeScript API client files from one frontend feature tree. */
function frontendApiFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...frontendApiFiles(absolutePath));
    else if (entry.isFile() && entry.name.endsWith(".api.ts")) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** Collects frontend TypeScript source files so API methods can be checked for real production consumers. */
function frontendSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...frontendSourceFiles(absolutePath));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** Returns true when a declaration has a short purpose comment immediately above it. */
function hasPurposeComment(source, declarationIndex) {
  const lines = source.slice(0, declarationIndex).split("\n");
  let index = lines.length - 1;
  while (index >= 0 && lines[index].trim() === "") index -= 1;
  if (index < 0) return false;
  const previous = lines[index].trim();
  return (
    previous.startsWith("//") ||
    previous.startsWith("/*") ||
    previous.endsWith("*/")
  );
}

/** Extracts Axios client calls that use a literal or template API path. */
function frontendApiCalls(source) {
  const calls = [];
  const pattern = /apiClient\.(get|post|put|patch|delete)\(\s*([`"'])(.*?)\2/gs;
  for (const match of source.matchAll(pattern)) {
    const path = match[3];
    if (path.startsWith("/")) calls.push(normalizedApiRoute(match[1], path));
  }
  return calls;
}

/** Converts route registrations into stable METHOD path strings, including duplicate local paths. */
function runtimeRoutes(source) {
  const routes = [];
  const pattern = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes.sort();
}

/** Extracts one balanced object literal while ignoring braces inside strings and comments. */
function balancedObject(source, openBraceIndex) {
  let depth = 0;
  let stringQuote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (stringQuote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === stringQuote) stringQuote = null;
      continue;
    }

    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      stringQuote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, index + 1);
    }
  }

  throw new Error("Unclosed OpenAPI path object.");
}

/** Returns the HTTP method keys declared directly on one OpenAPI path item. */
function pathMethods(pathObject) {
  const methods = [];
  let depth = 1;
  let stringQuote = null;
  let escaped = false;

  for (let index = 1; index < pathObject.length - 1; index += 1) {
    const current = pathObject[index];

    if (stringQuote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === stringQuote) stringQuote = null;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      stringQuote = current;
      continue;
    }
    if (current === "{") {
      depth += 1;
      continue;
    }
    if (current === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 1 || !/[A-Za-z]/.test(current)) continue;

    const match = pathObject.slice(index).match(/^([A-Za-z]+)\s*:/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (HTTP_METHODS.has(key)) methods.push(key.toUpperCase());
    index += match[0].length - 1;
  }

  return methods.sort();
}

/** Reads every /api/v1 OpenAPI path and its exact methods from one route-owned registry. */
function openApiRoutes(source) {
  const routes = [];
  const pattern = /["'](\/api\/v1\/[^"']+)["']\s*:\s*\{/g;

  for (const match of source.matchAll(pattern)) {
    const path = match[1];
    const braceIndex = source.indexOf("{", match.index + match[0].length - 1);
    const object = balancedObject(source, braceIndex);
    for (const method of pathMethods(object)) routes.push(`${method} ${path}`);
  }

  return routes.sort();
}

/** Compares two route lists and reports the missing or unexpected operations clearly. */
function assertExactRoutes(actual, expected, label) {
  const actualCopy = [...actual];
  const expectedCopy = [...expected].sort();
  const missing = [];

  for (const route of expectedCopy) {
    const index = actualCopy.indexOf(route);
    if (index < 0) missing.push(route);
    else actualCopy.splice(index, 1);
  }

  if (missing.length || actualCopy.length) {
    throw new Error(
      `${label} mismatch.\nMissing: ${missing.join(", ") || "none"}\nUnexpected: ${actualCopy.join(", ") || "none"}`,
    );
  }
}

const moduleContracts = [
  {
    name: "Module 2 Authentication",
    file: "backend/src/modules/administration/auth.routes.ts",
    runtime: [
      "POST /register",
      "POST /login",
      "POST /refresh",
      "POST /logout",
      "GET /me",
    ],
    openApi: [
      "POST /api/v1/auth/register",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/refresh",
      "POST /api/v1/auth/logout",
      "GET /api/v1/auth/me",
    ],
  },
  {
    name: "Module 2 Administration",
    file: "backend/src/modules/administration/administration.routes.ts",
    runtime: [
      "GET /users",
      "PATCH /users/:id/status",
      "PUT /users/:id/roles",
      "GET /roles",
      "POST /roles",
      "PUT /roles/:id/permissions",
      "GET /settings",
      "PATCH /settings",
    ],
    openApi: [
      "GET /api/v1/admin/users",
      "PATCH /api/v1/admin/users/{id}/status",
      "PUT /api/v1/admin/users/{id}/roles",
      "GET /api/v1/admin/roles",
      "POST /api/v1/admin/roles",
      "PUT /api/v1/admin/roles/{id}/permissions",
      "GET /api/v1/admin/settings",
      "PATCH /api/v1/admin/settings",
    ],
  },
  {
    name: "Module 21 Documents and Audit",
    file: "backend/src/modules/documents-audit/documents-audit.routes.ts",
    runtime: [
      "POST /uploads/sign",
      "POST /uploads/:id/confirm",
      "POST /:id/link",
      "GET /:id/download",
      "DELETE /:id/link/:linkId",
      "GET /",
      "GET /:id",
    ],
    openApi: [
      "POST /api/v1/documents/uploads/sign",
      "POST /api/v1/documents/uploads/{id}/confirm",
      "POST /api/v1/documents/{id}/link",
      "GET /api/v1/documents/{id}/download",
      "DELETE /api/v1/documents/{id}/link/{linkId}",
      "GET /api/v1/audit",
      "GET /api/v1/audit/{id}",
    ],
  },
  {
    name: "Public Media",
    file: "backend/src/modules/public-media/public-media.routes.ts",
    runtime: ["POST /public/resolve"],
    openApi: ["POST /api/v1/media/public/resolve"],
  },
  {
    name: "Module 3 Customers",
    file: "backend/src/modules/customers/customers.routes.ts",
    runtime: [
      "GET /me",
      "PATCH /me",
      "GET /me/addresses",
      "POST /me/addresses",
      "PATCH /me/addresses/:id",
      "DELETE /me/addresses/:id",
      "GET /",
      "GET /:id",
    ],
    openApi: [
      "GET /api/v1/customers/me",
      "PATCH /api/v1/customers/me",
      "GET /api/v1/customers/me/addresses",
      "POST /api/v1/customers/me/addresses",
      "PATCH /api/v1/customers/me/addresses/{id}",
      "DELETE /api/v1/customers/me/addresses/{id}",
      "GET /api/v1/admin/customers",
      "GET /api/v1/admin/customers/{id}",
    ],
  },
  {
    name: "Module 4 Sellers",
    file: "backend/src/modules/sellers/sellers.routes.ts",
    runtime: [
      "POST /applications",
      "GET /me",
      "PATCH /me",
      "POST /me/stores",
      "PATCH /me/stores/:id",
      "GET /:slug",
      "GET /",
      "POST /:id/approve",
      "POST /:id/reject",
      "POST /:id/suspend",
    ],
    openApi: [
      "POST /api/v1/sellers/applications",
      "GET /api/v1/admin/seller-applications",
      "POST /api/v1/admin/seller-applications/{id}/approve",
      "POST /api/v1/admin/seller-applications/{id}/reject",
      "GET /api/v1/sellers/me",
      "PATCH /api/v1/sellers/me",
      "POST /api/v1/sellers/me/stores",
      "GET /api/v1/stores/{slug}",
      "PATCH /api/v1/sellers/me/stores/{id}",
      "POST /api/v1/admin/sellers/{id}/suspend",
    ],
  },
  {
    name: "Module 5 Catalog Taxonomy",
    file: "backend/src/modules/catalog-taxonomy/catalog-taxonomy.routes.ts",
    runtime: [
      "GET /categories",
      "GET /categories/:id/attributes",
      "GET /brands",
      "GET /attributes",
      "POST /categories",
      "PATCH /categories/:id",
      "POST /brands",
      "POST /attributes",
      "PUT /categories/:id/attributes",
    ],
    openApi: [
      "GET /api/v1/catalog/categories",
      "GET /api/v1/catalog/categories/{id}/attributes",
      "POST /api/v1/admin/catalog/categories",
      "PATCH /api/v1/admin/catalog/categories/{id}",
      "GET /api/v1/catalog/brands",
      "POST /api/v1/admin/catalog/brands",
      "GET /api/v1/catalog/attributes",
      "POST /api/v1/admin/catalog/attributes",
      "PUT /api/v1/admin/catalog/categories/{id}/attributes",
    ],
  },
  {
    name: "Module 6 Products",
    file: "backend/src/modules/products/products.routes.ts",
    runtime: [
      "GET /",
      "GET /:slug",
      "GET /",
      "GET /:id",
      "POST /",
      "PATCH /:id",
      "POST /:id/variants",
      "PATCH /:id/variants/:variantId",
      "POST /:id/media",
      "POST /:id/publish",
      "POST /:id/unpublish",
      "GET /",
      "GET /:id",
      "POST /:id/approve",
      "POST /:id/reject",
    ],
    openApi: [
      "GET /api/v1/products",
      "GET /api/v1/products/{slug}",
      "GET /api/v1/seller/products",
      "GET /api/v1/seller/products/{id}",
      "POST /api/v1/seller/products",
      "PATCH /api/v1/seller/products/{id}",
      "POST /api/v1/seller/products/{id}/variants",
      "PATCH /api/v1/seller/products/{id}/variants/{variantId}",
      "POST /api/v1/seller/products/{id}/media",
      "POST /api/v1/seller/products/{id}/publish",
      "POST /api/v1/seller/products/{id}/unpublish",
      "GET /api/v1/admin/products",
      "GET /api/v1/admin/products/{id}",
      "POST /api/v1/admin/products/{id}/approve",
      "POST /api/v1/admin/products/{id}/reject",
    ],
  },
  {
    name: "Module 7 Inventory",
    file: "backend/src/modules/inventory/inventory.routes.ts",
    runtime: [
      "GET /",
      "GET /:variantId/movements",
      "POST /:variantId/adjust",
      "PATCH /:variantId/reorder-level",
      "POST /reserve",
      "POST /release",
      "POST /ship",
    ],
    openApi: [
      "GET /api/v1/seller/inventory",
      "GET /api/v1/seller/inventory/{variantId}/movements",
      "POST /api/v1/seller/inventory/{variantId}/adjust",
      "PATCH /api/v1/seller/inventory/{variantId}/reorder-level",
      "POST /api/v1/internal/inventory/reserve",
      "POST /api/v1/internal/inventory/release",
      "POST /api/v1/internal/inventory/ship",
    ],
  },
  {
    name: "Module 19 Search and Discovery",
    file: "backend/src/modules/search-discovery/search-discovery.routes.ts",
    runtime: [
      "GET /products",
      "GET /suggestions",
      "GET /stores",
      "POST /reindex",
      "GET /reindex/:id",
    ],
    openApi: [
      "GET /api/v1/search/products",
      "GET /api/v1/search/suggestions",
      "GET /api/v1/search/stores",
      "POST /api/v1/admin/search/reindex",
      "GET /api/v1/admin/search/reindex/{id}",
    ],
  },
  {
    name: "Module 8 Cart and Wishlist",
    file: "backend/src/modules/cart-wishlist/cart-wishlist.routes.ts",
    runtime: [
      "GET /",
      "POST /items",
      "PATCH /items/:id",
      "DELETE /items/:id",
      "DELETE /",
      "GET /",
      "POST /items",
      "DELETE /items/:id",
    ],
    openApi: [
      "GET /api/v1/cart",
      "POST /api/v1/cart/items",
      "PATCH /api/v1/cart/items/{id}",
      "DELETE /api/v1/cart/items/{id}",
      "DELETE /api/v1/cart",
      "GET /api/v1/wishlist",
      "POST /api/v1/wishlist/items",
      "DELETE /api/v1/wishlist/items/{id}",
    ],
  },
  {
    name: "Module 9 Promotions and Coupons",
    file: "backend/src/modules/promotions/promotions.routes.ts",
    runtime: [
      "GET /",
      "GET /",
      "POST /",
      "PATCH /:id",
      "POST /:id/activate",
      "POST /:id/deactivate",
      "POST /",
      "GET /validate",
    ],
    openApi: [
      "GET /api/v1/admin/promotions",
      "POST /api/v1/admin/promotions",
      "PATCH /api/v1/admin/promotions/{id}",
      "GET /api/v1/seller/promotions",
      "POST /api/v1/seller/promotions",
      "GET /api/v1/promotions/validate",
      "POST /api/v1/admin/promotions/{id}/activate",
      "POST /api/v1/admin/promotions/{id}/deactivate",
    ],
  },
  {
    name: "Module 13 Shipping & Fulfillment",
    file: "backend/src/modules/shipping/shipping.routes.ts",
    runtime: [
      "GET /shipping-options",
      "GET /shipments",
      "POST /orders/:sellerOrderId/shipments",
      "PATCH /shipments/:id/tracking",
      "POST /shipments/:id/mark-shipped",
      "POST /shipments/:id/mark-delivered",
      "GET /:orderId/shipments",
    ],
    openApi: [
      "GET /api/v1/checkout/shipping-options",
      "GET /api/v1/seller/shipments",
      "POST /api/v1/seller/orders/{sellerOrderId}/shipments",
      "PATCH /api/v1/seller/shipments/{id}/tracking",
      "POST /api/v1/seller/shipments/{id}/mark-shipped",
      "POST /api/v1/seller/shipments/{id}/mark-delivered",
      "GET /api/v1/orders/{orderId}/shipments",
    ],
  },
  {
    name: "Module 10 Checkout",
    file: "backend/src/modules/checkout/checkout.routes.ts",
    runtime: [
      "POST /quote",
      "GET /quote/:id",
      "POST /quote/:id/confirm",
      "GET /:attemptId/status",
    ],
    openApi: [
      "POST /api/v1/checkout/quote",
      "GET /api/v1/checkout/quote/{id}",
      "POST /api/v1/checkout/quote/{id}/confirm",
      "GET /api/v1/checkout/{attemptId}/status",
    ],
  },
  {
    name: "Module 11 Orders",
    file: "backend/src/modules/orders/orders.routes.ts",
    runtime: [
      "GET /",
      "GET /:id",
      "POST /:id/cancel",
      "GET /",
      "GET /:id",
      "POST /:id/accept",
      "GET /",
      "POST /:id/cancel",
      "POST /:id/payment-confirmed",
    ],
    openApi: [
      "GET /api/v1/orders",
      "GET /api/v1/orders/{id}",
      "GET /api/v1/seller/orders",
      "GET /api/v1/seller/orders/{id}",
      "POST /api/v1/seller/orders/{id}/accept",
      "POST /api/v1/orders/{id}/cancel",
      "POST /api/v1/admin/orders/{id}/cancel",
      "GET /api/v1/admin/orders",
      "POST /api/v1/internal/orders/{id}/payment-confirmed",
    ],
  },
  {
    name: "Module 12 Payments",
    file: "backend/src/modules/payments/payments.routes.ts",
    runtime: [
      "POST /order/:orderId/intent",
      "GET /order/:orderId",
      "POST /webhooks/stripe",
      "GET /",
      "GET /:id",
      "POST /:id/refund",
    ],
    openApi: [
      "POST /api/v1/payments/order/{orderId}/intent",
      "GET /api/v1/payments/order/{orderId}",
      "POST /api/v1/payments/webhooks/stripe",
      "GET /api/v1/admin/payments",
      "GET /api/v1/admin/payments/{id}",
      "POST /api/v1/internal/payments/{id}/refund",
    ],
  },
  {
    name: "Module 16 Commissions",
    file: "backend/src/modules/commissions/commissions.routes.ts",
    runtime: [
      "GET /rules",
      "POST /rules",
      "PATCH /rules/:id",
      "GET /entries",
      "GET /",
      "POST /order-settle",
      "POST /refund-adjust",
    ],
    openApi: [
      "GET /api/v1/admin/commissions/rules",
      "POST /api/v1/admin/commissions/rules",
      "PATCH /api/v1/admin/commissions/rules/{id}",
      "GET /api/v1/seller/commissions",
      "GET /api/v1/admin/commissions/entries",
      "POST /api/v1/internal/commissions/order-settle",
      "POST /api/v1/internal/commissions/refund-adjust",
    ],
  },
  {
    name: "Module 14 Returns, Refunds & Disputes",
    file: "backend/src/modules/returns-refunds/returns-refunds.routes.ts",
    runtime: [
      "POST /:orderId/returns",
      "GET /",
      "POST /:id/refund",
      "GET /",
      "POST /:id/approve",
      "POST /:id/reject",
      "POST /:id/receive",
      "GET /",
    ],
    openApi: [
      "POST /api/v1/orders/{orderId}/returns",
      "GET /api/v1/returns",
      "GET /api/v1/seller/returns",
      "POST /api/v1/seller/returns/{id}/approve",
      "POST /api/v1/seller/returns/{id}/reject",
      "POST /api/v1/seller/returns/{id}/receive",
      "POST /api/v1/returns/{id}/refund",
      "GET /api/v1/admin/returns",
    ],
  },
  {
    name: "Module 17 Seller Wallet & Payouts",
    file: "backend/src/modules/seller-wallet-payouts/seller-wallet-payouts.routes.ts",
    runtime: [
      "GET /wallet",
      "GET /payouts",
      "POST /payouts",
      "POST /payout-accounts",
      "GET /",
      "POST /:id/approve",
      "POST /:id/send",
      "POST /settle",
      "POST /adjust",
    ],
    openApi: [
      "GET /api/v1/seller/wallet",
      "GET /api/v1/seller/payouts",
      "POST /api/v1/seller/payouts",
      "POST /api/v1/seller/payout-accounts",
      "GET /api/v1/admin/payouts",
      "POST /api/v1/admin/payouts/{id}/approve",
      "POST /api/v1/admin/payouts/{id}/send",
      "POST /api/v1/internal/wallet/settle",
      "POST /api/v1/internal/wallet/adjust",
    ],
  },
  {
    name: "Module 15 Reviews & Ratings",
    file: "backend/src/modules/reviews/reviews.routes.ts",
    runtime: [
      "POST /",
      "PATCH /:id",
      "POST /:id/helpful",
      "GET /:productId/reviews",
      "GET /:storeId/reviews",
      "GET /",
      "POST /:id/hide",
      "POST /:id/publish",
    ],
    openApi: [
      "POST /api/v1/reviews",
      "PATCH /api/v1/reviews/{id}",
      "GET /api/v1/products/{productId}/reviews",
      "GET /api/v1/stores/{storeId}/reviews",
      "POST /api/v1/reviews/{id}/helpful",
      "GET /api/v1/admin/reviews",
      "POST /api/v1/admin/reviews/{id}/hide",
      "POST /api/v1/admin/reviews/{id}/publish",
    ],
  },
  {
    name: "Module 18 Notifications",
    file: "backend/src/modules/notifications/notifications.routes.ts",
    runtime: [
      "GET /",
      "POST /:id/read",
      "POST /read-all",
      "GET /preferences",
      "PUT /preferences",
      "GET /",
      "POST /:id/retry",
    ],
    openApi: [
      "GET /api/v1/notifications",
      "POST /api/v1/notifications/{id}/read",
      "POST /api/v1/notifications/read-all",
      "GET /api/v1/notifications/preferences",
      "PUT /api/v1/notifications/preferences",
      "GET /api/v1/admin/notification-deliveries",
      "POST /api/v1/admin/notification-deliveries/{id}/retry",
    ],
  },
  {
    name: "Module 20 Reports & Analytics",
    file: "backend/src/modules/reports/reports.routes.ts",
    runtime: [
      "GET /catalog",
      "GET /sales",
      "GET /sellers",
      "GET /inventory",
      "GET /refunds",
      "GET /commissions",
      "GET /payouts",
      "POST /runs",
      "GET /runs/:id",
    ],
    openApi: [
      "GET /api/v1/reports/catalog",
      "GET /api/v1/reports/sales",
      "GET /api/v1/reports/sellers",
      "GET /api/v1/reports/inventory",
      "GET /api/v1/reports/refunds",
      "GET /api/v1/reports/commissions",
      "GET /api/v1/reports/payouts",
      "POST /api/v1/reports/runs",
      "GET /api/v1/reports/runs/{id}",
    ],
  },
  {
    name: "Module 1 Dashboard",
    file: "backend/src/modules/dashboard/dashboard.routes.ts",
    runtime: [
      "GET /summary",
      "GET /orders",
      "GET /sellers",
      "GET /alerts",
      "PATCH /preferences",
    ],
    openApi: [
      "GET /api/v1/dashboard/summary",
      "GET /api/v1/dashboard/orders",
      "GET /api/v1/dashboard/sellers",
      "GET /api/v1/dashboard/alerts",
      "PATCH /api/v1/dashboard/preferences",
    ],
  },
];

/** Verifies each implemented module has no missing or accidental HTTP/OpenAPI operations. */
function verifyModuleRouteSurfaces() {
  for (const contract of moduleContracts) {
    const source = readProjectFile(contract.file);
    assertExactRoutes(runtimeRoutes(source), contract.runtime, `${contract.name} runtime routes`);
    assertExactRoutes(openApiRoutes(source), contract.openApi, `${contract.name} OpenAPI routes`);
  }
}

/** Verifies every composed router is mounted at the expected API prefix exactly once. */
function verifyApplicationMounts() {
  const app = readProjectFile("backend/src/app.ts");
  const mounts = [
    ["/auth", "authRouter"],
    ["/admin", "administrationRouter"],
    ["/documents", "documentsRouter"],
    ["/media", "publicMediaRouter"],
    ["/audit", "auditRouter"],
    ["/customers", "customersRouter"],
    ["/admin/customers", "adminCustomersRouter"],
    ["/sellers", "sellersRouter"],
    ["/stores", "publicStoresRouter"],
    ["/admin/seller-applications", "adminSellerApplicationsRouter"],
    ["/admin/sellers", "adminSellersRouter"],
    ["/catalog", "catalogTaxonomyRouter"],
    ["/admin/catalog", "adminCatalogTaxonomyRouter"],
    ["/products", "publicProductsRouter"],
    ["/seller/products", "sellerProductsRouter"],
    ["/admin/products", "adminProductsRouter"],
    ["/seller/inventory", "sellerInventoryRouter"],
    ["/internal/inventory", "internalInventoryRouter"],
    ["/search", "publicSearchRouter"],
    ["/admin/search", "adminSearchRouter"],
    ["/cart", "cartRouter"],
    ["/wishlist", "wishlistRouter"],
    ["/promotions", "promotionsRouter"],
    ["/seller/promotions", "sellerPromotionsRouter"],
    ["/admin/promotions", "adminPromotionsRouter"],
    ["/checkout", "shippingRouter"],
    ["/checkout", "checkoutRouter"],
    ["/seller", "sellerShippingRouter"],
    ["/orders", "orderShippingRouter"],
    ["/orders", "customerOrdersRouter"],
    ["/seller/orders", "sellerOrdersRouter"],
    ["/admin/orders", "adminOrdersRouter"],
    ["/internal/orders", "internalOrdersRouter"],
    ["/payments", "paymentsWebhookRouter"],
    ["/payments", "paymentsRouter"],
    ["/admin/payments", "adminPaymentsRouter"],
    ["/internal/payments", "internalPaymentsRouter"],
    ["/admin/commissions", "adminCommissionsRouter"],
    ["/seller/commissions", "sellerCommissionsRouter"],
    ["/internal/commissions", "internalCommissionsRouter"],
    ["/orders", "orderReturnsRouter"],
    ["/returns", "returnsRouter"],
    ["/seller/returns", "sellerReturnsRouter"],
    ["/admin/returns", "adminReturnsRouter"],
    ["/seller", "sellerWalletPayoutsRouter"],
    ["/admin/payouts", "adminPayoutsRouter"],
    ["/internal/wallet", "internalWalletRouter"],
    ["/reviews", "reviewsRouter"],
    ["/products", "productReviewsRouter"],
    ["/stores", "storeReviewsRouter"],
    ["/admin/reviews", "adminReviewsRouter"],
    ["/notifications", "notificationsRouter"],
    ["/admin/notification-deliveries", "adminNotificationDeliveriesRouter"],
    ["/reports", "reportsRouter"],
    ["/dashboard", "dashboardRouter"],
  ];

  const compact = app.replace(/\s+/g, "").replace(/,\)/g, ")");
  for (const [prefix, router] of mounts) {
    const expected = `app.use(\`${"${API_V1_PREFIX}"}${prefix}\`,${router});`;
    const occurrences = compact.split(expected).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Application mount must exist exactly once: ${prefix} -> ${router}. Found ${occurrences}.`,
      );
    }
  }
}


/** Verifies protected/public routers keep the intended authentication and policy middleware. */
function verifyRouteSecurity() {
  const checks = [
    [
      "backend/src/modules/administration/auth.routes.ts",
      ["authenticationMiddleware", 'router.get("/me", authenticationMiddleware'],
    ],
    [
      "backend/src/modules/administration/administration.routes.ts",
      ["router.use(authenticationMiddleware)", "requirePermission", "requireAnyPermission"],
    ],
    [
      "backend/src/modules/documents-audit/documents-audit.routes.ts",
      ["router.use(authenticationMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/customers/customers.routes.ts",
      ["router.use(authenticationMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/sellers/sellers.routes.ts",
      ["router.use(authenticationMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/catalog-taxonomy/catalog-taxonomy.routes.ts",
      ["router.use(optionalAuthenticationMiddleware)", "router.use(authenticationMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/products/products.routes.ts",
      ["router.use(authenticationMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/inventory/inventory.routes.ts",
      ["router.use(authenticationMiddleware)", "router.use(internalServiceMiddleware)", "requirePermission"],
    ],
    [
      "backend/src/modules/search-discovery/search-discovery.routes.ts",
      [
        "router.use(optionalAuthenticationMiddleware)",
        "publicSearchPermissionMiddleware",
        "router.use(authenticationMiddleware)",
        "requirePermission(SEARCH_PERMISSION.ADMIN_MANAGE)",
        "createReindexRateLimit",
      ],
    ],
    [
      "backend/src/modules/cart-wishlist/cart-wishlist.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN)",
        "requirePermission(CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN)",
      ],
    ],
    [
      "backend/src/modules/promotions/promotions.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE)",
        "requirePermission(PROMOTION_PERMISSION.SELLER_MANAGE)",
        "requirePermission(PROMOTION_PERMISSION.READ)",
      ],
    ],
    [
      "backend/src/modules/shipping/shipping.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(SHIPPING_PERMISSION.SELLER_READ)",
        "requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE)",
        "requireAnyPermission(",
        "SHIPPING_PERMISSION.READ_OWN_ORDER",
        "SHIPPING_PERMISSION.ADMIN_READ",
      ],
    ],
    [
      "backend/src/modules/checkout/checkout.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(CHECKOUT_PERMISSION.CREATE_OWN)",
        "requirePermission(CHECKOUT_PERMISSION.CONFIRM_OWN)",
      ],
    ],
    [
      "backend/src/modules/orders/orders.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "router.use(internalServiceMiddleware)",
        "requirePermission(ORDERS_PERMISSION.READ_OWN)",
        "requirePermission(ORDERS_PERMISSION.SELLER_READ)",
        "requirePermission(ORDERS_PERMISSION.SELLER_MANAGE)",
        "requirePermission(ORDERS_PERMISSION.ADMIN_READ)",
        "requirePermission(ORDERS_PERMISSION.ADMIN_CANCEL)",
      ],
    ],
    [
      "backend/src/modules/payments/payments.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "router.use(internalServiceMiddleware)",
        "requirePermission(PAYMENTS_PERMISSION.READ_OWN)",
        "requirePermission(PAYMENTS_PERMISSION.ADMIN_READ)",
        'express.raw({ type: "application/json"',
      ],
    ],
    [
      "backend/src/modules/commissions/commissions.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "router.use(internalServiceMiddleware)",
        "requirePermission(COMMISSIONS_PERMISSION.ADMIN_READ)",
        "requirePermission(COMMISSIONS_PERMISSION.ADMIN_MANAGE)",
        "requirePermission(COMMISSIONS_PERMISSION.SELLER_READ)",
      ],
    ],
    [
      "backend/src/modules/returns-refunds/returns-refunds.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(RETURNS_PERMISSION.CREATE_OWN)",
        "requirePermission(RETURNS_PERMISSION.READ_OWN)",
        "requirePermission(RETURNS_PERMISSION.SELLER_MANAGE)",
        "requirePermission(RETURNS_PERMISSION.ADMIN_MANAGE)",
        "requirePermission(RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE)",
      ],
    ],
    [
      "backend/src/modules/seller-wallet-payouts/seller-wallet-payouts.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "router.use(internalServiceMiddleware)",
        "requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ)",
        "requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST)",
        "requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE)",
        "requirePermission(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ)",
        "requirePermission(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE)",
      ],
    ],
    [
      "backend/src/modules/reviews/reviews.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "router.use(optionalAuthenticationMiddleware)",
        "publicReviewsPermissionMiddleware",
        "requirePermission(REVIEWS_PERMISSION.CREATE_VERIFIED)",
        "requirePermission(REVIEWS_PERMISSION.UPDATE_OWN)",
        "requirePermission(REVIEWS_PERMISSION.PUBLIC_READ)",
        "requirePermission(REVIEWS_PERMISSION.ADMIN_MODERATE)",
      ],
    ],
    [
      "backend/src/modules/notifications/notifications.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN)",
        "requirePermission(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN)",
        "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_READ)",
        "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_RETRY)",
      ],
    ],
    [
      "backend/src/modules/reports/reports.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(REPORTS_PERMISSION.SALES_READ)",
        "requirePermission(REPORTS_PERMISSION.SELLER_READ)",
        "requirePermission(REPORTS_PERMISSION.INVENTORY_READ)",
        "requirePermission(REPORTS_PERMISSION.FINANCE_READ)",
        "requirePermission(REPORTS_PERMISSION.EXPORT)",
      ],
    ],
    [
      "backend/src/modules/dashboard/dashboard.routes.ts",
      [
        "router.use(authenticationMiddleware)",
        "requirePermission(DASHBOARD_PERMISSION.READ)",
        "requirePermission(DASHBOARD_PERMISSION.SELLER_READ)",
        "requirePermission(DASHBOARD_PERMISSION.MANAGE_PREFERENCES)",
      ],
    ],
  ];

  for (const [relativePath, expectedTexts] of checks) {
    const source = readProjectFile(relativePath);
    for (const expected of expectedTexts) {
      if (!source.includes(expected)) {
        throw new Error(`${relativePath} is missing HTTP security/policy wiring: ${expected}`);
      }
    }
  }
}

/** Verifies the central OpenAPI document includes every implemented module registry and both Foundation endpoints. */
function verifyOpenApiRegistration() {
  const document = readProjectFile(
    "backend/src/http/openapi/openapi.document.ts",
  );
  for (const registry of [
    "...authOpenApiPaths",
    "...administrationOpenApiPaths",
    "...documentsAuditOpenApiPaths",
    "...publicMediaOpenApiPaths",
    "...customersOpenApiPaths",
    "...sellersOpenApiPaths",
    "...catalogTaxonomyOpenApiPaths",
    "...productsOpenApiPaths",
    "...inventoryOpenApiPaths",
    "...searchDiscoveryOpenApiPaths",
    "...cartWishlistOpenApiPaths",
    "...promotionsOpenApiPaths",
    "...shippingOpenApiPaths",
    "...checkoutOpenApiPaths",
    "...ordersOpenApiPaths",
    "...paymentsOpenApiPaths",
    "...commissionsOpenApiPaths",
    "...returnsRefundsOpenApiPaths",
    "...sellerWalletPayoutsOpenApiPaths",
    "...reviewsOpenApiPaths",
    "...notificationsOpenApiPaths",
    "...reportsOpenApiPaths",
    "...dashboardOpenApiPaths",
  ]) {
    if (!document.includes(registry)) {
      throw new Error(`OpenAPI document is missing module registry: ${registry}`);
    }
  }
  for (const path of ['"/health"', '"/ready"']) {
    if (!document.includes(path)) throw new Error(`Foundation OpenAPI path is missing: ${path}`);
  }
}

/** Keeps requestId mandatory in the documented stable success/error envelopes. */
function verifyRequestIdContract() {
  const authRoutes = readProjectFile(
    "backend/src/modules/administration/auth.routes.ts",
  );
  const adminRoutes = readProjectFile(
    "backend/src/modules/administration/administration.routes.ts",
  );
  const openApiDocument = readProjectFile(
    "backend/src/http/openapi/openapi.document.ts",
  );

  for (const requiredText of [
    'required: ["success", "error", "requestId"]',
    'required: ["success", "data", "requestId"]',
  ]) {
    if (!authRoutes.includes(requiredText)) {
      throw new Error(`Authentication OpenAPI envelope is missing: ${requiredText}`);
    }
  }
  if (!adminRoutes.includes('required: ["success", "error", "requestId"]')) {
    throw new Error("Administration failure envelope must require requestId.");
  }
  if (!adminRoutes.includes('["success", "data", "meta", "requestId"]')) {
    throw new Error("Administration paginated success envelope must require requestId.");
  }
  if (!adminRoutes.includes('["success", "data", "requestId"]')) {
    throw new Error("Administration success envelope must require requestId.");
  }
  if (!openApiDocument.includes('required: ["success", "data", "requestId"]')) {
    throw new Error("Foundation success envelope must require requestId.");
  }
  if (!openApiDocument.includes('required: ["success", "error", "requestId"]')) {
    throw new Error("Foundation readiness failure envelope must require requestId.");
  }
}

/** Ensures every controller reads params/query/body only through an explicit Zod boundary parser. */
function verifyControllerValidationBoundaries() {
  const controllers = [
    "backend/src/modules/administration/auth.controller.ts",
    "backend/src/modules/administration/administration.controller.ts",
    "backend/src/modules/documents-audit/documents-audit.controller.ts",
    "backend/src/modules/public-media/public-media.controller.ts",
    "backend/src/modules/customers/customers.controller.ts",
    "backend/src/modules/sellers/sellers.controller.ts",
    "backend/src/modules/catalog-taxonomy/catalog-taxonomy.controller.ts",
    "backend/src/modules/products/products.controller.ts",
    "backend/src/modules/inventory/inventory.controller.ts",
    "backend/src/modules/search-discovery/search-discovery.controller.ts",
    "backend/src/modules/cart-wishlist/cart-wishlist.controller.ts",
    "backend/src/modules/promotions/promotions.controller.ts",
    "backend/src/modules/shipping/shipping.controller.ts",
    "backend/src/modules/checkout/checkout.controller.ts",
    "backend/src/modules/orders/orders.controller.ts",
    "backend/src/modules/payments/payments.controller.ts",
    "backend/src/modules/commissions/commissions.controller.ts",
    "backend/src/modules/returns-refunds/returns-refunds.controller.ts",
    "backend/src/modules/seller-wallet-payouts/seller-wallet-payouts.controller.ts",
    "backend/src/modules/reviews/reviews.controller.ts",
    "backend/src/modules/notifications/notifications.controller.ts",
    "backend/src/modules/reports/reports.controller.ts",
    "backend/src/modules/dashboard/dashboard.controller.ts",
  ];

  for (const relativePath of controllers) {
    const lines = readProjectFile(relativePath).split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/request\.(params|query|body)/.test(line)) continue;
      if (
        line.includes(".parse(request.") ||
        line.includes(".safeParse(request.") ||
        line.includes("parsePublicQuery(") ||
        line.includes("parseDashboardQuery(")
      ) {
        continue;
      }

      throw new Error(
        `${relativePath}:${index + 1} reads an HTTP input without an explicit Zod parse boundary.`,
      );
    }
  }
}

/** Keeps runtime/backend/frontend API envelopes aligned with the documented mandatory request ID. */
function verifyRuntimeEnvelopeContract() {
  const backendTypes = readProjectFile("backend/src/common/types/api.ts");
  const backendSchemas = readProjectFile(
    "backend/src/common/schemas/api-envelope.schema.ts",
  );
  const responseHelpers = readProjectFile(
    "backend/src/common/utils/api-response.ts",
  );
  const frontendTypes = readProjectFile("frontend/src/types/api.ts");
  const frontendApiError = readProjectFile("frontend/src/lib/api-error.ts");
  const contractTests = readProjectFile("backend/tests/unit/contracts.test.ts");

  if ((backendTypes.match(/requestId: string;/g) ?? []).length < 2) {
    throw new Error("Backend success/failure envelope types must require requestId.");
  }
  if ((frontendTypes.match(/requestId: string;/g) ?? []).length < 2) {
    throw new Error("Frontend success/failure envelope types must require requestId.");
  }
  if ((backendSchemas.match(/requestId: z\.string\(\)\.min\(1\),/g) ?? []).length < 2) {
    throw new Error("Runtime Zod success/failure envelope schemas must require requestId.");
  }
  if (!responseHelpers.includes("options: { requestId: string; meta?: TMeta }")) {
    throw new Error("successResponse must require a requestId from every HTTP caller.");
  }
  if (!responseHelpers.includes("requestId: string;")) {
    throw new Error("failureResponse must require a requestId from every HTTP caller.");
  }
  if (!frontendApiError.includes('typeof record.requestId === "string"')) {
    throw new Error("Frontend failure-envelope guard must validate the mandatory requestId.");
  }
  if (!contractTests.includes("rejects public envelopes that do not contain a request ID")) {
    throw new Error("Shared boundary tests must reject envelopes without requestId.");
  }
}

/** Verifies every current frontend feature API call resolves to one documented backend operation. */
function verifyFrontendApiParity() {
  const backendRoutes = new Set(
    moduleContracts.flatMap((contract) =>
      contract.openApi.map((route) => {
        const [method, ...pathParts] = route.split(" ");
        const path = pathParts.join(" ").replace(/^\/api\/v1/, "");
        return normalizedApiRoute(method, path);
      }),
    ),
  );

  const apiRoot = join(root, "frontend/src/features");
  for (const absolutePath of frontendApiFiles(apiRoot)) {
    const source = readFileSync(absolutePath, "utf8");
    for (const route of frontendApiCalls(source)) {
      if (!backendRoutes.has(route)) {
        const relativePath = absolutePath.slice(root.length);
        throw new Error(
          `${relativePath} calls an API operation missing from backend OpenAPI: ${route}`,
        );
      }
    }
  }
}

/** Keeps routes/controllers thin and prevents accidental data-access shortcuts in the HTTP layer. */
function verifyHttpLayerBoundaries() {
  const routeFiles = [
    ...new Set(moduleContracts.map((contract) => contract.file)),
  ];
  const controllerFiles = [
    "backend/src/modules/administration/auth.controller.ts",
    "backend/src/modules/administration/administration.controller.ts",
    "backend/src/modules/documents-audit/documents-audit.controller.ts",
    "backend/src/modules/public-media/public-media.controller.ts",
    "backend/src/modules/customers/customers.controller.ts",
    "backend/src/modules/sellers/sellers.controller.ts",
    "backend/src/modules/catalog-taxonomy/catalog-taxonomy.controller.ts",
    "backend/src/modules/products/products.controller.ts",
    "backend/src/modules/inventory/inventory.controller.ts",
    "backend/src/modules/search-discovery/search-discovery.controller.ts",
    "backend/src/modules/cart-wishlist/cart-wishlist.controller.ts",
    "backend/src/modules/promotions/promotions.controller.ts",
    "backend/src/modules/shipping/shipping.controller.ts",
    "backend/src/modules/checkout/checkout.controller.ts",
    "backend/src/modules/orders/orders.controller.ts",
    "backend/src/modules/payments/payments.controller.ts",
    "backend/src/modules/commissions/commissions.controller.ts",
    "backend/src/modules/returns-refunds/returns-refunds.controller.ts",
    "backend/src/modules/seller-wallet-payouts/seller-wallet-payouts.controller.ts",
    "backend/src/modules/reviews/reviews.controller.ts",
    "backend/src/modules/notifications/notifications.controller.ts",
    "backend/src/modules/reports/reports.controller.ts",
    "backend/src/modules/dashboard/dashboard.controller.ts",
  ];

  for (const relativePath of routeFiles) {
    const source = readProjectFile(relativePath);
    for (const forbidden of [".repository.js", ".service.js", "/database/"]) {
      if (source.includes(forbidden)) {
        throw new Error(`${relativePath} bypasses the controller boundary through ${forbidden}.`);
      }
    }
  }

  for (const relativePath of controllerFiles) {
    const source = readProjectFile(relativePath);
    for (const forbidden of [".repository.js", "/database/"]) {
      if (source.includes(forbidden)) {
        throw new Error(`${relativePath} bypasses the service boundary through ${forbidden}.`);
      }
    }
  }
}

/** Ensures every HTTP definition has a real runtime consumer instead of leaving dead handlers or registries behind. */
function verifyNoDeadHttpDefinitions() {
  const app = readProjectFile("backend/src/app.ts");
  const openApiDocument = readProjectFile(
    "backend/src/http/openapi/openapi.document.ts",
  );
  const routeFiles = [...new Set(moduleContracts.map((contract) => contract.file))];

  for (const routeFile of routeFiles) {
    const routeSource = readProjectFile(routeFile);
    const controllerFile = routeFile.replace(/\.routes\.ts$/, ".controller.ts");
    const controllerSource = readProjectFile(controllerFile);

    const controllerMethods = new Set(
      [...controllerSource.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/gm)].map(
        (match) => match[1],
      ),
    );
    const routedHandlers = new Set(
      [
        ...routeSource.matchAll(
          /router\.(?:get|post|put|patch|delete)\([\s\S]*?\bcontroller\.([A-Za-z_$][\w$]*)/g,
        ),
      ].map((match) => match[1]),
    );

    const unusedControllerMethods = [...controllerMethods].filter(
      (method) => !routedHandlers.has(method),
    );
    const missingControllerMethods = [...routedHandlers].filter(
      (method) => !controllerMethods.has(method),
    );
    if (unusedControllerMethods.length || missingControllerMethods.length) {
      throw new Error(
        `${controllerFile} route-handler mismatch. ` +
          `Unused controller methods: ${unusedControllerMethods.join(", ") || "none"}. ` +
          `Missing controller methods: ${missingControllerMethods.join(", ") || "none"}.`,
      );
    }

    const routerFactories = [
      ...routeSource.matchAll(/export\s+function\s+(create[A-Za-z_$][\w$]*Router)\s*\(/g),
    ].map((match) => match[1]);
    for (const routerFactory of routerFactories) {
      if (!app.includes(`${routerFactory}(`)) {
        throw new Error(`${routeFile} exports an unused router factory: ${routerFactory}`);
      }
    }

    const openApiRegistries = [
      ...routeSource.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*OpenApiPaths)\s*=/g),
    ].map((match) => match[1]);
    for (const registry of openApiRegistries) {
      if (!openApiDocument.includes(`...${registry}`)) {
        throw new Error(`${routeFile} exports an unregistered OpenAPI path registry: ${registry}`);
      }
    }
  }
}

/** Keeps controller handlers and frontend API methods documented, used, and easy to trace. */
function verifyHttpReadabilityAndClientUsage() {
  const controllerFiles = [
    ...new Set(
      moduleContracts.map((contract) =>
        contract.file.replace(/\.routes\.ts$/, ".controller.ts"),
      ),
    ),
  ];

  for (const relativePath of controllerFiles) {
    const source = readProjectFile(relativePath);
    for (const match of source.matchAll(
      /^\s{2}([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/gm,
    )) {
      if (!hasPurposeComment(source, match.index)) {
        throw new Error(`${relativePath}:${match[1]} is missing a short purpose comment.`);
      }
    }
  }

  const sourceRoot = join(root, "frontend/src");
  const sourceFiles = frontendSourceFiles(sourceRoot);
  const sourceByFile = new Map(
    sourceFiles.map((absolutePath) => [absolutePath, readFileSync(absolutePath, "utf8")]),
  );

  for (const apiFile of frontendApiFiles(join(sourceRoot, "features"))) {
    const source = sourceByFile.get(apiFile) ?? readFileSync(apiFile, "utf8");
    const objectMatch = source.match(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/);

    if (objectMatch) {
      const apiObject = objectMatch[1];
      const objectStart = source.indexOf(
        "{",
        objectMatch.index + objectMatch[0].length - 1,
      );
      const objectEnd = source.indexOf("\n};", objectStart);
      if (objectEnd < 0) throw new Error(`Unclosed frontend API object in ${apiFile}.`);
      const objectBody = source.slice(objectStart + 1, objectEnd);
      const bodyOffset = objectStart + 1;

      for (const match of objectBody.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) {
        const methodName = match[1];
        const declarationIndex = bodyOffset + match.index;
        if (!hasPurposeComment(source, declarationIndex)) {
          throw new Error(
            `${apiFile}:${apiObject}.${methodName} is missing a short purpose comment.`,
          );
        }

        const usagePattern = new RegExp(`\\b${apiObject}\\.${methodName}\\b`);
        const consumerCount = [...sourceByFile.entries()].reduce(
          (count, [absolutePath, candidate]) =>
            absolutePath === apiFile || !usagePattern.test(candidate) ? count : count + 1,
          0,
        );
        if (consumerCount === 0) {
          throw new Error(
            `${apiFile}:${apiObject}.${methodName} has no production frontend consumer.`,
          );
        }
      }
      continue;
    }

    for (const match of source.matchAll(
      /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    )) {
      const functionName = match[1];
      if (!hasPurposeComment(source, match.index)) {
        throw new Error(`${apiFile}:${functionName} is missing a short purpose comment.`);
      }
      const usagePattern = new RegExp(`\\b${functionName}\\b`);
      const consumerCount = [...sourceByFile.entries()].reduce(
        (count, [absolutePath, candidate]) =>
          absolutePath === apiFile || !usagePattern.test(candidate) ? count : count + 1,
        0,
      );
      if (consumerCount === 0) {
        throw new Error(`${apiFile}:${functionName} has no production frontend consumer.`);
      }
    }
  }

  const apiClient = readProjectFile("frontend/src/lib/api-client.ts");
  for (const required of [
    "axios.create({",
    "withCredentials: true",
    "apiClient.interceptors.request.use",
    "apiClient.interceptors.response.use",
    'config.headers.set("X-Request-Id"',
    'config.headers.set("Authorization"',
    '`${env.VITE_API_BASE_URL}/auth/refresh`',
  ]) {
    if (!apiClient.includes(required)) {
      throw new Error(`Central frontend API client is missing required behavior: ${required}`);
    }
  }
}

/** Prevents dead standalone router/controller singletons in modules composed explicitly by app.ts. */
function verifyExplicitHttpComposition() {
  const checks = [
    [
      "backend/src/modules/administration/administration.routes.ts",
      ["administrationController", "export const administrationRouter"],
    ],
    [
      "backend/src/modules/customers/customers.routes.ts",
      [
        "customersController",
        "export const customersRouter",
        "export const adminCustomersRouter",
      ],
    ],
    [
      "backend/src/modules/documents-audit/documents-audit.routes.ts",
      [
        "documentsAuditController",
        "export const documentsRouter",
        "export const auditRouter",
      ],
    ],
    [
      "backend/src/modules/cart-wishlist/cart-wishlist.routes.ts",
      [
        "cartWishlistController",
        "export const cartRouter",
        "export const wishlistRouter",
      ],
    ],
    [
      "backend/src/modules/promotions/promotions.routes.ts",
      [
        "promotionsController =",
        "export const promotionsRouter",
        "export const sellerPromotionsRouter",
        "export const adminPromotionsRouter",
      ],
    ],
    [
      "backend/src/modules/shipping/shipping.routes.ts",
      ["shippingController =", "export const shippingRouter"],
    ],
    [
      "backend/src/modules/checkout/checkout.routes.ts",
      ["checkoutController =", "export const checkoutRouter"],
    ],
    [
      "backend/src/modules/orders/orders.routes.ts",
      [
        "ordersController =",
        "export const customerOrdersRouter",
        "export const sellerOrdersRouter",
        "export const adminOrdersRouter",
        "export const internalOrdersRouter",
      ],
    ],
    [
      "backend/src/modules/payments/payments.routes.ts",
      [
        "paymentsController =",
        "export const paymentsRouter",
        "export const paymentsWebhookRouter",
        "export const adminPaymentsRouter",
        "export const internalPaymentsRouter",
      ],
    ],
    [
      "backend/src/modules/returns-refunds/returns-refunds.routes.ts",
      [
        "returnsRefundsController =",
        "export const orderReturnsRouter",
        "export const returnsRouter",
        "export const sellerReturnsRouter",
        "export const adminReturnsRouter",
      ],
    ],
    [
      "backend/src/modules/seller-wallet-payouts/seller-wallet-payouts.routes.ts",
      [
        "sellerWalletPayoutsController =",
        "export const sellerWalletPayoutsRouter",
        "export const adminPayoutsRouter",
        "export const internalWalletRouter",
      ],
    ],
    [
      "backend/src/modules/reviews/reviews.routes.ts",
      [
        "reviewsController =",
        "export const reviewsRouter",
        "export const productReviewsRouter",
        "export const storeReviewsRouter",
        "export const adminReviewsRouter",
      ],
    ],
    [
      "backend/src/modules/notifications/notifications.routes.ts",
      [
        "notificationsController =",
        "export const notificationsRouter",
        "export const adminNotificationDeliveriesRouter",
      ],
    ],
    [
      "backend/src/modules/reports/reports.routes.ts",
      [
        "reportsController =",
        "export const reportsRouter",
      ],
    ],
  ];

  for (const [relativePath, forbiddenTexts] of checks) {
    const source = readProjectFile(relativePath);
    for (const forbidden of forbiddenTexts) {
      if (source.includes(forbidden)) {
        throw new Error(
          `${relativePath} recreates an unused standalone HTTP singleton: ${forbidden}`,
        );
      }
    }
  }
}

/** Rejects known deferred/removed generic operations that would violate the controlling route contract. */
function verifyNoForbiddenOperations() {
  const allRouteSource = moduleContracts
    .map((contract) => readProjectFile(contract.file))
    .join("\n");
  const forbidden = [
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/admin/permissions",
    "/api/v1/audit/export",
    "/api/v1/admin/catalog/brands/{id}",
    "/api/v1/admin/catalog/attributes/{id}",
    "/api/v1/seller/products/{id}/delete",
    "/api/v1/internal/inventory/commit",
    "/api/v1/cart/reserve",
    "/api/v1/cart/checkout",
    "/api/v1/wishlist/items/{id}/move-to-cart",
    "/api/v1/coupons",
    "/api/v1/admin/promotions/{id}/delete",
    "/api/v1/returns/{id}/status",
    "/api/v1/returns/{id}/restock",
    "/api/v1/returns/{id}/dispute-notes",
  ];

  for (const path of forbidden) {
    if (allRouteSource.includes(path)) {
      throw new Error(`Deferred or generic operation must not be exposed: ${path}`);
    }
  }
}

/** Verifies the two additive read routes are explicitly governed by the requirements patch. */
function verifyApprovedExtensions() {
  const patch0001 = readProjectFile("REQUIREMENTS_PATCH_0001.md");
  for (const route of [
    "GET /api/v1/catalog/categories/:id/attributes",
    "GET /api/v1/seller/products/:id",
  ]) {
    if (!patch0001.includes(route)) {
      throw new Error(`Requirements patch is missing approved extension: ${route}`);
    }
  }

  const patch0011 = readProjectFile("REQUIREMENTS_PATCH_0011_PROPOSED.md");
  if (!patch0011.includes("Status: **APPROVED") || !patch0011.includes("GET /api/v1/admin/reviews")) {
    throw new Error("Approved Patch 0011 must govern the Module 15 moderation queue read.");
  }
}

/** Locks the complete implemented business HTTP surface, including public media, to 170 operations. */
function verifyImplementedOperationCount() {
  const operationCount = moduleContracts.reduce(
    (total, contract) => total + contract.openApi.length,
    0,
  );
  if (operationCount !== IMPLEMENTED_OPERATION_COUNT) {
    throw new Error(
      `Implemented HTTP operation count changed from ${IMPLEMENTED_OPERATION_COUNT} to ${operationCount}.`,
    );
  }
}

/** Runs the permanent dependency-free HTTP/OpenAPI parity gate. */
function main() {
  verifyImplementedOperationCount();
  verifyModuleRouteSurfaces();
  verifyApplicationMounts();
  verifyRouteSecurity();
  verifyOpenApiRegistration();
  verifyRequestIdContract();
  verifyControllerValidationBoundaries();
  verifyRuntimeEnvelopeContract();
  verifyFrontendApiParity();
  verifyHttpLayerBoundaries();
  verifyNoDeadHttpDefinitions();
  verifyHttpReadabilityAndClientUsage();
  verifyExplicitHttpComposition();
  verifyNoForbiddenOperations();
  verifyApprovedExtensions();
  console.log("HTTP/OpenAPI contract verification passed.");
}

main();
