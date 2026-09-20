import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shippingApi } from "../api/shipping.api";
import { shippingQueryKeys } from "./shipping.query-keys";
import type {
  CreateShipmentInput,
  SellerShipmentListParams,
  UpdateShipmentTrackingInput,
} from "../types/shipping.types";

/** Loads a permission-protected seller Shipment queue page. */
export function useSellerShipmentsQuery(params: SellerShipmentListParams, enabled = true) {
  return useQuery({
    queryKey: shippingQueryKeys.sellerList(params),
    queryFn: () => shippingApi.listSellerShipments(params),
    enabled,
    retry: false,
  });
}

/** Loads customer/admin-safe tracking for one authorized parent Order. */
export function useOrderShipmentsQuery(orderId: string, enabled = true) {
  return useQuery({
    queryKey: shippingQueryKeys.orderTracking(orderId),
    queryFn: () => shippingApi.getOrderShipments(orderId),
    enabled: enabled && Boolean(orderId),
    retry: false,
  });
}

/** Creates one Shipment and refreshes every seller Shipment list that could contain it. */
export function useCreateShipmentMutation(sellerOrderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (value: { input: CreateShipmentInput; idempotencyKey: string }) =>
      shippingApi.createShipment(sellerOrderId, value.input, value.idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["shipping", "seller", "list"] });
    },
  });
}

/** Saves normalized tracking values and refreshes seller/customer Shipment views. */
export function useUpdateShipmentTrackingMutation(shipmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateShipmentTrackingInput) =>
      shippingApi.updateShipmentTracking(shipmentId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shippingQueryKeys.all });
    },
  });
}

/** Executes the server-owned mark-shipped transition and refreshes Shipping plus Order state. */
export function useMarkShipmentShippedMutation(shipmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      shippingApi.markShipmentShipped(shipmentId, idempotencyKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shippingQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
  });
}

/** Executes the server-owned delivered transition and refreshes Shipping plus Order state. */
export function useMarkShipmentDeliveredMutation(shipmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      shippingApi.markShipmentDelivered(shipmentId, idempotencyKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shippingQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
  });
}
