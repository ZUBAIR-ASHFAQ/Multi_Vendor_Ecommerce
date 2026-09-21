import { z } from "zod";
import { SEARCH_UI_LIMITS } from "../search-discovery.constants";

const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(?:\.\d{1,2})?$/, "Use a non-negative price with at most two decimal places.");

/** Converts one validated NUMERIC(18,2) price string into exact cents for range comparison. */
function priceToCents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

/** Accepts URL booleans produced either by the router serializer or a manually entered URL. */
function routeBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** Normalizes one or many URL attribute filters into the array expected by Module 19. */
function routeAttributeFilters(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  return Array.isArray(value) ? value : [value];
}

const optionalQuerySchema = z.string().trim().min(1).max(SEARCH_UI_LIMITS.QUERY_MAX_LENGTH).optional();
const uuidSchema = z.string().uuid();
const sortSchema = z.enum(["relevance", "price_asc", "price_desc", "rating_desc", "newest"]);
const storeSortSchema = z.enum(["relevance", "name"]);
const attributeFilterSchema = z.string().trim().min(3).max(240);

/** Typed URL state for the public Product Search route. */
export const searchProductsRouteSearchSchema = z.object({
  q: optionalQuerySchema.catch(undefined),
  categoryId: uuidSchema.optional().catch(undefined),
  brandId: uuidSchema.optional().catch(undefined),
  attribute: z
    .preprocess(
      routeAttributeFilters,
      z.array(attributeFilterSchema).max(SEARCH_UI_LIMITS.MAX_ATTRIBUTE_FILTERS).optional(),
    )
    .catch(undefined),
  minPrice: priceSchema.optional().catch(undefined),
  maxPrice: priceSchema.optional().catch(undefined),
  minRating: z.coerce.number().min(0).max(5).optional().catch(undefined),
  inStock: z.preprocess(routeBoolean, z.boolean().optional()).catch(undefined),
  sort: sortSchema.catch("relevance"),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_UI_LIMITS.MAX_PAGE_SIZE)
    .catch(SEARCH_UI_LIMITS.PAGE_SIZE),
});

/** Typed URL state for public Store discovery. */
export const searchStoresRouteSearchSchema = z.object({
  q: optionalQuerySchema.catch(undefined),
  sort: storeSortSchema.catch("relevance"),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_UI_LIMITS.MAX_PAGE_SIZE)
    .catch(SEARCH_UI_LIMITS.PAGE_SIZE),
});

/** TanStack Form contract for the storefront search text field. */
export const searchQueryFormSchema = z.object({
  q: z.string().trim().max(SEARCH_UI_LIMITS.QUERY_MAX_LENGTH),
});

/** TanStack Form contract for scalar Product Search filters. Facets and sorting stay URL-backed separately. */
export const searchFiltersFormSchema = z
  .object({
    minPrice: z.union([z.literal(""), priceSchema]),
    maxPrice: z.union([z.literal(""), priceSchema]),
    minRating: z.enum(["", "1", "2", "3", "4", "5"]),
    inStock: z.enum(["all", "true", "false"]),
  })
  .superRefine((value, context) => {
    if (value.minPrice && value.maxPrice && priceToCents(value.minPrice) > priceToCents(value.maxPrice)) {
      context.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "Maximum price must be greater than or equal to minimum price.",
      });
    }
  });

/** TanStack Form contract for the required public Store Search text. */
export const searchStoresFormSchema = z.object({
  q: z.string().trim().min(1).max(SEARCH_UI_LIMITS.QUERY_MAX_LENGTH),
  sort: storeSortSchema,
});

/** One public-safe Product card returned by Module 19 Search. */
export const searchProductCardSchema = z.object({
  productId: uuidSchema,
  storeId: uuidSchema,
  slug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  categoryId: uuidSchema,
  categoryPath: z.string().trim().min(1).max(2_000),
  brandId: uuidSchema.nullable(),
  brand: z.string().trim().min(1).max(200).nullable(),
  minPrice: priceSchema,
  maxPrice: priceSchema,
  minCompareAtPrice: priceSchema.nullable(),
  maxCompareAtPrice: priceSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.number().int().nonnegative(),
  inStock: z.boolean(),
  thumbnailFileId: uuidSchema.nullable(),
  updatedAt: z.iso.datetime(),
});

/** Facets returned alongside Product Search results. */
export const searchFacetsSchema = z.object({
  categories: z.array(z.object({
    categoryId: uuidSchema,
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
  })),
  brands: z.array(z.object({
    brandId: uuidSchema,
    label: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
  })),
  attributes: z.array(z.object({
    attributeId: uuidSchema,
    label: z.string().trim().min(1),
    values: z.array(z.object({
      value: z.string().trim().min(1),
      label: z.string().trim().min(1),
      count: z.number().int().nonnegative(),
    })),
  })),
  price: z.object({ min: priceSchema, max: priceSchema }).nullable(),
  availability: z.object({
    inStock: z.number().int().nonnegative(),
    outOfStock: z.number().int().nonnegative(),
  }),
});

/** Product Search payload inside the standard API envelope. */
export const searchProductsDataSchema = z.object({
  items: z.array(searchProductCardSchema),
  facets: searchFacetsSchema,
});

/** Public Store projection reused by Search without private seller fields. */
export const searchStoreSchema = z.object({
  id: uuidSchema,
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  logoFileId: uuidSchema.nullable(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  supportEmail: z.string().email().nullable(),
  seller: z.object({
    id: uuidSchema,
    displayName: z.string().trim().min(1),
  }),
});

export type SearchProductsRouteSearch = z.infer<typeof searchProductsRouteSearchSchema>;
export type SearchStoresRouteSearch = z.infer<typeof searchStoresRouteSearchSchema>;
export type SearchFiltersFormValue = z.infer<typeof searchFiltersFormSchema>;
export type SearchProductCard = z.infer<typeof searchProductCardSchema>;
export type SearchFacets = z.infer<typeof searchFacetsSchema>;
export type SearchProductsData = z.infer<typeof searchProductsDataSchema>;
export type SearchStore = z.infer<typeof searchStoreSchema>;
