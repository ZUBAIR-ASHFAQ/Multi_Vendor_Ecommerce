import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  returnRefundResultSchema,
  returnRequestSchema,
} from "../schemas/returns-refunds.schemas";
import type {
  AdminReturnListParams,
  ApproveReturnInput,
  CreateReturnRequestInput,
  IssueReturnRefundInput,
  PaginatedReturns,
  RejectReturnInput,
  ReturnListParams,
  SellerReturnListParams,
  ReceiveReturnInput,
} from "../types/returns-refunds.types";

/** Removes undefined and blank query values before sending allow-listed Return filters. */
function queryParams(value: object): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Module 14 response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one paginated Return list with defensive pagination metadata. */
async function list(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
): Promise<PaginatedReturns> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const items = response.data.data.map((value) => returnRequestSchema.parse(value));
  return {
    items,
    meta: response.data.meta ?? {
      page: 1,
      pageSize: items.length,
      totalItems: items.length,
      totalPages: items.length > 0 ? 1 : 0,
    },
  };
}

export const returnsRefundsApi = {
  /** Creates one customer-owned Return Request; eligibility remains server-authoritative. */
  createReturnRequest: (orderId: string, input: CreateReturnRequestInput) =>
    one(
      apiClient.post(`/orders/${orderId}/returns`, input),
      (value) => returnRequestSchema.parse(value),
    ),

  /** Lists only Return Requests owned by the authenticated customer. */
  listCustomerReturns: (params: ReturnListParams) =>
    list(apiClient.get("/returns", { params: queryParams(params) })),

  /** Lists only Return Requests inside the authenticated seller/store scope. */
  listSellerReturns: (params: SellerReturnListParams) =>
    list(apiClient.get("/seller/returns", { params: queryParams(params) })),

  /** Approves one seller-scoped requested Return. */
  approveReturn: (returnId: string, input: ApproveReturnInput) =>
    one(
      apiClient.post(`/seller/returns/${returnId}/approve`, input),
      (value) => returnRequestSchema.parse(value),
    ),

  /** Rejects one seller-scoped requested Return with an explicit reason. */
  rejectReturn: (returnId: string, input: RejectReturnInput) =>
    one(
      apiClient.post(`/seller/returns/${returnId}/reject`, input),
      (value) => returnRequestSchema.parse(value),
    ),

  /** Records physical receipt/inspection without accepting browser-owned refund or restock amounts. */
  receiveReturn: (returnId: string, input: ReceiveReturnInput) =>
    one(
      apiClient.post(`/seller/returns/${returnId}/receive`, input),
      (value) => returnRequestSchema.parse(value),
    ),

  /** Lists Returns for the authorized platform support/admin scope. */
  listAdminReturns: (params: AdminReturnListParams) =>
    list(apiClient.get("/admin/returns", { params: queryParams(params) })),

  /** Issues the provider-authoritative refund with a retry-safe Foundation idempotency key. */
  issueRefund: (returnId: string, input: IssueReturnRefundInput, idempotencyKey: string) =>
    one(
      apiClient.post(`/returns/${returnId}/refund`, input, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => returnRefundResultSchema.parse(value),
    ),
};
