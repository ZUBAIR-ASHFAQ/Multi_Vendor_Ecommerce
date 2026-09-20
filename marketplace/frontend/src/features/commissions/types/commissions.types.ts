import type { PaginationMeta } from "@/types/api";
import type {
  CommissionEntry,
  CommissionEntryType,
  CommissionRule,
  CommissionRuleScope,
  CommissionRuleStatus,
  SellerCommissionStatement,
} from "../schemas/commissions.schemas";

export interface AdminCommissionRulesParams {
  page: number;
  pageSize: number;
  scopeType?: CommissionRuleScope;
  status?: CommissionRuleStatus;
  sort?: "priority" | "startAt" | "createdAt";
  order?: "asc" | "desc";
}

export interface SellerCommissionStatementParams {
  page: number;
  pageSize: number;
  type?: CommissionEntryType;
  sellerOrderId?: string;
  sort?: "occurredAt" | "createdAt";
  order?: "asc" | "desc";
}

export interface AdminCommissionEntriesParams {
  page: number;
  pageSize: number;
  sellerId?: string;
  sellerOrderId?: string;
  orderItemId?: string;
  type?: CommissionEntryType;
  currency?: string;
  sort?: "occurredAt" | "createdAt";
  order?: "asc" | "desc";
}

export interface CreateCommissionRuleInput {
  priority: number;
  scopeType: CommissionRuleScope;
  scopeId?: string | null;
  ratePercent: string;
  fixedFee?: string | null;
  startAt: string;
  endAt?: string | null;
  status: CommissionRuleStatus;
}

export type UpdateCommissionRuleInput = Partial<CreateCommissionRuleInput>;

export interface PaginatedCommissionRules {
  items: CommissionRule[];
  meta: PaginationMeta;
}

export interface PaginatedCommissionEntries {
  items: CommissionEntry[];
  meta: PaginationMeta;
}

export interface PaginatedSellerCommissionStatement {
  statement: SellerCommissionStatement;
  meta: PaginationMeta;
}
