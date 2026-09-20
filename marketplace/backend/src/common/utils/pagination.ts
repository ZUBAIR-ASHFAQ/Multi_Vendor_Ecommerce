import type { PaginationMeta, PaginationQuery } from "../schemas/pagination.schema.js";

/** Converts validated page pagination into SQL limit/offset values. */
export function toLimitOffset(query: PaginationQuery): { limit: number; offset: number } {
  return {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
}

/** Builds deterministic pagination metadata from a validated query and total row count. */
export function paginationMeta(query: PaginationQuery, totalItems: number): PaginationMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
  };
}
