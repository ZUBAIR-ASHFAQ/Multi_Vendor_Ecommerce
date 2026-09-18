import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import {
  adminRoleDetailRoute,
  adminRolesRoute,
  adminSettingsRoute,
  adminUserDetailRoute,
  adminUsersRoute,
} from "@/app/routes/administration.routes";
import {
  accountRoute,
  loginRoute,
  registerRoute,
} from "@/app/routes/auth.routes";
import { indexRoute } from "@/app/routes/index.route";
import { dashboardRoute } from "@/app/routes/dashboard.routes";
import { cartRoute, wishlistRoute } from "@/app/routes/cart-wishlist.routes";
import { checkoutRoute } from "@/app/routes/checkout.routes";
import {
  adminOrdersRoute,
  customerOrderDetailRoute,
  customerOrdersRoute,
  sellerOrderDetailRoute,
  sellerOrdersRoute,
} from "@/app/routes/orders.routes";
import {
  adminCatalogAttributesRoute,
  adminCatalogBrandsRoute,
  adminCatalogCategoriesRoute,
  adminCatalogCategoryAttributesRoute,
  sellerCatalogTaxonomyRoute,
} from "@/app/routes/catalog-taxonomy.routes";
import {
  adminCustomerDetailRoute,
  adminCustomersRoute,
  customerAddressesRoute,
  customerProfileRoute,
} from "@/app/routes/customers.routes";
import { auditDetailRoute, auditRoute, documentsRoute } from "@/app/routes/documents-audit.routes";
import {
  adminSellerApplicationsRoute,
  adminSellerSuspensionRoute,
  publicStoreRoute,
  sellerApplicationRoute,
  sellerProfileRoute,
  sellerStaffRoute,
  sellerStoresRoute,
} from "@/app/routes/sellers.routes";
import {
  publicProductDetailRoute,
  publicProductsRoute,
  sellerProductCreateRoute,
  sellerProductEditRoute,
  sellerProductsRoute,
} from "@/app/routes/products.routes";
import {
  sellerInventoryMovementsRoute,
  sellerInventoryRoute,
  sellerInventoryVariantRoute,
} from "@/app/routes/inventory.routes";
import {
  searchProductsRoute,
  searchStoresRoute,
} from "@/app/routes/search-discovery.routes";
import {
  adminPromotionsRoute,
  sellerPromotionsRoute,
} from "@/app/routes/promotions.routes";
import {
  adminPaymentDetailRoute,
  adminPaymentsRoute,
  paymentStatusRoute,
} from "@/app/routes/payments.routes";
import {
  adminCommissionLedgerRoute,
  adminCommissionRulesRoute,
  sellerCommissionStatementRoute,
} from "@/app/routes/commissions.routes";
import {
  customerOrderShippingRoute,
  sellerOrderShippingRoute,
  sellerShipmentsRoute,
} from "@/app/routes/shipping.routes";
import { adminReviewsRoute, customerCreateReviewRoute } from "@/app/routes/reviews.routes";
import {
  adminNotificationDeliveriesRoute,
  notificationPreferencesRoute,
  notificationsRoute,
} from "@/app/routes/notifications.routes";
import {
  adminReturnsRoute,
  customerCreateReturnRoute,
  customerReturnsRoute,
  sellerReturnsRoute,
} from "@/app/routes/returns-refunds.routes";
import {
  adminPayoutsQueueRoute,
  sellerPayoutsRoute,
  sellerWalletRoute,
} from "@/app/routes/seller-wallet-payouts.routes";
import {
  commissionsReportRoute,
  inventoryReportRoute,
  payoutsReportRoute,
  refundsReportRoute,
  reportRunRoute,
  reportsCatalogRoute,
  salesReportRoute,
  sellersReportRoute,
} from "@/app/routes/reports.routes";
import { NotFoundPage } from "@/app/routes/not-found";
import { rootRoute } from "@/app/routes/root.route";

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  cartRoute,
  wishlistRoute,
  checkoutRoute,
  customerOrdersRoute,
  customerOrderDetailRoute,
  sellerOrdersRoute,
  sellerOrderDetailRoute,
  sellerShipmentsRoute,
  sellerOrderShippingRoute,
  customerOrderShippingRoute,
  customerReturnsRoute,
  customerCreateReturnRoute,
  customerCreateReviewRoute,
  adminReviewsRoute,
  notificationsRoute,
  notificationPreferencesRoute,
  adminNotificationDeliveriesRoute,
  sellerReturnsRoute,
  adminReturnsRoute,
  adminOrdersRoute,
  paymentStatusRoute,
  adminPaymentsRoute,
  adminPaymentDetailRoute,
  adminCommissionRulesRoute,
  adminCommissionLedgerRoute,
  sellerCommissionStatementRoute,
  sellerWalletRoute,
  sellerPayoutsRoute,
  adminPayoutsQueueRoute,
  reportsCatalogRoute,
  salesReportRoute,
  sellersReportRoute,
  inventoryReportRoute,
  refundsReportRoute,
  commissionsReportRoute,
  payoutsReportRoute,
  reportRunRoute,
  loginRoute,
  registerRoute,
  accountRoute,
  adminUsersRoute,
  adminUserDetailRoute,
  adminRolesRoute,
  adminRoleDetailRoute,
  adminSettingsRoute,
  documentsRoute,
  auditRoute,
  auditDetailRoute,
  customerProfileRoute,
  customerAddressesRoute,
  adminCustomersRoute,
  adminCustomerDetailRoute,
  sellerApplicationRoute,
  sellerProfileRoute,
  sellerStaffRoute,
  sellerStoresRoute,
  publicStoreRoute,
  adminSellerApplicationsRoute,
  adminSellerSuspensionRoute,
  adminCatalogCategoriesRoute,
  adminCatalogBrandsRoute,
  adminCatalogAttributesRoute,
  adminCatalogCategoryAttributesRoute,
  sellerCatalogTaxonomyRoute,
  publicProductsRoute,
  publicProductDetailRoute,
  sellerProductsRoute,
  sellerProductCreateRoute,
  sellerProductEditRoute,
  sellerInventoryRoute,
  sellerInventoryVariantRoute,
  sellerInventoryMovementsRoute,
  searchProductsRoute,
  searchStoresRoute,
  adminPromotionsRoute,
  sellerPromotionsRoute,
]);

/** Creates the application router with an optional in-memory history for tests. */
export function createAppRouter(history?: ReturnType<typeof createMemoryHistory>) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    defaultNotFoundComponent: NotFoundPage,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

export const appRouter = createAppRouter();

/** Creates a deterministic memory router for component tests. */
export function createTestRouter(initialEntries: string[] = ["/"]) {
  return createAppRouter(createMemoryHistory({ initialEntries }));
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}
