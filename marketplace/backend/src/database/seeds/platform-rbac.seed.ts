import { pathToFileURL } from "node:url";
import { eq, inArray } from "drizzle-orm";
import {
  ADMIN_PERMISSION_CATALOG,
  ROLE_STATUS,
  SYSTEM_ROLE,
} from "../../modules/administration/administration.constants.js";
import {
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_AUDIT_PERMISSION_CATALOG,
} from "../../modules/documents-audit/documents-audit.constants.js";
import {
  CUSTOMER_PERMISSION,
  CUSTOMER_PERMISSION_CATALOG,
} from "../../modules/customers/customers.constants.js";
import {
  CATALOG_PERMISSION,
  CATALOG_PERMISSION_CATALOG,
} from "../../modules/catalog-taxonomy/catalog-taxonomy.constants.js";
import {
  SELLER_MANAGER_PERMISSION_CODES,
  SELLER_OWNER_PERMISSION_CODES,
  SELLER_PERMISSION_CATALOG,
  SELLER_SYSTEM_ROLE,
} from "../../modules/sellers/sellers.constants.js";
import {
  PRODUCT_PERMISSION,
  PRODUCT_PERMISSION_CATALOG,
} from "../../modules/products/products.constants.js";
import {
  INVENTORY_PERMISSION,
  INVENTORY_PERMISSION_CATALOG,
} from "../../modules/inventory/inventory.constants.js";
import {
  SEARCH_PERMISSION,
  SEARCH_PERMISSION_CATALOG,
} from "../../modules/search-discovery/search-discovery.constants.js";
import {
  CART_WISHLIST_PERMISSION,
  CART_WISHLIST_PERMISSION_CATALOG,
} from "../../modules/cart-wishlist/cart-wishlist.constants.js";
import {
  PROMOTION_PERMISSION,
  PROMOTION_PERMISSION_CATALOG,
} from "../../modules/promotions/promotions.constants.js";
import {
  CHECKOUT_PERMISSION,
  CHECKOUT_PERMISSION_CATALOG,
} from "../../modules/checkout/checkout.constants.js";
import {
  ORDERS_PERMISSION,
  ORDERS_PERMISSION_CATALOG,
} from "../../modules/orders/orders.constants.js";
import {
  PAYMENTS_PERMISSION,
  PAYMENTS_PERMISSION_CATALOG,
} from "../../modules/payments/payments.constants.js";
import {
  COMMISSIONS_PERMISSION,
  COMMISSIONS_PERMISSION_CATALOG,
} from "../../modules/commissions/commissions.constants.js";
import {
  SHIPPING_PERMISSION,
  SHIPPING_PERMISSION_CATALOG,
} from "../../modules/shipping/shipping.constants.js";
import {
  RETURNS_PERMISSION,
  RETURNS_PERMISSION_CATALOG,
} from "../../modules/returns-refunds/returns-refunds.constants.js";
import {
  WALLET_PAYOUT_PERMISSION,
  WALLET_PAYOUT_PERMISSION_CATALOG,
} from "../../modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import {
  REVIEWS_PERMISSION,
  REVIEWS_PERMISSION_CATALOG,
} from "../../modules/reviews/reviews.constants.js";
import {
  NOTIFICATIONS_PERMISSION,
  NOTIFICATIONS_PERMISSION_CATALOG,
} from "../../modules/notifications/notifications.constants.js";
import {
  REPORTS_PERMISSION,
  REPORTS_PERMISSION_CATALOG,
} from "../../modules/reports/reports.constants.js";
import {
  DASHBOARD_PERMISSION,
  DASHBOARD_PERMISSION_CATALOG,
} from "../../modules/dashboard/dashboard.constants.js";
import { closeDatabase, db } from "../db.js";
import {
  permissions,
  rolePermissions,
  roles,
} from "../schema/administration.js";
import { seedAdministrationRbac } from "./administration.seed.js";

