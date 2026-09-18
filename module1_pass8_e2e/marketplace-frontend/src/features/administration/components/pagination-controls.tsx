import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders bounded previous/next controls from the API pagination metadata. */
export function PaginationControls({
  meta,
  onPage,
}: {
  meta: PaginationMeta;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
      <span>
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} items
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
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
