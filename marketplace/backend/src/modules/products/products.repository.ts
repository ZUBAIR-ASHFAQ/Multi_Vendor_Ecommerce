import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  productAttributeValues,
  productMedia,
  productPriceHistory,
  products,
  productVariants,
  type NewProductAttributeValueRow,
  type NewProductMediaRow,
  type NewProductPriceHistoryRow,
  type NewProductRow,
  type NewProductVariantRow,
  type ProductAttributeValueRow,
  type ProductMediaRow,
  type ProductPriceHistoryRow,
  type ProductRow,
  type ProductVariantRow,
} from "../../database/schema/products.js";
import { brands, categories } from "../../database/schema/catalog.js";
import { sellers, stores } from "../../database/schema/sellers.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import {
  SELLER_APPROVAL_STATUS,
  SELLER_STATUS,
  STORE_STATUS,
} from "../sellers/sellers.constants.js";
import {
  PRODUCT_PUBLICATION_STATUS,
  PRODUCT_STATUS,
} from "./products.constants.js";
import type {
  AdminProductListQuery,
  PublicProductListQuery,
  SellerProductListQuery,
} from "./products.schema.js";

/** Server-derived seller/store IDs that must constrain every private Product query. */
export interface ProductSellerScope {
  sellerIds: string[];
  storeIds: string[];
}

/** Product fields persisted by the create-draft service command. */
export interface CreateProductRecordInput {
  sellerId: string;
  storeId: string;
  categoryId: string;
  brandId: string | null;
  slug: string;
  name: string;
  description: string;
  createdBy: string;
}

/** Editable product fields already authorized and validated by the service. */
export interface UpdateProductRecordInput {
  categoryId?: string;
  brandId?: string | null;
  slug?: string;
  name?: string;
  description?: string;
}

/** Publication fields written only by explicit service lifecycle commands. */
export interface UpdateProductPublicationRecordInput {
  publicationStatus: ProductRow["publicationStatus"];
  publishedAt: Date | null;
  moderationReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
}

/** Variant fields persisted after Product/taxonomy/currency rules have passed in the service. */
export interface CreateProductVariantRecordInput {
  productId: string;
  sku: string;
  title: string;
  price: string;
  compareAtPrice?: string | null;
  currency: string;
  status?: ProductVariantRow["status"];
  weight?: string | null;
}

/** Editable variant fields already validated by the service. */
export interface UpdateProductVariantRecordInput {
  sku?: string;
  title?: string;
  price?: string;
  compareAtPrice?: string | null;
  currency?: string;
  status?: ProductVariantRow["status"];
  weight?: string | null;
}

/** One product- or variant-level attribute value ready for persistence. */
export interface ProductAttributeRecordInput {
  attributeId: string;
  valueText?: string | null;
  valueNumber?: string | null;
  valueId?: string | null;
}

/** Product media metadata already authorized against Module 21 by the service. */
export interface CreateProductMediaRecordInput {
  productId: string;
  variantId?: string | null;
  fileId: string;
  mediaType: string;
  altText?: string | null;
  sortOrder?: number;
}

/** Immutable price-history values appended when a variant price changes. */
export interface CreateProductPriceHistoryRecordInput {
  variantId: string;
  oldPrice: string;
  newPrice: string;
  changedBy: string;
  changedAt?: Date;
}

/** One public Product list row enriched only with Product-module/store display data needed by storefront cards. */
export interface PublicProductListRow {
  product: ProductRow;
  minPrice: string;
  maxPrice: string;
  currency: string;
  thumbnailFileId: string | null;
}


/** Public Product plus only the safe Store/Seller/taxonomy fields needed by the storefront detail endpoint. */
export interface PublicProductStorefrontRow {
  product: ProductRow;
  storeId: string;
  storeSlug: string;
  storeName: string;
  storeLogoFileId: string | null;
  sellerId: string;
  sellerDisplayName: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  brandId: string | null;
  brandSlug: string | null;
  brandName: string | null;
}

/** Safe Product display context reused by customer intent surfaces such as Cart and Wishlist. */
export interface PublicProductDisplayContextRow {
  storeId: string;
  storeSlug: string;
  storeName: string;
  thumbnailFileId: string | null;
}

