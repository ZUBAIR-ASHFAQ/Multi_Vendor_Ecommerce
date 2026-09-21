import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { FileUploadForm } from "../forms/file-upload-form";
import { DocumentsAuditLayout } from "../components/documents-audit-layout";
import { LinkedFileList } from "../components/linked-file-list";
import { RecentUploadList } from "../components/recent-upload-list";
import {
  DOCUMENT_AUDIT_PERMISSION,
  hasDocumentPermission,
} from "../documents-audit.constants";
import type {
  DocumentFile,
  LinkedDocumentItem,
  UploadedDocumentResult,
} from "../types/documents-audit.types";

/** Renders the current document workflow without inventing an undocumented file-list API. */
export function DocumentsPage() {
  const [recentFiles, setRecentFiles] = useState<DocumentFile[]>([]);
  const [linkedFiles, setLinkedFiles] = useState<LinkedDocumentItem[]>([]);

  /** Adds one successful upload to the page-local workflow and its optional account link. */
  const recordUpload = (result: UploadedDocumentResult) => {
    setRecentFiles((current) => [result.file, ...current.filter((file) => file.id !== result.file.id)]);
    const link = result.link;
    if (link) {
      setLinkedFiles((current) => [
        { file: result.file, link },
        ...current.filter((item) => item.link.id !== link.id),
      ]);
    }
  };

  return (
    <DocumentsAuditLayout>
      {(user) => {
        const canUpload = hasDocumentPermission(user.permissions, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD);
        const canRead = hasDocumentPermission(user.permissions, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ);
        const canLink = hasDocumentPermission(user.permissions, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK);

        if (!canUpload && !canRead && !canLink) {
          return (
            <ErrorState
              title="Access denied"
              message="Your account does not have permission to use document workflows."
            />
          );
        }

        return (
          <div className="space-y-5">
            <PageHeader
              eyebrow="Operations · Documents"
              title="Documents"
              description="Upload and access permission-checked evidence without exposing object storage or creating a generic file catalog that the API does not support."
              actions={(
                <div className="flex flex-wrap gap-2">
                  {canUpload ? <StatusPill tone="positive">Upload allowed</StatusPill> : null}
                  {canRead ? <StatusPill tone="info">Download allowed</StatusPill> : null}
                  {canLink ? <StatusPill tone="neutral">Link allowed</StatusPill> : null}
                </div>
              )}
            />

            {canUpload ? (
              <FileUploadForm user={user} onUploaded={recordUpload} />
            ) : (
              <Surface>
                <SectionHeader
                  title="Upload unavailable"
                  description="You can read authorized documents, but this account cannot request new uploads."
                />
              </Surface>
            )}

            <Surface>
              <SectionHeader
                title="Recent uploads"
                description="Files created during this page session only. The backend intentionally exposes no generic file-catalog endpoint."
              />
              <div className="mt-4">
                <RecentUploadList files={recentFiles} canDownload={canRead} />
              </div>
            </Surface>

            <Surface>
              <SectionHeader
                title="Linked files"
                description="Resource screens can reuse authorized file/link pairs they already own; this page does not enumerate unrelated resources."
              />
              <div className="mt-4">
                <LinkedFileList
                  items={linkedFiles}
                  canDownload={canRead}
                  canUnlink={canLink}
                  onUnlinked={(linkId) =>
                    setLinkedFiles((current) => current.filter((item) => item.link.id !== linkId))
                  }
                />
              </div>
            </Surface>
          </div>
        );
      }}
    </DocumentsAuditLayout>
  );
}
