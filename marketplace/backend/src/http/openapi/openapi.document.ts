import { OPENAPI_INFO } from "../../common/openapi/openapi.contract.js";
import {
  administrationOpenApiPaths,
} from "../../modules/administration/administration.routes.js";
import {
  authOpenApiComponents,
  authOpenApiPaths,
} from "../../modules/administration/auth.routes.js";
import {
  documentsAuditOpenApiPaths,
} from "../../modules/documents-audit/documents-audit.routes.js";
import { publicMediaOpenApiPaths } from "../../modules/public-media/public-media.routes.js";
import { customersOpenApiPaths } from "../../modules/customers/customers.routes.js";
import { sellersOpenApiPaths } from "../../modules/sellers/sellers.routes.js";
import {
  catalogTaxonomyOpenApiComponents,
  catalogTaxonomyOpenApiPaths,
} from "../../modules/catalog-taxonomy/catalog-taxonomy.routes.js";
import { productsOpenApiPaths } from "../../modules/products/products.routes.js";
import {
  inventoryOpenApiComponents,
  inventoryOpenApiPaths,
} from "../../modules/inventory/inventory.routes.js";
import { searchDiscoveryOpenApiPaths } from "../../modules/search-discovery/search-discovery.routes.js";
import { cartWishlistOpenApiPaths } from "../../modules/cart-wishlist/cart-wishlist.routes.js";
import { promotionsOpenApiPaths } from "../../modules/promotions/promotions.routes.js";
import { shippingOpenApiPaths } from "../../modules/shipping/shipping.routes.js";
import { checkoutOpenApiPaths } from "../../modules/checkout/checkout.routes.js";
import { ordersOpenApiPaths } from "../../modules/orders/orders.routes.js";
import { paymentsOpenApiPaths } from "../../modules/payments/payments.routes.js";
import { commissionsOpenApiPaths } from "../../modules/commissions/commissions.routes.js";
import { returnsRefundsOpenApiPaths } from "../../modules/returns-refunds/returns-refunds.routes.js";
import { reviewsOpenApiPaths } from "../../modules/reviews/reviews.routes.js";
import { sellerWalletPayoutsOpenApiPaths } from "../../modules/seller-wallet-payouts/seller-wallet-payouts.routes.js";
import { notificationsOpenApiPaths } from "../../modules/notifications/notifications.routes.js";
import { reportsOpenApiPaths } from "../../modules/reports/reports.routes.js";
import { dashboardOpenApiPaths } from "../../modules/dashboard/dashboard.routes.js";

const requestIdProperty = {
  requestId: { type: "string", example: "b6e98ea4-5208-46fb-8c9e-05a7ed28bf02" },
} as const;

