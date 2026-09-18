import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  CreateProductInput,
  CreateProductVariantInput,
  LinkProductMediaInput,
  PaginatedPublicProducts,
  PaginatedSellerProducts,
  ProductDetail,
  PublicProductDetail,
  PublicProductListParams,
  SellerProductListParams,
  UpdateProductInput,
  UpdateProductVariantInput,
} from "../types/products.types";

/** Removes empty optional query values before sending documented Product filters. */
function queryParams(value: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps one successful Product API envelope while preserving normalized interceptor errors. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps one Product page and rejects a malformed response missing standard pagination metadata. */
async function page<T>(
  request: Promise<{ data: ApiResponse<T[], PaginationMeta> }>,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Product pagination metadata is missing.");
  return { items: response.data.data, meta: response.data.meta };
}

export const productsApi = {
  /** Lists public-safe published Products with documented filters and standard pagination. */
  listPublicProducts: (params: PublicProductListParams) =>
    page<PaginatedPublicProducts["items"][number]>(
      apiClient.get("/products", { params: queryParams(params) }),
    ),

  /** Reads one public-safe published Product by its globally unique slug. */
  getPublicProduct: (slug: string) =>
    one<PublicProductDetail>(apiClient.get(`/products/${encodeURIComponent(slug)}`)),

  /** Lists Products inside the authenticated seller/store scope. */
  listSellerProducts: (params: SellerProductListParams) =>
    page<PaginatedSellerProducts["items"][number]>(
      apiClient.get("/seller/products", { params: queryParams(params) }),
    ),

  /** Reads one complete seller-private Product aggregate for editing. */
  getSellerProduct: (id: string) =>
    one<ProductDetail>(apiClient.get(`/seller/products/${id}`)),

  /** Creates one draft Product inside the server-derived seller/store scope. */
  createProduct: (input: CreateProductInput) =>
    one<ProductDetail>(apiClient.post("/seller/products", input)),

  /** Updates editable Product fields while lifecycle state remains command-owned. */
  updateProduct: (id: string, input: UpdateProductInput) =>
    one<ProductDetail>(apiClient.patch(`/seller/products/${id}`, input)),

  /** Adds one Product variant/SKU. */
  addVariant: (productId: string, input: CreateProductVariantInput) =>
    one<ProductDetail>(apiClient.post(`/seller/products/${productId}/variants`, input)),

  /** Updates one Product variant/SKU and lets the backend append price history when needed. */
  updateVariant: (productId: string, variantId: string, input: UpdateProductVariantInput) =>
    one<ProductDetail>(
      apiClient.patch(`/seller/products/${productId}/variants/${variantId}`, input),
    ),

  /** Links one confirmed Module 21 file as Product media. */
  linkMedia: (productId: string, input: LinkProductMediaInput) =>
    one<ProductDetail>(apiClient.post(`/seller/products/${productId}/media`, input)),

  /** Publishes a Product or submits it for approval according to marketplace policy. */
  publishProduct: (id: string) =>
    one<ProductDetail>(apiClient.post(`/seller/products/${id}/publish`, {})),

  /** Unpublishes one seller-owned Product without deleting commerce history. */
  unpublishProduct: (id: string) =>
    one<ProductDetail>(apiClient.post(`/seller/products/${id}/unpublish`, {})),
};
