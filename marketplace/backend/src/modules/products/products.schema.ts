import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  decimalStringSchema,
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  PRODUCT_LIMITS,
  PRODUCT_MEDIA_STATUS_VALUES,
  PRODUCT_PUBLICATION_STATUS_VALUES,
  PRODUCT_SORT_DIRECTION_VALUES,
  PRODUCT_STATUS_VALUES,
  PRODUCT_VARIANT_STATUS_VALUES,
  PUBLIC_PRODUCT_SORT_VALUES,
  SELLER_PRODUCT_SORT_VALUES,
} from "./products.constants.js";

/** Creates one trimmed non-blank string bounded by the supplied database/API limit. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Creates one lowercase normalized identifier used for globally unique Product slugs. */
function normalizedLowercaseString(maxLength: number) {
  return z.string().trim().toLowerCase().min(1).max(maxLength);
}

/** Returns true when a canonical decimal string fits one PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsignedValue.split(".");
  const maximumIntegerDigits = precision - scale;

  return integerPart.length <= maximumIntegerDigits && fractionPart.length <= scale;
}

/** Creates a canonical decimal-string schema that cannot overflow or be rounded by PostgreSQL NUMERIC. */
function boundedDecimalString(precision: number, scale: number, nonNegative = false) {
  const baseSchema = nonNegative
    ? nonNegativeDecimalStringSchema
    : decimalStringSchema;

  return baseSchema.refine(
    (value) => decimalFitsNumeric(value, precision, scale),
    `Value must fit NUMERIC(${precision},${scale}) without rounding.`,
  );
}

/** NUMERIC(18,2) Product price contract transported as a non-negative decimal string. */
export const productPriceSchema = boundedDecimalString(18, 2, true);

/** NUMERIC(12,3) Product weight contract transported as a non-negative decimal string. */
export const productWeightSchema = boundedDecimalString(12, 3, true);

/** NUMERIC(24,6) taxonomy attribute-number contract transported as a decimal string. */
export const productAttributeNumberSchema = boundedDecimalString(24, 6);

/** ISO-4217-shaped uppercase currency code; supported-currency membership remains a service rule. */
export const productCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code");

/** Lowercase normalized globally unique Product slug persisted by the Product table. */
export const productSlugSchema = normalizedLowercaseString(
  PRODUCT_LIMITS.SLUG_MAX_LENGTH,
);

/** Product active/inactive lifecycle state. */
export const productStatusSchema = z.enum(PRODUCT_STATUS_VALUES);

/** Product publication state returned by seller/admin reads. */
export const productPublicationStatusSchema = z.enum(
  PRODUCT_PUBLICATION_STATUS_VALUES,
);

/** Product variant active/inactive lifecycle state. */
export const productVariantStatusSchema = z.enum(PRODUCT_VARIANT_STATUS_VALUES);

/** Product media active/inactive lifecycle state. */
export const productMediaStatusSchema = z.enum(PRODUCT_MEDIA_STATUS_VALUES);

/** One typed product or variant attribute value; service validation checks taxonomy compatibility. */
export const productAttributeInputSchema = z
  .object({
    attributeId: uuidSchema,
    valueText: nonBlankString(PRODUCT_LIMITS.DESCRIPTION_MAX_LENGTH).optional(),
    valueNumber: productAttributeNumberSchema.optional(),
    valueId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const suppliedValues = [value.valueText, value.valueNumber, value.valueId].filter(
      (item) => item !== undefined,
    );

    if (suppliedValues.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one attribute value representation is required.",
      });
    }
  });

/** Product/variant attribute collection with one value per attribute definition. */
export const productAttributesInputSchema = z
  .array(productAttributeInputSchema)
  .superRefine((values, context) => {
    const seen = new Set<string>();

    values.forEach((value, index) => {
      if (seen.has(value.attributeId)) {
        context.addIssue({
          code: "custom",
          message: "Each attribute may be supplied only once.",
          path: [index, "attributeId"],
        });
      }
      seen.add(value.attributeId);
    });
  });

