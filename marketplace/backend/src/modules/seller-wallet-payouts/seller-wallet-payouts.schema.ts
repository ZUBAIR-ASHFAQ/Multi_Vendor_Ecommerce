import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  PAYOUT_ACCOUNT_STATUS_VALUES,
  PAYOUT_LIST_SORT_VALUES,
  PAYOUT_PROVIDER_RESULT_VALUES,
  PAYOUT_STATUS_VALUES,
  WALLET_BALANCE_BUCKET_VALUES,
  WALLET_ENTRY_TYPE_VALUES,
  WALLET_LEDGER_SORT_VALUES,
  WALLET_PAYOUT_LIMITS,
  WALLET_PAYOUT_PATTERN,
  WALLET_PAYOUT_SORT_DIRECTION_VALUES,
} from "./seller-wallet-payouts.constants.js";

/** Creates one trimmed non-empty string with an explicit API safety limit. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Returns true when canonical scale-4 money fits PostgreSQL NUMERIC(18,4). */
function walletMoneyFitsNumeric(value: string): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0"] = unsignedValue.split(".");
  return integerPart.length <= WALLET_PAYOUT_LIMITS.MONEY_PRECISION - WALLET_PAYOUT_LIMITS.MONEY_SCALE;
}

/** Validates an optional from/to date range used by bounded Wallet/Payout list queries. */
function validateDateRange(
  value: { from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (!value.from || !value.to) return;
  if (new Date(value.from).getTime() > new Date(value.to).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "to must be on or after from.",
    });
  }
}

/** Frozen Wallet balance-bucket values. */
export const walletBalanceBucketSchema = z.enum(WALLET_BALANCE_BUCKET_VALUES);

/** Frozen immutable Wallet-entry values. */
export const walletEntryTypeSchema = z.enum(WALLET_ENTRY_TYPE_VALUES);

/** Frozen Payout-account lifecycle values. */
export const payoutAccountStatusSchema = z.enum(PAYOUT_ACCOUNT_STATUS_VALUES);

/** Frozen Payout lifecycle values. */
export const payoutStatusSchema = z.enum(PAYOUT_STATUS_VALUES);

/** Provider adapter result values; unknown deliberately remains non-terminal. */
export const payoutProviderResultSchema = z.enum(PAYOUT_PROVIDER_RESULT_VALUES);

/** Exact signed scale-4 money used by immutable Wallet-entry response contracts. */
export const walletSignedMoneySchema = z
  .string()
  .trim()
  .regex(/^-?(?:0|[1-9]\d*)\.\d{4}$/, "Wallet money must use canonical scale-4 decimal format.")
  .refine(
    walletMoneyFitsNumeric,
    `Wallet money must fit NUMERIC(${WALLET_PAYOUT_LIMITS.MONEY_PRECISION},${WALLET_PAYOUT_LIMITS.MONEY_SCALE}) without rounding.`,
  )
  .refine((value) => value !== "-0.0000", "Negative zero is not a canonical Wallet amount.");

/** Exact non-negative scale-4 money used by pending/available/held Wallet balances. */
export const walletNonNegativeMoneySchema = walletSignedMoneySchema.refine(
  (value) => !value.startsWith("-"),
  "Wallet balance must be non-negative.",
);

/** Exact non-positive scale-4 money used by recoverable seller debt. */
export const walletNegativeBalanceSchema = walletSignedMoneySchema.refine(
  (value) => value === "0.0000" || value.startsWith("-"),
  "Negative balance must be zero or negative.",
);

/** Exact positive scale-4 Payout amount submitted by a seller. */
export const payoutAmountSchema = walletNonNegativeMoneySchema.refine(
  (value) => value !== "0.0000",
  "Payout amount must be greater than zero.",
);

/** Normalized three-letter Wallet/Payout currency code. */
export const walletCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(WALLET_PAYOUT_LIMITS.CURRENCY_LENGTH)
  .regex(WALLET_PAYOUT_PATTERN.CURRENCY, "Currency must be a normalized three-letter code.");

/** Normalized configured payout-adapter key without choosing a concrete provider in core contracts. */
export const payoutProviderTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(WALLET_PAYOUT_LIMITS.PROVIDER_TYPE_MAX_LENGTH)
  .regex(
    WALLET_PAYOUT_PATTERN.PROVIDER_TYPE,
    "providerType must contain only lowercase letters, digits, underscores, or hyphens.",
  );

