/** Module 15 permissions used only for frontend convenience; the API remains authoritative. */
export const REVIEWS_PERMISSION = {
  CREATE_VERIFIED: "reviews.create_verified",
  UPDATE_OWN: "reviews.update_own",
  PUBLIC_READ: "reviews.public.read",
  ADMIN_MODERATE: "admin.reviews.moderate",
} as const;

/** Persisted Review states returned by the Module 15 API. */
export const REVIEW_STATUS = ["pending", "published", "hidden"] as const;

/** Human-readable labels keep Review lifecycle rendering consistent. */
export const REVIEW_STATUS_LABEL: Record<(typeof REVIEW_STATUS)[number], string> = {
  pending: "Pending moderation",
  published: "Published",
  hidden: "Hidden",
};

/** Rating choices mirror the backend 1..5 integer boundary. */
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
