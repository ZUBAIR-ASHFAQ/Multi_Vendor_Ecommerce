import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersApi } from "../api/customers.api";
import type {
  CustomerAddressWriteInput,
  CustomerListParams,
  CustomerProfileUpdateInput,
} from "../types/customers.types";
import { customerQueryKeys } from "./customers.query-keys";

/** Loads the authenticated customer's commerce profile when the page is authorized. */
export function useCustomerProfileQuery(enabled = true) {
  return useQuery({
    queryKey: customerQueryKeys.profile,
    queryFn: customersApi.getMyProfile,
    enabled,
  });
}

/** Updates the current customer profile and refreshes its cached server state. */
export function useUpdateCustomerProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerProfileUpdateInput) => customersApi.updateMyProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(customerQueryKeys.profile, profile);
    },
  });
}

/** Loads active addresses owned by the authenticated customer. */
export function useCustomerAddressesQuery(enabled = true) {
  return useQuery({
    queryKey: customerQueryKeys.addresses,
    queryFn: customersApi.listMyAddresses,
    enabled,
  });
}

/** Creates one address and refreshes the current customer's address list. */
export function useCreateCustomerAddressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerAddressWriteInput) => customersApi.createMyAddress(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.addresses });
    },
  });
}

/** Updates one customer-owned address and refreshes the address list. */
export function useUpdateCustomerAddressMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CustomerAddressWriteInput>) => customersApi.updateMyAddress(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.addresses });
    },
  });
}

/** Archives one customer-owned address and refreshes the active list. */
export function useArchiveCustomerAddressMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => customersApi.archiveMyAddress(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.addresses });
    },
  });
}

/** Loads one permission-protected page of customers for administrators. */
export function useAdminCustomersQuery(params: CustomerListParams, enabled = true) {
  return useQuery({
    queryKey: customerQueryKeys.adminList(params),
    queryFn: () => customersApi.listCustomersForAdmin(params),
    enabled,
  });
}

/** Loads one permission-protected customer detail record for administrators. */
export function useAdminCustomerDetailQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: customerQueryKeys.adminDetail(id),
    queryFn: () => customersApi.getCustomerForAdmin(id),
    enabled,
  });
}