/** Shared Payout path parameter for finance approval/send commands. */
export const payoutIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Seller Wallet read filters; seller identity is always derived from authenticated scope. */
export const sellerWalletQuerySchema = paginationQuerySchema
  .extend({
    currency: walletCurrencySchema.optional(),
    entryType: walletEntryTypeSchema.optional(),
    balanceBucket: walletBalanceBucketSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    sort: z.enum(WALLET_LEDGER_SORT_VALUES).default("occurredAt"),
    order: z.enum(WALLET_PAYOUT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Seller Payout-history filters; seller identity is intentionally absent from browser input. */
export const sellerPayoutListQuerySchema = paginationQuerySchema
  .extend({
    status: payoutStatusSchema.optional(),
    currency: walletCurrencySchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    sort: z.enum(PAYOUT_LIST_SORT_VALUES).default("requestedAt"),
    order: z.enum(WALLET_PAYOUT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Finance queue filters; seller ID is permitted only on the admin read boundary. */
export const adminPayoutListQuerySchema = paginationQuerySchema
  .extend({
    sellerId: uuidSchema.optional(),
    status: payoutStatusSchema.optional(),
    currency: walletCurrencySchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    sort: z.enum(PAYOUT_LIST_SORT_VALUES).default("requestedAt"),
    order: z.enum(WALLET_PAYOUT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Seller command for creating one Payout request from server-verified available balance. */
export const requestPayoutBodySchema = z
  .object({
    accountId: uuidSchema,
    amount: payoutAmountSchema,
    currency: walletCurrencySchema,
  })
  .strict();

/** Seller command accepts only provider-owned/tokenized destination identity; safe display data is provider-derived. */
export const createPayoutAccountBodySchema = z
  .object({
    providerType: payoutProviderTypeSchema,
    providerAccountRef: nonBlankString(WALLET_PAYOUT_LIMITS.PROVIDER_ACCOUNT_REF_MAX_LENGTH),
  })
  .strict();

/** Finance approval is an explicit command; seller, amount, status, and reservation facts remain server-derived. */
export const approvePayoutBodySchema = z.object({}).strict();

/** Provider send is an explicit command; provider account/token and authoritative Payout facts remain server-derived. */
export const sendPayoutBodySchema = z.object({}).strict();

/** Trusted bounded settlement command; seller/currency/cutoff identity is never accepted from the caller. */
export const settleWalletBodySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_MIN)
      .max(WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_MAX)
      .default(WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_DEFAULT),
  })
  .strict();

/** Trusted adjustment re-drive accepts only one immutable Commission source identity, never arbitrary money. */
export const adjustWalletBodySchema = z
  .object({
    commissionEntryId: uuidSchema,
  })
  .strict();

/** Foundation Idempotency-Key header required by all retryable Module 17 money commands. */
export const walletPayoutIdempotencyHeadersSchema = z.object({
  "idempotency-key": nonBlankString(WALLET_PAYOUT_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH),
});

/** Safe seller Wallet balance representation; snapshot buckets remain separate financial concepts. */
export const sellerWalletBalanceResponseSchema = z
  .object({
    sellerId: uuidSchema,
    currency: walletCurrencySchema,
    pendingBalance: walletNonNegativeMoneySchema,
    availableBalance: walletNonNegativeMoneySchema,
    heldBalance: walletNonNegativeMoneySchema,
    negativeBalance: walletNegativeBalanceSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe immutable Wallet ledger row; internal deterministic source keys are intentionally not exposed. */
export const sellerWalletEntryResponseSchema = z
  .object({
    id: uuidSchema,
    sellerId: uuidSchema,
    currency: walletCurrencySchema,
    type: walletEntryTypeSchema,
    amount: walletSignedMoneySchema,
    balanceBucket: walletBalanceBucketSchema,
    sourceType: nonBlankString(WALLET_PAYOUT_LIMITS.SOURCE_TYPE_MAX_LENGTH),
    sourceId: uuidSchema,
    occurredAt: isoDateTimeSchema,
  })
  .strict();

/** Safe payout-account representation excludes the provider-owned account reference. */
export const payoutAccountResponseSchema = z
  .object({
    id: uuidSchema,
    sellerId: uuidSchema,
    providerType: payoutProviderTypeSchema,
    maskedDetails: nonBlankString(WALLET_PAYOUT_LIMITS.MASKED_DETAILS_MAX_LENGTH),
    status: payoutAccountStatusSchema,
    verifiedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

/** Aggregated seller payout facts grouped by currency; no provider secrets or scheduling claims are exposed. */
export const sellerPayoutSummaryResponseSchema = z
  .object({
    currency: walletCurrencySchema,
    lifetimePaidAmount: walletNonNegativeMoneySchema,
    inProgressAmount: walletNonNegativeMoneySchema,
    inProgressCount: z.number().int().nonnegative(),
  })
  .strict();

/** Seller Wallet read response also returns safe payout accounts and authoritative payout aggregates. */
export const sellerWalletResponseSchema = z
  .object({
    wallets: z.array(sellerWalletBalanceResponseSchema),
    entries: z.array(sellerWalletEntryResponseSchema),
    payoutAccounts: z.array(payoutAccountResponseSchema),
    payoutSummaries: z.array(sellerPayoutSummaryResponseSchema),
  })
  .strict();

/** Payout allocation safely links reserved amount back to immutable Wallet earning evidence. */
export const payoutAllocationResponseSchema = z
  .object({
    walletEntryId: uuidSchema,
    amount: payoutAmountSchema,
  })
  .strict();

/** Safe Payout representation shared by seller history and finance queue/reconciliation views. */
export const payoutResponseSchema = z
  .object({
    id: uuidSchema,
    payoutNo: nonBlankString(WALLET_PAYOUT_LIMITS.PAYOUT_NUMBER_MAX_LENGTH),
    sellerId: uuidSchema,
    amount: payoutAmountSchema,
    currency: walletCurrencySchema,
    accountId: uuidSchema,
    status: payoutStatusSchema,
    requestedAt: isoDateTimeSchema,
    processedAt: isoDateTimeSchema.nullable(),
    providerRef: nonBlankString(WALLET_PAYOUT_LIMITS.PROVIDER_REF_MAX_LENGTH).nullable(),
    allocations: z.array(payoutAllocationResponseSchema),
  })
  .strict();

/** Bounded settlement result reports processing counts without trusting caller-owned financial totals. */
export const settleWalletResultSchema = z
  .object({
    scanned: z.number().int().nonnegative(),
    settled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();

/** Trusted adjustment result exposes the authoritative Commission source and resulting Wallet snapshot only. */
export const adjustWalletResultSchema = z
  .object({
    commissionEntryId: uuidSchema,
    applied: z.boolean(),
    wallet: sellerWalletBalanceResponseSchema,
  })
  .strict();

export type WalletBalanceBucket = z.infer<typeof walletBalanceBucketSchema>;
export type WalletEntryType = z.infer<typeof walletEntryTypeSchema>;
export type PayoutAccountStatus = z.infer<typeof payoutAccountStatusSchema>;
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;
export type SellerWalletQuery = z.infer<typeof sellerWalletQuerySchema>;
export type SellerPayoutListQuery = z.infer<typeof sellerPayoutListQuerySchema>;
export type AdminPayoutListQuery = z.infer<typeof adminPayoutListQuerySchema>;
export type RequestPayoutInput = z.infer<typeof requestPayoutBodySchema>;
export type CreatePayoutAccountInput = z.infer<typeof createPayoutAccountBodySchema>;
export type SettleWalletInput = z.infer<typeof settleWalletBodySchema>;
export type AdjustWalletInput = z.infer<typeof adjustWalletBodySchema>;
export type SellerWalletBalanceResponse = z.infer<typeof sellerWalletBalanceResponseSchema>;
export type PayoutAccountResponse = z.infer<typeof payoutAccountResponseSchema>;
export type SellerPayoutSummaryResponse = z.infer<typeof sellerPayoutSummaryResponseSchema>;
export type SellerWalletResponse = z.infer<typeof sellerWalletResponseSchema>;
export type PayoutResponse = z.infer<typeof payoutResponseSchema>;
export type SettleWalletResult = z.infer<typeof settleWalletResultSchema>;
export type AdjustWalletResult = z.infer<typeof adjustWalletResultSchema>;
