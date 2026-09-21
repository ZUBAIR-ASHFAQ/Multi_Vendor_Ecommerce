import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders bounded previous/next controls from server pagination metadata. */
export function ReportPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground-muted">
      <span>
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems.toLocaleString()} rows
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
