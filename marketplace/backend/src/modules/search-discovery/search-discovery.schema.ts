import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import { productCurrencySchema, productPriceSchema } from "../products/products.schema.js";
import { publicStoreResponseSchema } from "../sellers/sellers.schema.js";
import {
  SEARCH_LIMITS,
  SEARCH_PRODUCT_SORT_VALUES,
  SEARCH_REINDEX_SCOPE,
  SEARCH_REINDEX_STATUS_VALUES,
  SEARCH_STORE_SORT_VALUES,
} from "./search-discovery.constants.js";

/** Compares two validated non-negative NUMERIC(18,2) strings without converting money to floating point. */
function comparePriceStrings(left: string, right: string): number {
  /** Converts one validated decimal price string into exact integer cents. */
  function toCents(value: string): bigint {
    const [whole = "0", fractional = ""] = value.split(".");
    const cents = `${fractional}00`.slice(0, 2);
    return BigInt(whole) * 100n + BigInt(cents);
  }

  const leftCents = toCents(left);
  const rightCents = toCents(right);
  return leftCents === rightCents ? 0 : leftCents < rightCents ? -1 : 1;
}

/** Trimmed public Search text bounded before it reaches PostgreSQL FTS/trigram queries. */
export const searchQueryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(SEARCH_LIMITS.QUERY_MAX_LENGTH);

/** Query-string boolean that accepts only explicit true/false values. */
const searchBooleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Rating filter accepted from storefront query strings. */
const searchMinimumRatingSchema = z.coerce.number().min(0).max(5);

/** One URL-safe attribute-facet token in the documented attributeId=value form. */
export const searchAttributeFilterTokenSchema = z
  .string()
  .trim()
  .min(3)
  .max(SEARCH_LIMITS.ATTRIBUTE_FILTER_TOKEN_MAX_LENGTH)
  .superRefine((value, context) => {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      context.addIssue({
        code: "custom",
        message: "Attribute filters must use attributeId=value.",
      });
      return;
    }

    const attributeId = value.slice(0, separatorIndex);
    const facetValue = value.slice(separatorIndex + 1).trim();
    if (!uuidSchema.safeParse(attributeId).success || facetValue.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Attribute filters require a UUID attribute ID and non-blank value.",
      });
    }
  });

/** Normalizes one-or-many Express query values into one bounded attribute-filter array. */
const searchAttributeFiltersQuerySchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
  },
  z
    .array(searchAttributeFilterTokenSchema)
    .max(SEARCH_LIMITS.ATTRIBUTE_FILTER_MAX_COUNT)
    .optional(),
);

/** Public Product Search query with only the documented filter/sort families. */
export const searchProductsQuerySchema = paginationQuerySchema
  .extend({
    q: searchQueryTextSchema.optional(),
    categoryId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    attribute: searchAttributeFiltersQuerySchema,
    minPrice: productPriceSchema.optional(),
    maxPrice: productPriceSchema.optional(),
    minRating: searchMinimumRatingSchema.optional(),
    inStock: searchBooleanQuerySchema.optional(),
    sort: z.enum(SEARCH_PRODUCT_SORT_VALUES).default("relevance"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      comparePriceStrings(value.minPrice, value.maxPrice) > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Minimum price must not exceed maximum price.",
        path: ["minPrice"],
      });
    }
  });

/** Bounded autocomplete query; suggestions never accept arbitrary sort/filter expressions. */
export const searchSuggestionsQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(2)
      .max(SEARCH_LIMITS.SUGGESTION_QUERY_MAX_LENGTH),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SEARCH_LIMITS.SUGGESTION_LIMIT_MAX)
      .default(8),
  })
  .strict();

/** Public store Search query with bounded pagination and one allow-listed sort key. */
export const searchStoresQuerySchema = paginationQuerySchema
  .extend({
    q: searchQueryTextSchema,
    sort: z.enum(SEARCH_STORE_SORT_VALUES).default("relevance"),
  })
  .strict();

/** Reindex status path parameter used by GET /api/v1/admin/search/reindex/:id. */
export const searchReindexIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** The controlling API exposes only a bounded full reindex, so callers cannot tune worker internals. */
export const queueSearchReindexBodySchema = z.object({}).strict().default({});

