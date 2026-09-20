import type {
  AdminCommissionEntriesParams,
  AdminCommissionRulesParams,
  SellerCommissionStatementParams,
} from "../types/commissions.types";

export const commissionsQueryKeys = {
  admin: ["commissions", "admin"] as const,

  /** Returns the stable key for one admin Commission-rule page. */
  rules: (params: AdminCommissionRulesParams) => ["commissions", "admin", "rules", params] as const,

  /** Returns the stable key for the authenticated seller's statement filters. */
  sellerStatement: (params: SellerCommissionStatementParams) =>
    ["commissions", "seller", "statement", params] as const,

  /** Returns the stable key for one finance Commission-ledger page. */
  adminEntries: (params: AdminCommissionEntriesParams) =>
    ["commissions", "admin", "entries", params] as const,
};