/** Seller Product list row enriched only with Product-owned display/read-model context. */
export interface SellerProductListRow {
  product: ProductRow;
  storeName: string;
  storeSlug: string;
  storeCurrency: string;
  variantCount: number;
  minPrice: string | null;
  maxPrice: string | null;
  priceCurrency: string | null;
  thumbnailFileId: string | null;
}

/** Paginated public Product rows returned by the public storefront list read. */
export interface PaginatedPublicProductRows {
  items: PublicProductListRow[];
  totalItems: number;
}

/** Paginated seller Product rows returned by seller-scoped repository list reads. */
export interface PaginatedSellerProductRows {
  items: SellerProductListRow[];
  totalItems: number;
}

/** Paginated Product rows returned by admin repository list reads. */
export interface PaginatedProductRows {
  items: ProductRow[];
  totalItems: number;
}

/** Returns a SQL false predicate when a required seller/store scope is empty. */
function productSellerScopeCondition(scope: ProductSellerScope): SQL {
  if (scope.sellerIds.length === 0 || scope.storeIds.length === 0) {
    return sql`false`;
  }

  return and(
    inArray(products.sellerId, scope.sellerIds),
    inArray(products.storeId, scope.storeIds),
  ) as SQL;
}

/** Combines only SQL predicates that are actually present. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Maps public Product list sorting to deterministic SQL ordering. */
function publicProductOrder(query: PublicProductListQuery): SQL[] {
  const direction = query.direction === "asc" ? asc : desc;

  switch (query.sort) {
    case "name":
      return [direction(products.name), asc(products.id)];
    case "createdAt":
    default:
      return [direction(products.createdAt), asc(products.id)];
  }
}

/** Maps seller Product list sorting to deterministic SQL ordering. */
function sellerProductOrder(query: SellerProductListQuery): SQL[] {
  const direction = query.direction === "asc" ? asc : desc;

  switch (query.sort) {
    case "updatedAt":
      return [direction(products.updatedAt), asc(products.id)];
    case "name":
      return [direction(products.name), asc(products.id)];
    case "publicationStatus":
      return [direction(products.publicationStatus), asc(products.id)];
    case "createdAt":
    default:
      return [direction(products.createdAt), asc(products.id)];
  }
}

/** Builds the optional text-search predicate shared by public and seller list reads. */
function productTextSearch(search: string | undefined): SQL | undefined {
  if (!search) return undefined;

  const pattern = `%${search}%`;
  return or(
    ilike(products.name, pattern),
    ilike(products.slug, pattern),
    ilike(products.description, pattern),
  );
}

/**
 * Persistence-only Module 6 repository.
 * Permissions, seller lifecycle, taxonomy rules, publication decisions, audit, and outbox behavior stay in services.
 */
