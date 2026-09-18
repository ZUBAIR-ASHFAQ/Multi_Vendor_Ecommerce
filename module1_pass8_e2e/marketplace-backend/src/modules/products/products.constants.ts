/** Active/inactive lifecycle state for Product Management records. */
export const PRODUCT_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const PRODUCT_STATUS_VALUES = [
  PRODUCT_STATUS.ACTIVE,
  PRODUCT_STATUS.INACTIVE,
] as const;

/** Product publication states used by explicit publish/unpublish/approval commands. */
export const PRODUCT_PUBLICATION_STATUS = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  PUBLISHED: "published",
  UNPUBLISHED: "unpublished",
} as const;

export const PRODUCT_PUBLICATION_STATUS_VALUES = [
  PRODUCT_PUBLICATION_STATUS.DRAFT,
  PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL,
  PRODUCT_PUBLICATION_STATUS.PUBLISHED,
  PRODUCT_PUBLICATION_STATUS.UNPUBLISHED,
] as const;

/** Active/inactive variant state; inventory quantities remain owned by Module 7. */
export const PRODUCT_VARIANT_STATUS_VALUES = PRODUCT_STATUS_VALUES;

/** Active/inactive product-media state. */
export const PRODUCT_MEDIA_STATUS_VALUES = PRODUCT_STATUS_VALUES;

/** Stable permissions named by the controlling Module 6 requirements. */
export const PRODUCT_PERMISSION = {
  PUBLIC_READ: "products.public.read",
  SELLER_READ: "seller.products.read",
  SELLER_CREATE: "seller.products.create",
  SELLER_UPDATE: "seller.products.update",
  SELLER_PUBLISH: "seller.products.publish",
  ADMIN_REVIEW: "admin.products.review",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const PRODUCT_PERMISSION_CATALOG = [
  {
    code: PRODUCT_PERMISSION.PUBLIC_READ,
    domain: "products",
    description: "Read published public product listings.",
  },
  {
    code: PRODUCT_PERMISSION.SELLER_READ,
    domain: "products",
    description: "Read products inside the authenticated seller scope.",
  },
  {
    code: PRODUCT_PERMISSION.SELLER_CREATE,
    domain: "products",
    description: "Create draft products inside the authenticated seller/store scope.",
  },
  {
    code: PRODUCT_PERMISSION.SELLER_UPDATE,
    domain: "products",
    description: "Update editable products, variants, prices, attributes, and media in seller scope.",
  },
  {
    code: PRODUCT_PERMISSION.SELLER_PUBLISH,
    domain: "products",
    description: "Publish, submit, or unpublish products in seller scope.",
  },
  {
    code: PRODUCT_PERMISSION.ADMIN_REVIEW,
    domain: "products",
    description: "Approve product listings when marketplace moderation is enabled.",
  },
] as const;

/** Stable Module 6 business error codes returned by Product Management commands and reads. */
export const PRODUCT_ERROR_CODE = {
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  DUPLICATE_SKU: "DUPLICATE_SKU",
  PRODUCT_NOT_PUBLISHABLE: "PRODUCT_NOT_PUBLISHABLE",
  PRODUCT_SCOPE_FORBIDDEN: "PRODUCT_SCOPE_FORBIDDEN",
  INVALID_PRODUCT_ATTRIBUTE: "INVALID_PRODUCT_ATTRIBUTE",
  PRODUCT_SLUG_TAKEN: "PRODUCT_SLUG_TAKEN",
  PRODUCT_CURRENCY_UNSUPPORTED: "PRODUCT_CURRENCY_UNSUPPORTED",
} as const;

/** Durable Product Management events named by the controlling guide. */
export const PRODUCT_OUTBOX_EVENT = {
  CREATED: "product.created",
  UPDATED: "product.updated",
  PRICE_CHANGED: "product.price_changed",
  PUBLISHED: "product.published",
  UNPUBLISHED: "product.unpublished",
  MEDIA_CHANGED: "product.media_changed",
} as const;

/** Stable resource names for Module 6 audit/outbox metadata. */
export const PRODUCT_RESOURCE_TYPE = {
  PRODUCT: "product",
  VARIANT: "product.variant",
  MEDIA: "product.media",
} as const;

/** Concise audit actions for meaningful Product Management writes. */
export const PRODUCT_AUDIT_ACTION = {
  CREATED: "product.created",
  UPDATED: "product.updated",
  VARIANT_CREATED: "product.variant_created",
  VARIANT_UPDATED: "product.variant_updated",
  PRICE_CHANGED: "product.price_changed",
  MEDIA_LINKED: "product.media_linked",
  PUBLISHED: "product.published",
  UNPUBLISHED: "product.unpublished",
  APPROVED: "product.approved",
} as const;

/** Database-aligned text and pagination limits shared by Module 6 contracts. */
export const PRODUCT_LIMITS = {
  SLUG_MAX_LENGTH: 160,
  NAME_MAX_LENGTH: 240,
  DESCRIPTION_MAX_LENGTH: 20_000,
  SKU_MAX_LENGTH: 120,
  VARIANT_TITLE_MAX_LENGTH: 200,
  MEDIA_TYPE_MAX_LENGTH: 40,
  ALT_TEXT_MAX_LENGTH: 500,
  SEARCH_MAX_LENGTH: 200,
} as const;

/** Allow-listed public product sort keys. */
export const PUBLIC_PRODUCT_SORT_VALUES = ["createdAt", "name"] as const;

/** Allow-listed seller product sort keys. */
export const SELLER_PRODUCT_SORT_VALUES = [
  "createdAt",
  "updatedAt",
  "name",
  "publicationStatus",
] as const;

/** Shared ascending/descending list sort direction. */
export const PRODUCT_SORT_DIRECTION_VALUES = ["asc", "desc"] as const;
