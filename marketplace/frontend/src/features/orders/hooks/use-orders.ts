import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ordersApi } from "../api/orders.api";
import type {
  AdminOrdersParams,
  CancelOrderInput,
  CustomerOrdersParams,
  SellerOrdersParams,
} from "../types/orders.types";
import { ordersQueryKeys } from "./orders.query-keys";

/** Loads one page of the current customer's parent Order history. */
export function useCustomerOrdersQuery(
  params: CustomerOrdersParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ordersQueryKeys.customerList(params),
    queryFn: () => ordersApi.listCustomerOrders(params),
    enabled,
    retry: false,
  });
}

/** Loads one customer-owned Order detail and immutable timeline. */
export function useCustomerOrderDetailQuery(
  orderId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ordersQueryKeys.customerDetail(orderId),
    queryFn: () => ordersApi.getCustomerOrder(orderId),
    enabled,
    retry: false,
  });
}

/** Applies one customer cancellation and refreshes parent Order reads. */
export function useCancelCustomerOrderMutation(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (value: {
      input: CancelOrderInput;
      idempotencyKey: string;
    }) =>
      ordersApi.cancelCustomerOrder(
        orderId,
        value.input,
        value.idempotencyKey,
      ),
    onSuccess: async (order) => {
      queryClient.setQueryData(
        ordersQueryKeys.customerDetail(orderId),
        order,
      );
      await queryClient.invalidateQueries({
        queryKey: ["orders", "customer", "list"],
      });
    },
  });
}

/** Loads the seller-scoped Seller Order queue. */
export function useSellerOrdersQuery(
  params: SellerOrdersParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ordersQueryKeys.sellerList(params),
    queryFn: () => ordersApi.listSellerOrders(params),
    enabled,
    retry: false,
  });
}

/** Loads one Seller Order only from the actor's server-derived scope. */
export function useSellerOrderDetailQuery(
  sellerOrderId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ordersQueryKeys.sellerDetail(sellerOrderId),
    queryFn: () => ordersApi.getSellerOrder(sellerOrderId),
    enabled,
    retry: false,
  });
}

/** Accepts one Seller Order and refreshes seller queue/detail state. */
export function useAcceptSellerOrderMutation(sellerOrderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => ordersApi.acceptSellerOrder(sellerOrderId),
    onSuccess: async (order) => {
      queryClient.setQueryData(
        ordersQueryKeys.sellerDetail(sellerOrderId),
        order,
      );
      await queryClient.invalidateQueries({
        queryKey: ["orders", "seller", "list"],
      });
    },
  });
}

/** Loads one permission-protected page of parent Orders for support/admin users. */
export function useAdminOrdersQuery(
  params: AdminOrdersParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ordersQueryKeys.adminList(params),
    queryFn: () => ordersApi.listAdminOrders(params),
    enabled,
    retry: false,
  });
}

/** Applies one privileged whole-Order cancellation and refreshes the admin search. */
export function useCancelAdminOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (value: {
      orderId: string;
      input: CancelOrderInput;
      idempotencyKey: string;
    }) =>
      ordersApi.cancelAdminOrder(
        value.orderId,
        value.input,
        value.idempotencyKey,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["orders", "admin", "list"],
      });
    },
  });
}
