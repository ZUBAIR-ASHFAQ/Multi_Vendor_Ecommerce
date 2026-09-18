import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commissionsApi } from "../api/commissions.api";
import type {
  AdminCommissionEntriesParams,
  AdminCommissionRulesParams,
  CreateCommissionRuleInput,
  SellerCommissionStatementParams,
  UpdateCommissionRuleInput,
} from "../types/commissions.types";
import { commissionsQueryKeys } from "./commissions.query-keys";

/** Loads one permission-protected page of Commission rules. */
export function useCommissionRulesQuery(params: AdminCommissionRulesParams, enabled = true) {
  return useQuery({
    queryKey: commissionsQueryKeys.rules(params),
    queryFn: () => commissionsApi.listRules(params),
    enabled,
    retry: false,
  });
}

/** Creates one Commission rule and refreshes all admin Commission reads. */
export function useCreateCommissionRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommissionRuleInput) => commissionsApi.createRule(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: commissionsQueryKeys.admin });
    },
  });
}

/** Updates one future-effective rule and refreshes admin Commission reads. */
export function useUpdateCommissionRuleMutation(ruleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCommissionRuleInput) => commissionsApi.updateRule(ruleId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: commissionsQueryKeys.admin });
    },
  });
}

/** Loads the authenticated seller's own statement; seller identity never comes from browser input. */
export function useSellerCommissionStatementQuery(
  params: SellerCommissionStatementParams,
  enabled = true,
) {
  return useQuery({
    queryKey: commissionsQueryKeys.sellerStatement(params),
    queryFn: () => commissionsApi.getSellerStatement(params),
    enabled,
    retry: false,
  });
}

/** Loads one permission-protected page of the immutable finance Commission ledger. */
export function useAdminCommissionEntriesQuery(
  params: AdminCommissionEntriesParams,
  enabled = true,
) {
  return useQuery({
    queryKey: commissionsQueryKeys.adminEntries(params),
    queryFn: () => commissionsApi.listAdminEntries(params),
    enabled,
    retry: false,
  });
}
