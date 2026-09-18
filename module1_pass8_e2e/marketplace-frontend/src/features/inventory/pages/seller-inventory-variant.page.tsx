import { useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { InventoryAdjustmentForm } from "../forms/inventory-adjustment-form";
import { InventoryReorderLevelForm } from "../forms/inventory-reorder-level-form";
import {
  useAdjustStockMutation,
  useUpdateReorderLevelMutation,
} from "../hooks/use-inventory";

const INVENTORY_ADJUST_PERMISSION = "inventory.adjust";
const INVENTORY_REORDER_PERMISSION = "inventory.reorder.manage";

/** Renders Inventory commands for a Product variant even before its first Inventory row exists. */
function SellerInventoryVariantContent({
  variantId,
  canAdjust,
  canManageReorder,
}: {
  variantId: string;
  canAdjust: boolean;
  canManageReorder: boolean;
}) {
  const adjust = useAdjustStockMutation(variantId);
  const reorder = useUpdateReorderLevelMutation(variantId);
  const latestItem = reorder.data ?? adjust.data;

  if (!canAdjust && !canManageReorder) {
    return (
      <ErrorState
        title="Inventory management permission required"
        message="Your seller account can read Inventory but cannot change stock or reorder thresholds."
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Manage variant Inventory</h1>
        <p className="mt-1 break-all text-sm text-slate-500">Variant {variantId}</p>
        <p className="mt-3 text-sm text-slate-600">
          This screen also works for a new Product variant that does not have an Inventory row yet.
          The server creates the zero-balance row only after an authorized command.
        </p>
        {latestItem ? (
          <div className="mt-4 grid max-w-xl grid-cols-3 gap-3 rounded-lg bg-slate-50 p-4 text-center text-sm">
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

/** Protects direct variant Inventory management with seller authentication and server-derived permissions. */
export function SellerInventoryVariantPage() {
  const { variantId } = useParams({ strict: false }) as { variantId: string };
  return (
    <SellerLayout>
      {(user) => (
        <SellerInventoryVariantContent
          variantId={variantId}
          canAdjust={user.permissions.includes(INVENTORY_ADJUST_PERMISSION)}
          canManageReorder={user.permissions.includes(INVENTORY_REORDER_PERMISSION)}
        />
      )}
    </SellerLayout>
  );
}