/** OpenAPI 3.1 document extended only by modules that have reached their HTTP generation pass. */
export const openApiDocument = {
  openapi: "3.1.0",
  info: OPENAPI_INFO,
  servers: [{ url: "/", description: "Current API host" }],
  tags: [
    { name: "Foundation", description: "Process and dependency health endpoints." },
    { name: "Authentication", description: "Platform authentication and session lifecycle." },
    { name: "Administration", description: "Platform users, roles and permission assignments." },
    { name: "Documents", description: "Permission-checked signed file upload, linking and download." },
    { name: "Public Media", description: "Short-lived delivery URLs for media attached to currently public marketplace resources." },
    { name: "Audit", description: "Append-only, permission-filtered audit read surface." },
    { name: "Customers", description: "Customer profiles, saved addresses, and privileged customer reads." },
    { name: "Sellers", description: "Seller onboarding, seller/store management, and public store reads." },
    { name: "Catalog Taxonomy", description: "Categories, brands, reusable attributes, and category facet mappings." },
    { name: "Products", description: "Public Product reads, seller listing management, variants, media, and publication workflow." },
    { name: "Inventory", description: "Seller stock balances, immutable movement history, and trusted reservation/fulfillment commands." },
    { name: "Search & Discovery", description: "Public PostgreSQL FTS/trigram discovery plus privileged Search reindex lifecycle." },
    {
      name: "Cart & Wishlist",
      description: "Authenticated customer shopping intent with preview-only Cart totals and saved Wishlist items.",
    },
    {
      name: "Promotions & Coupons",
      description: "Platform/seller promotion configuration and authenticated customer coupon eligibility previews.",
    },
    {
      name: "Shipping & Fulfillment",
      description:
        "Checkout shipping options plus seller-scoped Shipment creation, tracking, fulfillment, and customer-safe Order tracking.",
    },
    {
      name: "Checkout",
      description: "Authoritative customer quote creation, idempotent confirmation, and Checkout-attempt status.",
    },
    {
      name: "Orders",
      description: "Immutable Customer Orders, seller-scoped fulfillment units, cancellation, and trusted payment confirmation.",
    },
    {
      name: "Payments",
      description: "Provider-authoritative PaymentIntent, webhook, finance-read, refund, and reconciliation boundaries.",
    },
    {
      name: "Commissions & Marketplace Fees",
      description: "Effective-dated Commission rules, immutable seller earnings ledger, and trusted settlement/refund adjustments.",
    },
    {
      name: "Returns, Refunds & Disputes",
      description: "Customer Return Requests, seller-scoped review and inspection, provider-authoritative refunds, and support search.",
    },
    {
      name: "Reviews & Ratings",
      description: "Verified-purchase Reviews, public rating summaries, Helpful votes, and privileged moderation.",
    },
    {
      name: "Seller Wallet & Payouts",
      description:
        "Seller Wallet balances and immutable ledger, payout destinations, finance approval/reservation, and " +
        "provider payout reconciliation.",
    },
    {
      name: "Notifications",
      description:
        "Owner-scoped in-app Notifications, user preferences, and privileged failed-delivery retry operations.",
    },
    {
      name: "Reports & Analytics",
      description:
        "Permission-safe operational and financial reports plus asynchronous CSV/PDF export runs.",
    },
    {
      name: "Dashboard",
      description:
        "Role-aware KPI, trend, seller-performance, operational-alert, and preference views backed by stable source modules.",
    },
  ],
  components: {
    securitySchemes: {
      ...authOpenApiComponents.securitySchemes,
      ...inventoryOpenApiComponents.securitySchemes,
    },
    schemas: {
      ...catalogTaxonomyOpenApiComponents.schemas,
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Foundation"],
        summary: "Liveness check",
        responses: {
          "200": {
            description: "Backend process is alive.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["success", "data", "requestId"],
                  properties: {
                    success: { const: true },
                    data: {
                      type: "object",
                      required: ["status", "uptimeSeconds", "timestamp"],
                      properties: {
                        status: { const: "ok" },
                        uptimeSeconds: { type: "integer", minimum: 0 },
                        timestamp: { type: "string", format: "date-time" },
                      },
                    },
                    ...requestIdProperty,
                  },
                },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        tags: ["Foundation"],
        summary: "Dependency readiness check",
        responses: {
          "200": {
            description: "Required dependencies are ready.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["success", "data", "requestId"],
                  properties: {
                    success: { const: true },
                    data: {
                      type: "object",
                      required: ["status", "dependencies", "timestamp"],
                      properties: {
                        status: { const: "ready" },
                        dependencies: {
                          type: "object",
                          required: ["database", "redis"],
                          properties: {
                            database: { const: "ready" },
                            redis: { const: "ready" },
                          },
                        },
                        timestamp: { type: "string", format: "date-time" },
                      },
                    },
                    ...requestIdProperty,
                  },
                },
              },
            },
          },
          "503": {
            description: "One or more required dependencies are unavailable.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["success", "error", "requestId"],
                  properties: {
                    success: { const: false },
                    error: {
                      type: "object",
                      required: ["code", "message", "details"],
                      properties: {
                        code: { const: "SERVICE_UNAVAILABLE" },
                        message: { type: "string" },
                        details: {
                          type: "object",
                          required: ["database", "redis"],
                          properties: {
                            database: { type: "string", enum: ["ready", "unavailable"] },
                            redis: { type: "string", enum: ["ready", "unavailable"] },
                          },
                        },
                      },
                    },
                    ...requestIdProperty,
                  },
                },
              },
            },
          },
        },
      },
    },
    ...authOpenApiPaths,
    ...administrationOpenApiPaths,
    ...documentsAuditOpenApiPaths,
    ...publicMediaOpenApiPaths,
    ...customersOpenApiPaths,
    ...sellersOpenApiPaths,
    ...catalogTaxonomyOpenApiPaths,
    ...productsOpenApiPaths,
    ...inventoryOpenApiPaths,
    ...searchDiscoveryOpenApiPaths,
    ...cartWishlistOpenApiPaths,
    ...promotionsOpenApiPaths,
    ...shippingOpenApiPaths,
    ...checkoutOpenApiPaths,
    ...ordersOpenApiPaths,
    ...paymentsOpenApiPaths,
    ...commissionsOpenApiPaths,
    ...returnsRefundsOpenApiPaths,
    ...sellerWalletPayoutsOpenApiPaths,
    ...reviewsOpenApiPaths,
    ...notificationsOpenApiPaths,
    ...reportsOpenApiPaths,
    ...dashboardOpenApiPaths,
  },
} as const;
