import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Provides simple previous/next controls for the admin customer list. */
export function CustomerPagination({
  meta,
  onPage,
}: {
  meta: PaginationMeta;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} customers
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
