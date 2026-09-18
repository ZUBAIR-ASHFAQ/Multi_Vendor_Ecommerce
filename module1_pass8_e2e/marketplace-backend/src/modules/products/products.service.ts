import type {
  ProductAttributeValueRow,
  ProductMediaRow,
  ProductPriceHistoryRow,
  ProductRow,
  ProductVariantRow,
} from "../../database/schema/products.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import type { PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { AdministrationService } from "../administration/administration.service.js";
import {
  CatalogTaxonomyService,
  type ProductTaxonomyAttributeValueInput,
  type ProductTaxonomyValuesValidationInput,
} from "../catalog-taxonomy/catalog-taxonomy.service.js";
import { DOCUMENT_PURPOSE } from "../documents-audit/documents-audit.constants.js";
import type { DocumentFileResponse } from "../documents-audit/documents-audit.schema.js";
import { SellersService } from "../sellers/sellers.service.js";
import {
  PRODUCT_AUDIT_ACTION,
  PRODUCT_ERROR_CODE,
  PRODUCT_OUTBOX_EVENT,
  PRODUCT_PERMISSION,
  PRODUCT_PUBLICATION_STATUS,
  PRODUCT_RESOURCE_TYPE,
  PRODUCT_STATUS,
} from "./products.constants.js";
import {
  ProductsRepository,
  type ProductAttributeRecordInput,
  type ProductSellerScope,
} from "./products.repository.js";
import type {
  CreateProductInput,
  CreateProductVariantInput,
  LinkProductMediaInput,
  ProductDetailResponse,
  ProductMediaResponse,
  ProductPriceHistoryResponse,
  ProductResponse,
  ProductVariantResponse,
  PublicProductDetailResponse,
  PublicProductListQuery,
  PublicProductResponse,
  SellerProductListQuery,
  UpdateProductInput,
  UpdateProductVariantInput,
} from "./products.schema.js";

/** Runs one Module 6 transaction and allows focused service tests to replace the real database boundary. */
export type ProductsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Small seller/store boundary consumed by Product Management without importing seller persistence. */
export interface ProductSellerIntegration {
  /** Resolves one active store and its seller for a seller-scoped Product command. */
  resolveActiveStoreForSellerCommand(
    context: RequestContext,
    storeId: string,
    permission: PermissionCode,
  ): Promise<{ sellerId: string; storeId: string }>;

  /** Verifies an existing Product still belongs to an active approved commerce source. */
  assertStoreCommerceEligible(storeId: string, sellerId: string): Promise<void>;
}

/** Small platform-setting boundary used to keep Product currency validation out of repositories. */
export interface ProductCurrencyIntegration {
  /** Returns true only when the normalized currency remains enabled by Administration. */
  isSupportedCurrency(currency: string): Promise<boolean>;
}

/** Small file boundary used to validate and inspect confirmed Product media without direct file-table access. */
export interface ProductDocumentIntegration {
  /** Returns safe metadata for one readable confirmed file with the exact requested purpose. */
  getUsableFileForPurpose(
    context: RequestContext,
    fileId: string,
    purpose: typeof DOCUMENT_PURPOSE.PRODUCT_MEDIA,
  ): Promise<DocumentFileResponse>;
}

/** Explicit service dependencies keep Module 6 business logic readable and easy to unit test. */
export interface ProductsServiceDependencies {
  repository?: ProductsRepository;
  transactionRunner?: ProductsTransactionRunner;
  taxonomy?: CatalogTaxonomyService;
  sellers?: ProductSellerIntegration;
  currencies?: ProductCurrencyIntegration;
  documents?: ProductDocumentIntegration | null;
  moderationRequired?: boolean;
}

/** Paginated public Product list returned before the HTTP envelope is applied. */
export interface PaginatedPublicProductsResult {
  items: PublicProductResponse[];
  meta: PaginationMeta;
}

/** Paginated seller Product list returned before the HTTP envelope is applied. */
export interface PaginatedSellerProductsResult {
  items: ProductResponse[];
  meta: PaginationMeta;
}

/** Current public Product/variant facts Checkout may trust when rebuilding a Cart line. */
export interface CheckoutProductVariant {
  productId: string;
  variantId: string;
  sellerId: string;
  storeId: string;
  categoryId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  variantTitleSnapshot: string | null;
  unitPrice: string;
  currency: string;
}

/** Creates one stable Module 6 business error. */
function productError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Reads a PostgreSQL constraint name through nested database-driver causes. */
function databaseConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { constraint?: unknown; cause?: unknown };
  if (typeof candidate.constraint === "string") return candidate.constraint;
  return databaseConstraint(candidate.cause);
}

