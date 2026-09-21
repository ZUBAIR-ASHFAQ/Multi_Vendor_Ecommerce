import cookieParser from "cookie-parser";
import express, { type Express, type Router } from "express";
import { API_V1_PREFIX } from "./common/openapi/openapi.contract.js";
import { configureAuthenticationService } from "./common/middleware/authentication.middleware.js";
import { RealtimeService } from "./common/realtime/realtime.service.js";
import { appConfig } from "./config/app.config.js";
import { env } from "./config/env.js";
import { createPayoutProviderAdapter } from "./integrations/payouts/payout-provider.factory.js";
import { createNotificationEmailProvider } from "./integrations/email/notification-email-provider.factory.js";
import {
  corsMiddleware,
  errorMiddleware,
  globalRateLimitMiddleware,
  healthRouter,
  helmetMiddleware,
  httpLoggerMiddleware,
  notFoundMiddleware,
  registerOpenApi,
  requestIdMiddleware,
} from "./http/index.js";
import {
  AdministrationController,
  AdministrationService,
  AuthController,
  AuthService,
  createAdministrationRouter,
  createAuthRouter,
  type CustomerRegistrationProvisionInput,
  type SellerStaffLifecycleCoordinator,
} from "./modules/administration/index.js";
import {
  createAdminCustomersRouter,
  createCustomersRouter,
  CustomersController,
  CustomersService,
} from "./modules/customers/index.js";
import {
  CompositeDocumentResourcePolicy,
  createAuditRouter,
  createDocumentsAuditServiceFromEnvironment,
  createDocumentsRouter,
  CurrentDocumentResourcePolicy,
  DocumentsAuditController,
  type DocumentResourcePolicy,
  type DocumentsAuditService,
} from "./modules/documents-audit/index.js";
import {
  createPublicMediaRouter,
  PublicMediaController,
  PublicMediaService,
} from "./modules/public-media/index.js";
import {
  createAdminSellerApplicationsRouter,
  createAdminSellersRouter,
  createPublicStoresRouter,
  createSellersRouter,
  SELLER_SYSTEM_ROLE,
  SellersController,
  SellersService,
} from "./modules/sellers/index.js";
import {
  CatalogTaxonomyController,
  CatalogTaxonomyService,
  createAdminCatalogTaxonomyRouter,
  createCatalogTaxonomyRouter,
} from "./modules/catalog-taxonomy/index.js";
import {
  createAdminProductsRouter,
  createPublicProductsRouter,
  createSellerProductsRouter,
  ProductsController,
  ProductsService,
} from "./modules/products/index.js";
import {
  createInternalInventoryRouter,
  createSellerInventoryRouter,
  InventoryController,
  InventoryService,
} from "./modules/inventory/index.js";
import {
  createAdminSearchDiscoveryRouter,
  createPublicSearchDiscoveryRouter,
  SearchDiscoveryController,
  SearchDiscoveryService,
} from "./modules/search-discovery/index.js";
import {
  CartWishlistController,
  CartWishlistService,
  createCartRouter,
  createWishlistRouter,
} from "./modules/cart-wishlist/index.js";
import {
  createAdminPromotionsRouter,
  createPromotionsRouter,
  createSellerPromotionsRouter,
  PromotionsController,
  PromotionsService,
} from "./modules/promotions/index.js";
import {
  createOrderShippingRouter,
  createSellerShippingRouter,
  createShippingRouter,
  ShippingController,
  ShippingService,
} from "./modules/shipping/index.js";
import {
  CheckoutController,
  CheckoutService,
  createCheckoutRouter,
} from "./modules/checkout/index.js";
import {
  createAdminOrdersRouter,
  createCustomerOrdersRouter,
  createInternalOrdersRouter,
  createSellerOrdersRouter,
  OrdersController,
  OrdersService,
} from "./modules/orders/index.js";
import {
  createAdminPaymentsRouter,
  createInternalPaymentsRouter,
  createPaymentsRouter,
  createStripeWebhookRouter,
  PaymentsController,
  PaymentsService,
} from "./modules/payments/index.js";
import {
  CommissionsController,
  CommissionsService,
  createAdminCommissionsRouter,
  createInternalCommissionsRouter,
  createSellerCommissionsRouter,
} from "./modules/commissions/index.js";
import {
  createAdminReturnsRouter,
  createOrderReturnsRouter,
  createReturnsRouter,
  createSellerReturnsRouter,
  ReturnsRefundsController,
  ReturnsRefundsService,
} from "./modules/returns-refunds/index.js";
import {
  createAdminReviewsRouter,
  createProductReviewsRouter,
  createReviewsRouter,
  createStoreReviewsRouter,
  ReviewsController,
  ReviewsService,
} from "./modules/reviews/index.js";
import {
  createAdminPayoutsRouter,
  createInternalWalletRouter,
  createSellerWalletPayoutsRouter,
  SellerWalletPayoutsController,
  SellerWalletPayoutsService,
} from "./modules/seller-wallet-payouts/index.js";
import {
  createAdminNotificationDeliveriesRouter,
  createNotificationsRouter,
  DefaultNotificationDispatchPolicy,
  NotificationsController,
  NotificationsService,
} from "./modules/notifications/index.js";
import {
  createReportsRouter,
  ReportsController,
  ReportsService,
} from "./modules/reports/index.js";
import {
  createDashboardRouter,
  DashboardController,
  DashboardService,
} from "./modules/dashboard/index.js";

