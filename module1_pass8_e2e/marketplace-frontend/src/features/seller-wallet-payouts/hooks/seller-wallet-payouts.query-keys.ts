import type {
  AdminPayoutListParams,
  SellerPayoutListParams,
  SellerWalletParams,
} from "../types/seller-wallet-payouts.types";

/** Stable TanStack Query keys for Module 17 Wallet and Payout server state. */
export const sellerWalletPayoutsQueryKeys = {
  all: ["seller-wallet-payouts"] as const,
  sellerWallet: (params: SellerWalletParams) => ["seller-wallet-payouts", "seller", "wallet", params] as const,
  sellerPayouts: (params: SellerPayoutListParams) => ["seller-wallet-payouts", "seller", "payouts", params] as const,
  adminPayouts: (params: AdminPayoutListParams) => ["seller-wallet-payouts", "admin", "payouts", params] as const,
};
