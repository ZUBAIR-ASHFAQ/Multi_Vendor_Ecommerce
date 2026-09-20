import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { SellerLayout } from "@/features/sellers/components/seller-layout";
import { formatMoney } from "@/lib/money";
import { InventoryAdjustmentForm } from "../forms/inventory-adjustment-form";
import { InventoryReorderLevelForm } from "../forms/inventory-reorder-level-form";
import {
  useAdjustStockMutation,
  useSellerInventoryQuery,
  useUpdateReorderLevelMutation,
} from "../hooks/use-inventory";

const INVENTORY_READ_PERMISSION = "inventory.read";
const INVENTORY_ADJUST_PERMISSION = "inventory.adjust";
const INVENTORY_REORDER_PERMISSION = "inventory.reorder.manage";

/** Renders Inventory commands for a Product variant even before its first Inventory row exists. */
function SellerInventoryVariantContent({
  variantId,
  canRead,
  canAdjust,
  canManageReorder,
}: {
  variantId: string;
  canRead: boolean;
  canAdjust: boolean;
  canManageReorder: boolean;
}) {
  const inventory = useSellerInventoryQuery({ page: 1, pageSize: 1, variantId }, canRead);
  const adjust = useAdjustStockMutation(variantId);
  const reorder = useUpdateReorderLevelMutation(variantId);
  const contextItem = inventory.data?.items[0];
  const latestItem = reorder.data ?? adjust.data ?? contextItem;

  if (!canAdjust && !canManageReorder) {
    return (
      <ErrorState
        title="Inventory management permission required"
        message="Your seller account cannot change stock or reorder thresholds."
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inventory management</p>
            <h1 className="mt-1 text-2xl font-bold">
              {contextItem ? `${contextItem.productName} · ${contextItem.variantTitle}` : "Manage variant Inventory"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {contextItem ? `SKU ${contextItem.variantSku} · ${contextItem.storeName}` : `Variant ${variantId}`}
            </p>
            {contextItem ? (
              <p className="mt-2 text-sm font-medium text-slate-700">
                {formatMoney(contextItem.variantPrice, contextItem.variantCurrency)} · {contextItem.variantStatus}
              </p>
            ) : (
              <p className="mt-3 max-w-2xl text-sm text-slate-600">
                This variant does not have an Inventory row yet. The server creates the zero-balance row only after an authorized stock or reorder command.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canRead ? (
              <Button variant="outline" asChild><Link to="/seller/inventory">Back to Inventory</Link></Button>
            ) : null}
            {contextItem ? (
              <Button variant="ghost" asChild>
                <Link to="/seller/products/$productId" params={{ productId: contextItem.productId }}>Open Product</Link>
              </Button>
            ) : null}
          </div>
        </div>
        {latestItem ? (
          <div className="mt-5 grid max-w-2xl grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4 text-center text-sm">
            <div><strong className="block text-xl">{latestItem.onHandQty}</strong><span className="text-slate-500">On hand</span></div>
            <div><strong className="block text-xl">{latestItem.reservedQty}</strong><span className="text-slate-500">Reserved</span></div>
            <div><strong className="block text-xl">{latestItem.availableQty}</strong><span className="text-slate-500">Available</span></div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {canAdjust ? (
          <InventoryAdjustmentForm
            variantId={variantId}
            isPending={adjust.isPending}
            error={adjust.error}
            onSubmit={async (quantityDelta) => {
              await adjust.mutateAsync(quantityDelta);
            }}
          />
        ) : (
          <p className="rounded-lg border bg-white p-4 text-sm text-slate-500 shadow-sm">
            You do not have permission to adjust physical stock.
          </p>
        )}

        {canManageReorder ? (
          <InventoryReorderLevelForm
            key={`${variantId}:${latestItem?.reorderLevel ?? "unknown"}`}
            reorderLevel={latestItem?.reorderLevel ?? null}
            isPending={reorder.isPending}
            error={reorder.error}
            onSubmit={async (reorderLevel) => {
              await reorder.mutateAsync(reorderLevel);
            }}
          />
        ) : (
          <p className="rounded-lg border bg-white p-4 text-sm text-slate-500 shadow-sm">
            You do not have permission to manage reorder thresholds.
          </p>
        )}
      </div>
    </div>
  );
}

/** Preserves direct Inventory command access while enriching the page when read access is available. */
export function SellerInventoryVariantPage() {
  const { variantId } = useParams({ strict: false }) as { variantId: string };
  return (
    <SellerLayout>
      {(user) => (
        <SellerInventoryVariantContent
          variantId={variantId}
          canRead={user.permissions.includes(INVENTORY_READ_PERMISSION)}
          canAdjust={user.permissions.includes(INVENTORY_ADJUST_PERMISSION)}
          canManageReorder={user.permissions.includes(INVENTORY_REORDER_PERMISSION)}
        />
      )}
    </SellerLayout>
  );
}
