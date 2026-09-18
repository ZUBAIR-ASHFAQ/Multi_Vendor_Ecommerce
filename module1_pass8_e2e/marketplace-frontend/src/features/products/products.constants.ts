/** Stable Module 6 permissions used only for frontend navigation and convenience hiding. */
export const PRODUCT_PERMISSION = {
  PUBLIC_READ: "products.public.read",
  SELLER_READ: "seller.products.read",
  SELLER_CREATE: "seller.products.create",
  SELLER_UPDATE: "seller.products.update",
  SELLER_PUBLISH: "seller.products.publish",
  ADMIN_REVIEW: "admin.products.review",
} as const;

/** Product publication workflow values returned by the backend. */
export const PRODUCT_PUBLICATION_STATUS = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  PUBLISHED: "published",
  UNPUBLISHED: "unpublished",
} as const;

/** Database-aligned frontend limits mirrored from the Module 6 HTTP contract. */
export const PRODUCT_LIMITS = {
  SLUG_MAX_LENGTH: 160,
  NAME_MAX_LENGTH: 240,
  DESCRIPTION_MAX_LENGTH: 20_000,
  SKU_MAX_LENGTH: 120,
  VARIANT_TITLE_MAX_LENGTH: 200,
  ALT_TEXT_MAX_LENGTH: 500,
} as const;

/** Public Product sort options accepted by the backend. */
export const PUBLIC_PRODUCT_SORT_OPTIONS = [
  { value: "createdAt", label: "Newest" },
  { value: "name", label: "Name" },
] as const;

/** Seller Product sort options accepted by the backend. */
export const SELLER_PRODUCT_SORT_OPTIONS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "name", label: "Name" },
  { value: "publicationStatus", label: "Publication status" },
] as const;

