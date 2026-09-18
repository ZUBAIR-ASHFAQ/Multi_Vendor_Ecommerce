import type { PaginationMeta } from "@/types/api";
import type {
  ReturnRefundResult,
  ReturnRequest,
  ReturnStatusHistory,
} from "../schemas/returns-refunds.schemas";

export interface ReturnListParams {
  page: number;
  pageSize: number;
  status?: "requested" | "approved" | "rejected" | "received" | "closed";
  orderId?: string;
  requestedFrom?: string;
  requestedTo?: string;
  sort?: "requestedAt" | "returnNo";
  order?: "asc" | "desc";
}

export interface SellerReturnListParams extends ReturnListParams {
  sellerOrderId?: string;
}

export interface AdminReturnListParams extends SellerReturnListParams {
  customerUserId?: string;
  sellerId?: string;
}

export interface CreateReturnRequestInput {
  sellerOrderId: string;
  reasonCode: "damaged" | "defective" | "wrong_item" | "not_as_described" | "changed_mind" | "other";
  items: Array<{ orderItemId: string; quantity: number }>;
}

export interface ApproveReturnInput {
  note?: string;
}

export interface RejectReturnInput {
  reason: string;
}

export interface ReceiveReturnInput {
  items: Array<{
    returnItemId: string;
    itemCondition: "unopened" | "opened" | "damaged" | "defective" | "other";
    resolution: "refund_restock" | "refund_no_restock";
  }>;
  note?: string;
}

export interface IssueReturnRefundInput {
  note?: string;
}

export interface PaginatedReturns {
  items: ReturnRequest[];
  meta: PaginationMeta;
}

export type { ReturnRefundResult, ReturnRequest, ReturnStatusHistory };
