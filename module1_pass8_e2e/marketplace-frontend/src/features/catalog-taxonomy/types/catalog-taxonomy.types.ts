export type CatalogStatus = "active" | "inactive";

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  status: CatalogStatus;
  sortOrder: number;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  status: CatalogStatus;
}

export interface AttributeValue {
  id: string;
  attributeId: string;
  value: string;
  sortOrder: number;
  status: CatalogStatus;
}

export interface CatalogAttribute {
  id: string;
  code: string;
  name: string;
  dataType: string;
  isVariantAxis: boolean;
  status: CatalogStatus;
  values: AttributeValue[];
}

export interface CategoryAttributeMapping {
  categoryId: string;
  attributeId: string;
  isRequired: boolean;
  isFilterable: boolean;
  sortOrder: number;
}

export interface CreateCategoryInput {
  parentId?: string | null;
  slug: string;
  name: string;
  status?: CatalogStatus;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  parentId?: string | null;
  slug?: string;
  name?: string;
  status?: CatalogStatus;
  sortOrder?: number;
}

export interface CreateBrandInput {
  slug: string;
  name: string;
  status?: CatalogStatus;
}

export interface CreateAttributeValueInput {
  value: string;
  sortOrder?: number;
  status?: CatalogStatus;
}

export interface CreateAttributeInput {
  code: string;
  name: string;
  dataType: string;
  isVariantAxis?: boolean;
  status?: CatalogStatus;
  values?: CreateAttributeValueInput[];
}

export interface ReplaceCategoryAttributesInput {
  attributes: Array<{
    attributeId: string;
    isRequired?: boolean;
    isFilterable?: boolean;
    sortOrder?: number;
  }>;
}

export interface CategoryOption {
  id: string;
  label: string;
  status: CatalogStatus;
  depth: number;
}

export interface TaxonomySelection {
  categoryId: string;
  brandId: string;
  attributeIds: string[];
}
