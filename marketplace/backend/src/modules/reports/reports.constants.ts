import { DOCUMENT_AUDIT_PERMISSION } from "../documents-audit/documents-audit.constants.js";

/** Stable Module 20 report codes. Audit export is additive under approved Requirements Patch 0002. */
export const REPORT_CODE = {
  SALES: "sales",
  SELLERS: "sellers",
  INVENTORY: "inventory",
  REFUNDS: "refunds",
  COMMISSIONS: "commissions",
  PAYOUTS: "payouts",
  AUDIT_LOG: "audit_log",
} as const;

export const REPORT_CODE_VALUES = [
  REPORT_CODE.SALES,
  REPORT_CODE.SELLERS,
  REPORT_CODE.INVENTORY,
  REPORT_CODE.REFUNDS,
  REPORT_CODE.COMMISSIONS,
  REPORT_CODE.PAYOUTS,
  REPORT_CODE.AUDIT_LOG,
] as const;

export type ReportCode = (typeof REPORT_CODE)[keyof typeof REPORT_CODE];

/** Report-definition lifecycle states persisted by Module 20. */
export const REPORT_DEFINITION_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const REPORT_DEFINITION_STATUS_VALUES = [
  REPORT_DEFINITION_STATUS.ACTIVE,
  REPORT_DEFINITION_STATUS.INACTIVE,
] as const;

/** Asynchronous report-run lifecycle states persisted by Module 20. */
export const REPORT_RUN_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const REPORT_RUN_STATUS_VALUES = [
  REPORT_RUN_STATUS.QUEUED,
  REPORT_RUN_STATUS.PROCESSING,
  REPORT_RUN_STATUS.COMPLETED,
  REPORT_RUN_STATUS.FAILED,
] as const;

/** Export formats allow-listed by the Module 20 database and controlling guide. */
export const REPORT_OUTPUT_FORMAT = {
  CSV: "csv",
  PDF: "pdf",
} as const;

export const REPORT_OUTPUT_FORMAT_VALUES = [
  REPORT_OUTPUT_FORMAT.CSV,
  REPORT_OUTPUT_FORMAT.PDF,
] as const;

/** Representative Module 20 permissions required by the controlling guide. */
export const REPORTS_PERMISSION = {
  SALES_READ: "reports.sales.read",
  INVENTORY_READ: "reports.inventory.read",
  FINANCE_READ: "reports.finance.read",
  SELLER_READ: "reports.seller.read",
  EXPORT: "reports.export",
} as const;

/** Permission metadata composed into the central platform RBAC seed. */
export const REPORTS_PERMISSION_CATALOG = [
  {
    code: REPORTS_PERMISSION.SALES_READ,
    domain: "reports",
    description: "Read permission-safe sales and order reporting inside the actor's allowed scope.",
  },
  {
    code: REPORTS_PERMISSION.INVENTORY_READ,
    domain: "reports",
    description: "Read permission-safe inventory and low-stock reporting inside the actor's allowed scope.",
  },
  {
    code: REPORTS_PERMISSION.FINANCE_READ,
    domain: "reports",
    description: "Read permission-safe refund, commission, liability, and payout reporting inside the actor's allowed scope.",
  },
  {
    code: REPORTS_PERMISSION.SELLER_READ,
    domain: "reports",
    description: "Read seller performance and settlement reporting inside the actor's allowed scope.",
  },
  {
    code: REPORTS_PERMISSION.EXPORT,
    domain: "reports",
    description: "Create asynchronous CSV/PDF report exports inside the actor's allowed scope.",
  },
] as const;

/** Stable Module 20 business error codes required by the controlling guide. */
export const REPORTS_ERROR_CODE = {
  NOT_FOUND: "REPORT_NOT_FOUND",
  SCOPE_FORBIDDEN: "REPORT_SCOPE_FORBIDDEN",
  FILTER_INVALID: "REPORT_FILTER_INVALID",
  EXPORT_FAILED: "REPORT_EXPORT_FAILED",
} as const;

