import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  attributeValues,
  attributes,
  brands,
  categories,
  categoryAttributes,
  type AttributeRow,
  type AttributeValueRow,
  type BrandRow,
  type CategoryAttributeRow,
  type CategoryRow,
  type NewAttributeRow,
  type NewAttributeValueRow,
  type NewBrandRow,
  type NewCategoryAttributeRow,
  type NewCategoryRow,
} from "../../database/schema/catalog.js";
import type { DatabaseExecutor } from "../../database/types.js";

/** Values persisted when the service creates one category. */
interface CreateCategoryRecordInput {
  parentId?: string | null | undefined;
  slug: string;
  name: string;
  status?: CategoryRow["status"] | undefined;
  sortOrder?: number | undefined;
}

/** Category fields that the service may change through the approved update command. */
interface UpdateCategoryRecordInput {
  parentId?: string | null | undefined;
  slug?: string | undefined;
  name?: string | undefined;
  status?: CategoryRow["status"] | undefined;
  sortOrder?: number | undefined;
}

/** Values persisted when the service creates one brand. */
interface CreateBrandRecordInput {
  slug: string;
  name: string;
  status?: BrandRow["status"] | undefined;
}

/** Values persisted when the service creates one reusable attribute definition. */
interface CreateAttributeRecordInput {
  code: string;
  name: string;
  dataType: string;
  isVariantAxis?: boolean | undefined;
  status?: AttributeRow["status"] | undefined;
}

/** One allowed value option inserted for a newly created attribute. */
interface CreateAttributeValueRecordInput {
  value: string;
  sortOrder?: number | undefined;
  status?: AttributeValueRow["status"] | undefined;
}

/** One category-to-attribute mapping already validated by the service. */
interface ReplaceCategoryAttributeRecordInput {
  attributeId: string;
  isRequired?: boolean | undefined;
  isFilterable?: boolean | undefined;
  sortOrder?: number | undefined;
}

/** Optional persistence filter used by public versus privileged taxonomy reads. */
interface CatalogStatusFilter {
  status?: string;
}

/**
 * Persistence-only Module 5 repository.
 * Hierarchy rules, lifecycle decisions, permissions, audit, and outbox behavior stay in the service.
 */
