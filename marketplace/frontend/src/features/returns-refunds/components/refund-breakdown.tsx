import { RETURN_ITEM_RESOLUTION_LABEL } from "../returns-refunds.constants";
import type { ReturnRequest } from "../types/returns-refunds.types";

/** Formats display-only scale-4 refund money without using it for business calculations. */
function money(value: string): string {
  return Number(value).toFixed(2);
}

/** Shows persisted refund/restock outcomes while keeping the two effects visibly separate. */
export function RefundBreakdown({ value }: { value: ReturnRequest }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-slate-500">
            <th className="py-2">Order item</th>
            <th>Qty</th>
            <th>Resolution</th>
            <th>Refund</th>
            <th>Restock qty</th>
          </tr>
        </thead>
        <tbody>
          {value.items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2 font-mono text-xs">{item.orderItemId}</td>
              <td>{item.quantity}</td>
              <td>{item.resolution ? RETURN_ITEM_RESOLUTION_LABEL[item.resolution] : "Pending inspection"}</td>
              <td>{money(item.refundAmount)}</td>
              <td>{item.restockQty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
