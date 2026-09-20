import type { InventoryItem } from "../schemas/inventory.schemas";

/** Returns true when an Inventory row is at or below its configured reorder threshold. */
export function isLowStock(item: InventoryItem): boolean {
  return item.reorderLevel !== null && item.availableQty <= item.reorderLevel;
}

/** Displays a compact low-stock state without hiding the authoritative quantity columns. */
export function InventoryStatus({ item }: { item: InventoryItem }) {
  if (item.reorderLevel === null) {
    return <span className="text-xs text-slate-500">No threshold</span>;
  }

  if (isLowStock(item)) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
        Low stock
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
      Healthy
    </span>
  );
}
