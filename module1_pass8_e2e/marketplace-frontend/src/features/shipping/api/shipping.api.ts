import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  customerShipmentTrackingSchema,
  sellerShipmentSchema,
} from "../schemas/shipping.schemas";
import type {
  CreateShipmentInput,
  PaginatedSellerShipments,
  SellerShipmentListParams,
  UpdateShipmentTrackingInput,
} from "../types/shipping.types";

/** Removes undefined query values before sending the allow-listed Shipment filters. */
function queryParams(value: SellerShipmentListParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Shipping response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one paginated seller Shipment response with defensive pagination metadata. */
async function list(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
): Promise<PaginatedSellerShipments> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const items = response.data.data.map((value) => sellerShipmentSchema.parse(value));
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

export const shippingApi = {
  /** Lists Shipments only inside the authenticated seller's server-derived scope. */
  listSellerShipments: (params: SellerShipmentListParams) =>
    list(apiClient.get("/seller/shipments", { params: queryParams(params) })),

  /** Creates one immutable Shipment allocation with an explicit retry key. */
  createShipment: (sellerOrderId: string, input: CreateShipmentInput, idempotencyKey: string) =>
    one(
      apiClient.post(`/seller/orders/${sellerOrderId}/shipments`, input, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => sellerShipmentSchema.parse(value),
    ),

  /** Updates carrier/tracking values without sending lifecycle status authority. */
  updateShipmentTracking: (shipmentId: string, input: UpdateShipmentTrackingInput) =>
    one(
      apiClient.patch(`/seller/shipments/${shipmentId}/tracking`, input),
      (value) => sellerShipmentSchema.parse(value),
    ),

  /** Marks a Shipment shipped with a retry-safe command key. */
  markShipmentShipped: (shipmentId: string, idempotencyKey: string) =>
    one(
      apiClient.post(`/seller/shipments/${shipmentId}/mark-shipped`, {}, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => sellerShipmentSchema.parse(value),
    ),

  /** Marks a shipped Shipment delivered with a retry-safe command key. */
  markShipmentDelivered: (shipmentId: string, idempotencyKey: string) =>
    one(
      apiClient.post(`/seller/shipments/${shipmentId}/mark-delivered`, {}, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => sellerShipmentSchema.parse(value),
    ),

  /** Reads only customer/admin-safe tracking rows for one authorized Customer Order. */
  getOrderShipments: (orderId: string) =>
    one(apiClient.get(`/orders/${orderId}/shipments`), (value) =>
      customerShipmentTrackingSchema.array().parse(value),
    ),
};
