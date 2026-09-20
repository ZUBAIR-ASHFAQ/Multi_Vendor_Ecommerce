import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { paymentsApi } from "../api/payments.api";
import { PAYMENT_ACTIVE_STATUS } from "../payments.constants";
import type { AdminPaymentsParams } from "../types/payments.types";
import { paymentsQueryKeys } from "./payments.query-keys";

/** Creates/reuses one PaymentIntent while keeping the customer retry key explicit at the call site. */
export function useCreatePaymentIntentMutation(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idempotencyKey: string) => paymentsApi.createIntent(orderId, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: paymentsQueryKeys.customerStatus(orderId),
      });
    },
  });
}

/** Loads provider-authoritative customer Payment state and polls only while it can still change. */
export function useCustomerPaymentStatusQuery(orderId: string, enabled = true) {
  return useQuery({
    queryKey: paymentsQueryKeys.customerStatus(orderId),
    queryFn: () => paymentsApi.getCustomerStatus(orderId),
    enabled: enabled && orderId.length > 0,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && PAYMENT_ACTIVE_STATUS.includes(status as (typeof PAYMENT_ACTIVE_STATUS)[number])
        ? 2_000
        : false;
    },
  });
}

/** Loads one permission-protected page of finance Payment summaries. */
export function useAdminPaymentsQuery(params: AdminPaymentsParams, enabled = true) {
  return useQuery({
    queryKey: paymentsQueryKeys.adminList(params),
    queryFn: () => paymentsApi.listAdminPayments(params),
    enabled,
    retry: false,
  });
}

/** Loads one permission-protected Payment detail and transaction timeline. */
export function useAdminPaymentDetailQuery(paymentId: string, enabled = true) {
  return useQuery({
    queryKey: paymentsQueryKeys.adminDetail(paymentId),
    queryFn: () => paymentsApi.getAdminPaymentDetail(paymentId),
    enabled: enabled && paymentId.length > 0,
    retry: false,
  });
}
