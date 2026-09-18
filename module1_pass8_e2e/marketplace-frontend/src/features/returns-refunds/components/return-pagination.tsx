import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders simple previous/next navigation for bounded Return list APIs. */
export function ReturnPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">
        {meta.totalItems} Return{meta.totalItems === 1 ? "" : "s"} · Page {meta.page} of {Math.max(meta.totalPages, 1)}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={meta.totalPages === 0 || meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
