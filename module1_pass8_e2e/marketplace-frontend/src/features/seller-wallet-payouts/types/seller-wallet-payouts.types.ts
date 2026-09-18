import type { PaginationMeta } from "@/types/api";
import type {
  Payout,
  PayoutAccount,
  SellerWalletResponse,
} from "../schemas/seller-wallet-payouts.schemas";

export interface SellerWalletParams {
  page: number;
  pageSize: number;
  currency?: string;
  entryType?:
    | "commission_credit"
    | "commission_adjustment"
    | "availability_transfer"
    | "negative_recovery"
    | "payout_reserve"
    | "payout_release"
    | "payout_paid";
  balanceBucket?: "pending" | "available" | "held" | "negative";
  from?: string;
  to?: string;
  sort?: "occurredAt";
  order?: "asc" | "desc";
}

export interface SellerPayoutListParams {
  page: number;
  pageSize: number;
  status?: "requested" | "approved" | "processing" | "paid" | "failed";
  currency?: string;
  from?: string;
  to?: string;
  sort?: "requestedAt" | "payoutNo";
  order?: "asc" | "desc";
}

export interface AdminPayoutListParams extends SellerPayoutListParams {
  sellerId?: string;
}

export interface RequestPayoutInput {
  accountId: string;
  amount: string;
  currency: string;
}

export interface CreatePayoutAccountInput {
  providerType: string;
  providerAccountRef: string;
}

export interface PaginatedWallet {
  wallet: SellerWalletResponse;
  meta: PaginationMeta;
}

export interface PaginatedPayouts {
  items: Payout[];
  meta: PaginationMeta;
}

export type { Payout, PayoutAccount, SellerWalletResponse };
