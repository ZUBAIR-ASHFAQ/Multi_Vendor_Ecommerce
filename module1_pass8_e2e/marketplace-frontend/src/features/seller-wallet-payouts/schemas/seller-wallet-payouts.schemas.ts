import { z } from "zod";
import {
  PAYOUT_ACCOUNT_STATUS_VALUES,
  PAYOUT_STATUS_VALUES,
  WALLET_BALANCE_BUCKET_VALUES,
  WALLET_ENTRY_TYPE_VALUES,
} from "../seller-wallet-payouts.constants";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

/** Canonical signed scale-4 money returned by Wallet ledger APIs. */
export const walletSignedMoneySchema = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{4}$/);

/** Canonical non-negative scale-4 money returned by Wallet balance/Payout APIs. */
export const walletNonNegativeMoneySchema = walletSignedMoneySchema.refine(
  (value) => !value.startsWith("-"),
  "Amount must be non-negative.",
);

/** Canonical non-positive scale-4 debt value returned by the Wallet API. */
export const walletNegativeMoneySchema = walletSignedMoneySchema.refine(
  (value) => value === "0.0000" || value.startsWith("-"),
  "Negative balance must be zero or negative.",
);

/** Safe Wallet balance snapshot. */
export const sellerWalletBalanceSchema = z.object({
  sellerId: uuid,
  currency: z.string().regex(/^[A-Z]{3}$/),
  pendingBalance: walletNonNegativeMoneySchema,
  availableBalance: walletNonNegativeMoneySchema,
  heldBalance: walletNonNegativeMoneySchema,
  negativeBalance: walletNegativeMoneySchema,
  updatedAt: isoDateTime,
});

/** Safe immutable Wallet ledger row; deterministic source keys remain server-private. */
export const sellerWalletEntrySchema = z.object({
  id: uuid,
  sellerId: uuid,
  currency: z.string().regex(/^[A-Z]{3}$/),
  type: z.enum(WALLET_ENTRY_TYPE_VALUES),
  amount: walletSignedMoneySchema,
  balanceBucket: z.enum(WALLET_BALANCE_BUCKET_VALUES),
  sourceType: z.string().trim().min(1).max(50),
  sourceId: uuid,
  occurredAt: isoDateTime,
});

/** Safe payout-account projection excludes provider-owned secret/account reference data. */
export const payoutAccountSchema = z.object({
  id: uuid,
  sellerId: uuid,
  providerType: z.string().trim().min(1).max(40),
  maskedDetails: z.string().trim().min(1).max(255),
  status: z.enum(PAYOUT_ACCOUNT_STATUS_VALUES),
  verifiedAt: isoDateTime.nullable(),
});

/** Seller Wallet read contains balances, one ledger page, and safe payout accounts. */
export const sellerWalletResponseSchema = z.object({
  wallets: z.array(sellerWalletBalanceSchema),
  entries: z.array(sellerWalletEntrySchema),
  payoutAccounts: z.array(payoutAccountSchema),
});

/** Safe Payout allocation evidence links reserved money to immutable Wallet entries. */
export const payoutAllocationSchema = z.object({
  walletEntryId: uuid,
  amount: walletNonNegativeMoneySchema.refine((value) => value !== "0.0000"),
});

/** Safe Payout projection shared by seller history and finance reconciliation views. */
export const payoutSchema = z.object({
  id: uuid,
  payoutNo: z.string().trim().min(1).max(40),
  sellerId: uuid,
  amount: walletNonNegativeMoneySchema.refine((value) => value !== "0.0000"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  accountId: uuid,
  status: z.enum(PAYOUT_STATUS_VALUES),
  requestedAt: isoDateTime,
  processedAt: isoDateTime.nullable(),
  providerRef: z.string().trim().min(1).max(255).nullable(),
  allocations: z.array(payoutAllocationSchema),
});

/** Browser payout amount accepts a human-friendly decimal and is normalized without floating point. */
const payoutAmountInputSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/, "Enter a positive amount with at most four decimals.")
  .refine((value) => !/^0(?:\.0{1,4})?$/.test(value), "Payout amount must be greater than zero.");

/** Seller payout-request form state; seller, balances, and status are never browser-owned. */
export const payoutRequestFormSchema = z.object({
  accountId: z.string().uuid("Choose a payout account."),
  amount: payoutAmountInputSchema,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
});

/** Payout-account setup accepts only a provider/token reference, never raw bank/card fields. */
export const payoutAccountFormSchema = z.object({
  providerType: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter a configured provider type.")
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, digits, underscores, or hyphens."),
  providerAccountRef: z.string().trim().min(1, "Enter the provider account/token reference.").max(255),
});

/** Normalizes a validated decimal string to the backend's exact scale-4 format without Number/float conversion. */
export function normalizeScale4Money(value: string): string {
  const [whole, fraction = ""] = value.trim().split(".");
  return `${whole}.${fraction.padEnd(4, "0")}`;
}

export type SellerWalletBalance = z.infer<typeof sellerWalletBalanceSchema>;
export type SellerWalletEntry = z.infer<typeof sellerWalletEntrySchema>;
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;
export type SellerWalletResponse = z.infer<typeof sellerWalletResponseSchema>;
export type Payout = z.infer<typeof payoutSchema>;
