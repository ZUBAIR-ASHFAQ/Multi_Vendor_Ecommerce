import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  adminPaymentDetailSchema,
  adminPaymentListItemSchema,
  customerPaymentSchema,
  paymentIntentSchema,
} from "../schemas/payments.schemas";
import type {
  AdminPaymentDetail,
  AdminPaymentsParams,
  CustomerPayment,
  PaginatedAdminPayments,
  PaymentIntent,
} from "../types/payments.types";

/** Removes blank/undefined values so only documented Payment filters reach the API. */
function queryParams(value: AdminPaymentsParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Payments response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one paginated Payment response and validates every finance row. */
async function list(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
): Promise<PaginatedAdminPayments> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const items = response.data.data.map((value) => adminPaymentListItemSchema.parse(value));

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

export const paymentsApi = {
  /** Creates or reuses one customer-owned Stripe PaymentIntent with an explicit retry key. */
  createIntent: (orderId: string, idempotencyKey: string): Promise<PaymentIntent> =>
    one(
      apiClient.post(
        `/payments/order/${orderId}/intent`,
        {},
        { headers: { "Idempotency-Key": idempotencyKey } },
      ),
      (value) => paymentIntentSchema.parse(value),
    ),

  /** Reads provider-authoritative Payment state for the authenticated customer's Order. */
  getCustomerStatus: (orderId: string): Promise<CustomerPayment> =>
    one(apiClient.get(`/payments/order/${orderId}`), (value) => customerPaymentSchema.parse(value)),

  /** Searches safe Payment summaries through the finance-admin API. */
  listAdminPayments: (params: AdminPaymentsParams): Promise<PaginatedAdminPayments> =>
    list(apiClient.get("/admin/payments", { params: queryParams(params) })),

  /** Reads one finance Payment detail with its append-only transaction timeline. */
  getAdminPaymentDetail: (paymentId: string): Promise<AdminPaymentDetail> =>
    one(apiClient.get(`/admin/payments/${paymentId}`), (value) => adminPaymentDetailSchema.parse(value)),
};
