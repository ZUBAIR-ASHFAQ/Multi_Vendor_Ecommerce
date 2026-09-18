import type { ProductPublicationStatus, ProductStatus } from "../types/products.types";

/** Displays Product lifecycle state without implying that UI state is authoritative. */
export function ProductStatusBadge({
  status,
}: {
  status: ProductStatus | ProductPublicationStatus;
}) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {status.replaceAll("_", " ")}
    </span>
  );
}
