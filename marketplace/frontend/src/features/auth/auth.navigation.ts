import type { AuthenticatedUser } from "./types/auth.types";

export type PostLoginPath =
  | "/account"
  | "/dashboard"
  | "/admin/users"
  | "/admin/roles"
  | "/admin/settings"
  | "/admin/sellers/suspend"
  | "/admin/catalog/categories"
  | "/admin/catalog/brands"
  | "/admin/catalog/attributes"
  | "/admin/promotions"
  | "/admin/orders"
  | "/admin/reviews"
  | "/seller/catalog-taxonomy"
  | "/seller/products"
  | "/seller/inventory"
  | "/seller/promotions"
  | "/seller/orders"
  | "/seller/profile"
  | "/seller/stores"
  | "/seller/staff"
  | "/documents"
  | "/audit"
  | "/products";

/** Selects the first useful page that the authenticated actor can actually open. */
export function getPostLoginPath(user: AuthenticatedUser): PostLoginPath {
  if (user.permissions.includes("admin.users.read")) return "/admin/users";
  if (user.permissions.includes("admin.roles.read")) return "/admin/roles";
  if (user.permissions.includes("admin.settings.manage")) return "/admin/settings";
  if (user.permissions.includes("admin.sellers.suspend")) return "/admin/sellers/suspend";
  if (user.permissions.includes("catalog.manage_categories")) return "/admin/catalog/categories";
  if (user.permissions.includes("catalog.manage_brands")) return "/admin/catalog/brands";
  if (user.permissions.includes("catalog.manage_attributes")) return "/admin/catalog/attributes";
  if (user.permissions.includes("admin.promotions.manage")) return "/admin/promotions";
  if (user.permissions.includes("admin.orders.read")) return "/admin/orders";
  if (user.permissions.includes("admin.reviews.moderate")) return "/admin/reviews";
  if (user.accountType === "seller" && user.permissions.includes("dashboard.read")) {
    return "/dashboard";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.orders.read")) {
    return "/seller/orders";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.products.read")) {
    return "/seller/products";
  }
  if (user.accountType === "seller" && user.permissions.includes("inventory.read")) {
    return "/seller/inventory";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.promotions.manage")) {
    return "/seller/promotions";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.profile.read")) {
    return "/seller/profile";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.store.manage")) {
    return "/seller/stores";
  }
  if (user.accountType === "seller" && user.permissions.includes("seller.staff.manage")) {
    return "/seller/staff";
  }
  if (user.accountType === "seller" && user.permissions.includes("catalog.read")) {
    return "/seller/catalog-taxonomy";
  }
  if (user.accountType === "customer") return "/products";
  if (
    user.permissions.some((permission) =>
      ["documents.upload", "documents.read", "documents.link"].includes(permission),
    )
  ) {
    return "/documents";
  }
  if (user.permissions.includes("audit.read")) return "/audit";
  return "/account";
}
