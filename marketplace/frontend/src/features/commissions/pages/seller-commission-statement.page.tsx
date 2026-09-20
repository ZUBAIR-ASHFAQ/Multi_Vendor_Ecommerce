import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { CommissionPagination } from "../components/commission-pagination";
import { OrderCommissionBreakdown } from "../components/order-commission-breakdown";
import { SellerCommissionSummary } from "../components/seller-commission-summary";
import { SellerCommissionFilterForm } from "../forms/seller-commission-filter.form";
import { useSellerCommissionStatementQuery } from "../hooks/use-commissions";
import { COMMISSIONS_PERMISSION } from "../commissions.constants";
import type { SellerCommissionStatementParams } from "../types/commissions.types";

/** Renders the authenticated seller's fee statement without accepting a seller ID from the browser. */
function SellerCommissionStatementContent() {
  const [params, setParams] = useState<SellerCommissionStatementParams>({
    page: 1,
    pageSize: 20,
    sort: "occurredAt",
    order: "desc",
  });
  const statement = useSellerCommissionStatementQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Seller fee statement</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Reconcile gross sales, seller-funded discounts, marketplace fees, refunds, and seller net from the immutable Commission ledger.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/seller/wallet">Wallet & ledger</Link></Button>
            <Button asChild variant="outline"><Link to="/seller/payouts">Payouts</Link></Button>
          </div>
        </div>
      </section>

      <SellerCommissionFilterForm
        onApply={(filters) => setParams((current) => ({ ...current, ...filters, page: 1 }))}
      />

      {statement.isPending ? <LoadingState label="Loading seller Commission statement..." /> : null}
      {statement.isError ? (
        <ErrorState
          title="Commission statement could not be loaded"
          message={statement.error instanceof Error ? statement.error.message : "Please try again."}
          requestId={statement.error instanceof ApiClientError ? statement.error.requestId : undefined}
          onRetry={() => void statement.refetch()}
        />
      ) : null}

      {statement.data ? (
        <>
          <SellerCommissionSummary summaries={statement.data.statement.summaries} />
          <OrderCommissionBreakdown entries={statement.data.statement.entries} />
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <CommissionPagination
              meta={statement.data.meta}
              onPageChange={(page) => setParams((current) => ({ ...current, page }))}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

/** Protects the seller statement with seller account type and seller.commissions.read permission. */
export function SellerCommissionStatementPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={COMMISSIONS_PERMISSION.SELLER_READ}>
          <SellerCommissionStatementContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
