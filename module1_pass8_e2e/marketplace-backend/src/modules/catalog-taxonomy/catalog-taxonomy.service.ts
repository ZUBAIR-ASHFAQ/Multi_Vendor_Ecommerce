import type {
  AttributeRow,
  AttributeValueRow,
  BrandRow,
  CategoryAttributeRow,
  CategoryRow,
} from "../../database/schema/catalog.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { RequestContext } from "../../common/types/request-context.js";
import {
  CATALOG_AUDIT_ACTION,
  CATALOG_ERROR_CODE,
  CATALOG_OUTBOX_EVENT,
  CATALOG_PERMISSION,
  CATALOG_RESOURCE_TYPE,
  CATALOG_STATUS,
  CATALOG_VARIANT_AXIS_DATA_TYPE,
} from "./catalog-taxonomy.constants.js";
import { CatalogTaxonomyRepository } from "./catalog-taxonomy.repository.js";
import type {
  AttributeResponse,
  AttributeValueResponse,
  BrandResponse,
  CategoryAttributeMappingResponse,
  CategoryResponse,
  CategoryTreeNodeResponse,
  CreateAttributeInput,
  CreateBrandInput,
  CreateCategoryInput,
  ReplaceCategoryAttributesInput,
  UpdateCategoryInput,
} from "./catalog-taxonomy.schema.js";

/** Runs one Module 5 transaction and allows service tests to replace the real database boundary. */
export type CatalogTaxonomyTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Explicit service dependencies keep Module 5 logic small and easy to unit test. */
export interface CatalogTaxonomyServiceDependencies {
  repository?: CatalogTaxonomyRepository;
  transactionRunner?: CatalogTaxonomyTransactionRunner;
}

/** One Product-owned attribute value checked against Module 5 mapping/type/value rules. */
export interface ProductTaxonomyAttributeValueInput {
  attributeId: string;
  valueText?: string | null;
  valueNumber?: string | null;
  valueId?: string | null;
}

/** One variant's attribute set supplied by Product Management for taxonomy validation. */
export interface ProductTaxonomyVariantValuesInput {
  variantId: string;
  attributes: ProductTaxonomyAttributeValueInput[];
}

/** Product and variant values checked by Module 5 without exposing taxonomy repositories downstream. */
export interface ProductTaxonomyValuesValidationInput {
  categoryId: string;
  brandId?: string | null;
  productAttributes: ProductTaxonomyAttributeValueInput[];
  variants: ProductTaxonomyVariantValuesInput[];
}

/** Creates one stable Module 5 business error. */
function catalogError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Module 5 business service for taxonomy reads, controlled writes, hierarchy rules, audit, and outbox events. */
export class CatalogTaxonomyService {
  private readonly repository: CatalogTaxonomyRepository;
  private readonly transactionRunner: CatalogTaxonomyTransactionRunner;

  /** Stores explicit dependencies without introducing a container or unnecessary framework abstraction. */
  constructor(dependencies: CatalogTaxonomyServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new CatalogTaxonomyRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
  }

  /** Creates a transaction-bound service for trusted downstream module integration. */
  static using(transaction: DatabaseTransaction): CatalogTaxonomyService {
    return new CatalogTaxonomyService({
      repository: new CatalogTaxonomyRepository(transaction),
      /** Reuses the caller's transaction instead of opening a nested transaction. */
      transactionRunner: async (work) => work(transaction),
    });
  }

  /** Returns the category tree; public/read-only callers see active branches while category managers see all states. */
  async listCategories(
    context: RequestContext | null = null,
  ): Promise<CategoryTreeNodeResponse[]> {
    this.assertCatalogReadAllowed(context);
    const rows = await this.repository.listCategories();
    const tree = this.buildCategoryTree(rows);

    return this.canManageCategories(context)
      ? tree
      : this.filterActiveCategoryTree(tree);
  }

