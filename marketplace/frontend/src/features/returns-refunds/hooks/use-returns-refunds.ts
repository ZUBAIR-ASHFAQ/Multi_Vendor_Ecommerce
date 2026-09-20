import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { returnsRefundsApi } from "../api/returns-refunds.api";
import type {
  AdminReturnListParams,
  ApproveReturnInput,
  CreateReturnRequestInput,
  IssueReturnRefundInput,
  ReceiveReturnInput,
  RejectReturnInput,
  ReturnListParams,
  SellerReturnListParams,
} from "../types/returns-refunds.types";
import { returnsRefundsQueryKeys } from "./returns-refunds.query-keys";

/** Loads one page of the current customer's own Return Requests. */
export function useCustomerReturnsQuery(params: ReturnListParams, enabled = true) {
  return useQuery({
    queryKey: returnsRefundsQueryKeys.customerList(params),
    queryFn: () => returnsRefundsApi.listCustomerReturns(params),
    enabled,
    retry: false,
  });
}

/** Loads one seller-scoped Return queue page. */
export function useSellerReturnsQuery(params: SellerReturnListParams, enabled = true) {
  return useQuery({
    queryKey: returnsRefundsQueryKeys.sellerList(params),
    queryFn: () => returnsRefundsApi.listSellerReturns(params),
    enabled,
    retry: false,
  });
}

/** Loads one admin/support Return search page. */
export function useAdminReturnsQuery(params: AdminReturnListParams, enabled = true) {
  return useQuery({
    queryKey: returnsRefundsQueryKeys.adminList(params),
    queryFn: () => returnsRefundsApi.listAdminReturns(params),
    enabled,
    retry: false,
  });
}

/** Creates one Return Request and refreshes customer Order/Return reads. */
export function useCreateReturnRequestMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReturnRequestInput) => returnsRefundsApi.createReturnRequest(orderId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: returnsRefundsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["orders", "customer"] }),
      ]);
    },
  });
}

/** Approves one Return through the explicit seller command. */
export function useApproveReturnMutation(returnId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApproveReturnInput) => returnsRefundsApi.approveReturn(returnId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: returnsRefundsQueryKeys.all }),
  });
}

/** Rejects one Return through the explicit seller command. */
export function useRejectReturnMutation(returnId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RejectReturnInput) => returnsRefundsApi.rejectReturn(returnId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: returnsRefundsQueryKeys.all }),
  });
}

/** Records seller receipt/inspection decisions and refreshes every Return projection. */
export function useReceiveReturnMutation(returnId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveReturnInput) => returnsRefundsApi.receiveReturn(returnId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: returnsRefundsQueryKeys.all }),
  });
}

/** Issues the provider-authoritative refund and refreshes Return, Order, and Commission projections. */
export function useIssueReturnRefundMutation(returnId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: { input: IssueReturnRefundInput; idempotencyKey: string }) =>
      returnsRefundsApi.issueRefund(returnId, value.input, value.idempotencyKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: returnsRefundsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["commissions"] }),
      ]);
    },
  });
}
