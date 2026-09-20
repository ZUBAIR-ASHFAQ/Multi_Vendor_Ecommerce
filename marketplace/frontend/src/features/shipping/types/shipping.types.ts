import type { PaginationMeta } from "@/types/api";
import type {
  CustomerShipmentTracking,
  SellerShipment,
} from "../schemas/shipping.schemas";

export interface SellerShipmentListParams {
  page: number;
  pageSize: number;
  sellerOrderId?: string;
  status?: "created" | "shipped" | "delivered";
  sort?: "createdAt" | "shipmentNo";
  order?: "asc" | "desc";
}

export interface CreateShipmentInput {
  items: Array<{ orderItemId: string; quantity: number }>;
}

export interface UpdateShipmentTrackingInput {
  carrier: string;
  trackingNo: string;
  serviceLevel?: string | null;
}

export interface PaginatedSellerShipments {
  items: SellerShipment[];
  meta: PaginationMeta;
}

export type { CustomerShipmentTracking, SellerShipment };
