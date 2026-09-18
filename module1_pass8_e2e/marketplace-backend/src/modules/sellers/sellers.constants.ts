import {
  ADMIN_PERMISSION,
  ROLE_SCOPE_TYPE,
} from "../administration/administration.constants.js";
import { DOCUMENT_AUDIT_PERMISSION } from "../documents-audit/documents-audit.constants.js";

/** Seller-application lifecycle values persisted by Module 4. */
export const SELLER_APPLICATION_STATUS = {
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export const SELLER_APPLICATION_STATUS_VALUES = [
  SELLER_APPLICATION_STATUS.SUBMITTED,
  SELLER_APPLICATION_STATUS.APPROVED,
  SELLER_APPLICATION_STATUS.REJECTED,
] as const;

/** Seller commercial lifecycle values persisted by Module 4. */
export const SELLER_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
} as const;

export const SELLER_STATUS_VALUES = [
  SELLER_STATUS.ACTIVE,
  SELLER_STATUS.SUSPENDED,
] as const;

/** The current seller master is created only after application approval. */
export const SELLER_APPROVAL_STATUS = {
  APPROVED: "approved",
} as const;

export const SELLER_APPROVAL_STATUS_VALUES = [
  SELLER_APPROVAL_STATUS.APPROVED,
] as const;

/** Store lifecycle values persisted by Module 4. */
export const STORE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;

export const STORE_STATUS_VALUES = [
  STORE_STATUS.ACTIVE,
  STORE_STATUS.INACTIVE,
  STORE_STATUS.SUSPENDED,
] as const;

/** Seller-staff membership states synchronized with seller-scoped role assignments. */
export const SELLER_STAFF_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

/** Store states a seller may choose through the normal store update command. */
export const SELLER_EDITABLE_STORE_STATUS_VALUES = [
  STORE_STATUS.ACTIVE,
  STORE_STATUS.INACTIVE,
] as const;

/** Allow-listed ordering for the privileged seller-application review queue. */
export const SELLER_APPLICATION_SORT = {
  CREATED_DESC: "created_desc",
  CREATED_ASC: "created_asc",
} as const;

export const SELLER_APPLICATION_SORT_VALUES = [
  SELLER_APPLICATION_SORT.CREATED_DESC,
  SELLER_APPLICATION_SORT.CREATED_ASC,
] as const;

/** Stable Module 4 permissions used by routes, services and seller role grants. */
export const SELLER_PERMISSION = {
  PROFILE_READ: "seller.profile.read",
  PROFILE_MANAGE: "seller.profile.manage",
  STORE_MANAGE: "seller.store.manage",
  STAFF_MANAGE: ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
  ADMIN_REVIEW: "admin.sellers.review",
  ADMIN_SUSPEND: "admin.sellers.suspend",
} as const;

/** Module 4-owned permission catalog. seller.staff.manage stays owned by Module 2. */
export const SELLER_PERMISSION_CATALOG = [
  {
    code: SELLER_PERMISSION.PROFILE_READ,
    domain: "seller",
    description: "Read the current authorized seller profile, stores and staff summary.",
  },
  {
    code: SELLER_PERMISSION.PROFILE_MANAGE,
    domain: "seller",
    description: "Update permitted fields on the current authorized seller profile.",
  },
  {
    code: SELLER_PERMISSION.STORE_MANAGE,
    domain: "seller",
    description: "Create and update stores inside the current authorized seller scope.",
  },
  {
    code: SELLER_PERMISSION.ADMIN_REVIEW,
    domain: "admin",
    description: "Review seller applications and approve or reject submitted applications.",
  },
  {
    code: SELLER_PERMISSION.ADMIN_SUSPEND,
    domain: "admin",
    description: "Suspend an approved seller and stop new commerce activation for its stores.",
  },
] as const;