/** Normalizes a decimal string so numerically equal prices do not create false history rows. */
function normalizeDecimal(value: string): string {
  const [rawInteger = "0", rawFraction = ""] = value.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

/** Returns true when two non-negative Product prices represent the same exact decimal value. */
function sameDecimal(left: string, right: string): boolean {
  return normalizeDecimal(left) === normalizeDecimal(right);
}

/** Converts one persisted attribute row into the cross-module taxonomy validation shape. */
function toTaxonomyAttributeValue(
  value: ProductAttributeValueRow,
): ProductTaxonomyAttributeValueInput {
  return {
    attributeId: value.attributeId,
    valueText: value.valueText,
    valueNumber: value.valueNumber,
    valueId: value.valueId,
  };
}

/** Module 6 business service for seller-safe Product reads/writes, publication, audit, and durable events. */
export class ProductsService {
  private readonly repository: ProductsRepository;
  private readonly transactionRunner: ProductsTransactionRunner;
  private readonly taxonomy: CatalogTaxonomyService;
  private readonly sellers: ProductSellerIntegration;
  private readonly currencies: ProductCurrencyIntegration;
  private readonly documents: ProductDocumentIntegration | null;
  private readonly moderationRequired: boolean;

  /** Stores explicit dependencies without introducing a container or hidden framework abstraction. */
  constructor(dependencies: ProductsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new ProductsRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.taxonomy = dependencies.taxonomy ?? new CatalogTaxonomyService();
    this.sellers = dependencies.sellers ?? new SellersService();
    this.currencies = dependencies.currencies ?? new AdministrationService();
    this.documents = dependencies.documents ?? null;
    this.moderationRequired = dependencies.moderationRequired ?? false;
  }

  /** Lists only public-safe published Products with standard pagination metadata. */
  async listPublicProducts(query: PublicProductListQuery): Promise<PaginatedPublicProductsResult> {
    const result = await this.repository.listPublicProducts(query);
    return {
      items: result.items.map((product) => this.toPublicProductResponse(product)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Returns one public Product detail with only active variants/media and no seller-private history. */
  async getPublicProduct(slug: string): Promise<PublicProductDetailResponse> {
    const product = await this.repository.findPublicProductBySlug(slug);
    if (!product) throw this.productNotFound();
    return this.loadPublicProductDetail(product);
  }

  /** Finds one currently public Product by ID for trusted downstream read-model synchronization. */
  async findPublicProductById(productId: string): Promise<PublicProductDetailResponse | null> {
    const product = await this.repository.findPublicProductById(productId);
    return product ? this.loadPublicProductDetail(product) : null;
  }

  /** Resolves a variant to its owning Product ID without exposing seller-private Product fields. */
  async findProductIdByVariantId(variantId: string): Promise<string | null> {
    const scope = await this.repository.findVariantSellerStoreScope(variantId);
    return scope?.productId ?? null;
  }

  /** Resolves Product seller/store/category classification for historical Commission rule selection. */
  async resolveProductCommissionScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string; categoryId: string } | null> {
    return this.repository.findProductPromotionScope(productId);
  }

  /** Resolves an existing Product to seller/store/category scope for trusted Promotion configuration. */
  async resolveProductPromotionScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string; categoryId: string } | null> {
    const scope = await this.repository.findProductPromotionScope(productId);
    if (!scope) return null;

    await this.sellers.assertStoreCommerceEligible(scope.storeId, scope.sellerId);
    return scope;
  }

  /** Resolves a public Product to the internal seller/store/category scope needed by Promotion eligibility. */
  async resolvePublicProductPromotionScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string; categoryId: string } | null> {
    const product = await this.repository.findPublicProductById(productId);
    if (!product) return null;

    await this.sellers.assertStoreCommerceEligible(product.storeId, product.sellerId);
    return {
      productId: product.id,
      sellerId: product.sellerId,
      storeId: product.storeId,
      categoryId: product.categoryId,
    };
  }

  /** Resolves a public Product to the seller/store scope required for Checkout shipping grouping. */
  async resolvePublicProductSellerStoreScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string } | null> {
    const product = await this.repository.findPublicProductById(productId);
    if (!product) return null;

    await this.sellers.assertStoreCommerceEligible(product.storeId, product.sellerId);
    return {
      productId: product.id,
      sellerId: product.sellerId,
      storeId: product.storeId,
    };
  }

  /** Resolves one currently sellable public variant and its authoritative Checkout price/ownership facts. */
  async resolveVariantForCheckout(
    variantId: string,
  ): Promise<CheckoutProductVariant | null> {
    const scope = await this.repository.findVariantSellerStoreScope(variantId);
    if (!scope) return null;

    const product = await this.repository.findPublicProductById(scope.productId);
    if (!product) return null;

    const variant = await this.repository.findVariantByIdInProduct(product.id, variantId);
    if (!variant || variant.status !== PRODUCT_STATUS.ACTIVE) return null;

    return {
      productId: product.id,
      variantId: variant.id,
      sellerId: product.sellerId,
      storeId: product.storeId,
      categoryId: product.categoryId,
      skuSnapshot: variant.sku,
      nameSnapshot: product.name,
      variantTitleSnapshot: variant.title || null,
      unitPrice: variant.price,
      currency: variant.currency,
    };
  }

  /** Lists private Products only across seller scopes where the actor has seller.products.read. */
  async listSellerProducts(
    context: RequestContext,
    query: SellerProductListQuery,
  ): Promise<PaginatedSellerProductsResult> {
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_READ);
    this.assertRequestedStoreInScope(query.storeId, scope);
    const result = await this.repository.listSellerProducts(scope, query);

    return {
      items: result.items.map((product) => this.toProductResponse(product)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Returns one seller-private Product aggregate with variants, attributes, media, and immutable price history. */
  async getSellerProduct(
    context: RequestContext,
    productId: string,
  ): Promise<ProductDetailResponse> {
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_READ);
    const product = await this.repository.findProductByIdInSellerScope(productId, scope);
    if (!product) throw this.productNotFound();
    return this.loadSellerProductDetail(this.repository, product);
  }

  /** Creates one seller-owned draft Product with optional validated product-level attributes. */
  async createProduct(
    context: RequestContext,
    input: CreateProductInput,
  ): Promise<ProductDetailResponse> {
    const actorId = this.requireActorId(context);
    const store = await this.resolveSellerStore(
      context,
      input.storeId,
      PRODUCT_PERMISSION.SELLER_CREATE,
    );

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new ProductsRepository(tx);
        if (await repository.findProductIdBySlug(input.slug)) throw this.productSlugTaken();

        const created = await repository.createProduct({
          sellerId: store.sellerId,
          storeId: store.storeId,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          slug: input.slug,
          name: input.name,
          description: input.description,
          createdBy: actorId,
        });

        if (input.attributes !== undefined) {
          await repository.replaceProductAttributeValues(
            created.id,
            this.toAttributeRecords(input.attributes),
          );
        }

        await this.assertDraftTaxonomyValid(repository, created);
        const detail = await this.loadSellerProductDetail(repository, created);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PRODUCT_AUDIT_ACTION.CREATED,
          entityType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          entityId: created.id,
          sellerId: created.sellerId,
          requestId: context.requestId,
          after: detail,
        });
        await OutboxService.using(tx).enqueue({
          eventType: PRODUCT_OUTBOX_EVENT.CREATED,
          aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          aggregateId: created.id,
          payload: {
            productId: created.id,
            sellerId: created.sellerId,
            storeId: created.storeId,
            publicationStatus: created.publicationStatus,
          },
        });

        return detail;
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if (code === "23505") throw this.productSlugTaken();
      if (code === "23503") throw this.invalidProductAttribute();
      throw error;
    }
  }

  /** Updates seller-owned Product fields atomically and keeps a published listing valid after the edit. */
  async updateProduct(
    context: RequestContext,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_UPDATE);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new ProductsRepository(tx);
        const existing = await repository.findProductByIdInSellerScopeForUpdate(
          productId,
          scope,
        );
        if (!existing) throw this.productNotFound();

        if (input.slug !== undefined && input.slug !== existing.slug) {
          if (await repository.findProductIdBySlug(input.slug, productId)) {
            throw this.productSlugTaken();
          }
        }

        const updated = await repository.updateProductInSellerScope(productId, scope, {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        });
        if (!updated) throw this.productNotFound();

        if (input.attributes !== undefined) {
          await repository.replaceProductAttributeValues(
            productId,
            this.toAttributeRecords(input.attributes),
          );
        }

        await this.assertDraftTaxonomyValid(repository, updated);
        if (updated.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED) {
          await this.assertProductPublishable(repository, updated);
        }

        const detail = await this.loadSellerProductDetail(repository, updated);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PRODUCT_AUDIT_ACTION.UPDATED,
          entityType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          entityId: productId,
          sellerId: updated.sellerId,
          requestId: context.requestId,
          before: this.toProductResponse(existing),
          after: detail,
        });
        await OutboxService.using(tx).enqueue({
          eventType: PRODUCT_OUTBOX_EVENT.UPDATED,
          aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          aggregateId: productId,
          payload: {
            productId,
            sellerId: updated.sellerId,
            storeId: updated.storeId,
            changeType: "product_fields",
          },
        });

        return detail;
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if (code === "23505" && databaseConstraint(error) === "products_slug_uq") {
        throw this.productSlugTaken();
      }
      if (code === "23503") throw this.invalidProductAttribute();
      throw error;
    }
  }

  /** Adds one seller-owned SKU and validates currency/taxonomy before committing the Product update. */
  async addVariant(
    context: RequestContext,
    productId: string,
    input: CreateProductVariantInput,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_UPDATE);
    await this.assertCurrencySupported(input.currency);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new ProductsRepository(tx);
        const product = await repository.findProductByIdInSellerScopeForUpdate(productId, scope);
        if (!product) throw this.productNotFound();

        if (
          await repository.findVariantIdBySkuInSellerStore(
            product.sellerId,
            product.storeId,
            input.sku,
          )
        ) {
          throw this.duplicateSku();
        }

        const variant = await repository.createVariant({
          productId,
          sku: input.sku,
          title: input.title,
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          currency: input.currency,
          ...(input.status !== undefined ? { status: input.status } : {}),
          weight: input.weight ?? null,
        });
        if (input.attributes !== undefined) {
          await repository.replaceVariantAttributeValues(
            productId,
            variant.id,
            this.toAttributeRecords(input.attributes),
          );
        }

        await this.assertDraftTaxonomyValid(repository, product);
        if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED) {
          await this.assertProductPublishable(repository, product);
        }

        const detail = await this.loadSellerProductDetail(repository, product);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PRODUCT_AUDIT_ACTION.VARIANT_CREATED,
          entityType: PRODUCT_RESOURCE_TYPE.VARIANT,
          entityId: variant.id,
          sellerId: product.sellerId,
          requestId: context.requestId,
          after: this.toVariantResponse(variant),
          metadata: { productId },
        });
        await OutboxService.using(tx).enqueue({
          eventType: PRODUCT_OUTBOX_EVENT.UPDATED,
          aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          aggregateId: productId,
          payload: {
            productId,
            variantId: variant.id,
            sellerId: product.sellerId,
            changeType: "variant_created",
          },
        });

        return detail;
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if (code === "23505") throw this.duplicateSku();
      if (code === "23503") throw this.invalidProductAttribute();
      throw error;
    }
  }

  /** Updates one exact seller-owned variant and appends immutable price history only for a real price change. */
  async updateVariant(
    context: RequestContext,
    productId: string,
    variantId: string,
    input: UpdateProductVariantInput,
  ): Promise<ProductDetailResponse> {
    const actorId = this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_UPDATE);
    if (input.currency !== undefined) await this.assertCurrencySupported(input.currency);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new ProductsRepository(tx);
        const product = await repository.findProductByIdInSellerScopeForUpdate(productId, scope);
        if (!product) throw this.productNotFound();
        const existing = await repository.findVariantByIdInProductForUpdate(productId, variantId);
        if (!existing) throw this.productNotFound();

        if (input.sku !== undefined && input.sku !== existing.sku) {
          if (
            await repository.findVariantIdBySkuInSellerStore(
              product.sellerId,
              product.storeId,
              input.sku,
              variantId,
            )
          ) {
            throw this.duplicateSku();
          }
        }

        const updated = await repository.updateVariant(productId, variantId, {
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.compareAtPrice !== undefined
            ? { compareAtPrice: input.compareAtPrice }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.weight !== undefined ? { weight: input.weight } : {}),
        });
        if (!updated) throw this.productNotFound();

        if (input.attributes !== undefined) {
          await repository.replaceVariantAttributeValues(
            productId,
            variantId,
            this.toAttributeRecords(input.attributes),
          );
        }

        const nextPrice = input.price;
        const priceChanged =
          nextPrice !== undefined && !sameDecimal(existing.price, nextPrice);
        if (priceChanged && nextPrice !== undefined) {
          await repository.createPriceHistory({
            variantId,
            oldPrice: existing.price,
            newPrice: nextPrice,
            changedBy: actorId,
          });
        }

        await this.assertDraftTaxonomyValid(repository, product);
        if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED) {
          await this.assertProductPublishable(repository, product);
        }

        const detail = await this.loadSellerProductDetail(repository, product);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PRODUCT_AUDIT_ACTION.VARIANT_UPDATED,
          entityType: PRODUCT_RESOURCE_TYPE.VARIANT,
          entityId: variantId,
          sellerId: product.sellerId,
          requestId: context.requestId,
          before: this.toVariantResponse(existing),
          after: this.toVariantResponse(updated),
          metadata: { productId },
        });
        await OutboxService.using(tx).enqueue({
          eventType: PRODUCT_OUTBOX_EVENT.UPDATED,
          aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
          aggregateId: productId,
          payload: {
            productId,
            variantId,
            sellerId: product.sellerId,
            changeType: "variant_updated",
          },
        });

        if (priceChanged) {
          await AuditService.using(tx).record({
            actorId: context.actorId,
            actorType: context.actorType,
            action: PRODUCT_AUDIT_ACTION.PRICE_CHANGED,
            entityType: PRODUCT_RESOURCE_TYPE.VARIANT,
            entityId: variantId,
            sellerId: product.sellerId,
            requestId: context.requestId,
            before: { price: existing.price },
            after: { price: updated.price },
            metadata: { productId },
          });
          await OutboxService.using(tx).enqueue({
            eventType: PRODUCT_OUTBOX_EVENT.PRICE_CHANGED,
            aggregateType: PRODUCT_RESOURCE_TYPE.VARIANT,
            aggregateId: variantId,
            payload: {
              productId,
              variantId,
              sellerId: product.sellerId,
              oldPrice: existing.price,
              newPrice: updated.price,
              currency: updated.currency,
            },
          });
        }

        return detail;
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if (code === "23505") throw this.duplicateSku();
      if (code === "23503") throw this.invalidProductAttribute();
      throw error;
    }
  }

  /** Links one confirmed Product-media file and derives its media type from trusted Module 21 MIME metadata. */
  async linkMedia(
    context: RequestContext,
    productId: string,
    input: LinkProductMediaInput,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_UPDATE);
    const documents = this.requireDocumentsIntegration();
    const file = await documents.getUsableFileForPurpose(
      context,
      input.fileId,
      DOCUMENT_PURPOSE.PRODUCT_MEDIA,
    );
    const mediaType = this.mediaTypeFromMime(file.mimeType);

    return this.transactionRunner(async (tx) => {
      const repository = new ProductsRepository(tx);
      const product = await repository.findProductByIdInSellerScopeForUpdate(productId, scope);
      if (!product) throw this.productNotFound();

      if (input.variantId) {
        const variant = await repository.findVariantByIdInProduct(productId, input.variantId);
        if (!variant) throw this.productNotFound();
      }

      const media = await repository.createMedia({
        productId,
        variantId: input.variantId ?? null,
        fileId: input.fileId,
        mediaType,
        altText: input.altText ?? null,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      const detail = await this.loadSellerProductDetail(repository, product);

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PRODUCT_AUDIT_ACTION.MEDIA_LINKED,
        entityType: PRODUCT_RESOURCE_TYPE.MEDIA,
        entityId: media.id,
        sellerId: product.sellerId,
        requestId: context.requestId,
        after: this.toMediaResponse(media),
        metadata: { productId },
      });
      await OutboxService.using(tx).enqueue({
        eventType: PRODUCT_OUTBOX_EVENT.MEDIA_CHANGED,
        aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        aggregateId: productId,
        payload: {
          productId,
          mediaId: media.id,
          fileId: media.fileId,
          sellerId: product.sellerId,
          changeType: "linked",
        },
      });

      return detail;
    });
  }

  /** Publishes a valid Product immediately or submits it for approval when moderation is configured. */
  async publishProduct(
    context: RequestContext,
    productId: string,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_PUBLISH);

    return this.transactionRunner(async (tx) => {
      const repository = new ProductsRepository(tx);
      const product = await repository.findProductByIdInSellerScopeForUpdate(productId, scope);
      if (!product) throw this.productNotFound();

      if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED) {
        return this.loadSellerProductDetail(repository, product);
      }
      if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL) {
        if (this.moderationRequired) return this.loadSellerProductDetail(repository, product);
        throw this.productNotPublishable("This Product is already waiting for approval.");
      }

      await this.assertProductPublishable(repository, product);
      const nextStatus = this.moderationRequired
        ? PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL
        : PRODUCT_PUBLICATION_STATUS.PUBLISHED;
      const updated = await repository.updateProductPublicationInSellerScope(
        productId,
        scope,
        {
          publicationStatus: nextStatus,
          publishedAt: nextStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED ? new Date() : null,
        },
      );
      if (!updated) throw this.productNotFound();

      const detail = await this.loadSellerProductDetail(repository, updated);
      const published = nextStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED;
      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: published ? PRODUCT_AUDIT_ACTION.PUBLISHED : PRODUCT_AUDIT_ACTION.UPDATED,
        entityType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        entityId: productId,
        sellerId: product.sellerId,
        requestId: context.requestId,
        before: this.toProductResponse(product),
        after: this.toProductResponse(updated),
        metadata: published ? undefined : { changeType: "submitted_for_approval" },
      });
      await OutboxService.using(tx).enqueue({
        eventType: published ? PRODUCT_OUTBOX_EVENT.PUBLISHED : PRODUCT_OUTBOX_EVENT.UPDATED,
        aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        aggregateId: productId,
        payload: {
          productId,
          sellerId: product.sellerId,
          storeId: product.storeId,
          publicationStatus: updated.publicationStatus,
          ...(published ? {} : { changeType: "submitted_for_approval" }),
        },
      });

      return detail;
    });
  }

  /** Moves a published or pending Product to unpublished without deleting its historical commerce references. */
  async unpublishProduct(
    context: RequestContext,
    productId: string,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    const scope = this.resolveSellerScope(context, PRODUCT_PERMISSION.SELLER_PUBLISH);

    return this.transactionRunner(async (tx) => {
      const repository = new ProductsRepository(tx);
      const product = await repository.findProductByIdInSellerScopeForUpdate(productId, scope);
      if (!product) throw this.productNotFound();
      if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.UNPUBLISHED) {
        return this.loadSellerProductDetail(repository, product);
      }
      if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.DRAFT) {
        throw this.productNotPublishable("A draft Product is already unavailable to public buyers.");
      }

      const updated = await repository.updateProductPublicationInSellerScope(
        productId,
        scope,
        {
          publicationStatus: PRODUCT_PUBLICATION_STATUS.UNPUBLISHED,
          publishedAt: null,
        },
      );
      if (!updated) throw this.productNotFound();
      const detail = await this.loadSellerProductDetail(repository, updated);

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PRODUCT_AUDIT_ACTION.UNPUBLISHED,
        entityType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        entityId: productId,
        sellerId: product.sellerId,
        requestId: context.requestId,
        before: this.toProductResponse(product),
        after: this.toProductResponse(updated),
      });
      await OutboxService.using(tx).enqueue({
        eventType: PRODUCT_OUTBOX_EVENT.UNPUBLISHED,
        aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        aggregateId: productId,
        payload: {
          productId,
          sellerId: product.sellerId,
          storeId: product.storeId,
        },
      });

      return detail;
    });
  }

  /** Approves one pending Product after re-checking the complete current seller/taxonomy/currency snapshot. */
  async approveProduct(
    context: RequestContext,
    productId: string,
  ): Promise<ProductDetailResponse> {
    this.requireActorId(context);
    this.assertPlatformPermission(context, PRODUCT_PERMISSION.ADMIN_REVIEW);

    return this.transactionRunner(async (tx) => {
      const repository = new ProductsRepository(tx);
      const product = await repository.findProductByIdForAdminUpdate(productId);
      if (!product) throw this.productNotFound();
      if (product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED) {
        return this.loadSellerProductDetail(repository, product);
      }
      if (product.publicationStatus !== PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL) {
        throw this.productNotPublishable("Only a Product waiting for approval can be approved.");
      }

      await this.assertProductPublishable(repository, product);
      const updated = await repository.updateProductPublicationForAdmin(productId, {
        publicationStatus: PRODUCT_PUBLICATION_STATUS.PUBLISHED,
        publishedAt: new Date(),
      });
      if (!updated) throw this.productNotFound();
      const detail = await this.loadSellerProductDetail(repository, updated);

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PRODUCT_AUDIT_ACTION.APPROVED,
        entityType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        entityId: productId,
        sellerId: product.sellerId,
        requestId: context.requestId,
        before: this.toProductResponse(product),
        after: this.toProductResponse(updated),
      });
      await OutboxService.using(tx).enqueue({
        eventType: PRODUCT_OUTBOX_EVENT.PUBLISHED,
        aggregateType: PRODUCT_RESOURCE_TYPE.PRODUCT,
        aggregateId: productId,
        payload: {
          productId,
          sellerId: product.sellerId,
          storeId: product.storeId,
          approvedBy: context.actorId,
        },
      });

      return detail;
    });
  }

  /** Resolves one Product variant to a seller/store only when the actor has the requested seller-scoped permission. */
  async resolveVariantSellerStoreForCommand(
    context: RequestContext,
    variantId: string,
    permission: PermissionCode,
  ): Promise<{ variantId: string; productId: string; sellerId: string; storeId: string }> {
    const scope = await this.repository.findVariantSellerStoreScope(variantId);
    if (!scope) throw this.productNotFound();

    const sellerPermissions = context.sellerPermissions.get(scope.sellerId);
    const allowed =
      context.sellerIds.has(scope.sellerId) &&
      context.storeIds.has(scope.storeId) &&
      sellerPermissions?.has(permission) === true;

    if (!allowed) throw this.productScopeForbidden();
    return scope;
  }

  /** Resolves the seller IDs where one seller-scoped Product permission is actually effective. */
  private resolveSellerScope(
    context: RequestContext,
    permission: PermissionCode,
  ): ProductSellerScope {
    const sellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId) && permissions.has(permission),
      )
      .map(([sellerId]) => sellerId);
    const storeIds = [...context.storeIds];

    if (sellerIds.length === 0 || storeIds.length === 0) {
      throw this.productScopeForbidden();
    }
    return { sellerIds, storeIds };
  }

  /** Rejects an explicit seller-list store filter that is outside the server-derived active store scope. */
  private assertRequestedStoreInScope(
    storeId: string | undefined,
    scope: ProductSellerScope,
  ): void {
    if (storeId && !scope.storeIds.includes(storeId)) throw this.productScopeForbidden();
  }

  /** Resolves one active seller/store pair and translates upstream scope failures to the Module 6 boundary. */
  private async resolveSellerStore(
    context: RequestContext,
    storeId: string,
    permission: PermissionCode,
  ): Promise<{ sellerId: string; storeId: string }> {
    try {
      return await this.sellers.resolveActiveStoreForSellerCommand(
        context,
        storeId,
        permission,
      );
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 403) {
        throw this.productScopeForbidden();
      }
      throw error;
    }
  }

  /** Requires an authenticated actor identifier for every Product write/audit operation. */
  private requireActorId(context: RequestContext): string {
    if (!context.actorId) {
      throw productError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
    return context.actorId;
  }

  /** Enforces a platform-level Product permission for privileged administration commands. */
  private assertPlatformPermission(context: RequestContext, permission: PermissionCode): void {
    if (!context.permissions.has(permission)) {
      throw productError(
        PRODUCT_ERROR_CODE.PRODUCT_SCOPE_FORBIDDEN,
        "You do not have permission to manage this Product.",
        403,
      );
    }
  }

  /** Converts request attribute values into the persistence-only repository input shape. */
  private toAttributeRecords(
    values: Array<{
      attributeId: string;
      valueText?: string | undefined;
      valueNumber?: string | undefined;
      valueId?: string | undefined;
    }>,
  ): ProductAttributeRecordInput[] {
    return values.map((value) => ({
      attributeId: value.attributeId,
      valueText: value.valueText ?? null,
      valueNumber: value.valueNumber ?? null,
      valueId: value.valueId ?? null,
    }));
  }

  /** Validates all currently persisted Product/variant taxonomy values while drafts may remain incomplete. */
  private async assertDraftTaxonomyValid(
    repository: ProductsRepository,
    product: ProductRow,
  ): Promise<void> {
    const snapshot = await this.buildTaxonomySnapshot(repository, product, false);
    try {
      await this.taxonomy.assertProductTaxonomyValuesAreValid(snapshot);
    } catch (error) {
      if (error instanceof AppError) throw this.invalidProductAttribute();
      throw error;
    }
  }

  /** Re-checks every rule required before a Product can be public or approved. */
  private async assertProductPublishable(
    repository: ProductsRepository,
    product: ProductRow,
  ): Promise<void> {
    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      throw this.productNotPublishable("The Product is inactive.");
    }

    try {
      await this.sellers.assertStoreCommerceEligible(product.storeId, product.sellerId);
    } catch (error) {
      if (error instanceof AppError) {
        throw this.productNotPublishable("The seller/store is not active for publication.");
      }
      throw error;
    }

    const variants = await repository.listVariantsByProductId(
      product.id,
      PRODUCT_STATUS.ACTIVE,
    );
    if (variants.length === 0) {
      throw this.productNotPublishable("At least one active Product variant is required.");
    }

    for (const currency of new Set(variants.map((variant) => variant.currency))) {
      await this.assertCurrencySupported(currency);
    }

    const snapshot = await this.buildTaxonomySnapshot(repository, product, true);
    try {
      await this.taxonomy.assertProductTaxonomyPublicationIsValid(snapshot);
    } catch (error) {
      if (error instanceof AppError) {
        throw this.productNotPublishable("The Product taxonomy is incomplete or no longer active.");
      }
      throw error;
    }
  }

  /** Builds the exact Product/variant taxonomy snapshot consumed by Module 5 validation services. */
  private async buildTaxonomySnapshot(
    repository: ProductsRepository,
    product: ProductRow,
    activeVariantsOnly: boolean,
  ): Promise<ProductTaxonomyValuesValidationInput> {
    const variants = await repository.listVariantsByProductId(
      product.id,
      activeVariantsOnly ? PRODUCT_STATUS.ACTIVE : undefined,
    );
    const values = await repository.listAttributeValuesByProductId(product.id);
    const productAttributes = values
      .filter((value) => value.variantId === null)
      .map((value) => toTaxonomyAttributeValue(value));

    return {
      categoryId: product.categoryId,
      brandId: product.brandId,
      productAttributes,
      variants: variants.map((variant) => ({
        variantId: variant.id,
        attributes: values
          .filter((value) => value.variantId === variant.id)
          .map((value) => toTaxonomyAttributeValue(value)),
      })),
    };
  }

  /** Checks one normalized Product currency against the current Administration allow-list. */
  private async assertCurrencySupported(currency: string): Promise<void> {
    if (!(await this.currencies.isSupportedCurrency(currency))) {
      throw productError(
        PRODUCT_ERROR_CODE.PRODUCT_CURRENCY_UNSUPPORTED,
        "The Product currency is not supported by the marketplace.",
        409,
      );
    }
  }

  /** Returns the configured Module 21 file boundary or fails clearly during incomplete application composition. */
  private requireDocumentsIntegration(): ProductDocumentIntegration {
    if (!this.documents) {
      throw new Error("Product media validation is not configured.");
    }
    return this.documents;
  }

  /** Derives the Product media category from trusted confirmed MIME metadata. */
  private mediaTypeFromMime(mimeType: string): string {
    const normalized = mimeType.trim().toLowerCase();
    if (normalized.startsWith("image/")) return "image";
    if (normalized.startsWith("video/")) return "video";
    throw productError(
      ERROR_CODE.INVALID_REQUEST,
      "Only image or video files can be linked as Product media.",
      422,
    );
  }

  /** Loads the public Product aggregate used by storefront reads and trusted Search synchronization. */
  private async loadPublicProductDetail(product: ProductRow): Promise<PublicProductDetailResponse> {
    const [variants, media, attributes] = await Promise.all([
      this.repository.listVariantsByProductId(product.id, PRODUCT_STATUS.ACTIVE),
      this.repository.listMediaByProductId(product.id, PRODUCT_STATUS.ACTIVE),
      this.repository.listAttributeValuesByProductId(product.id),
    ]);
    const activeVariantIds = new Set(variants.map((variant) => variant.id));
    const publicAttributes = attributes.filter(
      (value) => value.variantId === null || activeVariantIds.has(value.variantId),
    );

    return this.toPublicProductDetail(product, variants, publicAttributes, media);
  }

  /** Loads one complete seller-safe Product aggregate using the supplied repository/transaction. */
  private async loadSellerProductDetail(
    repository: ProductsRepository,
    product: ProductRow,
  ): Promise<ProductDetailResponse> {
    const [variants, attributes, media, priceHistory] = await Promise.all([
      repository.listVariantsByProductId(product.id),
      repository.listAttributeValuesByProductId(product.id),
      repository.listMediaByProductId(product.id),
      repository.listPriceHistoryByProductId(product.id),
    ]);

    return {
      ...this.toProductResponse(product),
      variants: variants.map((variant) => this.toVariantResponse(variant)),
      attributes: attributes.map((value) => ({
        id: value.id,
        productId: value.productId,
        variantId: value.variantId,
        attributeId: value.attributeId,
        valueText: value.valueText,
        valueNumber: value.valueNumber,
        valueId: value.valueId,
      })),
      media: media.map((item) => this.toMediaResponse(item)),
      priceHistory: priceHistory.map((history) => this.toPriceHistoryResponse(history)),
    };
  }

  /** Maps one persisted Product to the seller/admin-safe response contract. */
  private toProductResponse(product: ProductRow): ProductResponse {
    return {
      id: product.id,
      sellerId: product.sellerId,
      storeId: product.storeId,
      categoryId: product.categoryId,
      brandId: product.brandId,
      slug: product.slug,
      name: product.name,
      description: product.description,
      status: product.status as ProductResponse["status"],
      publicationStatus: product.publicationStatus as ProductResponse["publicationStatus"],
      publishedAt: product.publishedAt?.toISOString() ?? null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /** Maps one persisted published Product to the intentionally smaller public response contract. */
  private toPublicProductResponse(product: ProductRow): PublicProductResponse {
    const safe = this.toProductResponse(product);
    return {
      id: safe.id,
      storeId: safe.storeId,
      categoryId: safe.categoryId,
      brandId: safe.brandId,
      slug: safe.slug,
      name: safe.name,
      description: safe.description,
      publishedAt: safe.publishedAt,
      createdAt: safe.createdAt,
      updatedAt: safe.updatedAt,
    };
  }

  /** Maps one persisted variant to its seller/admin-safe API representation. */
  private toVariantResponse(variant: ProductVariantRow): ProductVariantResponse {
    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      title: variant.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      currency: variant.currency,
      status: variant.status as ProductVariantResponse["status"],
      weight: variant.weight,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    };
  }

  /** Maps one persisted media row to its seller/admin-safe API representation. */
  private toMediaResponse(media: ProductMediaRow): ProductMediaResponse {
    return {
      id: media.id,
      productId: media.productId,
      variantId: media.variantId,
      fileId: media.fileId,
      mediaType: media.mediaType,
      altText: media.altText,
      sortOrder: media.sortOrder,
      status: media.status as ProductMediaResponse["status"],
      createdAt: media.createdAt.toISOString(),
    };
  }

  /** Maps one immutable price-history row to the seller-safe response contract. */
  private toPriceHistoryResponse(
    history: ProductPriceHistoryRow,
  ): ProductPriceHistoryResponse {
    return {
      id: history.id,
      variantId: history.variantId,
      oldPrice: history.oldPrice,
      newPrice: history.newPrice,
      changedBy: history.changedBy,
      changedAt: history.changedAt.toISOString(),
    };
  }

  /** Builds one public detail response without internal status fields or price-history metadata. */
  private toPublicProductDetail(
    product: ProductRow,
    variants: ProductVariantRow[],
    attributes: ProductAttributeValueRow[],
    media: ProductMediaRow[],
  ): PublicProductDetailResponse {
    return {
      ...this.toPublicProductResponse(product),
      variants: variants.map((variant) => {
        const safe = this.toVariantResponse(variant);
        return {
          id: safe.id,
          productId: safe.productId,
          sku: safe.sku,
          title: safe.title,
          price: safe.price,
          compareAtPrice: safe.compareAtPrice,
          currency: safe.currency,
          weight: safe.weight,
          createdAt: safe.createdAt,
          updatedAt: safe.updatedAt,
        };
      }),
      attributes: attributes.map((value) => ({
        id: value.id,
        productId: value.productId,
        variantId: value.variantId,
        attributeId: value.attributeId,
        valueText: value.valueText,
        valueNumber: value.valueNumber,
        valueId: value.valueId,
      })),
      media: media.map((item) => {
        const safe = this.toMediaResponse(item);
        return {
          id: safe.id,
          productId: safe.productId,
          variantId: safe.variantId,
          fileId: safe.fileId,
          mediaType: safe.mediaType,
          altText: safe.altText,
          sortOrder: safe.sortOrder,
          createdAt: safe.createdAt,
        };
      }),
    };
  }

  /** Creates the stable private-not-found error used to avoid seller resource probing. */
  private productNotFound(): AppError {
    return productError(PRODUCT_ERROR_CODE.PRODUCT_NOT_FOUND, "Product not found.", 404);
  }

  /** Creates the stable seller-scope error used by private Product operations. */
  private productScopeForbidden(): AppError {
    return productError(
      PRODUCT_ERROR_CODE.PRODUCT_SCOPE_FORBIDDEN,
      "The Product is outside your seller/store scope.",
      403,
    );
  }

  /** Creates the stable global Product slug conflict error. */
  private productSlugTaken(): AppError {
    return productError(
      PRODUCT_ERROR_CODE.PRODUCT_SLUG_TAKEN,
      "This Product slug is already in use.",
      409,
    );
  }

  /** Creates the stable seller/store SKU conflict error. */
  private duplicateSku(): AppError {
    return productError(
      PRODUCT_ERROR_CODE.DUPLICATE_SKU,
      "This SKU already exists in the seller/store scope.",
      409,
    );
  }

  /** Creates the stable Product publication-rule error with one safe caller-facing reason. */
  private productNotPublishable(message: string): AppError {
    return productError(PRODUCT_ERROR_CODE.PRODUCT_NOT_PUBLISHABLE, message, 409);
  }

  /** Creates the stable taxonomy compatibility error without exposing internal taxonomy rows. */
  private invalidProductAttribute(): AppError {
    return productError(
      PRODUCT_ERROR_CODE.INVALID_PRODUCT_ATTRIBUTE,
      "One or more Product attributes are invalid for the selected category.",
      409,
    );
  }
}
