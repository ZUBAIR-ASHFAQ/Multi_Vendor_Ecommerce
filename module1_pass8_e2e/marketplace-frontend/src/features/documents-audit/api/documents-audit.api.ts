import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  AuditListParams,
  AuditLogDetail,
  AuditLogSummary,
  ConfirmUploadResponse,
  LinkFileInput,
  LinkFileResponse,
  PaginatedAuditLogs,
  SignedDownloadResponse,
  SignedUploadResponse,
  SignUploadInput,
} from "../types/documents-audit.types";

/** Removes empty query values before sending documented audit filters. */
function queryParams(value: AuditListParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Record<string, string | number>;
}

/** Unwraps one successful API response while preserving normalized interceptor failures. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps a paginated audit response with a defensive metadata fallback. */
async function page(
  request: Promise<{ data: ApiResponse<AuditLogSummary[], PaginationMeta> }>,
): Promise<PaginatedAuditLogs> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);

  return {
    items: response.data.data,
    meta: response.data.meta ?? {
      page: 1,
      pageSize: response.data.data.length,
      totalItems: response.data.data.length,
      totalPages: response.data.data.length > 0 ? 1 : 0,
    },
  };
}

/** Uploads bytes directly to the signed storage URL without API auth/cookie interceptors. */
async function putSignedObject(
  uploadUrl: string,
  file: File,
  requiredHeaders: Record<string, string>,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: requiredHeaders,
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error("The file could not be uploaded to object storage.");
  }
}

export const documentsAuditApi = {
  /** Requests pending metadata plus one short-lived constrained upload URL. */
  signUpload: (input: SignUploadInput) =>
    one<SignedUploadResponse>(apiClient.post("/documents/uploads/sign", input)),

  /** Sends bytes directly to storage using only headers required by the signed grant. */
  uploadSignedObject: putSignedObject,

  /** Confirms provider metadata after the direct upload completes. */
  confirmUpload: (fileId: string) =>
    one<ConfirmUploadResponse>(apiClient.post(`/documents/uploads/${fileId}/confirm`)),

  /** Links one confirmed file to an authorized business resource. */
  linkFile: (fileId: string, input: LinkFileInput) =>
    one<LinkFileResponse>(apiClient.post(`/documents/${fileId}/link`, input)),

  /** Requests one short-lived permission-checked signed download URL. */
  getDownload: (fileId: string) =>
    one<SignedDownloadResponse>(apiClient.get(`/documents/${fileId}/download`)),

  /** Removes one active file/resource link without deleting the physical object. */
  unlinkFile: (fileId: string, linkId: string) =>
    one<{ unlinked: true }>(apiClient.delete(`/documents/${fileId}/link/${linkId}`)),

  /** Searches append-only audit metadata using only documented bounded filters. */
  listAuditLogs: (params: AuditListParams) =>
    page(apiClient.get("/audit", { params: queryParams(params) })),

  /** Reads one permission-filtered audit detail record. */
  getAuditLog: (id: string) => one<AuditLogDetail>(apiClient.get(`/audit/${id}`)),
};
