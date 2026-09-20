/** Stable Module 21 permission codes returned by the backend RBAC context. */
export const DOCUMENT_AUDIT_PERMISSION = {
  DOCUMENTS_UPLOAD: "documents.upload",
  DOCUMENTS_READ: "documents.read",
  DOCUMENTS_LINK: "documents.link",
  AUDIT_READ: "audit.read",
  AUDIT_EXPORT: "audit.export",
} as const;

/** Upload purposes exposed by the Module 21 API contract. */
export const DOCUMENT_PURPOSE = {
  PRODUCT_MEDIA: "product_media",
  SELLER_VERIFICATION: "seller_verification",
  STORE_ASSET: "store_asset",
  REPORT_EXPORT: "report_export",
  OPERATIONAL_EVIDENCE: "operational_evidence",
} as const;

export const DOCUMENT_PURPOSE_VALUES = [
  DOCUMENT_PURPOSE.PRODUCT_MEDIA,
  DOCUMENT_PURPOSE.SELLER_VERIFICATION,
  DOCUMENT_PURPOSE.STORE_ASSET,
  DOCUMENT_PURPOSE.REPORT_EXPORT,
  DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
] as const;

export type DocumentPurpose =
  (typeof DOCUMENT_PURPOSE)[keyof typeof DOCUMENT_PURPOSE];

/** File status values returned by Module 21. */
export const DOCUMENT_FILE_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
} as const;

export type DocumentFileStatus =
  (typeof DOCUMENT_FILE_STATUS)[keyof typeof DOCUMENT_FILE_STATUS];

/** Sort keys accepted by the audit search API. */
export const AUDIT_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
} as const;

export const AUDIT_SORT_VALUES = [
  AUDIT_SORT.CREATED_DESC,
  AUDIT_SORT.CREATED_ASC,
] as const;

export type AuditSort = (typeof AUDIT_SORT)[keyof typeof AUDIT_SORT];

/** Human-readable audit sort choices shared by the filter UI. */
export const AUDIT_SORT_OPTIONS = [
  { value: AUDIT_SORT.CREATED_DESC, label: "Newest first" },
  { value: AUDIT_SORT.CREATED_ASC, label: "Oldest first" },
] as const;

/** Client-side limits mirror the documented Module 21 HTTP boundary. */
export const DOCUMENT_AUDIT_LIMITS = {
  AUDIT_ACTION_MAX_LENGTH: 150,
  RESOURCE_TYPE_MAX_LENGTH: 100,
  RESOURCE_ID_MAX_LENGTH: 200,
} as const;

/** Client validation pattern mirrors the documented normalized resource-type boundary. */
export const DOCUMENT_RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_.-]*$/i;

/** Human-readable upload purpose choices for Module 21 forms. */
export const DOCUMENT_PURPOSE_OPTIONS = [
  { value: DOCUMENT_PURPOSE.PRODUCT_MEDIA, label: "Product media" },
  { value: DOCUMENT_PURPOSE.SELLER_VERIFICATION, label: "Seller verification" },
  { value: DOCUMENT_PURPOSE.REPORT_EXPORT, label: "Report export" },
  { value: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE, label: "Operational evidence" },
] as const;

/** Returns true when the server-derived permission list contains one Module 21 permission. */
export function hasDocumentPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
