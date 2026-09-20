import { ACTOR_TYPE } from "../../common/security/security.contract.js";

/** File lifecycle values persisted by Module 21. */
export const DOCUMENT_FILE_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
} as const;

export const DOCUMENT_FILE_STATUS_VALUES = [
  DOCUMENT_FILE_STATUS.PENDING,
  DOCUMENT_FILE_STATUS.CONFIRMED,
  DOCUMENT_FILE_STATUS.FAILED,
] as const;

/** Storage-provider identifiers supported by the Foundation S3/R2-compatible adapter. */
export const DOCUMENT_STORAGE_PROVIDER = {
  S3: "s3",
  R2: "r2",
  S3_COMPATIBLE: "s3_compatible",
} as const;

export type DocumentStorageProvider =
  (typeof DOCUMENT_STORAGE_PROVIDER)[keyof typeof DOCUMENT_STORAGE_PROVIDER];

/** Upload/link purposes named by the Module 21 business consumers. */
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

/** Sort keys accepted by the bounded audit search endpoint. */
export const AUDIT_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
} as const;

export const AUDIT_SORT_VALUES = [
  AUDIT_SORT.CREATED_DESC,
  AUDIT_SORT.CREATED_ASC,
] as const;

export type AuditSort = (typeof AUDIT_SORT)[keyof typeof AUDIT_SORT];

/** Actor values that can be persisted in the append-only audit ledger. */
export const DOCUMENT_AUDIT_ACTOR_TYPE_VALUES = [
  ACTOR_TYPE.SYSTEM,
  ACTOR_TYPE.PLATFORM_ADMIN,
  ACTOR_TYPE.SELLER,
  ACTOR_TYPE.CUSTOMER,
] as const;

/** Stable Module 21 permission codes consumed by route middleware and service policy checks. */
export const DOCUMENT_AUDIT_PERMISSION = {
  DOCUMENTS_UPLOAD: "documents.upload",
  DOCUMENTS_READ: "documents.read",
  DOCUMENTS_LINK: "documents.link",
  AUDIT_READ: "audit.read",
  AUDIT_EXPORT: "audit.export",
} as const;

/** Module-owned permission catalog merged into the central RBAC seed. */
export const DOCUMENT_AUDIT_PERMISSION_CATALOG = [
  {
    code: DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    domain: "documents",
    description: "Request constrained signed uploads for an authorized document purpose.",
  },
  {
    code: DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    domain: "documents",
    description: "Read authorized file metadata and request permission-checked downloads.",
  },
  {
    code: DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
    domain: "documents",
    description: "Link or unlink confirmed files to resources inside the actor's allowed scope.",
  },
  {
    code: DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
    domain: "audit",
    description: "Search and read audit records inside the actor's authorized scope.",
  },
  {
    code: DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT,
    domain: "audit",
    description: "Request an authorized audit export when the approved export workflow is available.",
  },
] as const;

/** Stable Module 21 error codes required by the Documents/Audit contract. */
export const DOCUMENT_AUDIT_ERROR_CODE = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_UPLOAD_INVALID: "FILE_UPLOAD_INVALID",
  FILE_SCOPE_FORBIDDEN: "FILE_SCOPE_FORBIDDEN",
  AUDIT_SCOPE_FORBIDDEN: "AUDIT_SCOPE_FORBIDDEN",
} as const;

/** Durable Module 21 domain events. Payloads must contain safe identifiers/state only. */
export const DOCUMENT_AUDIT_OUTBOX_EVENT = {
  FILE_UPLOAD_CONFIRMED: "file.upload_confirmed",
  FILE_LINKED: "file.linked",
  FILE_UNLINKED: "file.unlinked",
  AUDIT_EXPORT_REQUESTED: "audit.export_requested",
} as const;

/** API/database-aligned length and numeric limits used by Module 21 contracts. */
export const DOCUMENT_AUDIT_LIMITS = {
  ORIGINAL_NAME_MAX_LENGTH: 255,
  MIME_TYPE_MAX_LENGTH: 255,
  PURPOSE_MAX_LENGTH: 100,
  RESOURCE_TYPE_MAX_LENGTH: 100,
  RESOURCE_ID_MAX_LENGTH: 200,
  AUDIT_ACTION_MAX_LENGTH: 150,
  REQUEST_ID_MAX_LENGTH: 100,
  SIZE_BYTES_MAX: Number.MAX_SAFE_INTEGER,
} as const;

/** OpenAPI/Zod-shared lexical patterns for normalized text boundaries. */
export const DOCUMENT_AUDIT_PATTERN = {
  RESOURCE_TYPE: "^[A-Za-z][A-Za-z0-9_.-]*$",
  MIME_TYPE: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$",
} as const;
