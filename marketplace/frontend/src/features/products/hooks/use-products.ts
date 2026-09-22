import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DOCUMENT_PURPOSE } from "@/features/documents-audit/documents-audit.constants";
import { invalidateProductCommerceState } from "@/lib/commerce-cache-invalidation";
import { documentsAuditApi } from "@/features/documents-audit/api/documents-audit.api";
import { productsApi } from "../api/products.api";
import type {
  AdminProductListParams,
  CreateProductInput,
  CreateProductVariantInput,
  PublicProductListParams,
  RejectProductInput,
  SellerProductListParams,
  UpdateProductInput,
  UpdateProductVariantInput,
  UploadProductMediaInput,
} from "../types/products.types";
import { productQueryKeys } from "./products.query-keys";

/** Loads one public Product page. */
export function usePublicProductsQuery(params: PublicProductListParams) {
  return useQuery({
    queryKey: productQueryKeys.publicList(params),
    queryFn: () => productsApi.listPublicProducts(params),
  });
}

/** Loads one published public-safe Product detail by slug. */
export function usePublicProductQuery(slug: string) {
  return useQuery({
    queryKey: productQueryKeys.publicDetail(slug),
    queryFn: () => productsApi.getPublicProduct(slug),
    enabled: slug.length > 0,
  });
}

/** Loads one seller-scoped Product page. */
export function useSellerProductsQuery(params: SellerProductListParams, enabled = true) {
  return useQuery({
    queryKey: productQueryKeys.sellerList(params),
    queryFn: () => productsApi.listSellerProducts(params),
    enabled,
  });
}

/** Loads one complete seller Product aggregate for the edit workflow. */
export function useSellerProductQuery(productId: string, enabled = true) {
  return useQuery({
    queryKey: productQueryKeys.sellerDetail(productId),
    queryFn: () => productsApi.getSellerProduct(productId),
    enabled: enabled && productId.length > 0,
  });
}

/** Creates one Product and seeds the seller-detail cache with the server result. */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => productsApi.createProduct(input),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(product.id), product);
      await queryClient.invalidateQueries({ queryKey: productQueryKeys.seller });
    },
  });
}

/** Updates one Product and refreshes seller/public Product state. */
export function useUpdateProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProductInput) => productsApi.updateProduct(productId, input),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Adds one variant and refreshes all server state derived from this Product. */
export function useAddProductVariantMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductVariantInput) => productsApi.addVariant(productId, input),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Updates one variant and refreshes Product detail, list, and public state. */
export function useUpdateProductVariantMutation(productId: string, variantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProductVariantInput) =>
      productsApi.updateVariant(productId, variantId, input),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Uploads Product media through Module 21, then links the confirmed file through Module 6. */
export function useUploadProductMediaMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadProductMediaInput) => {
      const signed = await documentsAuditApi.signUpload({
        originalName: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size,
        purpose: DOCUMENT_PURPOSE.PRODUCT_MEDIA,
      });
      await documentsAuditApi.uploadSignedObject(
        signed.uploadUrl,
        input.file,
        signed.requiredHeaders,
      );
      const confirmed = await documentsAuditApi.confirmUpload(signed.fileId);
      return productsApi.linkMedia(input.productId, {
        fileId: confirmed.file.id,
        variantId: input.variantId ?? null,
        altText: input.altText ?? null,
        sortOrder: input.sortOrder,
      });
    },
    onSuccess: async (product, input) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(input.productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Publishes or submits one Product and refreshes seller/public state. */
export function usePublishProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => productsApi.publishProduct(productId),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Unpublishes one Product and refreshes seller/public state. */
export function useUnpublishProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => productsApi.unpublishProduct(productId),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.sellerDetail(productId), product);
      await invalidateProductCommerceState(queryClient);
    },
  });
}

/** Loads the platform-wide moderation queue. */
export function useAdminProductsQuery(params: AdminProductListParams, enabled = true) {
  return useQuery({
    queryKey: productQueryKeys.adminList(params),
    queryFn: () => productsApi.listAdminProducts(params),
    enabled,
  });
}

/** Loads one complete Product for an admin review decision. */
export function useAdminProductQuery(productId: string, enabled = true) {
  return useQuery({
    queryKey: productQueryKeys.adminDetail(productId),
    queryFn: () => productsApi.getAdminProduct(productId),
    enabled: enabled && productId.length > 0,
  });
}

/** Approves one pending Product and refreshes all affected catalog state. */
export function useApproveProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => productsApi.approveProduct(productId),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.adminDetail(productId), product);
      await invalidateProductCommerceState(queryClient, { includeAdmin: true });
    },
  });
}

/** Rejects one pending Product and returns it to the seller with a reason. */
export function useRejectProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RejectProductInput) => productsApi.rejectProduct(productId, input),
    onSuccess: async (product) => {
      queryClient.setQueryData(productQueryKeys.adminDetail(productId), product);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productQueryKeys.admin }),
        queryClient.invalidateQueries({ queryKey: productQueryKeys.seller }),
      ]);
    },
  });
}
