import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { PermissionCode } from "../../common/security/security.contract.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { PAGINATION } from "../../common/constants/pagination.js";
import { withTransaction } from "../../database/transaction.js";
import type { DatabaseTransaction } from "../../database/types.js";
import type { ReportDefinitionRow, ReportRunRow } from "../../database/schema/reports.js";
import { COMMISSION_ENTRY_TYPE_VALUES } from "../commissions/commissions.constants.js";
import { DOCUMENT_PURPOSE } from "../documents-audit/documents-audit.constants.js";
import type { DocumentsAuditService } from "../documents-audit/documents-audit.service.js";
import { SELLER_ORDER_STATUS } from "../orders/orders.constants.js";
import { PAYMENT_STATUS } from "../payments/payments.constants.js";
import { RETURN_REFUND_STATUS } from "../returns-refunds/returns-refunds.constants.js";
import {
  PAYOUT_STATUS,
  WALLET_BALANCE_BUCKET,
} from "../seller-wallet-payouts/seller-wallet-payouts.constants.js";
import {
  REPORT_CODE,
  REPORT_DEFINITION_STATUS,
  REPORT_OUTPUT_FORMAT,
  REPORT_RUN_STATUS,
  REPORTS_ERROR_CODE,
  REPORTS_OUTBOX_EVENT,
  REPORTS_PERMISSION,
  type ReportCode,
} from "./reports.constants.js";
import { renderReportExport } from "./reports.export.js";
import {
  createReportRunBodySchema,
  type CommissionsReportQuery,
  type CommissionsReportResponse,
  type CreateReportRunBody,
  type InventoryReportQuery,
  type InventoryReportResponse,
  type PayoutsReportQuery,
  type PayoutsReportResponse,
  type RefundsReportQuery,
  type RefundsReportResponse,
  type ReportDefinitionResponse,
  type ReportRunResponse,
  type SalesReportQuery,
  type SalesReportResponse,
  type SellersReportQuery,
  type SellersReportResponse,
} from "./reports.schema.js";
import {
  ReportsRepository,
  type AuditExportRecord,
  type CommissionReportRecord,
  type CurrencyAggregateRow,
  type InventoryReportRecord,
  type PayoutReportRecord,
  type RefundReportRecord,
  type ReportsReadScope,
  type SalesReportRecord,
} from "./reports.repository.js";

const SALES_FINAL_STATUSES = [
  SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
  SELLER_ORDER_STATUS.PROCESSING,
] as const;
const CAPTURED_PAYMENT_STATUSES = [
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
] as const;
const PAYABLE_WALLET_BUCKETS = [
  WALLET_BALANCE_BUCKET.PENDING,
  WALLET_BALANCE_BUCKET.AVAILABLE,
  WALLET_BALANCE_BUCKET.HELD,
] as const;
const FINAL_PAYOUT_STATUSES = [PAYOUT_STATUS.PAID] as const;

/** Runs one Reports operation inside the caller-provided transaction boundary. */
export type ReportsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Minimum generated-document boundary needed by Reports export processing. */
export interface ReportsDocumentsIntegration {
  /** Stores one generated export as a confirmed private Module 21 document. */
  storeGeneratedDocument(input: {
    ownerUserId: string;
    purpose: typeof DOCUMENT_PURPOSE.REPORT_EXPORT;
    originalName: string;
    mimeType: string;
    body: Uint8Array;
  }): Promise<{ file: { id: string } }>;

  /** Returns a short-lived download only after Reports has verified run ownership. */
  getGeneratedDocumentDownload(
    ownerUserId: string,
    fileId: string,
    purpose: typeof DOCUMENT_PURPOSE.REPORT_EXPORT,
  ): Promise<{ downloadUrl: string; expiresAt: string }>;
}

/** Explicit dependencies keep the Module 20 service testable and preserve service/repository boundaries. */
export interface ReportsServiceDependencies {
  repository?: ReportsRepository;
  documents: ReportsDocumentsIntegration | Pick<DocumentsAuditService, "storeGeneratedDocument" | "getGeneratedDocumentDownload">;
  transactionRunner?: ReportsTransactionRunner;
  now?: () => Date;
}

/** One paged service result whose metadata is placed in the standard HTTP response envelope. */
export interface ReportsPagedResult<T> {
  data: T;
  meta: PaginationMeta;
}