/** Exact nine-operation Module 20 HTTP path surface required by the controlling guide. */
export const REPORTS_PATH = {
  CATALOG: "/api/v1/reports/catalog",
  SALES: "/api/v1/reports/sales",
  SELLERS: "/api/v1/reports/sellers",
  INVENTORY: "/api/v1/reports/inventory",
  REFUNDS: "/api/v1/reports/refunds",
  COMMISSIONS: "/api/v1/reports/commissions",
  PAYOUTS: "/api/v1/reports/payouts",
  CREATE_RUN: "/api/v1/reports/runs",
  READ_RUN: "/api/v1/reports/runs/:id",
} as const;

/** Durable Module 20 events named by the controlling guide. */
export const REPORTS_OUTBOX_EVENT = {
  RUN_REQUESTED: "report.run_requested",
  GENERATED: "report.generated",
  FAILED: "report.failed",
} as const;

/** BullMQ source-event queue consumed by the Module 20 asynchronous export runtime. */
export const REPORTS_JOB = {
  SOURCE_EVENT_QUEUE: "reports-domain-events",
} as const;

/** Shared report query limits. The guide requires a bounded range but does not prescribe a numeric cap. */
export const REPORTS_LIMITS = {
  CODE_MAX_LENGTH: 120,
  DOMAIN_MAX_LENGTH: 80,
  ERROR_CODE_MAX_LENGTH: 100,
  SAVED_FILTER_NAME_MAX_LENGTH: 160,
  CURRENCY_LENGTH: 3,
  MAX_DATE_RANGE_DAYS: 366,
} as const;

/** Query sort allow-lists chosen for the concrete Module 20 read contracts. */
export const REPORTS_SORT = {
  SALES: ["created_desc", "created_asc", "total_desc", "total_asc"],
  SELLERS: ["gmv_desc", "gmv_asc", "orders_desc", "orders_asc"],
  INVENTORY: ["available_asc", "available_desc", "updated_desc", "updated_asc"],
  REFUNDS: ["created_desc", "created_asc", "amount_desc", "amount_asc"],
  COMMISSIONS: ["occurred_desc", "occurred_asc", "amount_desc", "amount_asc"],
  PAYOUTS: ["requested_desc", "requested_asc", "amount_desc", "amount_asc"],
} as const;

/**
 * Server-controlled report definition registry persisted by the Module 20 seed.
 * Filter metadata is descriptive UI/catalog metadata; Zod schemas remain the executable validation source of truth.
 */
export const REPORT_DEFINITION_CATALOG = [
  {
    code: REPORT_CODE.SALES,
    domain: "sales",
    requiredPermissions: [REPORTS_PERMISSION.SALES_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["from", "to", "sellerId", "storeId", "currency"],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.SELLERS,
    domain: "sellers",
    requiredPermissions: [REPORTS_PERMISSION.SELLER_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["from", "to", "sellerId", "currency"],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.INVENTORY,
    domain: "inventory",
    requiredPermissions: [REPORTS_PERMISSION.INVENTORY_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["sellerId", "storeId", "lowStockOnly"],
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.REFUNDS,
    domain: "refunds",
    requiredPermissions: [REPORTS_PERMISSION.FINANCE_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["from", "to", "sellerId", "storeId", "currency"],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.COMMISSIONS,
    domain: "commissions",
    requiredPermissions: [REPORTS_PERMISSION.FINANCE_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["from", "to", "sellerId", "currency"],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.PAYOUTS,
    domain: "payouts",
    requiredPermissions: [REPORTS_PERMISSION.FINANCE_READ],
    filterSchemaJson: {
      version: 1,
      fields: ["from", "to", "sellerId", "currency"],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
  {
    code: REPORT_CODE.AUDIT_LOG,
    domain: "audit",
    requiredPermissions: [
      DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
      DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT,
    ],
    filterSchemaJson: {
      version: 1,
      fields: [
        "actorUserId",
        "action",
        "resourceType",
        "resourceId",
        "sellerId",
        "from",
        "to",
      ],
      maxDateRangeDays: REPORTS_LIMITS.MAX_DATE_RANGE_DAYS,
    },
    outputFormats: REPORT_OUTPUT_FORMAT_VALUES,
    status: REPORT_DEFINITION_STATUS.ACTIVE,
  },
] as const;
