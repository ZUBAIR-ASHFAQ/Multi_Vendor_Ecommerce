import { relations } from "drizzle-orm";
import { outboxEvents } from "./schema/foundation.js";
import { auditLogs, fileLinks, files } from "./schema/audit.js";
import { cartItems, carts, wishlistItems, wishlists } from "./schema/cart-wishlist.js";
import { customerAddresses, customerProfiles } from "./schema/customers.js";
import {
  checkoutAttempts,
  checkoutQuoteLines,
  checkoutQuotes,
  checkoutQuoteShippingSelections,
} from "./schema/checkout.js";
import {
  attributeValues,
  attributes,
  brands,
  categories,
  categoryAttributes,
} from "./schema/catalog.js";
import {
  sellerApplications,
  sellers,
  sellerStaff,
  stores,
} from "./schema/sellers.js";
import {
  productAttributeValues,
  productMedia,
  productPriceHistory,
  products,
  productVariants,
} from "./schema/products.js";
import { inventoryItems, stockMovements, stockReservations } from "./schema/inventory.js";
import { productSearchDocuments } from "./schema/search-discovery.js";
import {
  reviewHelpfulVotes,
  reviewModerationHistory,
  reviews,
} from "./schema/reviews.js";
import {
  notificationDeliveries,
  notificationPreferences,
  notifications,
} from "./schema/notifications.js";
import {
  reportDefinitions,
  reportRuns,
  savedReportFilters,
} from "./schema/reports.js";
import {
  dashboardPreferences,
  dashboardSavedFilters,
} from "./schema/dashboard.js";
import {
  orderAddresses,
  orderItems,
  orders,
  orderStatusHistory,
  sellerOrders,
} from "./schema/orders.js";
import {
  shipmentItems,
  shipments,
  shipmentStatusHistory,
  shippingMethods,
} from "./schema/shipping.js";
import {
  paymentTransactions,
  paymentWebhookEvents,
  payments,
} from "./schema/payments.js";
import {
  disputeNotes,
  refunds,
  returnItems,
  returnRequests,
  returnStatusHistory,
} from "./schema/returns-refunds.js";
import {
  commissionEntries,
  commissionRuleSnapshots,
  commissionRules,
} from "./schema/commissions.js";
import {
  payoutAccounts,
  payoutAllocations,
  payouts,
  sellerWalletEntries,
  sellerWallets,
} from "./schema/seller-wallet-payouts.js";
import {
  couponRedemptions,
  coupons,
  promotionScopes,
  promotions,
} from "./schema/promotions.js";
import {
  refreshSessions,
  permissions,
  platformSettings,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "./schema/administration.js";

/** Relational-query metadata for Administration/Auth tables. Foreign-key integrity remains defined on the tables. */
export const usersRelations = relations(users, ({ one, many }) => ({
  roleMemberships: many(userRoles, { relationName: "user_role_member" }),
  roleAssignmentsMade: many(userRoles, { relationName: "user_role_assigner" }),
  permissionAssignmentsMade: many(rolePermissions, {
    relationName: "role_permission_assigner",
  }),
  refreshSessions: many(refreshSessions),
  platformSettingsUpdated: many(platformSettings),
  filesOwned: many(files),
  fileLinksCreated: many(fileLinks),
  auditLogs: many(auditLogs),
  customerProfile: one(customerProfiles),
  sellerApplications: many(sellerApplications, {
    relationName: "seller_application_applicant",
  }),
  sellerApplicationsReviewed: many(sellerApplications, {
    relationName: "seller_application_reviewer",
  }),
  sellersOwned: many(sellers),
  sellerStaffMemberships: many(sellerStaff),
  productsCreated: many(products),
  productPriceChanges: many(productPriceHistory),
  stockMovements: many(stockMovements),
  orderStatusChanges: many(orderStatusHistory),
  returnStatusChanges: many(returnStatusHistory),
  disputeNotes: many(disputeNotes),
  reviewHelpfulVotes: many(reviewHelpfulVotes),
  reviewModerationActions: many(reviewModerationHistory),
  notificationRecords: many(notifications),
  notificationDeliveries: many(notificationDeliveries),
  notificationPreferences: many(notificationPreferences),
  reportRunsRequested: many(reportRuns),
  savedReportFilters: many(savedReportFilters),
  dashboardPreference: one(dashboardPreferences),
  dashboardSavedFilters: many(dashboardSavedFilters),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
    relationName: "user_role_member",
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  assignedByUser: one(users, {
    fields: [userRoles.assignedBy],
    references: [users.id],
    relationName: "user_role_assigner",
  }),
  seller: one(sellers, {
    fields: [userRoles.sellerId],
    references: [sellers.id],
  }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
  assignedByUser: one(users, {
    fields: [rolePermissions.assignedBy],
    references: [users.id],
    relationName: "role_permission_assigner",
  }),
}));

export const refreshSessionsRelations = relations(refreshSessions, ({ one }) => ({
  user: one(users, {
    fields: [refreshSessions.userId],
    references: [users.id],
  }),
}));

/** Relates each platform setting to the administrator who last changed it. */
export const platformSettingsRelations = relations(platformSettings, ({ one }) => ({
  updatedByUser: one(users, {
    fields: [platformSettings.updatedBy],
    references: [users.id],
  }),
}));

/** Relates one customer commerce profile to identity and its customer-owned commerce records. */
export const customerProfilesRelations = relations(customerProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [customerProfiles.userId],
    references: [users.id],
  }),
  addresses: many(customerAddresses),
  stockReservations: many(stockReservations),
  cart: one(carts),
  wishlists: many(wishlists),
  couponRedemptions: many(couponRedemptions),
  checkoutQuotes: many(checkoutQuotes),
  checkoutAttempts: many(checkoutAttempts),
  orders: many(orders),
  returnRequests: many(returnRequests),
  reviews: many(reviews),
}));