export class CatalogTaxonomyRepository {
  /** Creates a repository bound to either the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Lists categories in a deterministic order, optionally restricted to one persisted status. */
  async listCategories(filter: CatalogStatusFilter = {}): Promise<CategoryRow[]> {
    return this.executor
      .select()
      .from(categories)
      .where(filter.status ? eq(categories.status, filter.status) : undefined)
      .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id));
  }

  /** Locks the complete category hierarchy in stable ID order before a hierarchy-changing transaction. */
  async listCategoriesForUpdate(): Promise<CategoryRow[]> {
    return this.executor
      .select()
      .from(categories)
      .orderBy(asc(categories.id))
      .for("update");
  }

  /** Reads one category by its stable ID. */
  async findCategoryById(categoryId: string): Promise<CategoryRow | null> {
    const [row] = await this.executor
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    return row ?? null;
  }

  /** Locks one category row inside the caller's transaction before a hierarchy or lifecycle update. */
  async findCategoryByIdForUpdate(categoryId: string): Promise<CategoryRow | null> {
    const [row] = await this.executor
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Reads only the category ID needed for a global normalized-slug conflict check. */
  async findCategoryIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);

    return row?.id ?? null;
  }

  /** Creates one category after the service has validated hierarchy and command rules. */
  async createCategory(input: CreateCategoryRecordInput): Promise<CategoryRow> {
    const values: NewCategoryRow = {
      parentId: input.parentId,
      slug: input.slug,
      name: input.name,
      status: input.status,
      sortOrder: input.sortOrder,
    };

    const [row] = await this.executor.insert(categories).values(values).returning();

    if (!row) {
      throw new Error("Category insert completed without returning a row.");
    }

    return row;
  }

  /** Updates only service-approved category fields for one exact category ID. */
  async updateCategory(
    categoryId: string,
    input: UpdateCategoryRecordInput,
  ): Promise<CategoryRow | null> {
    const [row] = await this.executor
      .update(categories)
      .set(input)
      .where(eq(categories.id, categoryId))
      .returning();

    return row ?? null;
  }

  /** Lists brands in a deterministic order, optionally restricted to one persisted status. */
  async listBrands(filter: CatalogStatusFilter = {}): Promise<BrandRow[]> {
    return this.executor
      .select()
      .from(brands)
      .where(filter.status ? eq(brands.status, filter.status) : undefined)
      .orderBy(asc(brands.name), asc(brands.id));
  }

  /** Reads one brand by its stable ID for downstream taxonomy validation. */
  async findBrandById(brandId: string): Promise<BrandRow | null> {
    const [row] = await this.executor
      .select()
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);

    return row ?? null;
  }

  /** Reads only the brand ID needed for a global normalized-slug conflict check. */
  async findBrandIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.slug, slug))
      .limit(1);

    return row?.id ?? null;
  }

  /** Creates one brand after the service has validated the command. */
  async createBrand(input: CreateBrandRecordInput): Promise<BrandRow> {
    const values: NewBrandRow = {
      slug: input.slug,
      name: input.name,
      status: input.status,
    };

    const [row] = await this.executor.insert(brands).values(values).returning();

    if (!row) {
      throw new Error("Brand insert completed without returning a row.");
    }

    return row;
  }

  /** Lists attribute definitions in a deterministic order, optionally restricted to one persisted status. */
  async listAttributes(filter: CatalogStatusFilter = {}): Promise<AttributeRow[]> {
    return this.executor
      .select()
      .from(attributes)
      .where(filter.status ? eq(attributes.status, filter.status) : undefined)
      .orderBy(asc(attributes.name), asc(attributes.id));
  }

  /** Reads all requested attribute definitions in one query for mapping validation. */
  async listAttributesByIds(attributeIds: string[]): Promise<AttributeRow[]> {
    if (attributeIds.length === 0) return [];

    return this.executor
      .select()
      .from(attributes)
      .where(inArray(attributes.id, attributeIds))
      .orderBy(asc(attributes.name), asc(attributes.id));
  }

  /** Reads only the attribute ID needed for a global normalized-code conflict check. */
  async findAttributeIdByCode(code: string): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: attributes.id })
      .from(attributes)
      .where(eq(attributes.code, code))
      .limit(1);

    return row?.id ?? null;
  }

  /** Creates one reusable attribute definition after the service has validated semantic rules. */
  async createAttribute(input: CreateAttributeRecordInput): Promise<AttributeRow> {
    const values: NewAttributeRow = {
      code: input.code,
      name: input.name,
      dataType: input.dataType,
      isVariantAxis: input.isVariantAxis,
      status: input.status,
    };

    const [row] = await this.executor.insert(attributes).values(values).returning();

    if (!row) {
      throw new Error("Attribute insert completed without returning a row.");
    }

    return row;
  }

  /** Inserts allowed value options for one attribute without making lifecycle or compatibility decisions. */
  async createAttributeValues(
    attributeId: string,
    values: CreateAttributeValueRecordInput[],
  ): Promise<AttributeValueRow[]> {
    if (values.length === 0) return [];

    const records: NewAttributeValueRow[] = values.map((value) => ({
      attributeId,
      value: value.value,
      sortOrder: value.sortOrder,
      status: value.status,
    }));

    return this.executor.insert(attributeValues).values(records).returning();
  }

  /** Lists value options for the requested attributes without issuing one query per attribute. */
  async listAttributeValuesByAttributeIds(
    attributeIds: string[],
    filter: CatalogStatusFilter = {},
  ): Promise<AttributeValueRow[]> {
    if (attributeIds.length === 0) return [];

    return this.executor
      .select()
      .from(attributeValues)
      .where(
        and(
          inArray(attributeValues.attributeId, attributeIds),
          filter.status ? eq(attributeValues.status, filter.status) : undefined,
        ),
      )
      .orderBy(
        asc(attributeValues.attributeId),
        asc(attributeValues.sortOrder),
        asc(attributeValues.value),
        asc(attributeValues.id),
      );
  }

  /** Lists the persisted attribute rules for one category in UI-friendly deterministic order. */
  async listCategoryAttributes(categoryId: string): Promise<CategoryAttributeRow[]> {
    return this.executor
      .select()
      .from(categoryAttributes)
      .where(eq(categoryAttributes.categoryId, categoryId))
      .orderBy(asc(categoryAttributes.sortOrder), asc(categoryAttributes.attributeId));
  }

  /**
   * Replaces one category's complete attribute mapping set using this repository's executor.
   * The service must call this method on a transaction-bound repository so delete and insert stay atomic.
   */
  async replaceCategoryAttributes(
    categoryId: string,
    mappings: ReplaceCategoryAttributeRecordInput[],
  ): Promise<CategoryAttributeRow[]> {
    await this.executor
      .delete(categoryAttributes)
      .where(eq(categoryAttributes.categoryId, categoryId));

    if (mappings.length === 0) return [];

    const records: NewCategoryAttributeRow[] = mappings.map((mapping) => ({
      categoryId,
      attributeId: mapping.attributeId,
      isRequired: mapping.isRequired,
      isFilterable: mapping.isFilterable,
      sortOrder: mapping.sortOrder,
    }));

    return this.executor.insert(categoryAttributes).values(records).returning();
  }
}
