import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders simple previous/next pagination controls for Commission lists. */
export function CommissionPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-slate-600">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} item(s)
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.totalPages === 0 || meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