/** Relates one saved address to the customer profile that owns it. */
export const customerAddressesRelations = relations(customerAddresses, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [customerAddresses.customerUserId],
    references: [customerProfiles.userId],
  }),
  shippingCheckoutQuotes: many(checkoutQuotes, {
    relationName: "checkout_shipping_address",
  }),
  billingCheckoutQuotes: many(checkoutQuotes, {
    relationName: "checkout_billing_address",
  }),
  orderAddressSnapshots: many(orderAddresses),
}));

/** Relates seller applications to the applicant and optional reviewing administrator. */
export const sellerApplicationsRelations = relations(sellerApplications, ({ one }) => ({
  applicantUser: one(users, {
    fields: [sellerApplications.applicantUserId],
    references: [users.id],
    relationName: "seller_application_applicant",
  }),
  reviewedByUser: one(users, {
    fields: [sellerApplications.reviewedBy],
    references: [users.id],
    relationName: "seller_application_reviewer",
  }),
}));

/** Relates one seller master to its owner, stores, staff, role memberships, products, inventory, promotions, and Shipping methods. */
export const sellersRelations = relations(sellers, ({ one, many }) => ({
  ownerUser: one(users, {
    fields: [sellers.ownerUserId],
    references: [users.id],
  }),
  stores: many(stores),
  staff: many(sellerStaff),
  roleMemberships: many(userRoles),
  products: many(products),
  inventoryItems: many(inventoryItems),
  promotions: many(promotions),
  shippingMethods: many(shippingMethods),
  checkoutQuoteLines: many(checkoutQuoteLines),
  checkoutQuoteShippingSelections: many(checkoutQuoteShippingSelections),
  sellerOrders: many(sellerOrders),
  commissionEntries: many(commissionEntries),
  wallets: many(sellerWallets),
  payoutAccounts: many(payoutAccounts),
  payouts: many(payouts),
  reviews: many(reviews),
}));

/** Relates one store to its owning seller and optional Module 21 logo file. */
export const storesRelations = relations(stores, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [stores.sellerId],
    references: [sellers.id],
  }),
  logoFile: one(files, {
    fields: [stores.logoFileId],
    references: [files.id],
  }),
  products: many(products),
  inventoryItems: many(inventoryItems),
  checkoutQuoteLines: many(checkoutQuoteLines),
  checkoutQuoteShippingSelections: many(checkoutQuoteShippingSelections),
  sellerOrders: many(sellerOrders),
  reviews: many(reviews),
  dashboardDefaultPreferences: many(dashboardPreferences),
}));

/** Relates one seller-staff membership to its seller and Module 2 user identity. */
export const sellerStaffRelations = relations(sellerStaff, ({ one }) => ({
  seller: one(sellers, {
    fields: [sellerStaff.sellerId],
    references: [sellers.id],
  }),
  user: one(users, {
    fields: [sellerStaff.userId],
    references: [users.id],
  }),
}));

