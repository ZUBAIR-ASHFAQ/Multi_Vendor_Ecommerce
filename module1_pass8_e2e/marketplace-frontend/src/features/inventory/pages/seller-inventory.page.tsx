import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { InventoryPagination } from "../components/inventory-pagination";
import { InventoryStatus } from "../components/inventory-status";
import { InventoryAdjustmentForm } from "../forms/inventory-adjustment-form";
import { InventoryReorderLevelForm } from "../forms/inventory-reorder-level-form";
import {
  useAdjustStockMutation,
  useSellerInventoryQuery,
  useUpdateReorderLevelMutation,
} from "../hooks/use-inventory";
import type { InventoryItem, SellerInventoryListParams } from "../schemas/inventory.schemas";

const INVENTORY_PERMISSION = {
  READ: "inventory.read",
  ADJUST: "inventory.adjust",
  REORDER_MANAGE: "inventory.reorder.manage",
} as const;

/** Shortens UUIDs only for table readability while preserving the full value in the title attribute. */
function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}

/** Renders quantity-management forms for one currently selected Inventory row. */
function InventoryManager({
  item,
  canAdjust,
  canManageReorder,
}: {
  item: InventoryItem;
  canAdjust: boolean;
  canManageReorder: boolean;
}) {
  const adjust = useAdjustStockMutation(item.variantId);
  const reorder = useUpdateReorderLevelMutation(item.variantId);

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Manage selected variant</h2>
          <p className="mt-1 text-sm text-slate-500" title={item.variantId}>Variant {shortId(item.variantId)}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div><strong className="block text-lg">{item.onHandQty}</strong><span className="text-slate-500">On hand</span></div>
          <div><strong className="block text-lg">{item.reservedQty}</strong><span className="text-slate-500">Reserved</span></div>
          <div><strong className="block text-lg">{item.availableQty}</strong><span className="text-slate-500">Available</span></div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {canAdjust ? (
          <InventoryAdjustmentForm
            variantId={item.variantId}
            isPending={adjust.isPending}
            error={adjust.error}
            onSubmit={async (quantityDelta) => {
              await adjust.mutateAsync(quantityDelta);
            }}
          />
        ) : (
          <p className="rounded-lg border p-4 text-sm text-slate-500">You do not have permission to adjust stock.</p>
        )}

        {canManageReorder ? (
          <InventoryReorderLevelForm
            key={`${item.variantId}:${item.reorderLevel ?? "disabled"}`}
            reorderLevel={item.reorderLevel}
            isPending={reorder.isPending}
            error={reorder.error}
            onSubmit={async (reorderLevel) => {
              await reorder.mutateAsync(reorderLevel);
            }}
          />
        ) : (
          <p className="rounded-lg border p-4 text-sm text-slate-500">You do not have permission to manage reorder thresholds.</p>
        )}
      </div>
    </section>
  );
}

/** Renders the seller Inventory table, filters, stock management, and low-stock states. */
function SellerInventoryContent({
  storeIds,
  permissions,
}: {
  storeIds: string[];
  permissions: string[];
}) {
  const [params, setParams] = useState<SellerInventoryListParams>({ page: 1, pageSize: 20 });
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const inventory = useSellerInventoryQuery(params);
  const selectedItem = useMemo(
    () => inventory.data?.items.find((item) => item.variantId === selectedVariantId) ?? null,
    [inventory.data?.items, selectedVariantId],
  );
  const filterForm = useForm({
    defaultValues: { storeId: "", lowStock: false },
    onSubmit: ({ value }) => {
      setSelectedVariantId(null);
      setParams({
        page: 1,
        pageSize: 20,
        storeId: value.storeId || undefined,
        lowStock: value.lowStock || undefined,
      });
    },
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Inventory & Stock</h1>
        <p className="mt-1 text-sm text-slate-600">
          Track on-hand, reserved, and available quantity. Physical stock changes are recorded in the immutable movement ledger.
        </p>

        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void filterForm.handleSubmit();
          }}
        >
          <filterForm.Field name="storeId">
            {(field) => (
              <label className="text-sm font-medium">
                Store
                <select
                  aria-label="Inventory store filter"
                  className="mt-1 block rounded-md border px-3 py-2"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">All allowed stores</option>
                  {storeIds.map((storeId) => <option key={storeId} value={storeId}>{shortId(storeId)}</option>)}
                </select>
              </label>
            )}
          </filterForm.Field>
          <filterForm.Field name="lowStock">
            {(field) => (
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
                <input
                  aria-label="Only low stock"
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
                Only low stock
              </label>
            )}
          </filterForm.Field>
          <Button>Apply filters</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              filterForm.reset();
              setSelectedVariantId(null);
              setParams({ page: 1, pageSize: 20 });
            }}
          >
            Clear
          </Button>
        </form>
      </section>

      {inventory.isPending ? <LoadingState label="Loading Inventory..." /> : null}
      {inventory.isError ? (
        <ErrorState
          title="Inventory could not be loaded"
          message={inventory.error instanceof Error ? inventory.error.message : "Please try again."}
          onRetry={() => void inventory.refetch()}
        />
      ) : null}

      {inventory.data ? (
        <>
          {inventory.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
              No Inventory rows match these filters. Create Product variants first, then use an adjustment to initialize stock.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Variant</th>
                    <th className="px-4 py-3">On hand</th>
                    <th className="px-4 py-3">Reserved</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3">Reorder</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.data.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-4 py-3" title={item.variantId}>{shortId(item.variantId)}</td>
                      <td className="px-4 py-3 font-medium">{item.onHandQty}</td>
                      <td className="px-4 py-3">{item.reservedQty}</td>
                      <td className="px-4 py-3 font-semibold">{item.availableQty}</td>
                      <td className="px-4 py-3">{item.reorderLevel ?? "Disabled"}</td>
                      <td className="px-4 py-3"><InventoryStatus item={item} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedVariantId(item.variantId)}>
                            Manage
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to="/seller/inventory/$variantId/movements"
                              params={{ variantId: item.variantId }}
                            >
                              Movements
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <InventoryPagination
            meta={inventory.data.meta}
            noun="variants"
            onPageChange={(page) => {
              setSelectedVariantId(null);
              setParams((current) => ({ ...current, page }));
            }}
          />
        </>
      ) : null}

      {selectedItem ? (
        <InventoryManager
          item={selectedItem}
          canAdjust={permissions.includes(INVENTORY_PERMISSION.ADJUST)}
          canManageReorder={permissions.includes(INVENTORY_PERMISSION.REORDER_MANAGE)}
        />
      ) : null}
    </div>
  );
}

/** Protects the Inventory page with the Module 7 seller read permission. */
export function SellerInventoryPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={INVENTORY_PERMISSION.READ}>
          <SellerInventoryContent storeIds={user.scopes.storeIds} permissions={user.permissions} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
