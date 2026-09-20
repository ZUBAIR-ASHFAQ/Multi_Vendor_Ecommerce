import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { CommissionEntryTable } from "../components/commission-entry-table";
import { CommissionPagination } from "../components/commission-pagination";
import { OrderCommissionBreakdown } from "../components/order-commission-breakdown";
import { AdminCommissionEntryFilterForm } from "../forms/admin-commission-entry-filter.form";
import { useAdminCommissionEntriesQuery } from "../hooks/use-commissions";
import { COMMISSIONS_PERMISSION } from "../commissions.constants";
import type { AdminCommissionEntriesParams } from "../types/commissions.types";

/** Renders permission-safe immutable Commission finance entries and optional per-order grouping. */
function AdminCommissionLedgerContent() {
  const [params, setParams] = useState<AdminCommissionEntriesParams>({
    page: 1,
    pageSize: 20,
    sort: "occurredAt",
    order: "desc",
  });
  const entries = useAdminCommissionEntriesQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
        <h1 className="mt-1 text-2xl font-bold">Finance Commission ledger</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Customer Payment, marketplace Commission revenue, seller payable, and eventual payout remain separate values.
        </p>
      </section>

      <AdminCommissionEntryFilterForm
        onApply={(filters) => setParams((current) => ({ ...current, ...filters, page: 1 }))}
      />

      {entries.isPending ? <LoadingState label="Loading Commission ledger..." /> : null}
      {entries.isError ? (
        <ErrorState
          title="Commission ledger could not be loaded"
          message={entries.error instanceof Error ? entries.error.message : "Please try again."}
          requestId={entries.error instanceof ApiClientError ? entries.error.requestId : undefined}
          onRetry={() => void entries.refetch()}
        />
      ) : null}

      {entries.data ? (
        <>
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <CommissionEntryTable entries={entries.data.items} showSeller />
            <div className="mt-4">
              <CommissionPagination
                meta={entries.data.meta}
                onPageChange={(page) => setParams((current) => ({ ...current, page }))}
              />
            </div>
          </section>
          {params.sellerOrderId ? <OrderCommissionBreakdown entries={entries.data.items} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** Protects the finance Commission ledger with the server-derived admin read permission. */
export function AdminCommissionLedgerPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={COMMISSIONS_PERMISSION.ADMIN_READ}>
          <AdminCommissionLedgerContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
