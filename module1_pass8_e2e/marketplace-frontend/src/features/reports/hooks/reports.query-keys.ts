import type {
  CommissionsReportParams,
  InventoryReportParams,
  PayoutsReportParams,
  RefundsReportParams,
  SalesReportParams,
  SellersReportParams,
} from "../types/reports.types";

export const reportsQueryKeys = {
  all: ["reports"] as const,
  catalog: ["reports", "catalog"] as const,

  /** Returns the stable cache key for one Sales report page. */
  sales: (params: SalesReportParams) => ["reports", "sales", params] as const,

  /** Returns the stable cache key for one Seller performance page. */
  sellers: (params: SellersReportParams) => ["reports", "sellers", params] as const,

  /** Returns the stable cache key for one Inventory report page. */
  inventory: (params: InventoryReportParams) => ["reports", "inventory", params] as const,

  /** Returns the stable cache key for one Refund report page. */
  refunds: (params: RefundsReportParams) => ["reports", "refunds", params] as const,

  /** Returns the stable cache key for one Commission report page. */
  commissions: (params: CommissionsReportParams) => ["reports", "commissions", params] as const,

  /** Returns the stable cache key for one Payout report page. */
  payouts: (params: PayoutsReportParams) => ["reports", "payouts", params] as const,

  /** Returns the stable cache key for one requester-owned export run. */
  run: (runId: string) => ["reports", "runs", runId] as const,
};