/** Current server-controlled permission catalog across generated modules. */
const PLATFORM_PERMISSION_CATALOG = [
  ...ADMIN_PERMISSION_CATALOG,
  ...DOCUMENT_AUDIT_PERMISSION_CATALOG,
  ...CUSTOMER_PERMISSION_CATALOG,
  ...SELLER_PERMISSION_CATALOG,
  ...CATALOG_PERMISSION_CATALOG,
  ...PRODUCT_PERMISSION_CATALOG,
  ...INVENTORY_PERMISSION_CATALOG,
  ...SEARCH_PERMISSION_CATALOG,
  ...CART_WISHLIST_PERMISSION_CATALOG,
  ...PROMOTION_PERMISSION_CATALOG,
  ...CHECKOUT_PERMISSION_CATALOG,
  ...ORDERS_PERMISSION_CATALOG,
  ...PAYMENTS_PERMISSION_CATALOG,
  ...COMMISSIONS_PERMISSION_CATALOG,
  ...SHIPPING_PERMISSION_CATALOG,
  ...RETURNS_PERMISSION_CATALOG,
  ...WALLET_PAYOUT_PERMISSION_CATALOG,
  ...REVIEWS_PERMISSION_CATALOG,
  ...NOTIFICATIONS_PERMISSION_CATALOG,
  ...REPORTS_PERMISSION_CATALOG,
  ...DASHBOARD_PERMISSION_CATALOG,
] as const;

/**
 * Customer permissions include self-service actions plus read-only public catalog access when authenticated,
 * public Search, own Cart/Wishlist access, promotion validation, Checkout, Orders, Payments, and Shipment tracking.
 */
const CUSTOMER_SELF_SERVICE_PERMISSION_CODES = [
  CUSTOMER_PERMISSION.PROFILE_READ_OWN,
  CUSTOMER_PERMISSION.PROFILE_UPDATE_OWN,
  CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
  CATALOG_PERMISSION.READ,
  PRODUCT_PERMISSION.PUBLIC_READ,
  SEARCH_PERMISSION.PUBLIC,
  CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
  CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
  PROMOTION_PERMISSION.READ,
  CHECKOUT_PERMISSION.CREATE_OWN,
  CHECKOUT_PERMISSION.CONFIRM_OWN,
  ORDERS_PERMISSION.READ_OWN,
  PAYMENTS_PERMISSION.READ_OWN,
  SHIPPING_PERMISSION.READ_OWN_ORDER,
  RETURNS_PERMISSION.CREATE_OWN,
  RETURNS_PERMISSION.READ_OWN,
  REVIEWS_PERMISSION.CREATE_VERIFIED,
  REVIEWS_PERMISSION.UPDATE_OWN,
  REVIEWS_PERMISSION.PUBLIC_READ,
  NOTIFICATIONS_PERMISSION.READ_OWN,
  NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
] as const;

/** Seller owners receive seller-commerce, fulfillment, and read-only Commission statement permissions. */
const SELLER_OWNER_PLATFORM_PERMISSION_CODES = [
  ...SELLER_OWNER_PERMISSION_CODES,
  CATALOG_PERMISSION.READ,
  PRODUCT_PERMISSION.PUBLIC_READ,
  PRODUCT_PERMISSION.SELLER_READ,
  PRODUCT_PERMISSION.SELLER_CREATE,
  PRODUCT_PERMISSION.SELLER_UPDATE,
  PRODUCT_PERMISSION.SELLER_PUBLISH,
  INVENTORY_PERMISSION.READ,
  INVENTORY_PERMISSION.ADJUST,
  INVENTORY_PERMISSION.REORDER_MANAGE,
  SEARCH_PERMISSION.PUBLIC,
  PROMOTION_PERMISSION.SELLER_MANAGE,
  ORDERS_PERMISSION.SELLER_READ,
  ORDERS_PERMISSION.SELLER_MANAGE,
  SHIPPING_PERMISSION.SELLER_READ,
  SHIPPING_PERMISSION.SELLER_MANAGE,
  COMMISSIONS_PERMISSION.SELLER_READ,
  RETURNS_PERMISSION.SELLER_MANAGE,
  WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ,
  WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST,
  WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE,
  REVIEWS_PERMISSION.PUBLIC_READ,
  NOTIFICATIONS_PERMISSION.READ_OWN,
  NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
  REPORTS_PERMISSION.SALES_READ,
  REPORTS_PERMISSION.INVENTORY_READ,
  REPORTS_PERMISSION.FINANCE_READ,
  REPORTS_PERMISSION.SELLER_READ,
  REPORTS_PERMISSION.EXPORT,
  DASHBOARD_PERMISSION.READ,
  DASHBOARD_PERMISSION.SELLER_READ,
  DASHBOARD_PERMISSION.MANAGE_PREFERENCES,
] as const;