/** Relates a category to its parent, child categories, and allowed attribute rules. */
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  attributeMappings: many(categoryAttributes),
  products: many(products),
}));

/** Relates an attribute definition to its allowed values and category mappings. */
export const attributesRelations = relations(attributes, ({ many }) => ({
  values: many(attributeValues),
  categoryMappings: many(categoryAttributes),
  productValues: many(productAttributeValues),
}));

/** Relates one allowed attribute value to its reusable attribute definition. */
export const attributeValuesRelations = relations(attributeValues, ({ one, many }) => ({
  attribute: one(attributes, {
    fields: [attributeValues.attributeId],
    references: [attributes.id],
  }),
  productValues: many(productAttributeValues),
}));

/** Relates one category rule to both its category and reusable attribute definition. */
export const categoryAttributesRelations = relations(categoryAttributes, ({ one }) => ({
  category: one(categories, {
    fields: [categoryAttributes.categoryId],
    references: [categories.id],
  }),
  attribute: one(attributes, {
    fields: [categoryAttributes.attributeId],
    references: [attributes.id],
  }),
}));

/** Relates one product to its seller, store, taxonomy, variants, attributes, and media. */
export const productsRelations = relations(products, ({ one, many }) => ({
  seller: one(sellers, { fields: [products.sellerId], references: [sellers.id] }),
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  createdByUser: one(users, { fields: [products.createdBy], references: [users.id] }),
  variants: many(productVariants),
  attributeValues: many(productAttributeValues),
  media: many(productMedia),
  wishlistItems: many(wishlistItems),
  orderItems: many(orderItems),
  reviews: many(reviews),
}));

/** Relates one product variant to its product, attribute values, media, and price history. */
export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  attributeValues: many(productAttributeValues),
  media: many(productMedia),
  priceHistory: many(productPriceHistory),
  inventoryItems: many(inventoryItems),
  stockReservations: many(stockReservations),
  cartItems: many(cartItems),
  wishlistItems: many(wishlistItems),
  checkoutQuoteLines: many(checkoutQuoteLines),
  orderItems: many(orderItems),
}));

/** Relates one assigned product attribute value to product, optional variant, and taxonomy definition. */
export const productAttributeValuesRelations = relations(productAttributeValues, ({ one }) => ({
  product: one(products, { fields: [productAttributeValues.productId], references: [products.id] }),
  variant: one(productVariants, { fields: [productAttributeValues.variantId], references: [productVariants.id] }),
  attribute: one(attributes, { fields: [productAttributeValues.attributeId], references: [attributes.id] }),
  allowedValue: one(attributeValues, { fields: [productAttributeValues.valueId], references: [attributeValues.id] }),
}));

/** Relates one media row to its product, optional variant, and confirmed file metadata. */
export const productMediaRelations = relations(productMedia, ({ one }) => ({
  product: one(products, { fields: [productMedia.productId], references: [products.id] }),
  variant: one(productVariants, { fields: [productMedia.variantId], references: [productVariants.id] }),
  file: one(files, { fields: [productMedia.fileId], references: [files.id] }),
}));

/** Relates one immutable price-history row to its variant and the user who changed the price. */
export const productPriceHistoryRelations = relations(productPriceHistory, ({ one }) => ({
  variant: one(productVariants, { fields: [productPriceHistory.variantId], references: [productVariants.id] }),
  changedByUser: one(users, { fields: [productPriceHistory.changedBy], references: [users.id] }),
}));

/** Relates one Checkout quote to its owning customer, priced lines, and confirmation attempts. */
export const checkoutQuotesRelations = relations(checkoutQuotes, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [checkoutQuotes.customerUserId],
    references: [customerProfiles.userId],
  }),
  shippingAddress: one(customerAddresses, {
    fields: [checkoutQuotes.shippingAddressId],
    references: [customerAddresses.id],
    relationName: "checkout_shipping_address",
  }),
  billingAddress: one(customerAddresses, {
    fields: [checkoutQuotes.billingAddressId],
    references: [customerAddresses.id],
    relationName: "checkout_billing_address",
  }),
  lines: many(checkoutQuoteLines),
  shippingSelections: many(checkoutQuoteShippingSelections),
  attempts: many(checkoutAttempts),
}));