export class ProductsRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Lists only persisted public Product rows using bounded filters and deterministic ordering. */
  async listPublicProducts(query: PublicProductListQuery): Promise<PaginatedPublicProductRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(products.status, PRODUCT_STATUS.ACTIVE),
      eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
      eq(stores.status, STORE_STATUS.ACTIVE),
      eq(sellers.status, SELLER_STATUS.ACTIVE),
      eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
      query.categoryId ? eq(products.categoryId, query.categoryId) : undefined,
      query.brandId ? eq(products.brandId, query.brandId) : undefined,
      query.storeId ? eq(products.storeId, query.storeId) : undefined,
      productTextSearch(query.q),
    ]);

    const minPrice = sql<string>`(
      select min(${productVariants.price})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
        and ${productVariants.status} = ${PRODUCT_STATUS.ACTIVE}
    )`;
    const maxPrice = sql<string>`(
      select max(${productVariants.price})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
        and ${productVariants.status} = ${PRODUCT_STATUS.ACTIVE}
    )`;
    const thumbnailFileId = sql<string | null>`(
      select ${productMedia.fileId}
      from ${productMedia}
      where ${productMedia.productId} = ${products.id}
        and ${productMedia.status} = ${PRODUCT_STATUS.ACTIVE}
      order by ${productMedia.sortOrder} asc, ${productMedia.id} asc
      limit 1
    )`;

    const items = await this.executor
      .select({
        product: products,
        minPrice,
        maxPrice,
        currency: stores.defaultCurrency,
        thumbnailFileId,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(where)
      .orderBy(...publicProductOrder(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads only the Product seller/store/category scope needed by trusted downstream promotion configuration. */
  async findProductPromotionScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string; categoryId: string } | null> {
    const [row] = await this.executor
      .select({
        productId: products.id,
        sellerId: products.sellerId,
        storeId: products.storeId,
        categoryId: products.categoryId,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one public Product plus safe Store/Seller/taxonomy context for the public detail endpoint. */
  async findPublicProductStorefrontBySlug(slug: string): Promise<PublicProductStorefrontRow | null> {
    const [row] = await this.executor
      .select({
        product: products,
        storeId: stores.id,
        storeSlug: stores.slug,
        storeName: stores.name,
        storeLogoFileId: stores.logoFileId,
        sellerId: sellers.id,
        sellerDisplayName: sellers.displayName,
        categoryId: categories.id,
        categorySlug: categories.slug,
        categoryName: categories.name,
        brandId: brands.id,
        brandSlug: brands.slug,
        brandName: brands.name,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(
        and(
          eq(products.slug, slug),
          eq(products.status, PRODUCT_STATUS.ACTIVE),
          eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Reads safe Store identity and first active media only while the Product remains storefront-eligible. */
  async findPublicProductDisplayContextById(
    productId: string,
  ): Promise<PublicProductDisplayContextRow | null> {
    const thumbnailFileId = sql<string | null>`(
      select ${productMedia.fileId}
      from ${productMedia}
      where ${productMedia.productId} = ${products.id}
        and ${productMedia.status} = ${PRODUCT_STATUS.ACTIVE}
      order by ${productMedia.sortOrder} asc, ${productMedia.id} asc
      limit 1
    )`;

    const [row] = await this.executor
      .select({
        storeId: stores.id,
        storeSlug: stores.slug,
        storeName: stores.name,
        thumbnailFileId,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(
        and(
          eq(products.id, productId),
          eq(products.status, PRODUCT_STATUS.ACTIVE),
          eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Reads one persisted public Product candidate by ID for trusted downstream read-model synchronization. */
  async findPublicProductById(productId: string): Promise<ProductRow | null> {
    const [row] = await this.executor
      .select({ product: products })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(
        and(
          eq(products.id, productId),
          eq(products.status, PRODUCT_STATUS.ACTIVE),
          eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      )
      .limit(1);

    return row?.product ?? null;
  }

  /** Lists private Product rows only inside the server-derived seller/store scope. */
  async listSellerProducts(
    scope: ProductSellerScope,
    query: SellerProductListQuery,
  ): Promise<PaginatedSellerProductRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      productSellerScopeCondition(scope),
      query.storeId ? eq(products.storeId, query.storeId) : undefined,
      query.status ? eq(products.status, query.status) : undefined,
      query.publicationStatus
        ? eq(products.publicationStatus, query.publicationStatus)
        : undefined,
      productTextSearch(query.q),
    ]);
    const variantCount = sql<number>`(
      select count(*)::int
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
    )`;
    const minPrice = sql<string | null>`(
      select min(${productVariants.price})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
    )`;
    const maxPrice = sql<string | null>`(
      select max(${productVariants.price})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
    )`;
    const priceCurrency = sql<string | null>`(
      select case when count(distinct ${productVariants.currency}) = 1 then min(${productVariants.currency}) else null end
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
    )`;
    const thumbnailFileId = sql<string | null>`(
      select ${productMedia.fileId}
      from ${productMedia}
      where ${productMedia.productId} = ${products.id}
        and ${productMedia.status} = ${PRODUCT_STATUS.ACTIVE}
      order by ${productMedia.sortOrder} asc, ${productMedia.id} asc
      limit 1
    )`;

    const items = await this.executor
      .select({
        product: products,
        storeName: stores.name,
        storeSlug: stores.slug,
        storeCurrency: stores.defaultCurrency,
        variantCount,
        minPrice,
        maxPrice,
        priceCurrency,
        thumbnailFileId,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(where)
      .orderBy(...sellerProductOrder(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(products)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Lists the cross-seller product moderation queue for an authorized platform reviewer. */
  async listAdminProducts(query: AdminProductListQuery): Promise<PaginatedProductRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.sellerId ? eq(products.sellerId, query.sellerId) : undefined,
      query.storeId ? eq(products.storeId, query.storeId) : undefined,
      eq(products.publicationStatus, query.publicationStatus),
      productTextSearch(query.q),
    ]);

    const items = await this.executor
      .select()
      .from(products)
      .where(where)
      .orderBy(...sellerProductOrder(query))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(products)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Reads one Product by ID for a permission-checked admin moderation detail page. */
  async findProductByIdForAdmin(productId: string): Promise<ProductRow | null> {
    const [row] = await this.executor
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return row ?? null;
  }

  /** Reads one private Product only inside the server-derived seller/store scope. */
  async findProductByIdInSellerScope(
    productId: string,
    scope: ProductSellerScope,
  ): Promise<ProductRow | null> {
    const [row] = await this.executor
      .select()
      .from(products)
      .where(and(eq(products.id, productId), productSellerScopeCondition(scope)))
      .limit(1);

    return row ?? null;
  }

  /** Locks one seller-scoped Product before an editable or lifecycle-sensitive service transaction. */
  async findProductByIdInSellerScopeForUpdate(
    productId: string,
    scope: ProductSellerScope,
  ): Promise<ProductRow | null> {
    const [row] = await this.executor
      .select()
      .from(products)
      .where(and(eq(products.id, productId), productSellerScopeCondition(scope)))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one Product by ID for an explicitly privileged admin lifecycle transaction. */
  async findProductByIdForAdminUpdate(productId: string): Promise<ProductRow | null> {
    const [row] = await this.executor
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Finds a conflicting globally unique Product slug, excluding one edited Product when supplied. */
  async findProductIdBySlug(
    slug: string,
    excludeProductId?: string,
  ): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: products.id })
      .from(products)
      .where(
        combineConditions([
          eq(products.slug, slug),
          excludeProductId ? ne(products.id, excludeProductId) : undefined,
        ]),
      )
      .limit(1);

    return row?.id ?? null;
  }

  /** Creates one draft Product after the service has derived ownership and validated taxonomy. */
  async createProduct(input: CreateProductRecordInput): Promise<ProductRow> {
    const values: NewProductRow = {
      sellerId: input.sellerId,
      storeId: input.storeId,
      categoryId: input.categoryId,
      brandId: input.brandId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
    };

    const [row] = await this.executor.insert(products).values(values).returning();
    if (!row) throw new Error("Product insert completed without returning a row.");
    return row;
  }

  /** Updates editable Product fields only inside the server-derived seller/store scope. */
  async updateProductInSellerScope(
    productId: string,
    scope: ProductSellerScope,
    input: UpdateProductRecordInput,
    updatedAt: Date = new Date(),
  ): Promise<ProductRow | null> {
    const [row] = await this.executor
      .update(products)
      .set({ ...input, updatedAt })
      .where(and(eq(products.id, productId), productSellerScopeCondition(scope)))
      .returning();

    return row ?? null;
  }

  /** Persists a seller-owned publication transition only inside the server-derived scope. */
  async updateProductPublicationInSellerScope(
    productId: string,
    scope: ProductSellerScope,
    input: UpdateProductPublicationRecordInput,
    updatedAt: Date = new Date(),
  ): Promise<ProductRow | null> {
    const [row] = await this.executor
      .update(products)
      .set({
        publicationStatus: input.publicationStatus,
        publishedAt: input.publishedAt,
        ...(input.moderationReason !== undefined
          ? { moderationReason: input.moderationReason }
          : {}),
        ...(input.reviewedBy !== undefined ? { reviewedBy: input.reviewedBy } : {}),
        ...(input.reviewedAt !== undefined ? { reviewedAt: input.reviewedAt } : {}),
        updatedAt,
      })
      .where(and(eq(products.id, productId), productSellerScopeCondition(scope)))
      .returning();

    return row ?? null;
  }

  /** Persists a publication transition for an explicitly privileged admin review command. */
  async updateProductPublicationForAdmin(
    productId: string,
    input: UpdateProductPublicationRecordInput,
    updatedAt: Date = new Date(),
  ): Promise<ProductRow | null> {
    const [row] = await this.executor
      .update(products)
      .set({
        publicationStatus: input.publicationStatus,
        publishedAt: input.publishedAt,
        ...(input.moderationReason !== undefined
          ? { moderationReason: input.moderationReason }
          : {}),
        ...(input.reviewedBy !== undefined ? { reviewedBy: input.reviewedBy } : {}),
        ...(input.reviewedAt !== undefined ? { reviewedAt: input.reviewedAt } : {}),
        updatedAt,
      })
      .where(eq(products.id, productId))
      .returning();

    return row ?? null;
  }

  /** Lists Product variants in stable creation order, optionally restricted to one persisted status. */
  async listVariantsByProductId(
    productId: string,
    status?: ProductVariantRow["status"],
  ): Promise<ProductVariantRow[]> {
    return this.executor
      .select()
      .from(productVariants)
      .where(
        combineConditions([
          eq(productVariants.productId, productId),
          status ? eq(productVariants.status, status) : undefined,
        ]),
      )
      .orderBy(asc(productVariants.createdAt), asc(productVariants.id));
  }

  /** Reads the seller/store ownership for one Product variant for downstream service authorization. */
  async findVariantSellerStoreScope(
    variantId: string,
  ): Promise<{ variantId: string; productId: string; sellerId: string; storeId: string } | null> {
    const [row] = await this.executor
      .select({
        variantId: productVariants.id,
        productId: products.id,
        sellerId: products.sellerId,
        storeId: products.storeId,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one variant only when it belongs to the expected Product. */
  async findVariantByIdInProduct(
    productId: string,
    variantId: string,
  ): Promise<ProductVariantRow | null> {
    const [row] = await this.executor
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.productId, productId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Locks one Product variant before a price or lifecycle-sensitive service update. */
  async findVariantByIdInProductForUpdate(
    productId: string,
    variantId: string,
  ): Promise<ProductVariantRow | null> {
    const [row] = await this.executor
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.productId, productId),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Finds a duplicate SKU inside the same seller/store commerce scope, excluding one edited variant when supplied. */
  async findVariantIdBySkuInSellerStore(
    sellerId: string,
    storeId: string,
    sku: string,
    excludeVariantId?: string,
  ): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        combineConditions([
          eq(products.sellerId, sellerId),
          eq(products.storeId, storeId),
          eq(productVariants.sku, sku),
          excludeVariantId ? ne(productVariants.id, excludeVariantId) : undefined,
        ]),
      )
      .limit(1);

    return row?.id ?? null;
  }

  /** Creates one Product variant after service validation has completed. */
  async createVariant(
    input: CreateProductVariantRecordInput,
  ): Promise<ProductVariantRow> {
    const values: NewProductVariantRow = {
      productId: input.productId,
      sku: input.sku,
      title: input.title,
      price: input.price,
      compareAtPrice: input.compareAtPrice,
      currency: input.currency,
      status: input.status,
      weight: input.weight,
    };

    const [row] = await this.executor
      .insert(productVariants)
      .values(values)
      .returning();

    if (!row) throw new Error("Product variant insert completed without returning a row.");
    return row;
  }

  /** Updates only service-approved fields on one exact Product variant. */
  async updateVariant(
    productId: string,
    variantId: string,
    input: UpdateProductVariantRecordInput,
    updatedAt: Date = new Date(),
  ): Promise<ProductVariantRow | null> {
    const [row] = await this.executor
      .update(productVariants)
      .set({ ...input, updatedAt })
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.productId, productId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Lists all persisted product/variant attribute values for one Product in deterministic order. */
  async listAttributeValuesByProductId(
    productId: string,
  ): Promise<ProductAttributeValueRow[]> {
    return this.executor
      .select()
      .from(productAttributeValues)
      .where(eq(productAttributeValues.productId, productId))
      .orderBy(
        asc(productAttributeValues.variantId),
        asc(productAttributeValues.attributeId),
        asc(productAttributeValues.id),
      );
  }

  /** Replaces all product-level attribute values; the service must call this on a transaction-bound repository. */
  async replaceProductAttributeValues(
    productId: string,
    values: ProductAttributeRecordInput[],
  ): Promise<ProductAttributeValueRow[]> {
    await this.executor
      .delete(productAttributeValues)
      .where(
        and(
          eq(productAttributeValues.productId, productId),
          isNull(productAttributeValues.variantId),
        ),
      );

    if (values.length === 0) return [];

    const records: NewProductAttributeValueRow[] = values.map((value) => ({
      productId,
      variantId: null,
      attributeId: value.attributeId,
      valueText: value.valueText ?? null,
      valueNumber: value.valueNumber ?? null,
      valueId: value.valueId ?? null,
    }));

    return this.executor.insert(productAttributeValues).values(records).returning();
  }

  /** Replaces all attribute values for one exact variant; the service must call this inside its transaction. */
  async replaceVariantAttributeValues(
    productId: string,
    variantId: string,
    values: ProductAttributeRecordInput[],
  ): Promise<ProductAttributeValueRow[]> {
    await this.executor
      .delete(productAttributeValues)
      .where(
        and(
          eq(productAttributeValues.productId, productId),
          eq(productAttributeValues.variantId, variantId),
        ),
      );

    if (values.length === 0) return [];

    const records: NewProductAttributeValueRow[] = values.map((value) => ({
      productId,
      variantId,
      attributeId: value.attributeId,
      valueText: value.valueText ?? null,
      valueNumber: value.valueNumber ?? null,
      valueId: value.valueId ?? null,
    }));

    return this.executor.insert(productAttributeValues).values(records).returning();
  }

  /** Lists Product media metadata in stable display order, optionally restricted to one persisted status. */
  async listMediaByProductId(
    productId: string,
    status?: ProductMediaRow["status"],
  ): Promise<ProductMediaRow[]> {
    return this.executor
      .select()
      .from(productMedia)
      .where(
        and(
          eq(productMedia.productId, productId),
          status ? eq(productMedia.status, status) : undefined,
        ),
      )
      .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt), asc(productMedia.id));
  }

  /** Links one already-authorized Module 21 file as Product media metadata. */
  async createMedia(input: CreateProductMediaRecordInput): Promise<ProductMediaRow> {
    const values: NewProductMediaRow = {
      productId: input.productId,
      variantId: input.variantId ?? null,
      fileId: input.fileId,
      mediaType: input.mediaType,
      altText: input.altText ?? null,
      sortOrder: input.sortOrder,
    };

    const [row] = await this.executor.insert(productMedia).values(values).returning();
    if (!row) throw new Error("Product media insert completed without returning a row.");
    return row;
  }

  /** Appends one immutable variant price-history row; this repository never updates or deletes history. */
  async createPriceHistory(
    input: CreateProductPriceHistoryRecordInput,
  ): Promise<ProductPriceHistoryRow> {
    const values: NewProductPriceHistoryRow = {
      variantId: input.variantId,
      oldPrice: input.oldPrice,
      newPrice: input.newPrice,
      changedBy: input.changedBy,
      changedAt: input.changedAt,
    };

    const [row] = await this.executor
      .insert(productPriceHistory)
      .values(values)
      .returning();

    if (!row) throw new Error("Product price-history insert completed without returning a row.");
    return row;
  }

  /** Lists immutable price history for every variant belonging to one Product. */
  async listPriceHistoryByProductId(
    productId: string,
  ): Promise<ProductPriceHistoryRow[]> {
    const rows = await this.executor
      .select({ history: productPriceHistory })
      .from(productPriceHistory)
      .innerJoin(productVariants, eq(productVariants.id, productPriceHistory.variantId))
      .where(eq(productVariants.productId, productId))
      .orderBy(desc(productPriceHistory.changedAt), asc(productPriceHistory.id));

    return rows.map((row) => row.history);
  }
}