/** Routers that require runtime cross-module service composition before they are mounted. */
interface ComposedRouters {
  auth: Router;
  administration: Router;
  documents: Router;
  publicMedia: Router;
  audit: Router;
  customers: Router;
  adminCustomers: Router;
  sellers: Router;
  publicStores: Router;
  adminSellerApplications: Router;
  adminSellers: Router;
  catalogTaxonomy: Router;
  adminCatalogTaxonomy: Router;
  publicProducts: Router;
  sellerProducts: Router;
  adminProducts: Router;
  sellerInventory: Router;
  internalInventory: Router;
  publicSearch: Router;
  adminSearch: Router;
  cart: Router;
  wishlist: Router;
  promotions: Router;
  sellerPromotions: Router;
  adminPromotions: Router;
  shipping: Router;
  sellerShipping: Router;
  orderShipping: Router;
  checkout: Router;
  customerOrders: Router;
  sellerOrders: Router;
  adminOrders: Router;
  internalOrders: Router;
  paymentsWebhook: Router;
  payments: Router;
  adminPayments: Router;
  internalPayments: Router;
  adminCommissions: Router;
  sellerCommissions: Router;
  internalCommissions: Router;
  orderReturns: Router;
  returns: Router;
  sellerReturns: Router;
  adminReturns: Router;
  sellerWalletPayouts: Router;
  adminPayouts: Router;
  internalWallet: Router;
  reviews: Router;
  productReviews: Router;
  storeReviews: Router;
  adminReviews: Router;
  notifications: Router;
  adminNotificationDeliveries: Router;
  reports: Router;
  dashboard: Router;
}

