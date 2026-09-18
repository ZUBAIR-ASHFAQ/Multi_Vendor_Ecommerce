import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  AdminPromotionListParams,
  CreatePromotionInput,
  Promotion,
  PromotionValidation,
  UpdatePromotionInput,
} from "../schemas/promotions.schemas";

/** Removes unset Promotion query values before sending the documented request. */
function queryParams(value: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps one successful Promotions API envelope. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps one paginated Promotion response and requires standard pagination metadata. */
async function page<T>(
  request: Promise<{ data: ApiResponse<T[], PaginationMeta> }>,
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Promotion pagination metadata is missing.");
  return { items: response.data.data, meta: response.data.meta };
}

export const promotionsApi = {
  /** Lists platform-owned promotions for an authorized administrator. */
  listAdminPromotions: (params: AdminPromotionListParams) =>
    page<Promotion>(
      apiClient.get("/admin/promotions", { params: queryParams(params) }),
    ),

  /** Creates one platform-funded promotion. */
  createAdminPromotion: (input: CreatePromotionInput) =>
    one<Promotion>(apiClient.post("/admin/promotions", input)),

  /** Updates editable fields on one draft/scheduled platform promotion. */
  updateAdminPromotion: (promotionId: string, input: UpdatePromotionInput) =>
    one<Promotion>(apiClient.patch(`/admin/promotions/${promotionId}`, input)),

  /** Creates one seller-funded promotion using server-derived seller ownership. */
  createSellerPromotion: (input: CreatePromotionInput) =>
    one<Promotion>(apiClient.post("/seller/promotions", input)),

  /** Validates one normalized coupon against the authenticated customer's current Cart. */
  validateCoupon: (code: string) =>
    one<PromotionValidation>(apiClient.get("/promotions/validate", { params: { code } })),

  /** Activates or schedules one platform promotion through the explicit lifecycle command. */
  activateAdminPromotion: (promotionId: string) =>
    one<Promotion>(apiClient.post(`/admin/promotions/${promotionId}/activate`, {})),

  /** Deactivates one platform promotion without deleting historical configuration. */
  deactivateAdminPromotion: (promotionId: string) =>
    one<Promotion>(apiClient.post(`/admin/promotions/${promotionId}/deactivate`, {})),
};
