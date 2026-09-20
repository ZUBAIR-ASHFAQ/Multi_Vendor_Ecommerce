import { env } from "./env.js";

/** Non-secret Express application settings derived from the validated environment. */
export const appConfig = {
  bodyLimit: env.HTTP_BODY_LIMIT,
  trustProxy: env.HTTP_TRUST_PROXY,
  productModerationRequired: env.PRODUCT_MODERATION_REQUIRED,
  reviewModerationRequired: env.REVIEW_MODERATION_REQUIRED,
} as const;
