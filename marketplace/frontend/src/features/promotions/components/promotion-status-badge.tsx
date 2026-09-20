import { PROMOTION_STATUS } from "../promotions.constants";
import type { Promotion } from "../schemas/promotions.schemas";

/** Renders a compact label for one promotion lifecycle status. */
export function PromotionStatusBadge({ status }: { status: Promotion["status"] }) {
  const label = status.replaceAll("_", " ");
  const className =
    status === PROMOTION_STATUS.ACTIVE
      ? "bg-emerald-100 text-emerald-800"
      : status === PROMOTION_STATUS.SCHEDULED
        ? "bg-blue-100 text-blue-800"
        : status === PROMOTION_STATUS.DRAFT
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${className}`}>
      {label}
    </span>
  );
}