/** Provisions the Module 3 customer profile inside the Module 2 registration transaction. */
async function provisionRegisteredCustomer(
  input: CustomerRegistrationProvisionInput,
): Promise<void> {
  await CustomersService.using(input.transaction).provisionRegisteredCustomer({
    userId: input.userId,
    displayName: input.displayName,
    accountType: input.accountType,
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
}

/** Holds routers plus service instances shared with background runtimes. */
interface ComposedApplication {
  routers: ComposedRouters;
  authService: AuthService;
  realtimeService: RealtimeService;
  inventoryService: InventoryService;
  searchDiscoveryService: SearchDiscoveryService;
  paymentsService: PaymentsService;
  commissionsService: CommissionsService;
  sellerWalletPayoutsService: SellerWalletPayoutsService;
  notificationsService: NotificationsService;
  reportsService: ReportsService;
}

/** Builds all currently required cross-module callbacks without introducing reverse module imports. */
function createComposedApplication(): ComposedApplication {
  const sellerStaffLifecycle: SellerStaffLifecycleCoordinator = {
    /** Validates newly assigned seller IDs through the transaction-bound Module 4 service. */
    async validateAssignableSellerIds(input) {
      await SellersService.using(input.transaction).validateAssignableSellerIds(
        input.sellerIds,
      );
    },

    /** Synchronizes seller_staff inside the same transaction as the Module 2 role replacement. */
    async synchronizeMemberships(input) {
      await SellersService.using(input.transaction).synchronizeSellerStaff({
        userId: input.userId,
        addedSellerIds: input.addedSellerIds,
        removedSellerIds: input.removedSellerIds,
        actorId: input.actorId,
        actorType: input.actorType,
        requestId: input.requestId,
      });
    },
  };

  const administrationService =
    AdministrationService.withSellerStaffLifecycle(sellerStaffLifecycle);
  let documentsService: DocumentsAuditService | null = null;

  const sellersService = new SellersService({
    administration: {
      /** Uses Module 2's transaction-bound service to preserve identity/RBAC ownership during seller approval. */
      async provisionApprovedSellerOwner(input) {
        await AdministrationService.using(
          input.transaction,
        ).provisionSellerScopedIdentity({
          userId: input.userId,
          sellerId: input.sellerId,
          roleCode: SELLER_SYSTEM_ROLE.OWNER.code,
          actorId: input.actorId,
          actorType: input.actorType,
          requestId: input.requestId,
        });
      },

      /** Reads the Administration-owned supported-currency setting through its service boundary. */
      async isSupportedCurrency(currency) {
        return administrationService.isSupportedCurrency(currency);
      },

      /** Exposes only the normalized seller-facing currency allow-list, never the full settings surface. */
      async getSupportedCurrencies() {
        return administrationService.getSupportedCurrencies();
      },

      /** Reuses the Administration-owned default when initializing seller store creation. */
      async getDefaultCurrency() {
        return administrationService.getDefaultCurrency();
      },
    },
    /** Reuses Module 21's file authorization and purpose validation for store logos. */
    async storeAssetValidator(context, fileId, purpose) {
      if (!documentsService) {
        throw new Error("Documents service composition is not ready.");
      }
      await documentsService.assertFileUsableForPurpose(
        context,
        fileId,
        purpose,
      );
    },
  });

  const authService = new AuthService(
    provisionRegisteredCustomer,
    /** Filters role-derived seller IDs through current seller_staff/seller/store lifecycle state. */
    async ({ userId, authorizedSellerIds }) =>
      sellersService.resolveAccessScopes(userId, authorizedSellerIds),
  );
  configureAuthenticationService(authService);

  const sellerDocumentPolicy: DocumentResourcePolicy = {
    /** Delegates seller/application/store resource checks to Module 4 without Module 21 importing it. */
    async authorize(context, resourceType, resourceId, action) {
      return sellersService.authorizeDocumentResource(
        context,
        resourceType,
        resourceId,
        action,
      );
    },
  };
  const resourcePolicy = new CompositeDocumentResourcePolicy([
    new CurrentDocumentResourcePolicy(),
    sellerDocumentPolicy,
  ]);
  documentsService = createDocumentsAuditServiceFromEnvironment(resourcePolicy);
  const reportsService = new ReportsService({ documents: documentsService });
  const reportsController = new ReportsController(reportsService);
  const dashboardService = new DashboardService({ reports: reportsService });
  const dashboardController = new DashboardController(dashboardService);
  const documentsAuditController = new DocumentsAuditController(documentsService);
  const publicMediaController = new PublicMediaController(new PublicMediaService());
  const sellersController = new SellersController(sellersService);
  const catalogTaxonomyService = new CatalogTaxonomyService();
  const catalogTaxonomyController = new CatalogTaxonomyController(
    catalogTaxonomyService,
  );
  let inventoryService: InventoryService;
  let reviewsService: ReviewsService;
  const productsService = new ProductsService({
    taxonomy: catalogTaxonomyService,
    sellers: sellersService,
    currencies: administrationService,
    documents: documentsService,
    inventory: {
      /** Resolves public stock presentation only after Inventory composition is complete. */
      async getPublicVariantAvailability(variantIds) {
        return inventoryService.getPublicVariantAvailability(variantIds);
      },
    },
    ratings: {
      /** Resolves public card ratings only after Reviews composition is complete. */
      async getPublishedRatingAggregates(productIds) {
        return reviewsService.getPublishedRatingAggregates(productIds);
      },
    },
    moderationRequired: appConfig.productModerationRequired,
  });
  const productsController = new ProductsController(productsService);
  inventoryService = new InventoryService({ products: productsService });
  const inventoryController = new InventoryController(inventoryService);
  const cartWishlistService = new CartWishlistService({
    products: productsService,
    inventory: inventoryService,
    currencies: administrationService,
  });
  const cartWishlistController = new CartWishlistController(cartWishlistService);
  const promotionsService = new PromotionsService({
    sellers: sellersService,
    products: productsService,
    catalog: catalogTaxonomyService,
    cart: cartWishlistService,
  });
  const promotionsController = new PromotionsController(promotionsService);
  const customersService = new CustomersService();
  const customersController = new CustomersController(customersService);
  const ordersService = new OrdersService();
  const ordersController = new OrdersController(ordersService);
  const shippingService = new ShippingService({
    customers: customersService,
    cart: cartWishlistService,
    products: productsService,
    currencies: administrationService,
    orders: ordersService,
    /** Keeps Shipping and Orders writes inside the same database transaction. */
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
    /** Keeps Shipment stock issue inside the same database transaction as Shipping state. */
    inventoryUsingTransaction: (transaction) => InventoryService.using(transaction),
  });
  const shippingController = new ShippingController(shippingService);
  reviewsService = new ReviewsService({
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
    shippingUsingTransaction: (transaction) => ShippingService.using(transaction),
    sellers: sellersService,
    moderationRequired: appConfig.reviewModerationRequired,
  });
  const reviewsController = new ReviewsController(reviewsService);
  const searchDiscoveryService = new SearchDiscoveryService({
    products: productsService,
    catalog: catalogTaxonomyService,
    inventory: inventoryService,
    ratings: reviewsService,
  });
  const searchDiscoveryController = new SearchDiscoveryController(
    searchDiscoveryService,
  );
  const checkoutService = new CheckoutService({
    customers: customersService,
    cart: cartWishlistService,
    products: productsService,
    inventory: inventoryService,
    promotions: promotionsService,
    /** Keeps coupon usage enforcement inside the same transaction as Order creation. */
    promotionsUsingTransaction: (transaction) => PromotionsService.using(transaction),
    shipping: shippingService,
    administration: administrationService,
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
  });
  const checkoutController = new CheckoutController(checkoutService);
  const paymentsService = new PaymentsService({
    administration: administrationService,
    orders: ordersService,
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
  });
  const paymentsController = new PaymentsController(paymentsService);
  const commissionsService = new CommissionsService({
    orders: ordersService,
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
    payments: paymentsService,
    products: productsService,
    promotions: promotionsService,
    sellers: sellersService,
    catalog: catalogTaxonomyService,
  });
  const commissionsController = new CommissionsController(commissionsService);
  const returnsRefundsService = new ReturnsRefundsService({
    administration: administrationService,
    payments: paymentsService,
    inventory: inventoryService,
    commissions: commissionsService,
    ordersUsingTransaction: (transaction) => OrdersService.using(transaction),
    shippingUsingTransaction: (transaction) => ShippingService.using(transaction),
  });
  const returnsRefundsController = new ReturnsRefundsController(returnsRefundsService);
  /** Keeps the production clock unchanged while allowing the non-production E2E hold window to advance. */
  const walletPayoutNow = () =>
    new Date(Date.now() + env.WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS * 24 * 60 * 60 * 1_000);
  const payoutProvider = createPayoutProviderAdapter({
    mode: env.PAYOUT_PROVIDER_MODE,
    ...(env.PAYOUT_PROVIDER_TYPE ? { providerType: env.PAYOUT_PROVIDER_TYPE } : {}),
    ...(env.PAYOUT_PROVIDER_ADAPTER_MODULE
      ? { moduleSpecifier: env.PAYOUT_PROVIDER_ADAPTER_MODULE }
      : {}),
    now: walletPayoutNow,
  });
  const sellerWalletPayoutsService = new SellerWalletPayoutsService({
    commissions: commissionsService,
    shipping: shippingService,
    administration: administrationService,
    sellers: sellersService,
    provider: payoutProvider,
    now: walletPayoutNow,
  });
  const sellerWalletPayoutsController = new SellerWalletPayoutsController(
    sellerWalletPayoutsService,
  );
  const realtimeService = new RealtimeService();
  const notificationEmailProvider = createNotificationEmailProvider({
    mode: env.NOTIFICATION_EMAIL_PROVIDER_MODE,
    ...(env.RESEND_API_KEY ? { apiKey: env.RESEND_API_KEY } : {}),
    ...(env.NOTIFICATION_EMAIL_FROM ? { from: env.NOTIFICATION_EMAIL_FROM } : {}),
    ...(env.RESEND_API_BASE_URL ? { baseUrl: env.RESEND_API_BASE_URL } : {}),
  });
  const notificationsService = new NotificationsService({
    administration: administrationService,
    emailProvider: notificationEmailProvider,
    realtimePublisher: realtimeService,
    dispatchPolicy: new DefaultNotificationDispatchPolicy({
      orders: ordersService,
      sellers: sellersService,
    }),
  });
  const notificationsController = new NotificationsController(notificationsService);

  const routers: ComposedRouters = {
    auth: createAuthRouter(new AuthController(authService)),
    administration: createAdministrationRouter(
      new AdministrationController(administrationService),
    ),
    documents: createDocumentsRouter(documentsAuditController),
    publicMedia: createPublicMediaRouter(publicMediaController),
    audit: createAuditRouter(documentsAuditController),
    customers: createCustomersRouter(customersController),
    adminCustomers: createAdminCustomersRouter(customersController),
    sellers: createSellersRouter(sellersController),
    publicStores: createPublicStoresRouter(sellersController),
    adminSellerApplications: createAdminSellerApplicationsRouter(
      sellersController,
    ),
    adminSellers: createAdminSellersRouter(sellersController),
    catalogTaxonomy: createCatalogTaxonomyRouter(catalogTaxonomyController),
    adminCatalogTaxonomy: createAdminCatalogTaxonomyRouter(
      catalogTaxonomyController,
    ),
    publicProducts: createPublicProductsRouter(productsController),
    sellerProducts: createSellerProductsRouter(productsController),
    adminProducts: createAdminProductsRouter(productsController),
    sellerInventory: createSellerInventoryRouter(inventoryController),
    internalInventory: createInternalInventoryRouter(inventoryController),
    publicSearch: createPublicSearchDiscoveryRouter(searchDiscoveryController),
    adminSearch: createAdminSearchDiscoveryRouter(searchDiscoveryController),
    cart: createCartRouter(cartWishlistController),
    wishlist: createWishlistRouter(cartWishlistController),
    promotions: createPromotionsRouter(promotionsController),
    sellerPromotions: createSellerPromotionsRouter(promotionsController),
    adminPromotions: createAdminPromotionsRouter(promotionsController),
    shipping: createShippingRouter(shippingController),
    sellerShipping: createSellerShippingRouter(shippingController),
    orderShipping: createOrderShippingRouter(shippingController),
    checkout: createCheckoutRouter(checkoutController),
    customerOrders: createCustomerOrdersRouter(ordersController),
    sellerOrders: createSellerOrdersRouter(ordersController),
    adminOrders: createAdminOrdersRouter(ordersController),
    internalOrders: createInternalOrdersRouter(ordersController),
    paymentsWebhook: createStripeWebhookRouter(paymentsController),
    payments: createPaymentsRouter(paymentsController),
    adminPayments: createAdminPaymentsRouter(paymentsController),
    internalPayments: createInternalPaymentsRouter(paymentsController),
    adminCommissions: createAdminCommissionsRouter(commissionsController),
    sellerCommissions: createSellerCommissionsRouter(commissionsController),
    internalCommissions: createInternalCommissionsRouter(commissionsController),
    orderReturns: createOrderReturnsRouter(returnsRefundsController),
    returns: createReturnsRouter(returnsRefundsController),
    sellerReturns: createSellerReturnsRouter(returnsRefundsController),
    adminReturns: createAdminReturnsRouter(returnsRefundsController),
    sellerWalletPayouts: createSellerWalletPayoutsRouter(sellerWalletPayoutsController),
    adminPayouts: createAdminPayoutsRouter(sellerWalletPayoutsController),
    internalWallet: createInternalWalletRouter(sellerWalletPayoutsController),
    reviews: createReviewsRouter(reviewsController),
    productReviews: createProductReviewsRouter(reviewsController),
    storeReviews: createStoreReviewsRouter(reviewsController),
    adminReviews: createAdminReviewsRouter(reviewsController),
    notifications: createNotificationsRouter(notificationsController),
    adminNotificationDeliveries: createAdminNotificationDeliveriesRouter(
      notificationsController,
    ),
    reports: createReportsRouter(reportsController),
    dashboard: createDashboardRouter(dashboardController),
  };

  return {
    routers,
    authService,
    realtimeService,
    inventoryService,
    searchDiscoveryService,
    paymentsService,
    commissionsService,
    sellerWalletPayoutsService,
    notificationsService,
    reportsService,
  };
}

/** Builds the Express application from one already-composed router set. */
function buildApp(routers: ComposedRouters): Express {
  const app = express();
  const {
    auth: authRouter,
    administration: administrationRouter,
    documents: documentsRouter,
    publicMedia: publicMediaRouter,
    audit: auditRouter,
    customers: customersRouter,
    adminCustomers: adminCustomersRouter,
    sellers: sellersRouter,
    publicStores: publicStoresRouter,
    adminSellerApplications: adminSellerApplicationsRouter,
    adminSellers: adminSellersRouter,
    catalogTaxonomy: catalogTaxonomyRouter,
    adminCatalogTaxonomy: adminCatalogTaxonomyRouter,
    publicProducts: publicProductsRouter,
    sellerProducts: sellerProductsRouter,
    adminProducts: adminProductsRouter,
    sellerInventory: sellerInventoryRouter,
    internalInventory: internalInventoryRouter,
    publicSearch: publicSearchRouter,
    adminSearch: adminSearchRouter,
    cart: cartRouter,
    wishlist: wishlistRouter,
    promotions: promotionsRouter,
    sellerPromotions: sellerPromotionsRouter,
    adminPromotions: adminPromotionsRouter,
    shipping: shippingRouter,
    sellerShipping: sellerShippingRouter,
    orderShipping: orderShippingRouter,
    checkout: checkoutRouter,
    customerOrders: customerOrdersRouter,
    sellerOrders: sellerOrdersRouter,
    adminOrders: adminOrdersRouter,
    internalOrders: internalOrdersRouter,
    paymentsWebhook: paymentsWebhookRouter,
    payments: paymentsRouter,
    adminPayments: adminPaymentsRouter,
    internalPayments: internalPaymentsRouter,
    adminCommissions: adminCommissionsRouter,
    sellerCommissions: sellerCommissionsRouter,
    internalCommissions: internalCommissionsRouter,
    orderReturns: orderReturnsRouter,
    returns: returnsRouter,
    sellerReturns: sellerReturnsRouter,
    adminReturns: adminReturnsRouter,
    sellerWalletPayouts: sellerWalletPayoutsRouter,
    adminPayouts: adminPayoutsRouter,
    internalWallet: internalWalletRouter,
    reviews: reviewsRouter,
    productReviews: productReviewsRouter,
    storeReviews: storeReviewsRouter,
    adminReviews: adminReviewsRouter,
    notifications: notificationsRouter,
    adminNotificationDeliveries: adminNotificationDeliveriesRouter,
    reports: reportsRouter,
    dashboard: dashboardRouter,
  } = routers;

  app.disable("x-powered-by");
  if (appConfig.trustProxy) app.set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(globalRateLimitMiddleware);

  // Stripe signature verification needs the exact raw bytes before normal JSON parsing.
  app.use(`${API_V1_PREFIX}/payments`, paymentsWebhookRouter);

  app.use(express.json({ limit: appConfig.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: appConfig.bodyLimit }));
  app.use(cookieParser());

  app.use(healthRouter);
  registerOpenApi(app);

  // Mount business routers in generation order.
  app.use(`${API_V1_PREFIX}/auth`, authRouter);
  app.use(`${API_V1_PREFIX}/admin`, administrationRouter);
  app.use(`${API_V1_PREFIX}/documents`, documentsRouter);
  app.use(`${API_V1_PREFIX}/media`, publicMediaRouter);
  app.use(`${API_V1_PREFIX}/audit`, auditRouter);
  app.use(`${API_V1_PREFIX}/customers`, customersRouter);
  app.use(`${API_V1_PREFIX}/admin/customers`, adminCustomersRouter);
  app.use(`${API_V1_PREFIX}/sellers`, sellersRouter);
  app.use(`${API_V1_PREFIX}/stores`, publicStoresRouter);
  app.use(
    `${API_V1_PREFIX}/admin/seller-applications`,
    adminSellerApplicationsRouter,
  );
  app.use(`${API_V1_PREFIX}/admin/sellers`, adminSellersRouter);
  app.use(`${API_V1_PREFIX}/catalog`, catalogTaxonomyRouter);
  app.use(`${API_V1_PREFIX}/admin/catalog`, adminCatalogTaxonomyRouter);
  app.use(`${API_V1_PREFIX}/products`, publicProductsRouter);
  app.use(`${API_V1_PREFIX}/seller/products`, sellerProductsRouter);
  app.use(`${API_V1_PREFIX}/admin/products`, adminProductsRouter);
  app.use(`${API_V1_PREFIX}/seller/inventory`, sellerInventoryRouter);
  app.use(`${API_V1_PREFIX}/internal/inventory`, internalInventoryRouter);
  app.use(`${API_V1_PREFIX}/search`, publicSearchRouter);
  app.use(`${API_V1_PREFIX}/admin/search`, adminSearchRouter);
  app.use(`${API_V1_PREFIX}/cart`, cartRouter);
  app.use(`${API_V1_PREFIX}/wishlist`, wishlistRouter);
  app.use(`${API_V1_PREFIX}/promotions`, promotionsRouter);
  app.use(`${API_V1_PREFIX}/seller/promotions`, sellerPromotionsRouter);
  app.use(`${API_V1_PREFIX}/admin/promotions`, adminPromotionsRouter);
  app.use(`${API_V1_PREFIX}/checkout`, shippingRouter);
  app.use(`${API_V1_PREFIX}/checkout`, checkoutRouter);
  app.use(`${API_V1_PREFIX}/seller`, sellerShippingRouter);
  app.use(`${API_V1_PREFIX}/orders`, orderShippingRouter);
  app.use(`${API_V1_PREFIX}/orders`, customerOrdersRouter);
  app.use(`${API_V1_PREFIX}/seller/orders`, sellerOrdersRouter);
  app.use(`${API_V1_PREFIX}/admin/orders`, adminOrdersRouter);
  app.use(`${API_V1_PREFIX}/internal/orders`, internalOrdersRouter);
  app.use(`${API_V1_PREFIX}/payments`, paymentsRouter);
  app.use(`${API_V1_PREFIX}/admin/payments`, adminPaymentsRouter);
  app.use(`${API_V1_PREFIX}/internal/payments`, internalPaymentsRouter);
  app.use(`${API_V1_PREFIX}/admin/commissions`, adminCommissionsRouter);
  app.use(`${API_V1_PREFIX}/seller/commissions`, sellerCommissionsRouter);
  app.use(`${API_V1_PREFIX}/internal/commissions`, internalCommissionsRouter);
  app.use(`${API_V1_PREFIX}/orders`, orderReturnsRouter);
  app.use(`${API_V1_PREFIX}/returns`, returnsRouter);
  app.use(`${API_V1_PREFIX}/seller/returns`, sellerReturnsRouter);
  app.use(`${API_V1_PREFIX}/admin/returns`, adminReturnsRouter);
  app.use(`${API_V1_PREFIX}/seller`, sellerWalletPayoutsRouter);
  app.use(`${API_V1_PREFIX}/admin/payouts`, adminPayoutsRouter);
  app.use(`${API_V1_PREFIX}/internal/wallet`, internalWalletRouter);
  app.use(`${API_V1_PREFIX}/reviews`, reviewsRouter);
  app.use(`${API_V1_PREFIX}/products`, productReviewsRouter);
  app.use(`${API_V1_PREFIX}/stores`, storeReviewsRouter);
  app.use(`${API_V1_PREFIX}/admin/reviews`, adminReviewsRouter);
  app.use(`${API_V1_PREFIX}/notifications`, notificationsRouter);
  app.use(
    `${API_V1_PREFIX}/admin/notification-deliveries`,
    adminNotificationDeliveriesRouter,
  );
  app.use(`${API_V1_PREFIX}/reports`, reportsRouter);
  app.use(`${API_V1_PREFIX}/dashboard`, dashboardRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

/** Builds a fresh application composition for tests that need isolated service instances. */
export function createApp(): Express {
  return buildApp(createComposedApplication().routers);
}

const defaultComposition = createComposedApplication();

/** Auth service shared by HTTP middleware and Socket.IO handshake authentication. */
export const authService = defaultComposition.authService;

/** Realtime transport shared by the HTTP server bootstrap and Module 18 Notification service. */
export const realtimeService = defaultComposition.realtimeService;

/** Inventory service shared by the default HTTP application and lifecycle-maintenance runtime. */
export const inventoryService = defaultComposition.inventoryService;

/** Search service shared by the default HTTP application and its background runtime. */
export const searchDiscoveryService = defaultComposition.searchDiscoveryService;

/** Payments service shared by the default HTTP application and reconciliation worker. */
export const paymentsService = defaultComposition.paymentsService;

/** Commissions service shared by the default HTTP application and later finance integrations. */
export const commissionsService = defaultComposition.commissionsService;

/** Seller Wallet/Payout service shared by the HTTP application and Module 17 background runtime. */
export const sellerWalletPayoutsService = defaultComposition.sellerWalletPayoutsService;

/** Notifications service shared by the HTTP application and Module 18 background runtime. */
export const notificationsService = defaultComposition.notificationsService;

/** Reports service shared by the HTTP application and Module 20 asynchronous export runtime. */
export const reportsService = defaultComposition.reportsService;

export const app = buildApp(defaultComposition.routers);
