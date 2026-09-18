import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogTaxonomyApi } from "../api/catalog-taxonomy.api";
import type {
  CreateAttributeInput,
  CreateBrandInput,
  CreateCategoryInput,
  ReplaceCategoryAttributesInput,
  UpdateCategoryInput,
} from "../types/catalog-taxonomy.types";
import { catalogTaxonomyQueryKeys } from "./catalog-taxonomy.query-keys";

/** Loads the category tree visible to the current actor. */
export function useCategoriesQuery(enabled = true) {
  return useQuery({
    queryKey: catalogTaxonomyQueryKeys.categories,
    queryFn: catalogTaxonomyApi.listCategories,
    enabled,
  });
}

/** Loads the authoritative attribute mapping for one selected category. */
export function useCategoryAttributesQuery(categoryId: string, enabled = true) {
  return useQuery({
    queryKey: catalogTaxonomyQueryKeys.categoryAttributes(categoryId),
    queryFn: () => catalogTaxonomyApi.listCategoryAttributes(categoryId),
    enabled: enabled && categoryId.length > 0,
  });
}

/** Creates one category and refreshes the authoritative category tree. */
export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => catalogTaxonomyApi.createCategory(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogTaxonomyQueryKeys.categories });
    },
  });
}

/** Updates one category and refreshes the authoritative category tree. */
export function useUpdateCategoryMutation(categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCategoryInput) =>
      catalogTaxonomyApi.updateCategory(categoryId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogTaxonomyQueryKeys.categories });
    },
  });
}

/** Loads brands visible to the current actor. */
export function useBrandsQuery(enabled = true) {
  return useQuery({
    queryKey: catalogTaxonomyQueryKeys.brands,
    queryFn: catalogTaxonomyApi.listBrands,
    enabled,
  });
}

/** Creates one brand and refreshes the brand list. */
export function useCreateBrandMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBrandInput) => catalogTaxonomyApi.createBrand(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogTaxonomyQueryKeys.brands });
    },
  });
}

/** Loads reusable attributes and their allowed values visible to the current actor. */
export function useAttributesQuery(enabled = true) {
  return useQuery({
    queryKey: catalogTaxonomyQueryKeys.attributes,
    queryFn: catalogTaxonomyApi.listAttributes,
    enabled,
  });
}

/** Creates one attribute and refreshes the attribute list. */
export function useCreateAttributeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAttributeInput) => catalogTaxonomyApi.createAttribute(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogTaxonomyQueryKeys.attributes });
    },
  });
}

/** Replaces one category's full attribute mapping and refreshes that mapping cache. */
export function useReplaceCategoryAttributesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      categoryId,
      input,
    }: {
      categoryId: string;
      input: ReplaceCategoryAttributesInput;
    }) => catalogTaxonomyApi.replaceCategoryAttributes(categoryId, input),
    onSuccess: async (mapping, variables) => {
      queryClient.setQueryData(
        catalogTaxonomyQueryKeys.categoryAttributes(variables.categoryId),
        mapping,
      );
      await queryClient.invalidateQueries({
        queryKey: catalogTaxonomyQueryKeys.categoryAttributes(variables.categoryId),
      });
    },
  });
}
