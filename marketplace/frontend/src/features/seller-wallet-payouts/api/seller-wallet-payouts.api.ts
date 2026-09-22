import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  payoutAccountSchema,
  payoutSchema,
  sellerWalletResponseSchema,
} from "../schemas/seller-wallet-payouts.schemas";
import type {
  AdminPayoutListParams,
  CreatePayoutAccountInput,
  PaginatedPayouts,
  PaginatedWallet,
  RequestPayoutInput,
  SellerPayoutListParams,
  SellerWalletParams,
} from "../types/seller-wallet-payouts.types";

/** Removes undefined/blank values before sending allow-listed Wallet/Payout filters. */
function queryParams(value: object): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful non-paginated Module 17 response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Returns safe pagination metadata even if a test fixture omits optional response meta. */
function paginationMeta(meta: PaginationMeta | undefined, itemCount: number): PaginationMeta {
  return meta ?? {
    page: 1,
    pageSize: itemCount,
    totalItems: itemCount,
    totalPages: itemCount > 0 ? 1 : 0,
  };
}

/** Unwraps the seller Wallet response and its ledger pagination metadata. */
async function wallet(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
): Promise<PaginatedWallet> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const parsed = sellerWalletResponseSchema.parse(response.data.data);
  return { wallet: parsed, meta: paginationMeta(response.data.meta, parsed.entries.length) };
}

/** Unwraps one seller/admin Payout page and validates every safe Payout projection. */
async function payouts(
  request: Promise<{ data: ApiResponse<unknown[], PaginationMeta> }>,
): Promise<PaginatedPayouts> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  const items = response.data.data.map((value) => payoutSchema.parse(value));
  return { items, meta: paginationMeta(response.data.meta, items.length) };
}

export const sellerWalletPayoutsApi = {
  /** Reads only the authenticated seller's server-derived Wallet snapshots, ledger, and safe payout accounts. */
  getSellerWallet: (params: SellerWalletParams) =>
    wallet(apiClient.get("/seller/wallet", { params: queryParams(params) })),

  /** Reads only Payout history owned by the authenticated seller scope. */
  listSellerPayouts: (params: SellerPayoutListParams) =>
    payouts(apiClient.get("/seller/payouts", { params: queryParams(params) })),

  /** Requests one Payout using the caller-owned retry-stable Foundation idempotency key. */
  requestPayout: (input: RequestPayoutInput, idempotencyKey: string) =>
    one(
      apiClient.post("/seller/payouts", input, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => payoutSchema.parse(value),
    ),

  /** Stores one provider-owned/tokenized payout destination without exposing raw financial account fields. */
  createPayoutAccount: (input: CreatePayoutAccountInput) =>
    one(apiClient.post("/seller/payout-accounts", input), (value) => payoutAccountSchema.parse(value)),

  /** Reads the finance Payout queue using only documented filters. */
  listAdminPayouts: (params: AdminPayoutListParams) =>
    payouts(apiClient.get("/admin/payouts", { params: queryParams(params) })),

  /** Approves and reserves one requested Payout with a retry-safe key. */
  approvePayout: (payoutId: string, idempotencyKey: string) =>
    one(
      apiClient.post(`/admin/payouts/${payoutId}/approve`, {}, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => payoutSchema.parse(value),
    ),

  /** Executes/reconciles one approved or processing Payout through the configured provider adapter. */
  sendPayout: (payoutId: string, idempotencyKey: string) =>
    one(
      apiClient.post(`/admin/payouts/${payoutId}/send`, {}, {
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      (value) => payoutSchema.parse(value),
    ),
};