/** Shared Product ID parameter used by seller/admin Product commands. */
export const productIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Product and variant IDs used by variant update commands. */
export const productVariantIdParamsSchema = z
  .object({
    id: uuidSchema,
    variantId: uuidSchema,
  })
  .strict();

/** Public Product slug parameter used by GET /api/v1/products/:slug. */
export const publicProductSlugParamsSchema = z
  .object({
    slug: productSlugSchema,
  })
  .strict();

/** Bounded public Product-list filters; public visibility remains service/repository enforced. */
export const publicProductListQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().min(1).max(PRODUCT_LIMITS.SEARCH_MAX_LENGTH).optional(),
    categoryId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    storeId: uuidSchema.optional(),
    sort: z.enum(PUBLIC_PRODUCT_SORT_VALUES).default("createdAt"),
    direction: z.enum(PRODUCT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Bounded seller Product-list filters scoped server-side to authenticated seller/store grants. */
export const sellerProductListQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().min(1).max(PRODUCT_LIMITS.SEARCH_MAX_LENGTH).optional(),
    storeId: uuidSchema.optional(),
    status: productStatusSchema.optional(),
    publicationStatus: productPublicationStatusSchema.optional(),
    sort: z.enum(SELLER_PRODUCT_SORT_VALUES).default("createdAt"),
    direction: z.enum(PRODUCT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Bounded cross-seller moderation queue filters available only to product reviewers. */
export const adminProductListQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().min(1).max(PRODUCT_LIMITS.SEARCH_MAX_LENGTH).optional(),
    sellerId: uuidSchema.optional(),
    storeId: uuidSchema.optional(),
    publicationStatus: productPublicationStatusSchema.default("pending_approval"),
    sort: z.enum(SELLER_PRODUCT_SORT_VALUES).default("updatedAt"),
    direction: z.enum(PRODUCT_SORT_DIRECTION_VALUES).default("asc"),
  })
  .strict();

/** Request body for POST /api/v1/seller/products. Seller identity and publication state are server-derived. */
export const createProductBodySchema = z
  .object({
    storeId: uuidSchema,
    categoryId: uuidSchema,
    brandId: uuidSchema.nullable().optional(),
    slug: productSlugSchema,
    name: nonBlankString(PRODUCT_LIMITS.NAME_MAX_LENGTH),
    description: nonBlankString(PRODUCT_LIMITS.DESCRIPTION_MAX_LENGTH),
    attributes: productAttributesInputSchema.optional(),
  })
  .strict();

/** Request body for PATCH /api/v1/seller/products/:id. Lifecycle states remain command-owned. */
export const updateProductBodySchema = z
  .object({
    categoryId: uuidSchema.optional(),
    brandId: uuidSchema.nullable().optional(),
    slug: productSlugSchema.optional(),
    name: nonBlankString(PRODUCT_LIMITS.NAME_MAX_LENGTH).optional(),
    description: nonBlankString(PRODUCT_LIMITS.DESCRIPTION_MAX_LENGTH).optional(),
    attributes: productAttributesInputSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable product field is required.",
  })
  .meta({ minProperties: 1 });

/** One variant payload used when adding a SKU to an owned Product. */
export const createProductVariantBodySchema = z
  .object({
    sku: nonBlankString(PRODUCT_LIMITS.SKU_MAX_LENGTH),
    title: nonBlankString(PRODUCT_LIMITS.VARIANT_TITLE_MAX_LENGTH),
    price: productPriceSchema,
    compareAtPrice: productPriceSchema.nullable().optional(),
    currency: productCurrencySchema,
    status: productVariantStatusSchema.optional(),
    weight: productWeightSchema.nullable().optional(),
    attributes: productAttributesInputSchema.optional(),
  })
  .strict();

/** Request body for PATCH /api/v1/seller/products/:id/variants/:variantId. */
export const updateProductVariantBodySchema = z
  .object({
    sku: nonBlankString(PRODUCT_LIMITS.SKU_MAX_LENGTH).optional(),
    title: nonBlankString(PRODUCT_LIMITS.VARIANT_TITLE_MAX_LENGTH).optional(),
    price: productPriceSchema.optional(),
    compareAtPrice: productPriceSchema.nullable().optional(),
    currency: productCurrencySchema.optional(),
    status: productVariantStatusSchema.optional(),
    weight: productWeightSchema.nullable().optional(),
    attributes: productAttributesInputSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable variant field is required.",
  })
  .meta({ minProperties: 1 });