/** Seller managers receive seller-commerce, fulfillment, and read-only Commission statement permissions. */
const SELLER_MANAGER_PLATFORM_PERMISSION_CODES = [
  ...SELLER_MANAGER_PERMISSION_CODES,
  CATALOG_PERMISSION.READ,
  PRODUCT_PERMISSION.PUBLIC_READ,
  PRODUCT_PERMISSION.SELLER_READ,
  PRODUCT_PERMISSION.SELLER_CREATE,
  PRODUCT_PERMISSION.SELLER_UPDATE,
  PRODUCT_PERMISSION.SELLER_PUBLISH,
  INVENTORY_PERMISSION.READ,
  INVENTORY_PERMISSION.ADJUST,
  INVENTORY_PERMISSION.REORDER_MANAGE,
  SEARCH_PERMISSION.PUBLIC,
  PROMOTION_PERMISSION.SELLER_MANAGE,
  ORDERS_PERMISSION.SELLER_READ,
  ORDERS_PERMISSION.SELLER_MANAGE,
  SHIPPING_PERMISSION.SELLER_READ,
  SHIPPING_PERMISSION.SELLER_MANAGE,
  COMMISSIONS_PERMISSION.SELLER_READ,
  RETURNS_PERMISSION.SELLER_MANAGE,
  WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ,
  WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST,
  WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE,
  REVIEWS_PERMISSION.PUBLIC_READ,
  NOTIFICATIONS_PERMISSION.READ_OWN,
  NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
  REPORTS_PERMISSION.SALES_READ,
  REPORTS_PERMISSION.INVENTORY_READ,
  REPORTS_PERMISSION.FINANCE_READ,
  REPORTS_PERMISSION.SELLER_READ,
  REPORTS_PERMISSION.EXPORT,
  DASHBOARD_PERMISSION.READ,
  DASHBOARD_PERMISSION.SELLER_READ,
  DASHBOARD_PERMISSION.MANAGE_PREFERENCES,
] as const;

/**
 * Composes RBAC catalogs from generated modules without making Module 2 import downstream modules.
 * Module-owned seed data is created first, then cross-module permission grants are attached here.
 */