/** Internal server-derived scope stored with an asynchronous run so workers never trust client ownership. */
interface PersistedReportScope {
  sellerIds: string[] | null;
  storeIds: string[] | null;
}

/** Internal filters envelope persisted for a queued report run. */
interface PersistedReportRunFilters {
  request: Record<string, unknown>;
  scope: PersistedReportScope;
}

/** Builds a stable Module 20 application error. */
function reportError(code: string, message: string, statusCode: number, details?: unknown): AppError {
  return new AppError({ code, message, statusCode, ...(details !== undefined ? { details } : {}) });
}

/** Returns true only for a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Converts one exact scale-4 decimal into an integer without using floating point. */
function moneyToScale4(value: string): bigint {
  const normalized = value.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const units = BigInt(whole || "0") * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4) || "0");
  return negative ? -units : units;
}

/** Maps exact aggregate rows to the public currency/amount contract. */
function currencyAmounts(rows: CurrencyAggregateRow[]): Array<{ currency: string; amount: string }> {
  return rows.map((row) => ({ currency: row.currency, amount: row.amount }));
}

/** Parses report-definition JSON permission metadata and fails closed on malformed seed data. */
function definitionPermissions(row: ReportDefinitionRow): PermissionCode[] {
  if (!Array.isArray(row.requiredPermissions)) return [];
  return row.requiredPermissions.filter(
    (value): value is PermissionCode => typeof value === "string" && value.length > 0,
  );
}

/** Parses report-definition JSON output formats and removes unexpected values. */
function definitionOutputFormats(row: ReportDefinitionRow): Array<"csv" | "pdf"> {
  if (!Array.isArray(row.outputFormats)) return [];
  return row.outputFormats.filter(
    (value): value is "csv" | "pdf" => value === REPORT_OUTPUT_FORMAT.CSV || value === REPORT_OUTPUT_FORMAT.PDF,
  );
}

/** Normalizes a persisted report-run filters envelope without trusting arbitrary JSON. */
function persistedFilters(value: unknown): PersistedReportRunFilters | null {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.scope)) return null;
  const sellerIds = value.scope.sellerIds;
  const storeIds = value.scope.storeIds;
  /** Checks that a persisted scope list is null or contains only string identifiers. */
  const validIds = (candidate: unknown): candidate is string[] | null =>
    candidate === null || (Array.isArray(candidate) && candidate.every((item) => typeof item === "string"));
  if (!validIds(sellerIds) || !validIds(storeIds)) return null;
  return { request: value.request, scope: { sellerIds, storeIds } };
}

/** Converts service scope to a plain serializable structure for durable worker execution. */
function persistScope(scope: ReportsReadScope): PersistedReportScope {
  return {
    sellerIds: scope.sellerIds === null ? null : [...scope.sellerIds],
    storeIds: scope.storeIds === null ? null : [...scope.storeIds],
  };
}

/** Converts one repository Sales row to the public transport shape. */
function salesRow(row: SalesReportRecord): SalesReportResponse["rows"][number] {
  return { ...row, createdAt: row.createdAt.toISOString() } as SalesReportResponse["rows"][number];
}

/** Converts one repository Inventory row to the public transport shape. */
function inventoryRow(row: InventoryReportRecord): InventoryReportResponse["rows"][number] {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Converts one repository Refund row to the public transport shape. */
function refundRow(row: RefundReportRecord): RefundsReportResponse["rows"][number] {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as RefundsReportResponse["rows"][number];
}

/** Converts one immutable Commission row to the public transport shape. */
function commissionRow(row: CommissionReportRecord): CommissionsReportResponse["rows"][number] {
  return { ...row, occurredAt: row.occurredAt.toISOString() } as CommissionsReportResponse["rows"][number];
}

/** Converts one terminal Payout row to the public transport shape. */
function payoutRow(row: PayoutReportRecord): PayoutsReportResponse["rows"][number] {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  } as PayoutsReportResponse["rows"][number];
}

