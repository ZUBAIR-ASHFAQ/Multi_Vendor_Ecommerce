import type { PaginationMeta } from "@/types/api";

export type ProductStatus = "active" | "inactive";
export type ProductPublicationStatus =
  | "draft"
  | "pending_approval"
  | "published"
  | "rejected"
  | "unpublished";
export type ProductVariantStatus = "active" | "inactive";
export type ProductMediaStatus = "active" | "inactive";
export type ProductSortDirection = "asc" | "desc";
export type PublicProductSort = "createdAt" | "name";
export type SellerProductSort = "createdAt" | "updatedAt" | "name" | "publicationStatus";

export interface Product {
  id: string;
  sellerId: string;
  storeId: string;
  categoryId: string;
  brandId: string | null;
  slug: string;
  name: string;
  description: string;
  status: ProductStatus;
  publicationStatus: ProductPublicationStatus;
  moderationReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProduct {
  id: string;
  storeId: string;
  categoryId: string;
  brandId: string | null;
  slug: string;
  name: string;
  description: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  status: ProductVariantStatus;
  weight: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProductVariant extends Omit<ProductVariant, "status"> {}

export interface ProductAttributeValue {
  id: string;
  productId: string;
  variantId: string | null;
  attributeId: string;
  valueText: string | null;
  valueNumber: string | null;
  valueId: string | null;
}

export interface ProductMedia {
  id: string;
  productId: string;
  variantId: string | null;
  fileId: string;
  mediaType: string;
  altText: string | null;
  sortOrder: number;
  status: ProductMediaStatus;
  createdAt: string;
}

export interface PublicProductMedia extends Omit<ProductMedia, "status"> {}

export interface ProductPriceHistory {
  id: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
  changedBy: string;
  changedAt: string;
}

export interface ProductDetail extends Product {
  variants: ProductVariant[];
  attributes: ProductAttributeValue[];
  media: ProductMedia[];
  priceHistory?: ProductPriceHistory[];
}

export interface PublicProductDetail extends PublicProduct {
  variants: PublicProductVariant[];
  attributes: ProductAttributeValue[];
  media: PublicProductMedia[];
}

export interface ProductAttributeInput {
  attributeId: string;
  valueText?: string;
  valueNumber?: string;
  valueId?: string;
}

export interface PublicProductListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  categoryId?: string;
  brandId?: string;
  storeId?: string;
  sort?: PublicProductSort;
  direction?: ProductSortDirection;
}

export interface SellerProductListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  storeId?: string;
  status?: ProductStatus;
  publicationStatus?: ProductPublicationStatus;
  sort?: SellerProductSort;
  direction?: ProductSortDirection;
}

export interface AdminProductListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sellerId?: string;
  storeId?: string;
  publicationStatus?: ProductPublicationStatus;
  sort?: SellerProductSort;
  direction?: ProductSortDirection;
}

export interface PaginatedAdminProducts {
  items: Product[];
  meta: PaginationMeta;
}

export interface PaginatedPublicProducts {
  items: PublicProduct[];
  meta: PaginationMeta;
}

export interface PaginatedSellerProducts {
  items: Product[];
  meta: PaginationMeta;
}

export interface CreateProductInput {
  storeId: string;
  categoryId: string;
  brandId?: string | null;
  slug: string;
  name: string;
  description: string;
  attributes?: ProductAttributeInput[];
}

export interface UpdateProductInput {
  categoryId?: string;
  brandId?: string | null;
  slug?: string;
  name?: string;
  description?: string;
  attributes?: ProductAttributeInput[];
}

export interface CreateProductVariantInput {
  sku: string;
  title: string;
  price: string;
  compareAtPrice?: string | null;
  currency: string;
  status?: ProductVariantStatus;
  weight?: string | null;
  attributes?: ProductAttributeInput[];
}

export interface UpdateProductVariantInput {
  sku?: string;
  title?: string;
  price?: string;
  compareAtPrice?: string | null;
  currency?: string;
  status?: ProductVariantStatus;
  weight?: string | null;
  attributes?: ProductAttributeInput[];
}

export interface LinkProductMediaInput {
  fileId: string;
  variantId?: string | null;
  altText?: string | null;
  sortOrder?: number;
}

export interface UploadProductMediaInput {
  productId: string;
  file: File;
  variantId?: string | null;
  altText?: string | null;
  sortOrder?: number;
}

export interface RejectProductInput {
  reason: string;
}
