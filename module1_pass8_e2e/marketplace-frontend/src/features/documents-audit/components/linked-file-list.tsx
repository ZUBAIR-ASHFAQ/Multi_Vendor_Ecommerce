import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { useUnlinkDocumentMutation } from "../hooks/use-documents-audit";
import type { LinkedDocumentItem } from "../types/documents-audit.types";
import { DocumentDownload } from "./document-download";

/** Renders file/link pairs supplied by an authorized resource workflow and supports safe unlink/download commands. */
export function LinkedFileList({
  items,
  canDownload,
  canUnlink,
  onUnlinked,
}: {
  items: LinkedDocumentItem[];
  canDownload: boolean;
  canUnlink: boolean;
  onUnlinked: (linkId: string) => void;
}) {
  const unlink = useUnlinkDocumentMutation();

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No linked files are available in this workflow yet.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map(({ file, link }) => (
        <article key={link.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold">{file.originalName}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {file.mimeType} · {file.sizeBytes.toLocaleString()} bytes
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {link.resourceType} · {link.purpose}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canDownload && <DocumentDownload fileId={file.id} />}
              {canUnlink && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={unlink.isPending}
                  onClick={() => {
                    void unlink
                      .mutateAsync({ fileId: file.id, linkId: link.id })
                      .then(() => onUnlinked(link.id));
                  }}
                >
                  Unlink
                </Button>
              )}
            </div>
          </div>
        </article>
      ))}
      <FormError error={unlink.error} />
    </div>
  );
}