/** Converts one Audit row to a flat export record without exposing redacted before/after payloads. */
function auditExportRow(row: AuditExportRecord): Record<string, unknown> {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Module 20 business service owning report definitions, authorization, KPI semantics and export lifecycle. */
export class ReportsService {
  private readonly repository: ReportsRepository;
  private readonly documents: ReportsDocumentsIntegration;
  private readonly transactionRunner: ReportsTransactionRunner;
  private readonly now: () => Date;

  /** Stores explicit dependencies and keeps infrastructure defaults small and visible. */
  constructor(dependencies: ReportsServiceDependencies) {
    this.repository = dependencies.repository ?? new ReportsRepository();
    this.documents = dependencies.documents;
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Returns only active report definitions the current actor is allowed to use. */
  async getCatalog(context: RequestContext): Promise<ReportDefinitionResponse[]> {
    this.requireActor(context);
    const definitions = await this.repository.listActiveDefinitions(REPORT_DEFINITION_STATUS.ACTIVE);
    return definitions
      .filter((definition) => this.canUseDefinition(context, definition, false))
      .map((definition) => this.toDefinitionResponse(definition));
  }

  /** Returns the paged Sales report while keeping GMV, captured order value and refunds separate. */
  async getSalesReport(
    context: RequestContext,
    query: SalesReportQuery,
  ): Promise<ReportsPagedResult<SalesReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.SALES_READ, query);
    const [page, gmv, counts, captured, refunds] = await Promise.all([
      this.repository.listSalesRows(query, scope, SALES_FINAL_STATUSES),
      this.repository.sumSalesGmv(query, scope, SALES_FINAL_STATUSES),
      this.repository.countSalesOrders(query, scope, SALES_FINAL_STATUSES),
      this.repository.sumCapturedSellerOrderValue(query, scope, SALES_FINAL_STATUSES, CAPTURED_PAYMENT_STATUSES),
      this.repository.sumCompletedRefunds(query, scope, RETURN_REFUND_STATUS.COMPLETED),
    ]);
    return {
      data: {
        summary: {
          ...counts,
          gmvByCurrency: currencyAmounts(gmv),
          capturedCashByCurrency: currencyAmounts(captured),
          refundsByCurrency: currencyAmounts(refunds),
        },
        rows: page.items.map(salesRow),
      },
      meta: paginationMeta(query, page.totalItems),
    };
  }

  /** Returns seller performance with immutable ledger concepts merged only by seller and currency. */
  async getSellersReport(
    context: RequestContext,
    query: SellersReportQuery,
  ): Promise<ReportsPagedResult<SellersReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.SELLER_READ, query);
    const rows = await this.buildSellerPerformanceRows(query, scope);
    const sorted = this.sortSellerPerformance(rows, query.sort);
    const offset = (query.page - 1) * query.pageSize;
    return {
      data: { rows: sorted.slice(offset, offset + query.pageSize) },
      meta: paginationMeta(query, sorted.length),
    };
  }

  /** Returns current Inventory/low-stock state; no stock-aging value is invented without lot age data. */
  async getInventoryReport(
    context: RequestContext,
    query: InventoryReportQuery,
  ): Promise<ReportsPagedResult<InventoryReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.INVENTORY_READ, query);
    const page = await this.repository.listInventoryRows(query, scope);
    return {
      data: { rows: page.items.map(inventoryRow) },
      meta: paginationMeta(query, page.totalItems),
    };
  }

  /** Returns only completed Return-linked refunds so seller/store attribution is deterministic. */
  async getRefundsReport(
    context: RequestContext,
    query: RefundsReportQuery,
  ): Promise<ReportsPagedResult<RefundsReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.FINANCE_READ, query);
    const [page, totals] = await Promise.all([
      this.repository.listRefundRows(query, scope, [RETURN_REFUND_STATUS.COMPLETED]),
      this.repository.sumCompletedRefunds(query, scope, RETURN_REFUND_STATUS.COMPLETED),
    ]);
    return {
      data: { rows: page.items.map(refundRow), refundedByCurrency: currencyAmounts(totals) },
      meta: paginationMeta(query, page.totalItems),
    };
  }

  /** Returns signed immutable Commission ledger entries and their net marketplace revenue by currency. */
  async getCommissionsReport(
    context: RequestContext,
    query: CommissionsReportQuery,
  ): Promise<ReportsPagedResult<CommissionsReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.FINANCE_READ, query);
    const [page, totals] = await Promise.all([
      this.repository.listCommissionRows(query, scope, COMMISSION_ENTRY_TYPE_VALUES),
      this.repository.sumCommissionRevenue(query, scope, COMMISSION_ENTRY_TYPE_VALUES),
    ]);
    return {
      data: { rows: page.items.map(commissionRow), marketplaceCommissionRevenueByCurrency: currencyAmounts(totals) },
      meta: paginationMeta(query, page.totalItems),
    };
  }

  /** Returns terminal paid Payouts plus point-in-time seller payable reconstructed from the Wallet ledger. */
  async getPayoutsReport(
    context: RequestContext,
    query: PayoutsReportQuery,
  ): Promise<ReportsPagedResult<PayoutsReportResponse>> {
    const scope = await this.resolveScope(context, REPORTS_PERMISSION.FINANCE_READ, query);
    const [page, payable, paid] = await Promise.all([
      this.repository.listPayoutRows(query, scope, FINAL_PAYOUT_STATUSES),
      this.repository.sumSellerPayable(query, scope, PAYABLE_WALLET_BUCKETS, WALLET_BALANCE_BUCKET.NEGATIVE),
      this.repository.sumPaidPayouts(query, scope, PAYOUT_STATUS.PAID),
    ]);
    return {
      data: {
        rows: page.items.map(payoutRow),
        sellerPayableByCurrency: currencyAmounts(payable),
        paidOutByCurrency: currencyAmounts(paid),
      },
      meta: paginationMeta(query, page.totalItems),
    };
  }

  /** Creates one authorized queued CSV/PDF run, audit event and durable request event atomically. */
  async createReportRun(context: RequestContext, input: CreateReportRunBody): Promise<ReportRunResponse> {
    const actorId = this.requireActor(context);
    const parsed = createReportRunBodySchema.safeParse(input);
    if (!parsed.success) {
      throw reportError(REPORTS_ERROR_CODE.FILTER_INVALID, "The report filters are invalid.", 422, parsed.error.flatten());
    }
    const command = parsed.data;
    const definition = await this.requireDefinition(command.reportCode);
    this.assertDefinitionPermission(context, definition, true);
    const scope = await this.resolveScope(
      context,
      this.primaryPermission(definition),
      command.filters,
      [REPORTS_PERMISSION.EXPORT],
    );
    const created = await this.transactionRunner(async (transaction) => {
      const repository = this.repository.using(transaction);
      const run = await repository.createReportRun({
        reportCode: command.reportCode,
        requestedBy: actorId,
        filtersJson: { request: command.filters, scope: persistScope(scope) },
        outputFormat: command.outputFormat,
      });
      await AuditService.using(transaction).record({
        actorId,
        actorType: context.actorType,
        action: REPORTS_OUTBOX_EVENT.RUN_REQUESTED,
        entityType: "report_run",
        entityId: run.id,
        requestId: context.requestId,
        metadata: { reportCode: run.reportCode, outputFormat: run.outputFormat, scope: persistScope(scope) },
      });
      await OutboxService.using(transaction).enqueue({
        eventType: REPORTS_OUTBOX_EVENT.RUN_REQUESTED,
        aggregateType: "report_run",
        aggregateId: run.id,
        payload: { reportRunId: run.id, recipientUserId: actorId, reportCode: run.reportCode },
      });
      return run;
    });
    return this.toRunResponse(created, null);
  }

  /** Reads one asynchronous run only for its requester and adds a signed download after completion. */
  async getReportRun(context: RequestContext, reportRunId: string): Promise<ReportRunResponse> {
    const actorId = this.requireActor(context);
    const run = await this.repository.findReportRunById(reportRunId);
    if (!run) throw this.notFound();
    if (run.requestedBy !== actorId) throw this.scopeForbidden();
    let download: ReportRunResponse["download"] = null;
    if (run.status === REPORT_RUN_STATUS.COMPLETED && run.fileId) {
      const signed = await this.documents.getGeneratedDocumentDownload(
        run.requestedBy,
        run.fileId,
        DOCUMENT_PURPOSE.REPORT_EXPORT,
      );
      download = { fileId: run.fileId, downloadUrl: signed.downloadUrl, expiresAt: signed.expiresAt };
    }
    return this.toRunResponse(run, download);
  }

  /** Executes one queued/processing run idempotently enough for BullMQ retry and persists generated document metadata. */
  async processReportRun(reportRunId: string): Promise<void> {
    const run = await this.beginProcessing(reportRunId);
    if (!run || run.status === REPORT_RUN_STATUS.COMPLETED || run.status === REPORT_RUN_STATUS.FAILED) return;
    const stored = persistedFilters(run.filtersJson);
    if (!stored) throw reportError(REPORTS_ERROR_CODE.FILTER_INVALID, "Stored report filters are invalid.", 422);
    const commandResult = createReportRunBodySchema.safeParse({
      reportCode: run.reportCode,
      filters: stored.request,
      outputFormat: run.outputFormat,
    });
    if (!commandResult.success) {
      throw reportError(REPORTS_ERROR_CODE.FILTER_INVALID, "Stored report filters are invalid.", 422);
    }
    const rows = await this.buildExportRows(commandResult.data, stored.scope);
    const rendered = renderReportExport(commandResult.data.reportCode, commandResult.data.outputFormat, rows);
    const generated = await this.documents.storeGeneratedDocument({
      ownerUserId: run.requestedBy,
      purpose: DOCUMENT_PURPOSE.REPORT_EXPORT,
      originalName: `${run.reportCode}-${run.id}.${commandResult.data.outputFormat}`,
      mimeType: rendered.mimeType,
      body: rendered.body,
    });
    await this.transactionRunner(async (transaction) => {
      const repository = this.repository.using(transaction);
      const completed = await repository.markReportRunCompleted(run.id, generated.file.id, this.now());
      if (!completed) return;
      await AuditService.using(transaction).record({
        actorId: null,
        actorType: ACTOR_TYPE.SYSTEM,
        action: REPORTS_OUTBOX_EVENT.GENERATED,
        entityType: "report_run",
        entityId: run.id,
        metadata: { reportCode: run.reportCode, requestedBy: run.requestedBy, fileId: generated.file.id },
      });
      await OutboxService.using(transaction).enqueue({
        eventType: REPORTS_OUTBOX_EVENT.GENERATED,
        aggregateType: "report_run",
        aggregateId: run.id,
        payload: { reportRunId: run.id, recipientUserId: run.requestedBy, reportCode: run.reportCode, fileId: generated.file.id },
      });
    });
  }

  /** Persists one final export failure and publishes a safe recipient notification event once. */
  async recordReportRunFailure(reportRunId: string, errorCode: string, finalAttempt: boolean): Promise<void> {
    if (!finalAttempt) return;
    await this.transactionRunner(async (transaction) => {
      const repository = this.repository.using(transaction);
      const existing = await repository.findReportRunById(reportRunId);
      if (!existing || existing.status === REPORT_RUN_STATUS.COMPLETED || existing.status === REPORT_RUN_STATUS.FAILED) return;
      const failed = await repository.markReportRunFailed(reportRunId, errorCode || REPORTS_ERROR_CODE.EXPORT_FAILED, this.now());
      if (!failed) return;
      await AuditService.using(transaction).record({
        actorId: null,
        actorType: ACTOR_TYPE.SYSTEM,
        action: REPORTS_OUTBOX_EVENT.FAILED,
        entityType: "report_run",
        entityId: reportRunId,
        metadata: { reportCode: failed.reportCode, requestedBy: failed.requestedBy, errorCode: failed.errorCode },
      });
      await OutboxService.using(transaction).enqueue({
        eventType: REPORTS_OUTBOX_EVENT.FAILED,
        aggregateType: "report_run",
        aggregateId: reportRunId,
        payload: { reportRunId, recipientUserId: failed.requestedBy, reportCode: failed.reportCode, errorCode: failed.errorCode },
      });
    });
  }

  /** Claims a queued run as processing or resumes a retryable processing run. */
  private async beginProcessing(reportRunId: string): Promise<ReportRunRow | null> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repository.using(transaction);
      const existing = await repository.findReportRunById(reportRunId);
      if (!existing) return null;
      if (existing.status === REPORT_RUN_STATUS.QUEUED) {
        return repository.markReportRunProcessing(reportRunId, this.now());
      }
      return existing;
    });
  }

  /** Builds all export rows from the same service-owned status and scope rules used by synchronous reads. */
  private async buildExportRows(
    command: CreateReportRunBody,
    scope: PersistedReportScope,
  ): Promise<Array<Record<string, unknown>>> {
    const readScope: ReportsReadScope = { sellerIds: scope.sellerIds, storeIds: scope.storeIds };
    if (command.reportCode === REPORT_CODE.SALES) return this.exportSales(command.filters, readScope);
    if (command.reportCode === REPORT_CODE.SELLERS) return this.exportSellers(command.filters, readScope);
    if (command.reportCode === REPORT_CODE.INVENTORY) return this.exportInventory(command.filters, readScope);
    if (command.reportCode === REPORT_CODE.REFUNDS) return this.exportRefunds(command.filters, readScope);
    if (command.reportCode === REPORT_CODE.COMMISSIONS) return this.exportCommissions(command.filters, readScope);
    if (command.reportCode === REPORT_CODE.PAYOUTS) return this.exportPayouts(command.filters, readScope);
    return (await this.repository.listAuditExportRows(command.filters, readScope)).map(auditExportRow);
  }

  /** Streams Sales export pages through bounded repository reads. */
  private async exportSales(
    filters: Extract<CreateReportRunBody, { reportCode: "sales" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repository.listSalesRows(
        { ...filters, page, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "created_asc" },
        scope,
        SALES_FINAL_STATUSES,
      );
      rows.push(...result.items.map((item) => salesRow(item) as unknown as Record<string, unknown>));
      if (page * PAGINATION.MAX_PAGE_SIZE >= result.totalItems) break;
    }
    return rows;
  }

  /** Builds the complete Seller Performance export from immutable source aggregates. */
  private async exportSellers(
    filters: Extract<CreateReportRunBody, { reportCode: "sellers" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.buildSellerPerformanceRows(
      { ...filters, page: 1, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "gmv_desc" },
      scope,
    );
    return rows as unknown as Array<Record<string, unknown>>;
  }

  /** Streams current Inventory export pages without inventing stock-aging data. */
  private async exportInventory(
    filters: Extract<CreateReportRunBody, { reportCode: "inventory" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repository.listInventoryRows(
        { ...filters, page, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "available_asc" },
        scope,
      );
      rows.push(...result.items.map((item) => inventoryRow(item) as unknown as Record<string, unknown>));
      if (page * PAGINATION.MAX_PAGE_SIZE >= result.totalItems) break;
    }
    return rows;
  }

  /** Streams only completed Return-linked Refund export rows. */
  private async exportRefunds(
    filters: Extract<CreateReportRunBody, { reportCode: "refunds" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repository.listRefundRows(
        { ...filters, page, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "created_asc" },
        scope,
        [RETURN_REFUND_STATUS.COMPLETED],
      );
      rows.push(...result.items.map((item) => refundRow(item) as unknown as Record<string, unknown>));
      if (page * PAGINATION.MAX_PAGE_SIZE >= result.totalItems) break;
    }
    return rows;
  }

  /** Streams all immutable Commission entry types so adjustments/refunds retain their signed accounting effect. */
  private async exportCommissions(
    filters: Extract<CreateReportRunBody, { reportCode: "commissions" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repository.listCommissionRows(
        { ...filters, page, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "occurred_asc" },
        scope,
        COMMISSION_ENTRY_TYPE_VALUES,
      );
      rows.push(...result.items.map((item) => commissionRow(item) as unknown as Record<string, unknown>));
      if (page * PAGINATION.MAX_PAGE_SIZE >= result.totalItems) break;
    }
    return rows;
  }

  /** Streams only terminal paid Payout rows for asynchronous payout exports. */
  private async exportPayouts(
    filters: Extract<CreateReportRunBody, { reportCode: "payouts" }>["filters"],
    scope: ReportsReadScope,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repository.listPayoutRows(
        { ...filters, page, pageSize: PAGINATION.MAX_PAGE_SIZE, sort: "requested_asc" },
        scope,
        FINAL_PAYOUT_STATUSES,
      );
      rows.push(...result.items.map((item) => payoutRow(item) as unknown as Record<string, unknown>));
      if (page * PAGINATION.MAX_PAGE_SIZE >= result.totalItems) break;
    }
    return rows;
  }

  /** Merges Seller Performance concepts by seller/currency without conflating ledger meanings. */
  private async buildSellerPerformanceRows(query: SellersReportQuery, scope: ReportsReadScope): Promise<SellersReportResponse["rows"]> {
    const [sales, commissions, wallet, refunds, payouts] = await Promise.all([
      this.repository.listSellerSalesAggregates(query, scope, SALES_FINAL_STATUSES),
      this.repository.listSellerCommissionAggregates(query, scope, COMMISSION_ENTRY_TYPE_VALUES),
      this.repository.listSellerWalletAggregates(query, scope, PAYABLE_WALLET_BUCKETS, WALLET_BALANCE_BUCKET.NEGATIVE),
      this.repository.listSellerRefundAggregates(query, scope, RETURN_REFUND_STATUS.COMPLETED),
      this.repository.listSellerPayoutAggregates(query, scope, PAYOUT_STATUS.PAID),
    ]);
    const sellerIds = new Set<string>();
    for (const collection of [sales, commissions, wallet, refunds, payouts]) {
      for (const item of collection) sellerIds.add(item.sellerId);
    }
    const sellerNames = new Map(
      (await this.repository.listSellerDirectory([...sellerIds])).map((seller) => [
        seller.sellerId,
        seller.sellerName,
      ]),
    );
    const map = new Map<string, SellersReportResponse["rows"][number]>();

    /** Returns the one mutable merge row for a seller/currency pair, creating a zero-valued row when needed. */
    const ensure = (sellerId: string, currency: string, sellerName?: string) => {
      const key = `${sellerId}:${currency}`;
      let row = map.get(key);
      if (!row) {
        row = {
          sellerId,
          sellerName: sellerName ?? sellerId,
          orderCount: 0,
          currency,
          gmv: "0.0000",
          commissionRevenue: "0.0000",
          sellerPayable: "0.0000",
          refunds: "0.0000",
          payouts: "0.0000",
        };
        map.set(key, row);
      }
      if (sellerName) row.sellerName = sellerName;
      return row;
    };
    for (const item of sales) {
      Object.assign(ensure(item.sellerId, item.currency, item.sellerName), {
        orderCount: item.orderCount,
        gmv: item.gmv,
      });
    }
    for (const item of commissions) {
      ensure(item.sellerId, item.currency, sellerNames.get(item.sellerId)).commissionRevenue =
        item.commissionRevenue;
    }
    for (const item of wallet) {
      ensure(item.sellerId, item.currency, sellerNames.get(item.sellerId)).sellerPayable =
        item.sellerPayable;
    }
    for (const item of refunds) {
      ensure(item.sellerId, item.currency, sellerNames.get(item.sellerId)).refunds = item.refunds;
    }
    for (const item of payouts) {
      ensure(item.sellerId, item.currency, sellerNames.get(item.sellerId)).payouts = item.payouts;
    }
    return [...map.values()];
  }

  /** Applies the explicitly allow-listed Seller Performance sort without floating point. */
  private sortSellerPerformance(rows: SellersReportResponse["rows"], sort: SellersReportQuery["sort"]): SellersReportResponse["rows"] {
    return [...rows].sort((left, right) => {
      const direction = sort.endsWith("_asc") ? 1 : -1;
      if (sort.startsWith("orders_")) {
        return direction * (
          left.orderCount - right.orderCount || left.sellerId.localeCompare(right.sellerId)
        );
      }
      const leftGmv = moneyToScale4(left.gmv);
      const rightGmv = moneyToScale4(right.gmv);
      const moneyCompare = leftGmv < rightGmv ? -1 : leftGmv > rightGmv ? 1 : 0;
      return direction * (moneyCompare || left.sellerId.localeCompare(right.sellerId));
    });
  }

  /** Resolves platform or seller-scoped report authorization and validates requested seller/store narrowing. */
  private async resolveScope(
    context: RequestContext,
    permission: PermissionCode,
    filters: {
      sellerId?: string | undefined;
      storeId?: string | undefined;
    },
    additionalPermissions: readonly PermissionCode[] = [],
  ): Promise<ReportsReadScope> {
    this.requireActor(context);
    if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
      if (
        !context.permissions.has(permission)
        || additionalPermissions.some((required) => !context.permissions.has(required))
      ) {
        throw this.scopeForbidden();
      }
      if (filters.storeId) {
        const store = await this.repository.findStoreScope(filters.storeId);
        if (!store) throw this.scopeForbidden();
        if (filters.sellerId && store.sellerId !== filters.sellerId) throw this.scopeForbidden();
      }
      return {
        sellerIds: filters.sellerId ? [filters.sellerId] : null,
        storeIds: filters.storeId ? [filters.storeId] : null,
      };
    }
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.scopeForbidden();
    const allowedSellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId)
          && permissions.has(permission)
          && additionalPermissions.every((required) => permissions.has(required)),
      )
      .map(([sellerId]) => sellerId);
    if (allowedSellerIds.length === 0) throw this.scopeForbidden();
    if (filters.sellerId && !allowedSellerIds.includes(filters.sellerId)) throw this.scopeForbidden();
    let storeIds = [...context.storeIds];
    if (filters.storeId) {
      if (!context.storeIds.has(filters.storeId)) throw this.scopeForbidden();
      const store = await this.repository.findStoreScope(filters.storeId);
      if (!store || !allowedSellerIds.includes(store.sellerId)) throw this.scopeForbidden();
      if (filters.sellerId && store.sellerId !== filters.sellerId) throw this.scopeForbidden();
      storeIds = [filters.storeId];
    }
    return {
      sellerIds: filters.sellerId ? [filters.sellerId] : allowedSellerIds,
      storeIds,
    };
  }

  /** Returns whether the actor can use all permissions declared by one active report definition. */
  private canUseDefinition(context: RequestContext, definition: ReportDefinitionRow, includeExport: boolean): boolean {
    const required = definitionPermissions(definition);
    if (required.length === 0) return false;
    if (definition.code === REPORT_CODE.AUDIT_LOG && context.actorType !== ACTOR_TYPE.PLATFORM_ADMIN) return false;
    const permissions = includeExport ? [...required, REPORTS_PERMISSION.EXPORT] : required;
    if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) return permissions.every((permission) => context.permissions.has(permission));
    if (context.actorType !== ACTOR_TYPE.SELLER) return false;
    return [...context.sellerPermissions.entries()].some(
      ([sellerId, sellerPermissions]) =>
        context.sellerIds.has(sellerId)
        && permissions.every((permission) => sellerPermissions.has(permission)),
    );
  }

  /** Throws the Module 20 scope error when one definition is not available to the actor. */
  private assertDefinitionPermission(context: RequestContext, definition: ReportDefinitionRow, includeExport: boolean): void {
    if (!this.canUseDefinition(context, definition, includeExport)) throw this.scopeForbidden();
  }

  /** Returns the first report-specific permission from a validated active definition. */
  private primaryPermission(definition: ReportDefinitionRow): PermissionCode {
    const [permission] = definitionPermissions(definition);
    if (!permission) throw this.scopeForbidden();
    return permission;
  }

  /** Loads one active report definition or returns the stable Module 20 not-found error. */
  private async requireDefinition(reportCode: ReportCode): Promise<ReportDefinitionRow> {
    const definition = await this.repository.findActiveDefinitionByCode(reportCode, REPORT_DEFINITION_STATUS.ACTIVE);
    if (!definition) throw this.notFound();
    return definition;
  }

  /** Converts one persisted definition to the safe permission-filtered catalog response. */
  private toDefinitionResponse(definition: ReportDefinitionRow): ReportDefinitionResponse {
    return {
      code: definition.code as ReportCode,
      domain: definition.domain,
      requiredPermissions: definitionPermissions(definition),
      outputFormats: definitionOutputFormats(definition),
      status: definition.status as "active" | "inactive",
    };
  }

  /** Converts an internal report run to the public response while hiding server-derived persisted scope metadata. */
  private toRunResponse(run: ReportRunRow, download: ReportRunResponse["download"]): ReportRunResponse {
    const stored = persistedFilters(run.filtersJson);
    return {
      id: run.id,
      reportCode: run.reportCode as ReportCode,
      filters: stored?.request ?? {},
      outputFormat: run.outputFormat as "csv" | "pdf",
      status: run.status as "queued" | "processing" | "completed" | "failed",
      errorCode: run.errorCode,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      download,
    };
  }

  /** Requires a real authenticated user id for every report read/export command. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId) throw reportError("UNAUTHENTICATED", "Authentication is required.", 401);
    return context.actorId;
  }

  /** Builds the stable Module 20 scope error. */
  private scopeForbidden(): AppError {
    return reportError(REPORTS_ERROR_CODE.SCOPE_FORBIDDEN, "The requested report scope is not allowed.", 403);
  }

  /** Builds the stable Module 20 not-found error. */
  private notFound(): AppError {
    return reportError(REPORTS_ERROR_CODE.NOT_FOUND, "The requested report was not found.", 404);
  }
}
