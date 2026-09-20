import { SHIPMENT_STATUS_LABEL } from "../shipping.constants";

/** Renders one server-owned Shipment status as read-only UI. */
export function ShipmentStatus({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border bg-slate-50 px-2 py-1 text-xs font-medium">
      {SHIPMENT_STATUS_LABEL[value] ?? value}
    </span>
  );
}
