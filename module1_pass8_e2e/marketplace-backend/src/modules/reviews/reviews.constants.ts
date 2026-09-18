/** Review lifecycle states persisted by Module 15. */
export const REVIEW_STATUS = {
  PENDING: "pending",
  PUBLISHED: "published",
  HIDDEN: "hidden",
} as const;

export const REVIEW_STATUS_VALUES = [
  REVIEW_STATUS.PENDING,
  REVIEW_STATUS.PUBLISHED,
  REVIEW_STATUS.HIDDEN,
] as const;

/** Aggregate entity kinds owned by Reviews & Ratings. */
export const REVIEW_RATING_ENTITY = {
  PRODUCT: "product",
  SELLER: "seller",
} as const;

export const REVIEW_RATING_ENTITY_VALUES = [
  REVIEW_RATING_ENTITY.PRODUCT,
  REVIEW_RATING_ENTITY.SELLER,
] as const;

/** Moderation actions recorded in append-only history. */
export const REVIEW_MODERATION_ACTION = {
  HIDE: "hide",
  PUBLISH: "publish",
} as const;

/** Module 15 permissions required by the controlling guide. */
export const REVIEWS_PERMISSION = {
  CREATE_VERIFIED: "reviews.create_verified",
  UPDATE_OWN: "reviews.update_own",
  PUBLIC_READ: "reviews.public.read",
  ADMIN_MODERATE: "admin.reviews.moderate",
} as const;

/** Permission metadata is declared here and composed into the central RBAC seed in Pass 5. */
export const REVIEWS_PERMISSION_CATALOG = [
  {
    code: REVIEWS_PERMISSION.CREATE_VERIFIED,
    domain: "reviews",
    description: "Create a verified-purchase Review for an eligible delivered Order Item.",
  },
  {
    code: REVIEWS_PERMISSION.UPDATE_OWN,
    domain: "reviews",
    description: "Edit a Review owned by the authenticated customer within Review policy.",
  },
  {
    code: REVIEWS_PERMISSION.PUBLIC_READ,
    domain: "reviews",
    description: "Read published Product and Store Reviews from public storefront surfaces.",
  },
  {
    code: REVIEWS_PERMISSION.ADMIN_MODERATE,
    domain: "reviews",
    description: "Read the moderation queue and hide or publish Reviews using privileged moderation commands.",
  },
] as const;

/** Stable Module 15 business error codes from the controlling guide. */
export const REVIEWS_ERROR_CODE = {
  NOT_ELIGIBLE: "REVIEW_NOT_ELIGIBLE",
  ALREADY_EXISTS: "REVIEW_ALREADY_EXISTS",
  NOT_FOUND: "REVIEW_NOT_FOUND",
  SCOPE_FORBIDDEN: "REVIEW_SCOPE_FORBIDDEN",
} as const;

/** Exact approved Module 15 HTTP paths, including the Audit Pass 1 moderation queue read. */
export const REVIEWS_PATH = {
  CREATE: "/api/v1/reviews",
  UPDATE_OWN: "/api/v1/reviews/:id",
  PRODUCT_PUBLIC_LIST: "/api/v1/products/:productId/reviews",
  STORE_PUBLIC_LIST: "/api/v1/stores/:storeId/reviews",
  HELPFUL: "/api/v1/reviews/:id/helpful",
  ADMIN_LIST: "/api/v1/admin/reviews",
  ADMIN_HIDE: "/api/v1/admin/reviews/:id/hide",
  ADMIN_PUBLISH: "/api/v1/admin/reviews/:id/publish",
} as const;

/** Audit actions emitted for meaningful Review lifecycle writes. */
export const REVIEWS_AUDIT_ACTION = {
  CREATED: "review.created",
  UPDATED: "review.updated",
  HIDDEN: "review.hidden",
  PUBLISHED: "review.published",
} as const;

/** Resource names shared by Review audit and outbox records. */
export const REVIEWS_RESOURCE_TYPE = {
  REVIEW: "review",
  RATING_AGGREGATE: "rating_aggregate",
} as const;

/** Durable domain events named by the Module 15 guide. */
export const REVIEWS_OUTBOX_EVENT = {
  CREATED: "review.created",
  PUBLISHED: "review.published",
  HIDDEN: "review.hidden",
  RATING_AGGREGATE_UPDATED: "rating.aggregate_updated",
} as const;

/** Database-backed boundary limits that are already fixed by the Module 15 persistence contract. */
export const REVIEWS_LIMITS = {
  RATING_MIN: 1,
  RATING_MAX: 5,
  TITLE_MAX_LENGTH: 200,
} as const;