/** Protected seller-scoped role definitions created by platform RBAC composition. */
export const SELLER_SYSTEM_ROLE = {
  OWNER: {
    code: "seller_owner",
    scopeType: ROLE_SCOPE_TYPE.SELLER,
    name: "Seller Owner",
    description: "Protected seller-scoped role for the approved owner of a seller account.",
  },
  MANAGER: {
    code: "seller_manager",
    scopeType: ROLE_SCOPE_TYPE.SELLER,
    name: "Seller Manager",
    description: "Protected seller-scoped role for approved seller management staff.",
  },
} as const;

/** Permissions granted to the protected seller-owner role by platform RBAC composition. */
export const SELLER_OWNER_PERMISSION_CODES = [
  SELLER_PERMISSION.PROFILE_READ,
  SELLER_PERMISSION.PROFILE_MANAGE,
  SELLER_PERMISSION.STORE_MANAGE,
  SELLER_PERMISSION.STAFF_MANAGE,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
] as const;

/** Permissions granted to seller managers; staff-management stays owner-controlled by default. */
export const SELLER_MANAGER_PERMISSION_CODES = [
  SELLER_PERMISSION.PROFILE_READ,
  SELLER_PERMISSION.PROFILE_MANAGE,
  SELLER_PERMISSION.STORE_MANAGE,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
  DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
] as const;

/** Stable Module 4 business error codes required by the controlling guide. */
export const SELLER_ERROR_CODE = {
  SELLER_NOT_FOUND: "SELLER_NOT_FOUND",
  SELLER_NOT_APPROVED: "SELLER_NOT_APPROVED",
  STORE_NOT_FOUND: "STORE_NOT_FOUND",
  STORE_SLUG_TAKEN: "STORE_SLUG_TAKEN",
  SELLER_SCOPE_FORBIDDEN: "SELLER_SCOPE_FORBIDDEN",
} as const;

/** Durable Module 4 events named by the controlling requirements. */
export const SELLER_OUTBOX_EVENT = {
  APPLICATION_SUBMITTED: "seller.application_submitted",
  SELLER_APPROVED: "seller.approved",
  SELLER_REJECTED: "seller.rejected",
  SELLER_SUSPENDED: "seller.suspended",
  STORE_CREATED: "store.created",
  STORE_UPDATED: "store.updated",
} as const;

/** Concise audit action names for meaningful Module 4 writes. */
export const SELLER_AUDIT_ACTION = {
  APPLICATION_SUBMITTED: "seller.application_submitted",
  APPLICATION_APPROVED: "seller.application_approved",
  APPLICATION_REJECTED: "seller.application_rejected",
  PROFILE_UPDATED: "seller.profile_updated",
  STORE_CREATED: "seller.store_created",
  STORE_UPDATED: "seller.store_updated",
  SELLER_SUSPENDED: "seller.suspended",
  STAFF_MEMBERSHIP_CHANGED: "seller.staff_membership_changed",
} as const;

/** Resource types authorized through Module 21's injected document-resource policy. */
export const SELLER_DOCUMENT_RESOURCE_TYPE = {
  APPLICATION: "seller_application",
  SELLER: "seller",
  STORE: "store",
} as const;

/** Database-aligned text limits used by Module 4 request and response contracts. */
export const SELLER_LIMITS = {
  LEGAL_NAME_MAX_LENGTH: 220,
  DISPLAY_NAME_MAX_LENGTH: 200,
  TAX_ID_MAX_LENGTH: 120,
  STORE_SLUG_MAX_LENGTH: 160,
  STORE_NAME_MAX_LENGTH: 200,
  SUPPORT_EMAIL_MAX_LENGTH: 320,
} as const;

/** Lexical patterns shared by Module 4 validation and future OpenAPI metadata. */
export const SELLER_PATTERN = {
  STORE_SLUG: "^[a-z0-9]+(-[a-z0-9]+)*$",
  CURRENCY: "^[A-Z]{3}$",
} as const;