  /** Creates one category after checking permissions, normalized uniqueness, and parent existence. */
  async createCategory(
    context: RequestContext,
    input: CreateCategoryInput,
  ): Promise<CategoryResponse> {
    assertPermission(context, CATALOG_PERMISSION.MANAGE_CATEGORIES);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CatalogTaxonomyRepository(tx);
        const hierarchy = await repository.listCategoriesForUpdate();
        this.assertParentExists(hierarchy, input.parentId ?? null);
        await this.assertCategorySlugAvailable(repository, input.slug);

        const created = await repository.createCategory(input);
        const safe = this.toCategoryResponse(created);

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: CATALOG_AUDIT_ACTION.CATEGORY_CREATED,
          entityType: CATALOG_RESOURCE_TYPE.CATEGORY,
          entityId: created.id,
          requestId: context.requestId,
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          eventType: CATALOG_OUTBOX_EVENT.CATEGORY_CREATED,
          aggregateType: CATALOG_RESOURCE_TYPE.CATEGORY,
          aggregateId: created.id,
          payload: {
            categoryId: created.id,
            parentId: created.parentId,
            status: created.status,
          },
        });

        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.duplicateCatalogCode();
      throw error;
    }
  }

  /** Updates one category atomically while preventing self-parenting and descendant hierarchy cycles. */
  async updateCategory(
    context: RequestContext,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryResponse> {
    assertPermission(context, CATALOG_PERMISSION.MANAGE_CATEGORIES);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CatalogTaxonomyRepository(tx);
        const hierarchy = await repository.listCategoriesForUpdate();
        const existing = hierarchy.find((category) => category.id === categoryId);
        if (!existing) throw this.categoryNotFound();

        const nextParentId =
          input.parentId !== undefined ? input.parentId : existing.parentId;
        this.assertCategoryParentIsValid(hierarchy, categoryId, nextParentId);

        if (input.slug !== undefined && input.slug !== existing.slug) {
          await this.assertCategorySlugAvailable(repository, input.slug, categoryId);
        }

        const updated = await repository.updateCategory(categoryId, input);
        if (!updated) throw this.categoryNotFound();
        const safe = this.toCategoryResponse(updated);

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: CATALOG_AUDIT_ACTION.CATEGORY_UPDATED,
          entityType: CATALOG_RESOURCE_TYPE.CATEGORY,
          entityId: categoryId,
          requestId: context.requestId,
          before: this.toCategoryResponse(existing),
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          eventType: CATALOG_OUTBOX_EVENT.CATEGORY_UPDATED,
          aggregateType: CATALOG_RESOURCE_TYPE.CATEGORY,
          aggregateId: categoryId,
          payload: {
            categoryId,
            parentId: updated.parentId,
            status: updated.status,
          },
        });

        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.duplicateCatalogCode();
      throw error;
    }
  }

  /** Returns brands allowed to the caller; public/read-only callers see active rows only. */
  async listBrands(context: RequestContext | null = null): Promise<BrandResponse[]> {
    this.assertCatalogReadAllowed(context);
    const rows = await this.repository.listBrands(
      this.canManageBrands(context) ? {} : { status: CATALOG_STATUS.ACTIVE },
    );
    return rows.map((row) => this.toBrandResponse(row));
  }

  /** Creates one brand with normalized uniqueness plus same-transaction audit and durable event writes. */
  async createBrand(
    context: RequestContext,
    input: CreateBrandInput,
  ): Promise<BrandResponse> {
    assertPermission(context, CATALOG_PERMISSION.MANAGE_BRANDS);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CatalogTaxonomyRepository(tx);
        if (await repository.findBrandIdBySlug(input.slug)) {
          throw this.duplicateCatalogCode();
        }

        const created = await repository.createBrand(input);
        const safe = this.toBrandResponse(created);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: CATALOG_AUDIT_ACTION.BRAND_CREATED,
          entityType: CATALOG_RESOURCE_TYPE.BRAND,
          entityId: created.id,
          requestId: context.requestId,
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          // The controlling guide names brand.updated but does not define a separate brand.created event.
          eventType: CATALOG_OUTBOX_EVENT.BRAND_UPDATED,
          aggregateType: CATALOG_RESOURCE_TYPE.BRAND,
          aggregateId: created.id,
          payload: { brandId: created.id, changeType: "created", status: created.status },
        });
        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.duplicateCatalogCode();
      throw error;
    }
  }

  /** Returns reusable attributes with their value options using bounded batched repository reads. */
  async listAttributes(
    context: RequestContext | null = null,
  ): Promise<AttributeResponse[]> {
    this.assertCatalogReadAllowed(context);
    const includeInactive = this.canManageAttributes(context);
    const rows = await this.repository.listAttributes(
      includeInactive ? {} : { status: CATALOG_STATUS.ACTIVE },
    );
    const values = await this.repository.listAttributeValuesByAttributeIds(
      rows.map((row) => row.id),
      includeInactive ? {} : { status: CATALOG_STATUS.ACTIVE },
    );
    return this.toAttributeResponses(rows, values);
  }

  /** Returns one category's attribute mappings and hides inactive taxonomy from non-management readers. */
  async listCategoryAttributeMappings(
    context: RequestContext | null,
    categoryId: string,
  ): Promise<CategoryAttributeMappingResponse[]> {
    this.assertCatalogReadAllowed(context);

    const category = await this.repository.findCategoryById(categoryId);
    if (!category) throw this.categoryNotFound();

    const mappings = await this.repository.listCategoryAttributes(categoryId);
    if (this.canManageCategories(context)) {
      return this.sortMappingResponses(
        mappings.map((row) => this.toMappingResponse(row)),
      );
    }

    const categories = await this.repository.listCategories();
    this.assertCategoryPathIsActive(categories, categoryId);

    const attributeIds = mappings.map((mapping) => mapping.attributeId);
    const attributes = await this.repository.listAttributesByIds(attributeIds);
    const activeAttributeIds = new Set(
      attributes
        .filter((attribute) => attribute.status === CATALOG_STATUS.ACTIVE)
        .map((attribute) => attribute.id),
    );

    return this.sortMappingResponses(
      mappings
        .filter((mapping) => activeAttributeIds.has(mapping.attributeId))
        .map((row) => this.toMappingResponse(row)),
    );
  }

  /** Creates one attribute and its optional value options atomically after semantic validation. */
  async createAttribute(
    context: RequestContext,
    input: CreateAttributeInput,
  ): Promise<AttributeResponse> {
    assertPermission(context, CATALOG_PERMISSION.MANAGE_ATTRIBUTES);
    this.assertAttributeDefinitionIsValid(input);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CatalogTaxonomyRepository(tx);
        if (await repository.findAttributeIdByCode(input.code)) {
          throw this.duplicateCatalogCode();
        }

        const created = await repository.createAttribute(input);
        const values = await repository.createAttributeValues(
          created.id,
          input.values ?? [],
        );
        const safe = this.toAttributeResponse(created, values);

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: CATALOG_AUDIT_ACTION.ATTRIBUTE_CREATED,
          entityType: CATALOG_RESOURCE_TYPE.ATTRIBUTE,
          entityId: created.id,
          requestId: context.requestId,
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          // The controlling guide names attribute.updated but does not define a separate attribute.created event.
          eventType: CATALOG_OUTBOX_EVENT.ATTRIBUTE_UPDATED,
          aggregateType: CATALOG_RESOURCE_TYPE.ATTRIBUTE,
          aggregateId: created.id,
          payload: {
            attributeId: created.id,
            changeType: "created",
            status: created.status,
            valueCount: values.length,
          },
        });

        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.duplicateCatalogCode();
      throw error;
    }
  }

  /** Replaces one category's complete attribute mapping atomically after validating every referenced attribute. */
  async replaceCategoryAttributes(
    context: RequestContext,
    categoryId: string,
    input: ReplaceCategoryAttributesInput,
  ): Promise<CategoryAttributeMappingResponse[]> {
    assertPermission(context, CATALOG_PERMISSION.MANAGE_CATEGORIES);
    this.assertUniqueMappingAttributeIds(input);

    return this.transactionRunner(async (tx) => {
      const repository = new CatalogTaxonomyRepository(tx);
      const category = await repository.findCategoryByIdForUpdate(categoryId);
      if (!category) throw this.categoryNotFound();

      const attributeIds = input.attributes.map((mapping) => mapping.attributeId);
      const referencedAttributes = await repository.listAttributesByIds(attributeIds);
      this.assertEveryMappedAttributeExists(attributeIds, referencedAttributes);

      const before = await repository.listCategoryAttributes(categoryId);
      const replaced = await repository.replaceCategoryAttributes(
        categoryId,
        input.attributes,
      );
      const safe = this.sortMappingResponses(
        replaced.map((row) => this.toMappingResponse(row)),
      );

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: CATALOG_AUDIT_ACTION.CATEGORY_ATTRIBUTES_REPLACED,
        entityType: CATALOG_RESOURCE_TYPE.CATEGORY,
        entityId: categoryId,
        requestId: context.requestId,
        before: before.map((row) => this.toMappingResponse(row)),
        after: safe,
      });
      await OutboxService.using(tx).enqueue({
        eventType: CATALOG_OUTBOX_EVENT.CATEGORY_ATTRIBUTES_CHANGED,
        aggregateType: CATALOG_RESOURCE_TYPE.CATEGORY,
        aggregateId: categoryId,
        payload: {
          categoryId,
          attributeIds: safe.map((mapping) => mapping.attributeId),
        },
      });

      return safe;
    });
  }

  /** Validates supplied Product/variant attribute values while allowing incomplete draft data. */
  async assertProductTaxonomyValuesAreValid(
    input: ProductTaxonomyValuesValidationInput,
  ): Promise<void> {
    const categories = await this.repository.listCategories();
    this.assertCategoryPathIsActive(categories, input.categoryId);

    if (input.brandId) {
      const brand = await this.repository.findBrandById(input.brandId);
      if (!brand || brand.status !== CATALOG_STATUS.ACTIVE) {
        throw catalogError(
          ERROR_CODE.CONFLICT,
          "The selected brand is not active for Product Management.",
          409,
        );
      }
    }

    const mappings = await this.repository.listCategoryAttributes(input.categoryId);
    const mappedIds = new Set(mappings.map((mapping) => mapping.attributeId));
    const allValues = [
      ...input.productAttributes,
      ...input.variants.flatMap((variant) => variant.attributes),
    ];
    const attributeIds = Array.from(new Set(allValues.map((value) => value.attributeId)));

    for (const attributeId of attributeIds) {
      if (!mappedIds.has(attributeId)) throw this.attributeInvalidForCategory();
    }

    const attributes = await this.repository.listAttributesByIds(attributeIds);
    if (
      attributes.length !== attributeIds.length ||
      attributes.some((attribute) => attribute.status !== CATALOG_STATUS.ACTIVE)
    ) {
      throw this.attributeInvalidForCategory();
    }

    const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
    const optionValues = await this.repository.listAttributeValuesByAttributeIds(
      attributeIds,
      { status: CATALOG_STATUS.ACTIVE },
    );
    const optionIdsByAttribute = new Map<string, Set<string>>();
    for (const value of optionValues) {
      const ids = optionIdsByAttribute.get(value.attributeId) ?? new Set<string>();
      ids.add(value.id);
      optionIdsByAttribute.set(value.attributeId, ids);
    }

    for (const value of input.productAttributes) {
      const attribute = attributesById.get(value.attributeId);
      if (!attribute || attribute.isVariantAxis) throw this.attributeInvalidForCategory();
      this.assertProductAttributeValueMatchesDefinition(
        attribute,
        value,
        optionIdsByAttribute.get(attribute.id) ?? new Set<string>(),
      );
    }

    for (const variant of input.variants) {
      for (const value of variant.attributes) {
        const attribute = attributesById.get(value.attributeId);
        if (!attribute || !attribute.isVariantAxis) throw this.attributeInvalidForCategory();
        this.assertProductAttributeValueMatchesDefinition(
          attribute,
          value,
          optionIdsByAttribute.get(attribute.id) ?? new Set<string>(),
        );
      }
    }
  }

  /** Validates a complete publishable taxonomy snapshot, including required attributes on every active variant. */
  async assertProductTaxonomyPublicationIsValid(
    input: ProductTaxonomyValuesValidationInput,
  ): Promise<void> {
    await this.assertProductTaxonomyValuesAreValid(input);

    const mappings = await this.repository.listCategoryAttributes(input.categoryId);
    const mappedAttributeIds = mappings.map((mapping) => mapping.attributeId);
    const attributes = await this.repository.listAttributesByIds(mappedAttributeIds);
    const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
    const productAttributeIds = new Set(
      input.productAttributes.map((value) => value.attributeId),
    );

    for (const mapping of mappings) {
      if (!mapping.isRequired) continue;
      const attribute = attributesById.get(mapping.attributeId);
      if (!attribute || attribute.status !== CATALOG_STATUS.ACTIVE) {
        throw this.attributeInvalidForCategory();
      }

      if (!attribute.isVariantAxis) {
        if (!productAttributeIds.has(attribute.id)) throw this.attributeInvalidForCategory();
        continue;
      }

      if (input.variants.length === 0) throw this.attributeInvalidForCategory();
      const everyVariantHasValue = input.variants.every((variant) =>
        variant.attributes.some((value) => value.attributeId === attribute.id),
      );
      if (!everyVariantHasValue) throw this.attributeInvalidForCategory();
    }
  }

  /** Allows public reads while requiring catalog.read for authenticated non-management callers. */
  private assertCatalogReadAllowed(context: RequestContext | null): void {
    if (!context) return;
    if (
      context.permissions.has(CATALOG_PERMISSION.READ) ||
      this.canManageCategories(context) ||
      this.canManageBrands(context) ||
      this.canManageAttributes(context)
    ) {
      return;
    }
    assertPermission(context, CATALOG_PERMISSION.READ);
  }

  /** Returns whether the authenticated actor may manage categories. */
  private canManageCategories(context: RequestContext | null): boolean {
    return Boolean(context?.permissions.has(CATALOG_PERMISSION.MANAGE_CATEGORIES));
  }

  /** Returns whether the authenticated actor may manage brands. */
  private canManageBrands(context: RequestContext | null): boolean {
    return Boolean(context?.permissions.has(CATALOG_PERMISSION.MANAGE_BRANDS));
  }

  /** Returns whether the authenticated actor may manage attribute definitions. */
  private canManageAttributes(context: RequestContext | null): boolean {
    return Boolean(context?.permissions.has(CATALOG_PERMISSION.MANAGE_ATTRIBUTES));
  }

  /** Ensures a supplied parent exists inside the transaction-locked hierarchy. */
  private assertParentExists(categories: CategoryRow[], parentId: string | null): void {
    if (!parentId) return;
    if (!categories.some((category) => category.id === parentId)) {
      throw catalogError(
        CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
        "Parent category not found.",
        404,
      );
    }
  }

  /** Ensures a category cannot be moved below itself or one of its descendants. */
  private assertCategoryParentIsValid(
    categories: CategoryRow[],
    categoryId: string,
    parentId: string | null,
  ): void {
    if (!parentId) return;
    if (parentId === categoryId) throw this.categoryCycle();

    const byId = new Map(categories.map((category) => [category.id, category]));
    let currentId: string | null = parentId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === categoryId) throw this.categoryCycle();
      if (visited.has(currentId)) throw this.categoryCycle();
      visited.add(currentId);

      const current = byId.get(currentId);
      if (!current) {
        throw catalogError(
          CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
          "Parent category not found.",
          404,
        );
      }
      currentId = current.parentId;
    }
  }

  /** Ensures the selected category and every ancestor are active and the stored hierarchy is not cyclic. */
  private assertCategoryPathIsActive(
    categories: CategoryRow[],
    categoryId: string,
  ): void {
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );
    let current = categoriesById.get(categoryId);
    const visited = new Set<string>();

    if (!current) throw this.categoryNotFound();

    while (current) {
      if (visited.has(current.id)) throw this.categoryCycle();
      visited.add(current.id);

      if (current.status !== CATALOG_STATUS.ACTIVE) {
        throw catalogError(
          CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
          "The selected category or one of its parent categories is not active.",
          404,
        );
      }

      if (!current.parentId) return;
      current = categoriesById.get(current.parentId);
      if (!current) throw this.categoryNotFound();
    }
  }

  /** Ensures a category slug is unused, allowing the current category to keep its own slug. */
  private async assertCategorySlugAvailable(
    repository: CatalogTaxonomyRepository,
    slug: string,
    currentCategoryId?: string,
  ): Promise<void> {
    const conflictingId = await repository.findCategoryIdBySlug(slug);
    if (conflictingId && conflictingId !== currentCategoryId) {
      throw this.duplicateCatalogCode();
    }
  }

  /** Validates attribute value uniqueness and the concrete value-backed variant-axis rule. */
  private assertAttributeDefinitionIsValid(input: CreateAttributeInput): void {
    const normalizedValues = (input.values ?? []).map((item) =>
      item.value.trim().toLowerCase(),
    );
    if (new Set(normalizedValues).size !== normalizedValues.length) {
      throw catalogError(
        ERROR_CODE.INVALID_REQUEST,
        "Attribute values must be unique within one attribute.",
        422,
      );
    }

    if (!input.isVariantAxis) return;

    if ((input.values ?? []).length === 0) throw this.attributeInvalidForCategory();
    if (input.dataType !== CATALOG_VARIANT_AXIS_DATA_TYPE) {
      throw this.attributeInvalidForCategory();
    }
  }

  /** Ensures one Product value representation matches the active taxonomy attribute definition. */
  private assertProductAttributeValueMatchesDefinition(
    attribute: AttributeRow,
    value: ProductTaxonomyAttributeValueInput,
    allowedOptionIds: ReadonlySet<string>,
  ): void {
    const dataType = attribute.dataType.trim().toLowerCase();

    if (dataType === CATALOG_VARIANT_AXIS_DATA_TYPE) {
      if (!value.valueId || value.valueText != null || value.valueNumber != null) {
        throw this.attributeInvalidForCategory();
      }
      if (!allowedOptionIds.has(value.valueId)) throw this.attributeInvalidForCategory();
      return;
    }

    if (dataType === "number") {
      if (value.valueNumber == null || value.valueText != null || value.valueId != null) {
        throw this.attributeInvalidForCategory();
      }
      return;
    }

    if (!value.valueText || value.valueNumber != null || value.valueId != null) {
      throw this.attributeInvalidForCategory();
    }
  }

  /** Ensures service callers cannot bypass the Zod duplicate-mapping guard. */
  private assertUniqueMappingAttributeIds(input: ReplaceCategoryAttributesInput): void {
    const ids = input.attributes.map((mapping) => mapping.attributeId);
    if (new Set(ids).size !== ids.length) throw this.attributeInvalidForCategory();
  }

  /** Ensures every requested category mapping references a real attribute definition. */
  private assertEveryMappedAttributeExists(
    requestedIds: string[],
    attributes: AttributeRow[],
  ): void {
    if (new Set(requestedIds).size !== attributes.length) {
      throw this.attributeInvalidForCategory();
    }
  }

  /** Builds one deterministic hierarchy from flat database rows without mutating persistence objects. */
  private buildCategoryTree(rows: CategoryRow[]): CategoryTreeNodeResponse[] {
    const nodes = new Map<string, CategoryTreeNodeResponse>();
    for (const row of rows) {
      nodes.set(row.id, { ...this.toCategoryResponse(row), children: [] });
    }

    const roots: CategoryTreeNodeResponse[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id);
      if (!node) continue;
      const parent = row.parentId ? nodes.get(row.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    this.sortCategoryTreeNodes(roots);
    return roots;
  }

  /** Sorts one category tree recursively by explicit order, then name, then stable ID. */
  private sortCategoryTreeNodes(items: CategoryTreeNodeResponse[]): void {
    items.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
    for (const item of items) this.sortCategoryTreeNodes(item.children);
  }

  /** Removes inactive category branches from the public/read-only hierarchy. */
  private filterActiveCategoryTree(
    nodes: CategoryTreeNodeResponse[],
  ): CategoryTreeNodeResponse[] {
    return nodes
      .filter((node) => node.status === CATALOG_STATUS.ACTIVE)
      .map((node) => ({
        ...node,
        children: this.filterActiveCategoryTree(node.children),
      }));
  }

  /** Converts one category row into the safe Module 5 response contract. */
  private toCategoryResponse(row: CategoryRow): CategoryResponse {
    return {
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      name: row.name,
      status: row.status as CategoryResponse["status"],
      sortOrder: row.sortOrder,
    };
  }

  /** Converts one brand row into the safe Module 5 response contract. */
  private toBrandResponse(row: BrandRow): BrandResponse {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status as BrandResponse["status"],
    };
  }

  /** Groups batched attribute values and returns deterministic safe attribute responses. */
  private toAttributeResponses(
    rows: AttributeRow[],
    values: AttributeValueRow[],
  ): AttributeResponse[] {
    const valuesByAttribute = new Map<string, AttributeValueRow[]>();
    for (const value of values) {
      const list = valuesByAttribute.get(value.attributeId) ?? [];
      list.push(value);
      valuesByAttribute.set(value.attributeId, list);
    }
    return rows.map((row) => this.toAttributeResponse(row, valuesByAttribute.get(row.id) ?? []));
  }

  /** Converts one attribute plus already-loaded values into the safe Module 5 response contract. */
  private toAttributeResponse(
    row: AttributeRow,
    values: AttributeValueRow[],
  ): AttributeResponse {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      dataType: row.dataType,
      isVariantAxis: row.isVariantAxis,
      status: row.status as AttributeResponse["status"],
      values: values.map((value) => this.toAttributeValueResponse(value)),
    };
  }

  /** Converts one attribute-value row into the safe nested response contract. */
  private toAttributeValueResponse(row: AttributeValueRow): AttributeValueResponse {
    return {
      id: row.id,
      attributeId: row.attributeId,
      value: row.value,
      sortOrder: row.sortOrder,
      status: row.status as AttributeValueResponse["status"],
    };
  }

  /** Converts one category-attribute persistence row into its safe response contract. */
  private toMappingResponse(row: CategoryAttributeRow): CategoryAttributeMappingResponse {
    return {
      categoryId: row.categoryId,
      attributeId: row.attributeId,
      isRequired: row.isRequired,
      isFilterable: row.isFilterable,
      sortOrder: row.sortOrder,
    };
  }

  /** Sorts mapping responses consistently for audit snapshots, tests, and later UI rendering. */
  private sortMappingResponses(
    rows: CategoryAttributeMappingResponse[],
  ): CategoryAttributeMappingResponse[] {
    return [...rows].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.attributeId.localeCompare(right.attributeId),
    );
  }

  /** Returns the stable category-not-found error required by Module 5. */
  private categoryNotFound(): AppError {
    return catalogError(
      CATALOG_ERROR_CODE.CATEGORY_NOT_FOUND,
      "Category not found.",
      404,
    );
  }

  /** Returns the stable hierarchy-cycle error required by Module 5. */
  private categoryCycle(): AppError {
    return catalogError(
      CATALOG_ERROR_CODE.CATEGORY_CYCLE,
      "The category parent would create a hierarchy cycle.",
      409,
    );
  }

  /** Returns the stable duplicate slug/code error required by Module 5. */
  private duplicateCatalogCode(): AppError {
    return catalogError(
      CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE,
      "A category slug, brand slug, or attribute code already exists.",
      409,
    );
  }

  /** Returns the stable invalid category-attribute error required by Module 5. */
  private attributeInvalidForCategory(): AppError {
    return catalogError(
      CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY,
      "The attribute definition is not valid for this category or variant-axis rule.",
      422,
    );
  }
}
