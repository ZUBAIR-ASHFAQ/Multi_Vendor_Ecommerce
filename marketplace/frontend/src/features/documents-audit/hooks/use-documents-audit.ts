import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentsAuditApi } from "../api/documents-audit.api";
import type {
  AuditListParams,
  DocumentPurpose,
  UploadedDocumentResult,
} from "../types/documents-audit.types";
import { documentsAuditQueryKeys } from "./documents-audit.query-keys";

export interface UploadDocumentInput {
  file: File;
  purpose: DocumentPurpose;
  linkToAccount: boolean;
  actorId: string;
}

/** Executes sign -> direct storage PUT -> confirm -> optional account link as one UI mutation. */
export function useUploadDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadDocumentInput): Promise<UploadedDocumentResult> => {
      const signed = await documentsAuditApi.signUpload({
        originalName: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size,
        purpose: input.purpose,
      });
      await documentsAuditApi.uploadSignedObject(
        signed.uploadUrl,
        input.file,
        signed.requiredHeaders,
      );
      const confirmed = await documentsAuditApi.confirmUpload(signed.fileId);
      const linked = input.linkToAccount
        ? await documentsAuditApi.linkFile(signed.fileId, {
            resourceType: "user",
            resourceId: input.actorId,
            purpose: input.purpose,
          })
        : null;

      return { file: confirmed.file, link: linked?.link ?? null };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsAuditQueryKeys.all });
    },
  });
}


export interface UploadDocumentToResourceInput {
  file: File;
  purpose: DocumentPurpose;
  resourceType: string;
  resourceId: string;
}

/** Executes sign -> storage PUT -> confirm -> resource link for a downstream business module. */
export function useUploadDocumentToResourceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadDocumentToResourceInput): Promise<UploadedDocumentResult> => {
      const signed = await documentsAuditApi.signUpload({
        originalName: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size,
        purpose: input.purpose,
      });
      await documentsAuditApi.uploadSignedObject(
        signed.uploadUrl,
        input.file,
        signed.requiredHeaders,
      );
      const confirmed = await documentsAuditApi.confirmUpload(signed.fileId);
      const linked = await documentsAuditApi.linkFile(signed.fileId, {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose: input.purpose,
      });

      return { file: confirmed.file, link: linked.link };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsAuditQueryKeys.all });
    },
  });
}

/** Requests a fresh short-lived download grant on demand. */
export function useDocumentDownloadMutation() {
  return useMutation({ mutationFn: documentsAuditApi.getDownload });
}

/** Removes one active link and invalidates Module 21 caches. */
export function useUnlinkDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, linkId }: { fileId: string; linkId: string }) =>
      documentsAuditApi.unlinkFile(fileId, linkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsAuditQueryKeys.all });
    },
  });
}

/** Loads one page of permission-filtered audit metadata. */
export function useAuditLogsQuery(params: AuditListParams) {
  return useQuery({
    queryKey: documentsAuditQueryKeys.audit(params),
    queryFn: () => documentsAuditApi.listAuditLogs(params),
  });
}

/** Loads one audit detail record when a route supplied a valid identifier. */
export function useAuditLogQuery(id: string) {
  return useQuery({
    queryKey: documentsAuditQueryKeys.auditDetail(id),
    queryFn: () => documentsAuditApi.getAuditLog(id),
    enabled: Boolean(id),
  });
}
