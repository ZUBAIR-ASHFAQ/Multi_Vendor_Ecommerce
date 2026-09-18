import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  customerOrderDetailSchema,
  customerOrderSummarySchema,
  sellerOrderDetailSchema,
  sellerOrderListItemSchema,
} from "../schemas/orders.schemas";
import type {
  AdminOrdersParams,
  CancelOrderInput,
  CustomerOrdersParams,
  PaginatedAdminOrders,
  PaginatedCustomerOrders,
  PaginatedSellerOrders,
  SellerOrdersParams,
} from "../types/orders.types";

/** Removes undefined and blank query values so only documented Order filters reach the API. */
function queryParams<T extends object>(value: T): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Order response. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>, parse: (value: unknown) => T): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one paginated Order response with a defensive metadata fallback. */
async function list<T>(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
  parseItem: (value: unknown) => T,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const items = response.data.data.map(parseItem);
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

export const ordersApi = {
  /** Lists only the authenticated customer's parent Orders. */
  listCustomerOrders: (params: CustomerOrdersParams): Promise<PaginatedCustomerOrders> =>
    list(apiClient.get("/orders", { params: queryParams(params) }), (value) => customerOrderSummarySchema.parse(value)),

  /** Reads one customer-owned parent Order including immutable Seller Order groups and timeline. */
  getCustomerOrder: (orderId: string) =>
    one(apiClient.get(`/orders/${orderId}`), (value) => customerOrderDetailSchema.parse(value)),

  /** Cancels all or one selected Order Item quantity with an explicit idempotency key. */
  cancelCustomerOrder: (orderId: string, input: CancelOrderInput, idempotencyKey: string) =>
    one(
      apiClient.post(`/orders/${orderId}/cancel`, input, { headers: { "Idempotency-Key": idempotencyKey } }),
      (value) => customerOrderDetailSchema.parse(value),
    ),

  /** Lists Seller Orders inside the authenticated actor's server-derived seller/store scope. */
  listSellerOrders: (params: SellerOrdersParams): Promise<PaginatedSellerOrders> =>
    list(apiClient.get("/seller/orders", { params: queryParams(params) }), (value) => sellerOrderListItemSchema.parse(value)),

  /** Reads one Seller Order only when it is inside the actor's seller/store scope. */
  getSellerOrder: (sellerOrderId: string) =>
    one(apiClient.get(`/seller/orders/${sellerOrderId}`), (value) => sellerOrderDetailSchema.parse(value)),

  /** Accepts one provider-paid Seller Order; no client lifecycle state is submitted. */
  acceptSellerOrder: (sellerOrderId: string) =>
    one(apiClient.post(`/seller/orders/${sellerOrderId}/accept`, {}), (value) => sellerOrderDetailSchema.parse(value)),

  /** Searches parent Orders through the privileged support/admin read surface. */
  listAdminOrders: (params: AdminOrdersParams): Promise<PaginatedAdminOrders> =>
    list(apiClient.get("/admin/orders", { params: queryParams(params) }), (value) => customerOrderSummarySchema.parse(value)),

  /** Performs a privileged whole-Order cancellation using the same idempotent command contract. */
  cancelAdminOrder: (orderId: string, input: CancelOrderInput, idempotencyKey: string) =>
    one(
      apiClient.post(`/admin/orders/${orderId}/cancel`, input, { headers: { "Idempotency-Key": idempotencyKey } }),
      (value) => customerOrderDetailSchema.parse(value),
    ),
};