/** Relates one Checkout quote line to its quote, authoritative Product variant, and seller snapshot. */
export const checkoutQuoteLinesRelations = relations(checkoutQuoteLines, ({ one }) => ({
  quote: one(checkoutQuotes, {
    fields: [checkoutQuoteLines.quoteId],
    references: [checkoutQuotes.id],
  }),
  variant: one(productVariants, {
    fields: [checkoutQuoteLines.variantId],
    references: [productVariants.id],
  }),
  seller: one(sellers, {
    fields: [checkoutQuoteLines.sellerId],
    references: [sellers.id],
  }),
  store: one(stores, {
    fields: [checkoutQuoteLines.storeId],
    references: [stores.id],
  }),
}));

/** Relates one persisted Checkout shipping selection to its quote, seller/store, and Shipping Core method. */
export const checkoutQuoteShippingSelectionsRelations = relations(
  checkoutQuoteShippingSelections,
  ({ one }) => ({
    quote: one(checkoutQuotes, {
      fields: [checkoutQuoteShippingSelections.quoteId],
      references: [checkoutQuotes.id],
    }),
    seller: one(sellers, {
      fields: [checkoutQuoteShippingSelections.sellerId],
      references: [sellers.id],
    }),
    store: one(stores, {
      fields: [checkoutQuoteShippingSelections.storeId],
      references: [stores.id],
    }),
    shippingMethod: one(shippingMethods, {
      fields: [checkoutQuoteShippingSelections.shippingMethodId],
      references: [shippingMethods.id],
    }),
  }),
);

/** Relates one Checkout attempt to the exact customer-owned quote it confirms. */
export const checkoutAttemptsRelations = relations(checkoutAttempts, ({ one }) => ({
  quote: one(checkoutQuotes, {
    fields: [checkoutAttempts.quoteId],
    references: [checkoutQuotes.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [checkoutAttempts.customerUserId],
    references: [customerProfiles.userId],
  }),
  order: one(orders, {
    fields: [checkoutAttempts.orderId],
    references: [orders.id],
    relationName: "checkout_attempt_materialized_order",
  }),
}));

/** Relates one Shipping Core method to its optional seller owner. */
export const shippingMethodsRelations = relations(shippingMethods, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [shippingMethods.sellerId],
    references: [sellers.id],
  }),
  checkoutQuoteSelections: many(checkoutQuoteShippingSelections),
  sellerOrders: many(sellerOrders),
}));

/** Relates one promotion to its optional seller owner, eligibility scopes, and coupon codes. */
export const promotionsRelations = relations(promotions, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [promotions.sellerId],
    references: [sellers.id],
  }),
  scopes: many(promotionScopes),
  coupons: many(coupons),
}));

/** Relates one eligibility scope row back to its promotion. */
export const promotionScopesRelations = relations(promotionScopes, ({ one }) => ({
  promotion: one(promotions, {
    fields: [promotionScopes.promotionId],
    references: [promotions.id],
  }),
}));

/** Relates one coupon to its promotion and immutable redemption rows. */
export const couponsRelations = relations(coupons, ({ one, many }) => ({
  promotion: one(promotions, {
    fields: [coupons.promotionId],
    references: [promotions.id],
  }),
  redemptions: many(couponRedemptions),
}));

/** Relates one coupon redemption to its coupon and customer profile. */
export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons, {
    fields: [couponRedemptions.couponId],
    references: [coupons.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [couponRedemptions.customerUserId],
    references: [customerProfiles.userId],
  }),
  order: one(orders, {
    fields: [couponRedemptions.orderId],
    references: [orders.id],
  }),
}));

/** Relates one customer cart to its owner profile and requested Product variants. */
export const cartsRelations = relations(carts, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [carts.customerUserId],
    references: [customerProfiles.userId],
  }),
  items: many(cartItems),
}));

/** Relates one cart line to its parent cart and current Product variant. */
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

/** Relates one named wishlist to its owning customer profile and saved entries. */
export const wishlistsRelations = relations(wishlists, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [wishlists.customerUserId],
    references: [customerProfiles.userId],
  }),
  items: many(wishlistItems),
}));

/** Relates one wishlist entry to its wishlist, Product, and optional Product variant. */
export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  wishlist: one(wishlists, {
    fields: [wishlistItems.wishlistId],
    references: [wishlists.id],
  }),
  product: one(products, {
    fields: [wishlistItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [wishlistItems.variantId],
    references: [productVariants.id],
  }),
}));