/** Request body for POST /api/v1/seller/products/:id/media. MIME/media type is derived from Module 21 file metadata. */
export const linkProductMediaBodySchema = z
  .object({
    fileId: uuidSchema,
    variantId: uuidSchema.nullable().optional(),
    altText: nonBlankString(PRODUCT_LIMITS.ALT_TEXT_MAX_LENGTH).nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Empty Product command body that also accepts an omitted JSON body. */
export const emptyProductCommandBodySchema = z.object({}).strict().default({});

/** Mandatory reviewer explanation for returning a submitted Product to its seller. */
export const rejectProductBodySchema = z
  .object({
    reason: nonBlankString(PRODUCT_LIMITS.MODERATION_REASON_MAX_LENGTH),
  })
  .strict();

/** Safe Product representation returned to seller/admin Product workflows. */
export const productResponseSchema = z
  .object({
    id: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    categoryId: uuidSchema,
    brandId: uuidSchema.nullable(),
    slug: z.string().min(1).max(PRODUCT_LIMITS.SLUG_MAX_LENGTH),
    name: z.string().min(1).max(PRODUCT_LIMITS.NAME_MAX_LENGTH),
    description: z.string().min(1),
    status: productStatusSchema,
    publicationStatus: productPublicationStatusSchema,
    moderationReason: z.string().nullable(),
    reviewedBy: uuidSchema.nullable(),
    reviewedAt: isoDateTimeSchema.nullable(),
    publishedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Public-safe Product representation that omits seller-private/internal lifecycle fields. */
export const publicProductResponseSchema = productResponseSchema.omit({
  sellerId: true,
  status: true,
  publicationStatus: true,
  moderationReason: true,
  reviewedBy: true,
  reviewedAt: true,
});

/** Safe variant representation; NUMERIC fields remain bounded decimal strings over HTTP. */
export const productVariantResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    sku: z.string().min(1).max(PRODUCT_LIMITS.SKU_MAX_LENGTH),
    title: z.string().min(1).max(PRODUCT_LIMITS.VARIANT_TITLE_MAX_LENGTH),
    price: productPriceSchema,
    compareAtPrice: productPriceSchema.nullable(),
    currency: productCurrencySchema,
    status: productVariantStatusSchema,
    weight: productWeightSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Public-safe variant representation that omits the internal active/inactive lifecycle field. */
export const publicProductVariantResponseSchema = productVariantResponseSchema.omit({
  status: true,
});

/** Safe persisted attribute-value representation returned with seller/public Product detail. */
export const productAttributeValueResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema.nullable(),
    attributeId: uuidSchema,
    valueText: z.string().nullable(),
    valueNumber: productAttributeNumberSchema.nullable(),
    valueId: uuidSchema.nullable(),
  })
  .strict();

/** Safe Product-media representation containing file metadata identifiers, never permanent object URLs. */
export const productMediaResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema.nullable(),
    fileId: uuidSchema,
    mediaType: z.string().trim().min(1).max(PRODUCT_LIMITS.MEDIA_TYPE_MAX_LENGTH),
    altText: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    status: productMediaStatusSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Public-safe media representation that omits the internal active/inactive lifecycle field. */
export const publicProductMediaResponseSchema = productMediaResponseSchema.omit({
  status: true,
});

/** Immutable price-history representation returned by seller Product detail/history reads. */
export const productPriceHistoryResponseSchema = z
  .object({
    id: uuidSchema,
    variantId: uuidSchema,
    oldPrice: productPriceSchema,
    newPrice: productPriceSchema,
    changedBy: uuidSchema,
    changedAt: isoDateTimeSchema,
  })
  .strict();

/** Detailed Product response used by seller/admin workflows after seller/resource scope checks. */
export const productDetailResponseSchema = productResponseSchema.extend({
  variants: z.array(productVariantResponseSchema),
  attributes: z.array(productAttributeValueResponseSchema),
  media: z.array(productMediaResponseSchema),
  priceHistory: z.array(productPriceHistoryResponseSchema).optional(),
});

/** Lean public Product aggregate reused by trusted commerce/search integrations without storefront-only presentation data. */
export const publicProductCommerceDetailResponseSchema = publicProductResponseSchema.extend({
  variants: z.array(publicProductVariantResponseSchema),
  attributes: z.array(productAttributeValueResponseSchema),
  media: z.array(publicProductMediaResponseSchema),
});

/** Public Store identity embedded in Product detail so the storefront can link the seller without a second lookup. */
export const publicProductStoreResponseSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    logoFileId: uuidSchema.nullable(),
    seller: z.object({
      id: uuidSchema,
      displayName: z.string().trim().min(1),
    }).strict(),
  })
  .strict();

