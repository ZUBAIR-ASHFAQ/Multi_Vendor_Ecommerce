import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { PromotionStatusBadge } from "../components/promotion-status-badge";
import { PromotionForm } from "../forms/promotion.form";
import {
  useCreateSellerPromotionMutation,
  useSellerPromotionsQuery,
} from "../hooks/use-promotions";
import { PROMOTION_PERMISSION, PROMOTION_STATUS } from "../promotions.constants";
import type {
  CreatePromotionInput,
  Promotion,
  SellerPromotionListParams,
} from "../schemas/promotions.schemas";

/** Formats one ISO timestamp for seller promotion management. */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Renders one seller-owned campaign row without exposing platform lifecycle commands. */
function SellerPromotionRow({ promotion }: { promotion: Promotion }) {
  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-4 py-3">
        <strong>{promotion.name}</strong>
        <span className="mt-1 block text-xs text-slate-500">
          {promotion.scopes.length} eligibility scope{promotion.scopes.length === 1 ? "" : "s"}
        </span>
      </td>
      <td className="px-4 py-3 font-medium">{promotion.value}%</td>
      <td className="px-4 py-3">{promotion.coupon?.code ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-slate-600">
        <span className="block">{formatDateTime(promotion.startAt)}</span>
        <span className="block">to {formatDateTime(promotion.endAt)}</span>
      </td>
      <td className="px-4 py-3"><PromotionStatusBadge status={promotion.status} /></td>
    </tr>
  );
}

/** Renders seller promotion creation plus the server-scoped campaign history. */
function SellerPromotionsContent() {
  const [created, setCreated] = useState<Promotion | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [params, setParams] = useState<SellerPromotionListParams>({ page: 1, pageSize: 20 });
  const promotions = useSellerPromotionsQuery(params);
  const createPromotion = useCreateSellerPromotionMutation();

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pricing & Growth</p>
            <h1 className="mt-1 text-2xl font-bold">Seller Promotions</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Create seller-funded campaigns and track their platform-controlled lifecycle from draft through active or inactive.
            </p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Seller promotion status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: (event.target.value || undefined) as SellerPromotionListParams["status"],
              }))}
            >
              <option value="">All</option>
              <option value={PROMOTION_STATUS.DRAFT}>Draft</option>
              <option value={PROMOTION_STATUS.SCHEDULED}>Scheduled</option>
              <option value={PROMOTION_STATUS.ACTIVE}>Active</option>
              <option value={PROMOTION_STATUS.INACTIVE}>Inactive</option>
            </select>
          </label>
        </div>
      </section>

      {created ? (
        <section role="status" className="rounded-xl border bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong>{created.name}</strong> was created with {created.scopes.length} eligibility scope(s).
              {created.coupon ? <span className="block">Coupon: {created.coupon.code}</span> : null}
            </div>
            <PromotionStatusBadge status={created.status} />
          </div>
        </section>
      ) : null}

      <PromotionForm
        key={formVersion}
        mode="seller-create"
        isPending={createPromotion.isPending}
        error={createPromotion.error}
        onSubmit={async (input) => {
          const result = await createPromotion.mutateAsync(input as CreatePromotionInput);
          setCreated(result);
          setFormVersion((value) => value + 1);
        }}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Campaigns</h2>
            <p className="text-sm text-slate-500">
              Lifecycle changes remain platform-controlled; this list reflects the authoritative current status.
            </p>
          </div>
        </div>

        {promotions.isPending ? <LoadingState label="Loading seller promotions..." /> : null}
        {promotions.isError ? (
          <ErrorState
            title="Seller promotions could not be loaded"
            message={promotions.error instanceof Error ? promotions.error.message : "Please try again."}
            requestId={promotions.error instanceof ApiClientError ? promotions.error.requestId : undefined}
            onRetry={() => void promotions.refetch()}
          />
        ) : null}

        {promotions.data ? (
          <>
            {promotions.data.items.length === 0 ? (
              <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                No seller promotions match this filter yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Promotion</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">Coupon</th>
                      <th className="px-4 py-3">Window</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotions.data.items.map((promotion) => (
                      <SellerPromotionRow key={promotion.id} promotion={promotion} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border bg-white p-4 text-sm shadow-sm">
              <Button
                type="button"
                variant="outline"
                disabled={promotions.data.meta.page <= 1}
                onClick={() => setParams((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
              >
                Previous
              </Button>
              <span>Page {promotions.data.meta.page} of {Math.max(1, promotions.data.meta.totalPages)}</span>
              <Button
                type="button"
                variant="outline"
                disabled={promotions.data.meta.page >= promotions.data.meta.totalPages}
                onClick={() => setParams((current) => ({ ...current, page: current.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

/** Protects seller promotion creation and read history with seller account type and seller-scoped permission. */
export function SellerPromotionsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={PROMOTION_PERMISSION.SELLER_MANAGE}>
          <SellerPromotionsContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
