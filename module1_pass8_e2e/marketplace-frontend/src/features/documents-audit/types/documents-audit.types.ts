import type { PaginationMeta } from "@/types/api";
import type {
  AuditSort,
  DocumentFileStatus,
  DocumentPurpose,
} from "../documents-audit.constants";

export type { AuditSort, DocumentFileStatus, DocumentPurpose };

export interface SignUploadInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: DocumentPurpose;
}

export interface SignedUploadResponse {
  fileId: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface DocumentFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentFileStatus;
  createdAt: string;
}

export interface ConfirmUploadResponse {
  file: DocumentFile;
}

export interface FileLink {
  id: string;
  fileId: string;
  resourceType: string;
  resourceId: string;
  purpose: DocumentPurpose;
  createdBy: string;
  createdAt: string;
}

export interface LinkFileInput {
  resourceType: string;
  resourceId: string;
  purpose: DocumentPurpose;
}

export interface LinkFileResponse {
  link: FileLink;
}

export interface SignedDownloadResponse {
  file: DocumentFile;
  downloadUrl: string;
  expiresAt: string;
}

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  sellerId?: string;
  from?: string;
  to?: string;
  sort?: AuditSort;
}

export interface AuditLogSummary {
  id: string;
  actorUserId: string | null;
  actorType: "system" | "platform_admin" | "seller" | "customer";
  action: string;
  resourceType: string;
  resourceId: string | null;
  sellerId: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditLogDetail extends AuditLogSummary {
  before: unknown | null;
  after: unknown | null;
}

export interface PaginatedAuditLogs {
  items: AuditLogSummary[];
  meta: PaginationMeta;
}

/** One confirmed upload optionally linked during the current UI workflow. */
export interface UploadedDocumentResult {
  file: DocumentFile;
  link: FileLink | null;
}

/** One file/link pair supplied to the reusable linked-file list. */
export interface LinkedDocumentItem {
  file: DocumentFile;
  link: FileLink;
}