/** Public category/brand identity embedded in Product detail for breadcrumbs and merchandising context. */
export const publicProductTaxonomyResponseSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

/** Public HTTP Product detail adds only safe storefront presentation context to the lean commerce aggregate. */
export const publicProductDetailResponseSchema = publicProductCommerceDetailResponseSchema.extend({
  store: publicProductStoreResponseSchema,
  category: publicProductTaxonomyResponseSchema,
  brand: publicProductTaxonomyResponseSchema.nullable(),
});

/** Public storefront-card fields derived from active Product variants/media and the active Store. */
export const publicProductListItemResponseSchema = publicProductResponseSchema.extend({
  minPrice: productPriceSchema,
  maxPrice: productPriceSchema,
  currency: productCurrencySchema,
  thumbnailFileId: uuidSchema.nullable(),
});

/** Public list response data; pagination metadata belongs in the standard envelope's meta field. */
export const publicProductListDataSchema = z.array(publicProductListItemResponseSchema);

/** Seller Product-list row enriched with display-only Store, variant, price, and thumbnail context. */
export const sellerProductListItemResponseSchema = productResponseSchema.extend({
  storeName: z.string().trim().min(1),
  storeSlug: z.string().trim().min(1),
  storeCurrency: productCurrencySchema,
  variantCount: z.number().int().nonnegative(),
  minPrice: productPriceSchema.nullable(),
  maxPrice: productPriceSchema.nullable(),
  priceCurrency: productCurrencySchema.nullable(),
  thumbnailFileId: uuidSchema.nullable(),
});

/** Seller list response data; pagination metadata belongs in the standard envelope's meta field. */
export const sellerProductListDataSchema = z.array(sellerProductListItemResponseSchema);

/** Admin moderation list keeps the original Product response contract. */
export const adminProductListDataSchema = z.array(productResponseSchema);

export type PublicProductListQuery = z.infer<typeof publicProductListQuerySchema>;
export type SellerProductListQuery = z.infer<typeof sellerProductListQuerySchema>;
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductBodySchema>;
export type UpdateProductInput = z.infer<typeof updateProductBodySchema>;
export type CreateProductVariantInput = z.infer<typeof createProductVariantBodySchema>;
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantBodySchema>;
export type LinkProductMediaInput = z.infer<typeof linkProductMediaBodySchema>;
export type RejectProductInput = z.infer<typeof rejectProductBodySchema>;
export type ProductAttributeInput = z.infer<typeof productAttributeInputSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type PublicProductResponse = z.infer<typeof publicProductResponseSchema>;
export type PublicProductListItemResponse = z.infer<typeof publicProductListItemResponseSchema>;
export type SellerProductListItemResponse = z.infer<typeof sellerProductListItemResponseSchema>;
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export type PublicProductCommerceDetailResponse = z.infer<typeof publicProductCommerceDetailResponseSchema>;
export type PublicProductDetailResponse = z.infer<typeof publicProductDetailResponseSchema>;
export type ProductVariantResponse = z.infer<typeof productVariantResponseSchema>;
export type ProductMediaResponse = z.infer<typeof productMediaResponseSchema>;
export type ProductPriceHistoryResponse = z.infer<typeof productPriceHistoryResponseSchema>;
