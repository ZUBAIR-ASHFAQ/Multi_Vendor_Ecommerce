import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Provides simple previous/next paging for the finance Payment search. */
export function PaymentPagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-sm text-slate-600">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} Payments
      </p>
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
