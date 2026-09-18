import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { useDocumentDownloadMutation } from "../hooks/use-documents-audit";

/** Requests a fresh signed download and exposes the short-lived URL only after authorization succeeds. */
export function DocumentDownload({ fileId }: { fileId: string }) {
  const download = useDocumentDownloadMutation();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate(fileId)}
      >
        {download.isPending ? "Authorizing..." : "Request download"}
      </Button>
      {download.data && (
        <a
          className="block text-sm font-medium underline"
          href={download.data.downloadUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open signed download
        </a>
      )}
      <FormError error={download.error} />
    </div>
  );
}
