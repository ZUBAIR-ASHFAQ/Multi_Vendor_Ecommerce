import type { PaginationMeta } from "@/types/api";
import type {
  AdminPaymentDetail,
  AdminPaymentListItem,
  CustomerPayment,
  PaymentIntent,
  PaymentStatus,
  PaymentTransaction,
} from "../schemas/payments.schemas";

/** Allow-listed finance query parameters supported by GET /admin/payments. */
export interface AdminPaymentsParams {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  provider?: "stripe";
  orderId?: string;
  providerPaymentId?: string;
  currency?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}

/** One paginated finance Payment search response. */
export interface PaginatedAdminPayments {
  items: AdminPaymentListItem[];
  meta: PaginationMeta;
}

export type {
  AdminPaymentDetail,
  AdminPaymentListItem,
  CustomerPayment,
  PaymentIntent,
  PaymentStatus,
  PaymentTransaction,
};
