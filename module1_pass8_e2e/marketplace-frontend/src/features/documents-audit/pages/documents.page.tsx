import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
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

/** Renders the current Module 21 document workflow without inventing an undocumented file-list API. */
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
            {canUpload ? (
              <FileUploadForm user={user} onUploaded={recordUpload} />
            ) : (
              <section className="rounded-xl border bg-white p-5 shadow-sm">
                <h1 className="text-2xl font-bold">Documents</h1>
                <p className="mt-1 text-sm text-slate-600">You can read authorized documents but cannot request uploads.</p>
              </section>
            )}

            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-bold">Recent uploads</h2>
              <p className="mt-1 text-sm text-slate-600">
                This list contains files created during the current page session. Module 21
                intentionally has no generic file-catalog endpoint.
              </p>
              <div className="mt-4">
                <RecentUploadList files={recentFiles} canDownload={canRead} />
              </div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-bold">Linked files</h2>
              <p className="mt-1 text-sm text-slate-600">
                Downstream resource screens can reuse this list with links they already own.
                Current-stage uploads may link only to your own user resource.
              </p>
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
            </section>
          </div>
        );
      }}
    </DocumentsAuditLayout>
  );
}