/** Relates one inventory balance row to its seller, store, Product variant, and immutable movements. */
export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  seller: one(sellers, { fields: [inventoryItems.sellerId], references: [sellers.id] }),
  store: one(stores, { fields: [inventoryItems.storeId], references: [stores.id] }),
  variant: one(productVariants, {
    fields: [inventoryItems.variantId],
    references: [productVariants.id],
  }),
  movements: many(stockMovements),
}));

/** Relates one immutable stock movement to its inventory item and optional acting user. */
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [stockMovements.inventoryItemId],
    references: [inventoryItems.id],
  }),
  actorUser: one(users, {
    fields: [stockMovements.actorUserId],
    references: [users.id],
  }),
}));

/** Relates one stock reservation to its Product variant, customer, and optional Checkout attempt. */
export const stockReservationsRelations = relations(stockReservations, ({ one, many }) => ({
  variant: one(productVariants, {
    fields: [stockReservations.variantId],
    references: [productVariants.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [stockReservations.customerUserId],
    references: [customerProfiles.userId],
  }),
  checkoutAttempt: one(checkoutAttempts, {
    fields: [stockReservations.orderAttemptId],
    references: [checkoutAttempts.id],
  }),
  orderItems: many(orderItems),
}));

/** Relates one Customer Order to its Checkout source, customer, seller groups, items, address snapshots, and history. */
export const ordersRelations = relations(orders, ({ one, many }) => ({
  checkoutAttempt: one(checkoutAttempts, {
    fields: [orders.checkoutAttemptId],
    references: [checkoutAttempts.id],
    relationName: "order_checkout_attempt_source",
  }),
  customerProfile: one(customerProfiles, {
    fields: [orders.customerUserId],
    references: [customerProfiles.userId],
  }),
  sellerOrders: many(sellerOrders),
  items: many(orderItems),
  addresses: many(orderAddresses),
  statusHistory: many(orderStatusHistory),
  couponRedemptions: many(couponRedemptions),
  payment: one(payments),
  returnRequests: many(returnRequests),
  refunds: many(refunds),
}));

/** Relates one Seller Order to its parent Order, seller/store scope, Shipping snapshot source, items, and history. */
export const sellerOrdersRelations = relations(sellerOrders, ({ one, many }) => ({
  order: one(orders, {
    fields: [sellerOrders.orderId],
    references: [orders.id],
  }),
  seller: one(sellers, {
    fields: [sellerOrders.sellerId],
    references: [sellers.id],
  }),
  store: one(stores, {
    fields: [sellerOrders.storeId],
    references: [stores.id],
  }),
  shippingMethod: one(shippingMethods, {
    fields: [sellerOrders.shippingMethodId],
    references: [shippingMethods.id],
  }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  commissionEntries: many(commissionEntries),
  shipments: many(shipments),
  returnRequests: many(returnRequests),
}));

/** Relates one immutable Order Item snapshot to its parent Order, Seller Order, Product identity, and Inventory reservation. */
export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  sellerOrder: one(sellerOrders, {
    fields: [orderItems.sellerOrderId],
    references: [sellerOrders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
  inventoryReservation: one(stockReservations, {
    fields: [orderItems.inventoryReservationId],
    references: [stockReservations.id],
  }),
  commissionRuleSnapshot: one(commissionRuleSnapshots),
  commissionEntries: many(commissionEntries),
  shipmentItems: many(shipmentItems),
  returnItems: many(returnItems),
  review: one(reviews, {
    fields: [orderItems.id],
    references: [reviews.orderItemId],
  }),
}));

/** Relates one immutable Order address snapshot to its parent Order and optional saved-address source. */
export const orderAddressesRelations = relations(orderAddresses, ({ one }) => ({
  order: one(orders, {
    fields: [orderAddresses.orderId],
    references: [orders.id],
  }),
  sourceAddress: one(customerAddresses, {
    fields: [orderAddresses.sourceAddressId],
    references: [customerAddresses.id],
  }),
}));

/** Relates one append-only status-history row to exactly one Order/Seller Order and optional acting user. */
export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, {
    fields: [orderStatusHistory.orderId],
    references: [orders.id],
  }),
  sellerOrder: one(sellerOrders, {
    fields: [orderStatusHistory.sellerOrderId],
    references: [sellerOrders.id],
  }),
  changedByUser: one(users, {
    fields: [orderStatusHistory.changedBy],
    references: [users.id],
  }),
}));

