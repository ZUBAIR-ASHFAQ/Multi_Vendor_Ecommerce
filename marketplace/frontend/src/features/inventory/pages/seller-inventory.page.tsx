import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { formatMoney } from "@/lib/money";
import { InventoryPagination } from "../components/inventory-pagination";
import { InventoryStatus } from "../components/inventory-status";
import { InventoryAdjustmentForm } from "../forms/inventory-adjustment-form";
import { InventoryReorderLevelForm } from "../forms/inventory-reorder-level-form";
import {
  useAdjustStockMutation,
  useSellerInventoryQuery,
  useUpdateReorderLevelMutation,
} from "../hooks/use-inventory";
import type {
  SellerInventoryListItem,
  SellerInventoryListParams,
} from "../schemas/inventory.schemas";

const INVENTORY_PERMISSION = {
  READ: "inventory.read",
  ADJUST: "inventory.adjust",
  REORDER_MANAGE: "inventory.reorder.manage",
} as const;

/** Shortens UUIDs only for fallbacks while preserving the complete value in title attributes. */
function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}

/** Renders quantity-management forms for one currently selected Inventory row. */
function InventoryManager({
  item,
  canAdjust,
  canManageReorder,
}: {
  item: SellerInventoryListItem;
  canAdjust: boolean;
  canManageReorder: boolean;
}) {
  const adjust = useAdjustStockMutation(item.variantId);
  const reorder = useUpdateReorderLevelMutation(item.variantId);

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected SKU</p>
          <h2 className="mt-1 text-lg font-semibold">{item.productName} · {item.variantTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">SKU {item.variantSku} · {item.storeName}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div className="rounded-lg bg-slate-50 px-4 py-3"><strong className="block text-lg">{item.onHandQty}</strong><span className="text-slate-500">On hand</span></div>
          <div className="rounded-lg bg-slate-50 px-4 py-3"><strong className="block text-lg">{item.reservedQty}</strong><span className="text-slate-500">Reserved</span></div>
          <div className="rounded-lg bg-slate-50 px-4 py-3"><strong className="block text-lg">{item.availableQty}</strong><span className="text-slate-500">Available</span></div>
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
    defaultValues: { q: "", storeId: "", lowStock: false },
    onSubmit: ({ value }) => {
      setSelectedVariantId(null);
      setParams({
        page: 1,
        pageSize: 20,
        q: value.q.trim() || undefined,
        storeId: value.storeId || undefined,
        lowStock: value.lowStock || undefined,
      });
    },
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog operations</p>
            <h1 className="mt-1 text-2xl font-bold">Inventory & Stock</h1>
            <p className="mt-1 text-sm text-slate-600">
              Track physical, reserved, and sellable stock by Product and SKU. Every physical adjustment remains recorded in the immutable movement ledger.
            </p>
          </div>
        </div>

        <form
          className="mt-5 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void filterForm.handleSubmit();
          }}
        >
          <filterForm.Field name="q">
            {(field) => (
              <label className="text-sm font-medium">
                Search
                <input
                  aria-label="Inventory search"
                  placeholder="Product, SKU, or variant"
                  className="mt-1 block w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </label>
            )}
          </filterForm.Field>
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
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product / SKU</th>
                    <th className="px-4 py-3">Store</th>
                    <th className="px-4 py-3">Price</th>
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
                    <tr key={item.id} className="border-b align-middle last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <strong className="block text-slate-950">{item.productName}</strong>
                        <span className="block text-xs text-slate-500">{item.variantTitle} · SKU {item.variantSku}</span>
                        <span className="block text-xs capitalize text-slate-400">{item.variantStatus}</span>
                      </td>
                      <td className="px-4 py-3">{item.storeName}</td>
                      <td className="px-4 py-3 font-medium">{formatMoney(item.variantPrice, item.variantCurrency)}</td>
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
                            <Link to="/seller/inventory/$variantId/movements" params={{ variantId: item.variantId }}>Movements</Link>
                          </Button>
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/seller/products/$productId" params={{ productId: item.productId }}>Product</Link>
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
