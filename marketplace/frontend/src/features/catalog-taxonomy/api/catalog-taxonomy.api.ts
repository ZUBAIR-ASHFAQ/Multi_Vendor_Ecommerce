import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api";
import type {
  Brand,
  CatalogAttribute,
  Category,
  CategoryAttributeMapping,
  CategoryTreeNode,
  CreateAttributeInput,
  CreateBrandInput,
  CreateCategoryInput,
  ReplaceCategoryAttributesInput,
  UpdateCategoryInput,
} from "../types/catalog-taxonomy.types";

/** Unwraps one successful Module 5 API envelope while preserving normalized interceptor errors. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export const catalogTaxonomyApi = {
  /** Loads the public or permission-aware category tree. */
  listCategories: () => one<CategoryTreeNode[]>(apiClient.get("/catalog/categories")),

  /** Creates one category through the approved administration command. */
  createCategory: (input: CreateCategoryInput) =>
    one<Category>(apiClient.post("/admin/catalog/categories", input)),

  /** Updates one category through the approved administration command. */
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    one<Category>(apiClient.patch(`/admin/catalog/categories/${id}`, input)),

  /** Loads the attributes currently mapped to one category for the current caller. */
  listCategoryAttributes: (categoryId: string) =>
    one<CategoryAttributeMapping[]>(
      apiClient.get(`/catalog/categories/${categoryId}/attributes`),
    ),

  /** Loads brands visible to the current caller. */
  listBrands: () => one<Brand[]>(apiClient.get("/catalog/brands")),

  /** Creates one brand through the approved administration command. */
  createBrand: (input: CreateBrandInput) =>
    one<Brand>(apiClient.post("/admin/catalog/brands", input)),

  /** Loads reusable attribute definitions and their allowed values. */
  listAttributes: () => one<CatalogAttribute[]>(apiClient.get("/catalog/attributes")),

  /** Creates one reusable attribute and optional allowed values. */
  createAttribute: (input: CreateAttributeInput) =>
    one<CatalogAttribute>(apiClient.post("/admin/catalog/attributes", input)),

  /** Replaces one category's complete attribute mapping using the approved PUT command. */
  replaceCategoryAttributes: (categoryId: string, input: ReplaceCategoryAttributesInput) =>
    one<CategoryAttributeMapping[]>(
      apiClient.put(`/admin/catalog/categories/${categoryId}/attributes`, input),
    ),
};