/** Relates one Shipment to its Seller Order, immutable item allocations, and append-only status timeline. */
export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  sellerOrder: one(sellerOrders, {
    fields: [shipments.sellerOrderId],
    references: [sellerOrders.id],
  }),
  items: many(shipmentItems),
  statusHistory: many(shipmentStatusHistory),
}));

/** Relates one immutable Shipment allocation to its Shipment and source Order Item. */
export const shipmentItemsRelations = relations(shipmentItems, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentItems.shipmentId],
    references: [shipments.id],
  }),
  orderItem: one(orderItems, {
    fields: [shipmentItems.orderItemId],
    references: [orderItems.id],
  }),
}));

/** Relates one append-only Shipment status row to its Shipment. */
export const shipmentStatusHistoryRelations = relations(
  shipmentStatusHistory,
  ({ one }) => ({
    shipment: one(shipments, {
      fields: [shipmentStatusHistory.shipmentId],
      references: [shipments.id],
    }),
  }),
);

/** Relates one Payment aggregate to its immutable Customer Order and append-only transaction history. */
export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
  transactions: many(paymentTransactions),
  refunds: many(refunds),
}));

/** Relates one Payment transaction to its aggregate and optional verified webhook event. */
export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentTransactions.paymentId],
    references: [payments.id],
  }),
  webhookEvent: one(paymentWebhookEvents, {
    fields: [paymentTransactions.rawEventId],
    references: [paymentWebhookEvents.id],
  }),
}));

/** Relates one verified provider webhook event to any transaction rows produced from that delivery. */
export const paymentWebhookEventsRelations = relations(paymentWebhookEvents, ({ many }) => ({
  transactions: many(paymentTransactions),
}));


/** Relates one Return Request to its immutable commerce sources and post-purchase records. */
export const returnRequestsRelations = relations(returnRequests, ({ one, many }) => ({
  order: one(orders, {
    fields: [returnRequests.orderId],
    references: [orders.id],
  }),
  sellerOrder: one(sellerOrders, {
    fields: [returnRequests.sellerOrderId],
    references: [sellerOrders.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [returnRequests.customerUserId],
    references: [customerProfiles.userId],
  }),
  items: many(returnItems),
  refunds: many(refunds),
  statusHistory: many(returnStatusHistory),
  disputeNotes: many(disputeNotes),
}));

/** Relates one Return Item to its Return Request and immutable Order Item source. */
export const returnItemsRelations = relations(returnItems, ({ one }) => ({
  returnRequest: one(returnRequests, {
    fields: [returnItems.returnRequestId],
    references: [returnRequests.id],
  }),
  orderItem: one(orderItems, {
    fields: [returnItems.orderItemId],
    references: [orderItems.id],
  }),
}));

/** Relates one business Refund record to its optional Return and authoritative Order/Payment sources. */
export const refundsRelations = relations(refunds, ({ one }) => ({
  returnRequest: one(returnRequests, {
    fields: [refunds.returnRequestId],
    references: [returnRequests.id],
  }),
  order: one(orders, {
    fields: [refunds.orderId],
    references: [orders.id],
  }),
  payment: one(payments, {
    fields: [refunds.paymentId],
    references: [payments.id],
  }),
}));

/** Relates one append-only Return status transition to its Return Request and optional actor. */
export const returnStatusHistoryRelations = relations(returnStatusHistory, ({ one }) => ({
  returnRequest: one(returnRequests, {
    fields: [returnStatusHistory.returnRequestId],
    references: [returnRequests.id],
  }),
  changedByUser: one(users, {
    fields: [returnStatusHistory.changedBy],
    references: [users.id],
  }),
}));

/** Relates one dispute note to its Return Request and author. */
export const disputeNotesRelations = relations(disputeNotes, ({ one }) => ({
  returnRequest: one(returnRequests, {
    fields: [disputeNotes.returnRequestId],
    references: [returnRequests.id],
  }),
  actorUser: one(users, {
    fields: [disputeNotes.actorUserId],
    references: [users.id],
  }),
}));


/** Relates one Commission rule to immutable Order Item snapshots that preserve historical economics. */
export const commissionRulesRelations = relations(commissionRules, ({ many }) => ({
  snapshots: many(commissionRuleSnapshots),
}));

/** Relates one immutable Commission rule snapshot to its Order Item and optional source rule. */
export const commissionRuleSnapshotsRelations = relations(
  commissionRuleSnapshots,
  ({ one }) => ({
    orderItem: one(orderItems, {
      fields: [commissionRuleSnapshots.orderItemId],
      references: [orderItems.id],
    }),
    rule: one(commissionRules, {
      fields: [commissionRuleSnapshots.ruleId],
      references: [commissionRules.id],
    }),
  }),
);

/** Relates one append-only Commission ledger entry to its seller and immutable Order sources. */
export const commissionEntriesRelations = relations(commissionEntries, ({ one }) => ({
  seller: one(sellers, {
    fields: [commissionEntries.sellerId],
    references: [sellers.id],
  }),
  sellerOrder: one(sellerOrders, {
    fields: [commissionEntries.sellerOrderId],
    references: [sellerOrders.id],
  }),
  orderItem: one(orderItems, {
    fields: [commissionEntries.orderItemId],
    references: [orderItems.id],
  }),
}));

/** Relates one seller/currency Wallet snapshot to its seller, immutable entries, and Payouts. */
export const sellerWalletsRelations = relations(sellerWallets, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [sellerWallets.sellerId],
    references: [sellers.id],
  }),
  entries: many(sellerWalletEntries),
  payouts: many(payouts),
}));

