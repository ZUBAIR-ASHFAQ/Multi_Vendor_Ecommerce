import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  commissionEntrySchema,
  commissionRuleSchema,
  sellerCommissionStatementSchema,
} from "../schemas/commissions.schemas";
import type {
  AdminCommissionEntriesParams,
  AdminCommissionRulesParams,
  CreateCommissionRuleInput,
  PaginatedCommissionEntries,
  PaginatedCommissionRules,
  PaginatedSellerCommissionStatement,
  SellerCommissionStatementParams,
  UpdateCommissionRuleInput,
} from "../types/commissions.types";

/** Removes blank and undefined values so only documented Commission filters reach the API. */
function queryParams(value: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Commission response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one paginated list and requires the standard pagination metadata. */
async function page<T>(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
  parse: (value: unknown) => T,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Commission pagination metadata is missing.");
  return { items: response.data.data.map(parse), meta: response.data.meta };
}

export const commissionsApi = {
  /** Lists platform Commission rules through the admin read endpoint. */
  listRules: async (params: AdminCommissionRulesParams): Promise<PaginatedCommissionRules> =>
    page(
      apiClient.get("/admin/commissions/rules", { params: queryParams(params) }),
      (value) => commissionRuleSchema.parse(value),
    ),

  /** Creates one effective-dated Commission rule through the documented admin command. */
  createRule: (input: CreateCommissionRuleInput) =>
    one(apiClient.post("/admin/commissions/rules", input), (value) => commissionRuleSchema.parse(value)),

  /** Updates one future-effective Commission rule without touching historical snapshots. */
  updateRule: (ruleId: string, input: UpdateCommissionRuleInput) =>
    one(apiClient.patch(`/admin/commissions/rules/${ruleId}`, input), (value) => commissionRuleSchema.parse(value)),

  /** Reads only the authenticated seller's own Commission statement. */
  getSellerStatement: async (
    params: SellerCommissionStatementParams,
  ): Promise<PaginatedSellerCommissionStatement> => {
    const response = await apiClient.get<ApiResponse<unknown, PaginationMeta>>("/seller/commissions", {
      params: queryParams(params),
    });
    if (!response.data.success) throw new Error(response.data.error.message);
    if (!response.data.meta) throw new Error("Seller Commission pagination metadata is missing.");
    return {
      statement: sellerCommissionStatementSchema.parse(response.data.data),
      meta: response.data.meta,
    };
  },

  /** Lists the immutable finance Commission ledger for an authorized administrator. */
  listAdminEntries: async (
    params: AdminCommissionEntriesParams,
  ): Promise<PaginatedCommissionEntries> =>
    page(
      apiClient.get("/admin/commissions/entries", { params: queryParams(params) }),
      (value) => commissionEntrySchema.parse(value),
    ),
};
