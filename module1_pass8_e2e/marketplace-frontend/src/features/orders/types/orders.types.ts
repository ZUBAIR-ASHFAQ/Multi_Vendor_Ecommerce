import type { PaginationMeta } from "@/types/api";
import type {
  CustomerOrderDetail,
  CustomerOrderSummary,
  SellerOrderDetail,
  SellerOrderListItem,
} from "../schemas/orders.schemas";

export interface CustomerOrdersParams {
  page: number;
  pageSize: number;
  orderStatus?: "pending_payment" | "confirmed" | "processing" | "cancelled";
  sort?: "createdAt" | "orderNo";
  order?: "asc" | "desc";
}

export interface SellerOrdersParams {
  page: number;
  pageSize: number;
  storeId?: string;
  status?: "pending_payment" | "pending_acceptance" | "processing" | "cancelled";
  sort?: "createdAt" | "sellerOrderNo";
  order?: "asc" | "desc";
}

export interface AdminOrdersParams extends CustomerOrdersParams {
  orderNo?: string;
  customerUserId?: string;
  sellerId?: string;
  storeId?: string;
  paymentStatus?: "pending" | "captured";
  createdFrom?: string;
  createdTo?: string;
}

export interface CancelOrderInput {
  items?: Array<{ orderItemId: string; quantity: number }>;
  reason?: string;
}

export interface PaginatedCustomerOrders {
  items: CustomerOrderSummary[];
  meta: PaginationMeta;
}

export interface PaginatedSellerOrders {
  items: SellerOrderListItem[];
  meta: PaginationMeta;
}

export interface PaginatedAdminOrders {
  items: CustomerOrderSummary[];
  meta: PaginationMeta;
}

export type { CustomerOrderDetail, SellerOrderDetail };
