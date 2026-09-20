import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { InventoryPagination } from "../components/inventory-pagination";
import { useSellerInventoryQuery, useStockMovementsQuery } from "../hooks/use-inventory";
import type { StockMovementListParams } from "../schemas/inventory.schemas";

const INVENTORY_READ_PERMISSION = "inventory.read";

/** Formats one immutable movement timestamp for the current browser locale. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Adds a visible plus sign to positive movement deltas. */
function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Renders one seller-owned variant's immutable stock movement history. */
function SellerInventoryMovementsContent({ variantId }: { variantId: string }) {
  const [params, setParams] = useState<StockMovementListParams>({ page: 1, pageSize: 20 });
  const inventory = useSellerInventoryQuery({ page: 1, pageSize: 1, variantId });
  const movements = useStockMovementsQuery(variantId, params);
  const contextItem = inventory.data?.items[0];

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inventory ledger</p>
            <h1 className="mt-1 text-2xl font-bold">Stock movement history</h1>
            <p className="mt-1 text-sm text-slate-500">
              {contextItem
                ? `${contextItem.productName} · ${contextItem.variantTitle} · SKU ${contextItem.variantSku}`
                : `Variant ${variantId}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/seller/inventory">Back to Inventory</Link></Button>
            {contextItem ? (
              <Button asChild variant="ghost"><Link to="/seller/products/$productId" params={{ productId: contextItem.productId }}>Open Product</Link></Button>
            ) : null}
          </div>
        </div>
      </section>

      {movements.isPending ? <LoadingState label="Loading stock movements..." /> : null}
      {movements.isError ? (
        <ErrorState
          title="Stock movements could not be loaded"
          message={movements.error instanceof Error ? movements.error.message : "Please try again."}
          onRetry={() => void movements.refetch()}
        />
      ) : null}

      {movements.data ? (
        <>
          {movements.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
              No movement history exists for this variant yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.items.map((movement) => (
                    <tr key={movement.id} className="border-b last:border-0">
                      <td className="px-4 py-3">{formatDate(movement.occurredAt)}</td>
                      <td className="px-4 py-3 capitalize">{movement.movementType}</td>
                      <td className="px-4 py-3 font-semibold">{formatDelta(movement.quantityDelta)}</td>
                      <td className="px-4 py-3">
                        <span className="block">{movement.sourceType.replaceAll("_", " ")}</span>
                        {movement.sourceId ? <span className="block text-xs text-slate-500">{movement.sourceId}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{movement.actorUserId ?? "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <InventoryPagination
            meta={movements.data.meta}
            noun="movements"
            onPageChange={(page) => setParams((current) => ({ ...current, page }))}
          />
        </>
      ) : null}
    </div>
  );
}

/** Protects stock movement history with the same seller Inventory read permission as the list page. */
export function SellerInventoryMovementsPage() {
  const { variantId } = useParams({ strict: false }) as { variantId: string };
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={INVENTORY_READ_PERMISSION}>
          <SellerInventoryMovementsContent variantId={variantId} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
