import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/types/api";

/** Provides small previous/next controls for Wallet-ledger and Payout list pages. */
export function PayoutPagination({
  meta,
  label,
  onPageChange,
}: {
  meta: PaginationMeta;
  label: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
      <p className="text-slate-600">Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} {label}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
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
