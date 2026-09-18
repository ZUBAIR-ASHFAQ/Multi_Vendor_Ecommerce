import type { DocumentFile } from "../types/documents-audit.types";
import { DocumentDownload } from "./document-download";

/** Shows confirmed uploads created in the current page workflow without pretending to be a server-backed file catalog. */
export function RecentUploadList({
  files,
  canDownload,
}: {
  files: DocumentFile[];
  canDownload: boolean;
}) {
  if (files.length === 0) {
    return <p className="text-sm text-slate-500">No files uploaded during this page session.</p>;
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <article key={file.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold">{file.originalName}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {file.mimeType} · {file.sizeBytes.toLocaleString()} bytes · {file.status}
              </p>
            </div>
            {canDownload && <DocumentDownload fileId={file.id} />}
          </div>
        </article>
      ))}
    </div>
  );
}