export async function seedPlatformRbac(): Promise<void> {
  await seedAdministrationRbac();

  await db.transaction(async (tx) => {
    for (const permission of [
      ...DOCUMENT_AUDIT_PERMISSION_CATALOG,
      ...CUSTOMER_PERMISSION_CATALOG,
      ...SELLER_PERMISSION_CATALOG,
      ...CATALOG_PERMISSION_CATALOG,
      ...PRODUCT_PERMISSION_CATALOG,
      ...INVENTORY_PERMISSION_CATALOG,
      ...SEARCH_PERMISSION_CATALOG,
      ...CART_WISHLIST_PERMISSION_CATALOG,
      ...PROMOTION_PERMISSION_CATALOG,
      ...CHECKOUT_PERMISSION_CATALOG,
      ...ORDERS_PERMISSION_CATALOG,
      ...PAYMENTS_PERMISSION_CATALOG,
      ...COMMISSIONS_PERMISSION_CATALOG,
      ...SHIPPING_PERMISSION_CATALOG,
      ...RETURNS_PERMISSION_CATALOG,
      ...WALLET_PAYOUT_PERMISSION_CATALOG,
      ...REVIEWS_PERMISSION_CATALOG,
      ...NOTIFICATIONS_PERMISSION_CATALOG,
      ...REPORTS_PERMISSION_CATALOG,
      ...DASHBOARD_PERMISSION_CATALOG,
    ]) {
      await tx
        .insert(permissions)
        .values(permission)
        .onConflictDoUpdate({
          target: permissions.code,
          set: {
            domain: permission.domain,
            description: permission.description,
          },
        });
    }

    const [adminRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code))
      .limit(1);
    if (!adminRole) {
      throw new Error("The platform_super_admin role must exist before platform RBAC composition.");
    }

    const [customerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.code))
      .limit(1);
    if (!customerRole) {
      throw new Error("The customer_self_service role must exist before platform RBAC composition.");
    }

    const [sellerOwnerRole] = await tx
      .insert(roles)
      .values({
        ...SELLER_SYSTEM_ROLE.OWNER,
        isSystem: true,
        status: ROLE_STATUS.ACTIVE,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: SELLER_SYSTEM_ROLE.OWNER.name,
          description: SELLER_SYSTEM_ROLE.OWNER.description,
          scopeType: SELLER_SYSTEM_ROLE.OWNER.scopeType,
          isSystem: true,
          status: ROLE_STATUS.ACTIVE,
          updatedAt: new Date(),
        },
      })
      .returning({ id: roles.id });
    if (!sellerOwnerRole) {
      throw new Error("Failed to resolve the seller_owner system role.");
    }

    const [sellerManagerRole] = await tx
      .insert(roles)
      .values({
        ...SELLER_SYSTEM_ROLE.MANAGER,
        isSystem: true,
        status: ROLE_STATUS.ACTIVE,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: SELLER_SYSTEM_ROLE.MANAGER.name,
          description: SELLER_SYSTEM_ROLE.MANAGER.description,
          scopeType: SELLER_SYSTEM_ROLE.MANAGER.scopeType,
          isSystem: true,
          status: ROLE_STATUS.ACTIVE,
          updatedAt: new Date(),
        },
      })
      .returning({ id: roles.id });
    if (!sellerManagerRole) {
      throw new Error("Failed to resolve the seller_manager system role.");
    }

    const permissionRows = await tx
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(
        inArray(
          permissions.code,
          PLATFORM_PERMISSION_CATALOG.map((permission) => permission.code),
        ),
      );

    if (permissionRows.length !== PLATFORM_PERMISSION_CATALOG.length) {
      throw new Error("Failed to resolve the complete platform permission seed set.");
    }

    const adminPermissionRows = permissionRows.filter(
      (permission) => permission.code !== PAYMENTS_PERMISSION.SYSTEM_WEBHOOK,
    );

    await tx
      .insert(rolePermissions)
      .values(
        adminPermissionRows.map((permission) => ({
          roleId: adminRole.id,
          permissionId: permission.id,
          assignedBy: null,
        })),
      )
      .onConflictDoNothing();

    const customerPermissionRows = permissionRows.filter((permission) =>
      CUSTOMER_SELF_SERVICE_PERMISSION_CODES.includes(
        permission.code as (typeof CUSTOMER_SELF_SERVICE_PERMISSION_CODES)[number],
      ),
    );

    if (customerPermissionRows.length !== CUSTOMER_SELF_SERVICE_PERMISSION_CODES.length) {
      throw new Error("Failed to resolve the customer self-service permission seed set.");
    }

    await tx
      .insert(rolePermissions)
      .values(
        customerPermissionRows.map((permission) => ({
          roleId: customerRole.id,
          permissionId: permission.id,
          assignedBy: null,
        })),
      )
      .onConflictDoNothing();

    const sellerOwnerPermissionRows = permissionRows.filter((permission) =>
      SELLER_OWNER_PLATFORM_PERMISSION_CODES.includes(
        permission.code as (typeof SELLER_OWNER_PLATFORM_PERMISSION_CODES)[number],
      ),
    );
    if (sellerOwnerPermissionRows.length !== SELLER_OWNER_PLATFORM_PERMISSION_CODES.length) {
      throw new Error("Failed to resolve the seller owner permission seed set.");
    }
    await tx
      .insert(rolePermissions)
      .values(
        sellerOwnerPermissionRows.map((permission) => ({
          roleId: sellerOwnerRole.id,
          permissionId: permission.id,
          assignedBy: null,
        })),
      )
      .onConflictDoNothing();

    const sellerManagerPermissionRows = permissionRows.filter((permission) =>
      SELLER_MANAGER_PLATFORM_PERMISSION_CODES.includes(
        permission.code as (typeof SELLER_MANAGER_PLATFORM_PERMISSION_CODES)[number],
      ),
    );
    if (sellerManagerPermissionRows.length !== SELLER_MANAGER_PLATFORM_PERMISSION_CODES.length) {
      throw new Error("Failed to resolve the seller manager permission seed set.");
    }
    await tx
      .insert(rolePermissions)
      .values(
        sellerManagerPermissionRows.map((permission) => ({
          roleId: sellerManagerRole.id,
          permissionId: permission.id,
          assignedBy: null,
        })),
      )
      .onConflictDoNothing();
  });
}

/** Runs the cross-module RBAC composition seed from the command line. */
async function main(): Promise<void> {
  try {
    await seedPlatformRbac();
    console.log("Platform RBAC composition seed completed.");
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
