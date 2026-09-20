import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Provides simple previous/next navigation for Product list pages. */
export function ProductPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-600">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} Products
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
          disabled={meta.page >= meta.totalPages || meta.totalPages === 0}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