/** Relates one immutable Wallet delta to its Wallet and any Payout allocations that consume it. */
export const sellerWalletEntriesRelations = relations(
  sellerWalletEntries,
  ({ one, many }) => ({
    wallet: one(sellerWallets, {
      fields: [sellerWalletEntries.sellerId, sellerWalletEntries.currency],
      references: [sellerWallets.sellerId, sellerWallets.currency],
    }),
    payoutAllocations: many(payoutAllocations),
  }),
);

/** Relates one tokenized Payout account to its seller and Payout history. */
export const payoutAccountsRelations = relations(payoutAccounts, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [payoutAccounts.sellerId],
    references: [sellers.id],
  }),
  payouts: many(payouts),
}));

/** Relates one Payout to its seller, Wallet, account, and immutable source allocations. */
export const payoutsRelations = relations(payouts, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [payouts.sellerId],
    references: [sellers.id],
  }),
  wallet: one(sellerWallets, {
    fields: [payouts.sellerId, payouts.currency],
    references: [sellerWallets.sellerId, sellerWallets.currency],
  }),
  account: one(payoutAccounts, {
    fields: [payouts.accountId, payouts.sellerId],
    references: [payoutAccounts.id, payoutAccounts.sellerId],
  }),
  allocations: many(payoutAllocations),
}));

/** Relates one Payout allocation to its Payout and immutable Wallet source entry. */
export const payoutAllocationsRelations = relations(payoutAllocations, ({ one }) => ({
  payout: one(payouts, {
    fields: [payoutAllocations.payoutId],
    references: [payouts.id],
  }),
  walletEntry: one(sellerWalletEntries, {
    fields: [payoutAllocations.walletEntryId],
    references: [sellerWalletEntries.id],
  }),
}));

/** Relates one verified Review to its immutable purchase and public ownership facts. */
export const reviewsRelations = relations(reviews, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [reviews.customerUserId],
    references: [customerProfiles.userId],
  }),
  orderItem: one(orderItems, {
    fields: [reviews.orderItemId],
    references: [orderItems.id],
  }),
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  seller: one(sellers, {
    fields: [reviews.sellerId],
    references: [sellers.id],
  }),
  store: one(stores, {
    fields: [reviews.storeId],
    references: [stores.id],
  }),
  helpfulVotes: many(reviewHelpfulVotes),
  moderationHistory: many(reviewModerationHistory),
}));

/** Relates one Helpful vote to the Review and authenticated user that created it. */
export const reviewHelpfulVotesRelations = relations(reviewHelpfulVotes, ({ one }) => ({
  review: one(reviews, {
    fields: [reviewHelpfulVotes.reviewId],
    references: [reviews.id],
  }),
  user: one(users, {
    fields: [reviewHelpfulVotes.userId],
    references: [users.id],
  }),
}));

