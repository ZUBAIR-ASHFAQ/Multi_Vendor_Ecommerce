/** Stable permissions named by the controlling Module 19 requirements. */
export const SEARCH_PERMISSION = {
  PUBLIC: "search.public",
  ADMIN_MANAGE: "admin.search.manage",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const SEARCH_PERMISSION_CATALOG = [
  {
    code: SEARCH_PERMISSION.PUBLIC,
    domain: "search",
    description: "Use public storefront product, suggestion, and store discovery reads.",
  },
  {
    code: SEARCH_PERMISSION.ADMIN_MANAGE,
    domain: "search",
    description: "Queue and inspect privileged Search reindex operations.",
  },
] as const;

/** Stable Module 19 business error codes required by the controlling guide. */
export const SEARCH_ERROR_CODE = {
  SEARCH_QUERY_INVALID: "SEARCH_QUERY_INVALID",
  SEARCH_INDEX_UNAVAILABLE: "SEARCH_INDEX_UNAVAILABLE",
  SEARCH_REINDEX_RUNNING: "SEARCH_REINDEX_RUNNING",
} as const;

/** Durable Search events named by the controlling guide. */
export const SEARCH_OUTBOX_EVENT = {
  DOCUMENT_UPDATED: "search.document_updated",
  REINDEX_STARTED: "search.reindex_started",
  REINDEX_COMPLETED: "search.reindex_completed",
  REINDEX_FAILED: "search.reindex_failed",
} as const;

/** Stable resource names used by Search audit and outbox metadata. */
export const SEARCH_RESOURCE_TYPE = {
  PRODUCT_DOCUMENT: "search.product_document",
  REINDEX_RUN: "search.reindex_run",
} as const;

/** Audit actions for privileged Search administration commands. */
export const SEARCH_AUDIT_ACTION = {
  REINDEX_QUEUED: "search.reindex_queued",
} as const;

/** Internal stable failure reasons persisted on reindex runs without exposing exception details. */
export const SEARCH_REINDEX_FAILURE_CODE = {
  QUEUE_UNAVAILABLE: "SEARCH_REINDEX_QUEUE_UNAVAILABLE",
  PROCESSING_FAILED: "SEARCH_REINDEX_PROCESSING_FAILED",
} as const;

/** BullMQ names remain module-owned so they cannot drift between producer and worker. */
export const SEARCH_JOB = {
  /** Independent queue that receives Foundation domain events for Search synchronization. */
  SOURCE_EVENT_QUEUE: "search-source-events",
  REINDEX_QUEUE: "search-reindex",
  FULL_REINDEX: "full-catalog",
} as const;

/** Full-catalog reindex lifecycle states persisted by the Search read-model table. */
export const SEARCH_REINDEX_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const SEARCH_REINDEX_STATUS_VALUES = [
  SEARCH_REINDEX_STATUS.QUEUED,
  SEARCH_REINDEX_STATUS.RUNNING,
  SEARCH_REINDEX_STATUS.COMPLETED,
  SEARCH_REINDEX_STATUS.FAILED,
] as const;

/** Module 19 currently supports only the bounded full-catalog reindex command required by the guide. */
export const SEARCH_REINDEX_SCOPE = {
  FULL_CATALOG: "full_catalog",
} as const;

/** Allow-listed storefront Product sort choices. */
export const SEARCH_PRODUCT_SORT = {
  RELEVANCE: "relevance",
  PRICE_ASC: "price_asc",
  PRICE_DESC: "price_desc",
  RATING_DESC: "rating_desc",
  NEWEST: "newest",
} as const;

export const SEARCH_PRODUCT_SORT_VALUES = [
  SEARCH_PRODUCT_SORT.RELEVANCE,
  SEARCH_PRODUCT_SORT.PRICE_ASC,
  SEARCH_PRODUCT_SORT.PRICE_DESC,
  SEARCH_PRODUCT_SORT.RATING_DESC,
  SEARCH_PRODUCT_SORT.NEWEST,
] as const;

/** Allow-listed public store ordering; relevance is the default for a text search. */
export const SEARCH_STORE_SORT_VALUES = ["relevance", "name"] as const;

/** Dedicated abuse protection for the privileged full-reindex command. */
export const SEARCH_REINDEX_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS: 3,
} as const;

/** Database and HTTP bounds used by Module 19 request/response contracts. */
export const SEARCH_LIMITS = {
  QUERY_MAX_LENGTH: 200,
  SUGGESTION_QUERY_MAX_LENGTH: 120,
  SUGGESTION_LIMIT_MAX: 20,
  ATTRIBUTE_FILTER_MAX_COUNT: 20,
  ATTRIBUTE_FILTER_TOKEN_MAX_LENGTH: 240,
  FACET_LABEL_MAX_LENGTH: 240,
  CATEGORY_PATH_MAX_LENGTH: 2_000,
  REINDEX_ERROR_CODE_MAX_LENGTH: 120,
  EXPANDED_QUERY_MAX_LENGTH: 800,
  REINDEX_BATCH_SIZE: 100,
} as const;