/** Public-safe Product card returned by Search; seller-private lifecycle fields are deliberately absent. */
export const searchProductCardResponseSchema = z
  .object({
    productId: uuidSchema,
    storeId: uuidSchema,
    slug: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(240),
    categoryId: uuidSchema,
    categoryPath: z.string().trim().min(1).max(SEARCH_LIMITS.CATEGORY_PATH_MAX_LENGTH),
    brandId: uuidSchema.nullable(),
    brand: z.string().trim().min(1).max(200).nullable(),
    minPrice: productPriceSchema,
    maxPrice: productPriceSchema,
    minCompareAtPrice: productPriceSchema.nullable(),
    maxCompareAtPrice: productPriceSchema.nullable(),
    currency: productCurrencySchema,
    ratingAvg: z.number().min(0).max(5),
    ratingCount: z.number().int().nonnegative(),
    inStock: z.boolean(),
    thumbnailFileId: uuidSchema.nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** One counted category facet generated from the public Search result set. */
export const searchCategoryFacetResponseSchema = z
  .object({
    categoryId: uuidSchema,
    label: z.string().trim().min(1).max(SEARCH_LIMITS.FACET_LABEL_MAX_LENGTH),
    path: z.string().trim().min(1).max(SEARCH_LIMITS.CATEGORY_PATH_MAX_LENGTH),
    count: z.number().int().nonnegative(),
  })
  .strict();

/** One counted brand facet generated from the public Search result set. */
export const searchBrandFacetResponseSchema = z
  .object({
    brandId: uuidSchema,
    label: z.string().trim().min(1).max(SEARCH_LIMITS.FACET_LABEL_MAX_LENGTH),
    count: z.number().int().nonnegative(),
  })
  .strict();

/** One counted value nested under a filterable taxonomy attribute facet. */
export const searchAttributeFacetValueResponseSchema = z
  .object({
    value: z.string().trim().min(1).max(SEARCH_LIMITS.ATTRIBUTE_FILTER_TOKEN_MAX_LENGTH),
    label: z.string().trim().min(1).max(SEARCH_LIMITS.FACET_LABEL_MAX_LENGTH),
    count: z.number().int().nonnegative(),
  })
  .strict();

/** One filterable taxonomy attribute and its bounded public values. */
export const searchAttributeFacetResponseSchema = z
  .object({
    attributeId: uuidSchema,
    label: z.string().trim().min(1).max(SEARCH_LIMITS.FACET_LABEL_MAX_LENGTH),
    values: z.array(searchAttributeFacetValueResponseSchema),
  })
  .strict();

/** Facet aggregates returned beside Search Product cards. */
export const searchFacetsResponseSchema = z
  .object({
    categories: z.array(searchCategoryFacetResponseSchema),
    brands: z.array(searchBrandFacetResponseSchema),
    attributes: z.array(searchAttributeFacetResponseSchema),
    price: z
      .object({
        min: productPriceSchema,
        max: productPriceSchema,
      })
      .strict()
      .nullable(),
    availability: z
      .object({
        inStock: z.number().int().nonnegative(),
        outOfStock: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** Product Search data combines public cards and facets; envelope metadata carries pagination. */
export const searchProductsDataSchema = z
  .object({
    items: z.array(searchProductCardResponseSchema),
    facets: searchFacetsResponseSchema,
  })
  .strict();

/** One autocomplete string. Search suggestions intentionally carry no private Product/store fields. */
export const searchSuggestionResponseSchema = z
  .string()
  .trim()
  .min(1)
  .max(SEARCH_LIMITS.QUERY_MAX_LENGTH);

/** Autocomplete response data returned inside the standard success envelope. */
export const searchSuggestionsDataSchema = z.array(searchSuggestionResponseSchema);

/** Public store Search returns the existing public-safe Module 4 store contract. */
export const searchStoresDataSchema = z.array(publicStoreResponseSchema);

/** Admin-safe status for one full-catalog Search reindex run. */
export const searchReindexRunResponseSchema = z
  .object({
    id: uuidSchema,
    scope: z.literal(SEARCH_REINDEX_SCOPE.FULL_CATALOG),
    status: z.enum(SEARCH_REINDEX_STATUS_VALUES),
    requestedAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    errorCode: z
      .string()
      .trim()
      .min(1)
      .max(SEARCH_LIMITS.REINDEX_ERROR_CODE_MAX_LENGTH)
      .nullable(),
  })
  .strict();

export type SearchProductsQuery = z.infer<typeof searchProductsQuerySchema>;
export type SearchSuggestionsQuery = z.infer<typeof searchSuggestionsQuerySchema>;
export type SearchStoresQuery = z.infer<typeof searchStoresQuerySchema>;
export type SearchProductCardResponse = z.infer<typeof searchProductCardResponseSchema>;
export type SearchProductsData = z.infer<typeof searchProductsDataSchema>;
export type SearchReindexRunResponse = z.infer<typeof searchReindexRunResponseSchema>;
