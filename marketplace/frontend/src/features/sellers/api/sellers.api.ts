import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  ApproveSellerApplicationResponse,
  CreateStoreInput,
  MySeller,
  PaginatedSellerApplications,
  PublicStore,
  Seller,
  SellerApplication,
  SellerApplicationListParams,
  SellerStore,
  SubmitSellerApplicationInput,
  UpdateSellerProfileInput,
  UpdateStoreInput,
} from "../types/sellers.types";

/** Removes undefined query values before sending documented seller-application filters. */
function queryParams(value: SellerApplicationListParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps one successful API envelope while preserving normalized interceptor errors. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps a paginated seller-application response and rejects malformed missing metadata. */
async function applicationPage(
  request: Promise<{ data: ApiResponse<SellerApplication[], PaginationMeta> }>,
): Promise<PaginatedSellerApplications> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) {
    throw new Error("Seller application pagination metadata is missing.");
  }
  return { items: response.data.data, meta: response.data.meta };
}

export const sellersApi = {
  /** Submits one seller application for the authenticated customer actor. */
  submitApplication: (input: SubmitSellerApplicationInput) =>
    one<SellerApplication>(apiClient.post("/sellers/applications", input)),

  /** Lists the privileged seller-application review queue with bounded filters. */
  listApplications: (params: SellerApplicationListParams) =>
    applicationPage(
      apiClient.get("/admin/seller-applications", { params: queryParams(params) }),
    ),

  /** Approves one submitted seller application without client-owned approval fields. */
  approveApplication: (id: string) =>
    one<ApproveSellerApplicationResponse>(
      apiClient.post(`/admin/seller-applications/${id}/approve`, {}),
    ),

  /** Rejects one submitted seller application with an explicit review reason. */
  rejectApplication: (id: string, reason: string) =>
    one<SellerApplication>(
      apiClient.post(`/admin/seller-applications/${id}/reject`, { reason }),
    ),

  /** Reads the authenticated seller master, stores, and staff summary. */
  getMySeller: () => one<MySeller>(apiClient.get("/sellers/me")),

  /** Updates only editable fields on the authenticated seller master. */
  updateMySeller: (input: UpdateSellerProfileInput) =>
    one<Seller>(apiClient.patch("/sellers/me", input)),

  /** Creates one store inside the current server-derived seller scope. */
  createStore: (input: CreateStoreInput) =>
    one<SellerStore>(apiClient.post("/sellers/me/stores", input)),

  /** Updates one store inside the current server-derived seller scope. */
  updateStore: (id: string, input: UpdateStoreInput) =>
    one<SellerStore>(apiClient.patch(`/sellers/me/stores/${id}`, input)),

  /** Reads one public-safe active store by its normalized slug. */
  getPublicStore: (slug: string) =>
    one<PublicStore>(apiClient.get(`/stores/${encodeURIComponent(slug)}`)),

  /** Suspends one approved seller through the privileged Module 4 lifecycle command. */
  suspendSeller: (id: string, reason?: string) =>
    one<Seller>(
      apiClient.post(`/admin/sellers/${id}/suspend`, reason ? { reason } : {}),
    ),
};
