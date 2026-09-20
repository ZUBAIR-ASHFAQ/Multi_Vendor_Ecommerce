import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Renders small bounded previous/next controls for Notification lists. */
export function NotificationPagination({
  meta,
  label,
  onPageChange,
}: {
  meta: PaginationMeta;
  label: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        {label}: page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} total
      </span>
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
