import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders simple bounded previous/next controls using server pagination metadata. */
export function ReviewPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  if (meta.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t pt-4">
      <Button
        type="button"
        variant="outline"
        disabled={meta.page <= 1}
        onClick={() => onPageChange(meta.page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-slate-600">
        Page {meta.page} of {meta.totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={meta.page >= meta.totalPages}
        onClick={() => onPageChange(meta.page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