/** Relates one append-only moderation decision to its Review and moderator. */
export const reviewModerationHistoryRelations = relations(
  reviewModerationHistory,
  ({ one }) => ({
    review: one(reviews, {
      fields: [reviewModerationHistory.reviewId],
      references: [reviews.id],
    }),
    moderator: one(users, {
      fields: [reviewModerationHistory.moderatorUserId],
      references: [users.id],
    }),
  }),
);


/** Relates one committed outbox event to its retry-safe Notification deliveries. */
export const outboxEventsRelations = relations(outboxEvents, ({ many }) => ({
  notificationDeliveries: many(notificationDeliveries),
}));

/** Relates one persisted in-app Notification to its owner and channel-delivery rows. */
export const notificationsRelations = relations(notifications, ({ one, many }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  deliveries: many(notificationDeliveries),
}));

/** Relates one retry-safe Notification delivery to its user, optional in-app row, and source outbox event. */
export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    notification: one(notifications, {
      fields: [notificationDeliveries.notificationId],
      references: [notifications.id],
    }),
    sourceEvent: one(outboxEvents, {
      fields: [notificationDeliveries.sourceEventId],
      references: [outboxEvents.id],
    }),
    user: one(users, {
      fields: [notificationDeliveries.userId],
      references: [users.id],
    }),
  }),
);

/** Relates one Notification preference row to the user who owns the event/channel choice. */
export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

/** Relates one Report definition to its generated runs and user-owned saved filters. */
export const reportDefinitionsRelations = relations(reportDefinitions, ({ many }) => ({
  runs: many(reportRuns),
  savedFilters: many(savedReportFilters),
}));

/** Relates one asynchronous Report run to its definition, requester, and optional generated file. */
export const reportRunsRelations = relations(reportRuns, ({ one }) => ({
  definition: one(reportDefinitions, {
    fields: [reportRuns.reportCode],
    references: [reportDefinitions.code],
  }),
  requester: one(users, {
    fields: [reportRuns.requestedBy],
    references: [users.id],
  }),
  file: one(files, {
    fields: [reportRuns.fileId],
    references: [files.id],
  }),
}));

/** Relates one saved Report filter to its owner and report definition. */
export const savedReportFiltersRelations = relations(savedReportFilters, ({ one }) => ({
  user: one(users, {
    fields: [savedReportFilters.userId],
    references: [users.id],
  }),
  definition: one(reportDefinitions, {
    fields: [savedReportFilters.reportCode],
    references: [reportDefinitions.code],
  }),
}));

/** Relates one Dashboard preference row to its owning user and optional default store. */
export const dashboardPreferencesRelations = relations(
  dashboardPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [dashboardPreferences.userId],
      references: [users.id],
    }),
    defaultStore: one(stores, {
      fields: [dashboardPreferences.defaultStoreId],
      references: [stores.id],
    }),
  }),
);

/** Relates one saved Dashboard filter to the user that owns it. */
export const dashboardSavedFiltersRelations = relations(
  dashboardSavedFilters,
  ({ one }) => ({
    user: one(users, {
      fields: [dashboardSavedFilters.userId],
      references: [users.id],
    }),
  }),
);

/** Relates one derived Search document back to its authoritative Product and taxonomy rows. */
export const productSearchDocumentsRelations = relations(productSearchDocuments, ({ one }) => ({
  product: one(products, {
    fields: [productSearchDocuments.productId],
    references: [products.id],
  }),
  category: one(categories, {
    fields: [productSearchDocuments.categoryId],
    references: [categories.id],
  }),
  brand: one(brands, {
    fields: [productSearchDocuments.brandId],
    references: [brands.id],
  }),
}));

/** Relates stored file metadata to its optional owner and business-resource links. */
export const filesRelations = relations(files, ({ one, many }) => ({
  ownerUser: one(users, {
    fields: [files.ownerUserId],
    references: [users.id],
  }),
  links: many(fileLinks),
  storeLogos: many(stores),
  productMedia: many(productMedia),
  reportRuns: many(reportRuns),
}));

/** Relates one file link to its file metadata and the user who created the link. */
export const fileLinksRelations = relations(fileLinks, ({ one }) => ({
  file: one(files, {
    fields: [fileLinks.fileId],
    references: [files.id],
  }),
  createdByUser: one(users, {
    fields: [fileLinks.createdBy],
    references: [users.id],
  }),
}));

/** Relates an audit row to its actor when that actor is a persisted Module 2 user. */
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actorUser: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
  }),
}));
