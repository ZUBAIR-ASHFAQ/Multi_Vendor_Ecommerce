import { ORDER_STATUS_LABEL } from "../orders.constants";

/** Renders one server-owned Order status without allowing the UI to edit it. */
export function OrderStatus({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border bg-slate-50 px-2 py-1 text-xs font-medium">
      {ORDER_STATUS_LABEL[value] ?? value}
    </span>
  );
}
