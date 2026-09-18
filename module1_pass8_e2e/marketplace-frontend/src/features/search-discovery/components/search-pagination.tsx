import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders URL-backed previous/next controls from standard Search pagination metadata. */
export function SearchPagination({
  meta,
  onPage,
}: {
  meta: PaginationMeta;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4 text-sm shadow-sm">
      <span>Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} results</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={meta.totalPages === 0 || meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
