import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  AdminCustomerDetail,
  AdminCustomerListItem,
  CustomerAddress,
  CustomerAddressWriteInput,
  CustomerListParams,
  CustomerProfile,
  CustomerProfileUpdateInput,
  PaginatedCustomers,
} from "../types/customers.types";

/** Removes undefined and empty query values before sending documented customer filters. */
function queryParams(value: CustomerListParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps one successful API envelope or throws its safe server message. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps one paginated customer response with a defensive pagination fallback. */
async function list(
  request: Promise<{ data: ApiResponse<AdminCustomerListItem[], PaginationMeta> }>,
): Promise<PaginatedCustomers> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);

  return {
    items: response.data.data,
    meta: response.data.meta ?? {
      page: 1,
      pageSize: response.data.data.length,
      totalItems: response.data.data.length,
      totalPages: response.data.data.length > 0 ? 1 : 0,
    },
  };
}

export const customersApi = {
  /** Reads the authenticated customer's commerce profile. */
  getMyProfile: () => one<CustomerProfile>(apiClient.get("/customers/me")),

  /** Updates only editable fields on the authenticated customer's profile. */
  updateMyProfile: (input: CustomerProfileUpdateInput) =>
    one<CustomerProfile>(apiClient.patch("/customers/me", input)),

  /** Lists active addresses owned by the authenticated customer. */
  listMyAddresses: () => one<CustomerAddress[]>(apiClient.get("/customers/me/addresses")),

  /** Creates one saved address owned by the authenticated customer. */
  createMyAddress: (input: CustomerAddressWriteInput) =>
    one<CustomerAddress>(apiClient.post("/customers/me/addresses", input)),

  /** Updates one saved address inside the authenticated customer's scope. */
  updateMyAddress: (id: string, input: Partial<CustomerAddressWriteInput>) =>
    one<CustomerAddress>(apiClient.patch(`/customers/me/addresses/${id}`, input)),

  /** Archives one saved address without deleting its history. */
  archiveMyAddress: (id: string) =>
    one<{ archived: true }>(apiClient.delete(`/customers/me/addresses/${id}`)),

  /** Searches customers using only the documented admin filters. */
  listCustomersForAdmin: (params: CustomerListParams) =>
    list(apiClient.get("/admin/customers", { params: queryParams(params) })),

  /** Reads one privileged customer detail using only Module 2 and Module 3 data. */
  getCustomerForAdmin: (id: string) =>
    one<AdminCustomerDetail>(apiClient.get(`/admin/customers/${id}`)),
};
