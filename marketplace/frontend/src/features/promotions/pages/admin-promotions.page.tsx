import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { PromotionStatusBadge } from "../components/promotion-status-badge";
import { PromotionForm } from "../forms/promotion.form";
import {
  useActivateAdminPromotionMutation,
  useAdminPromotionsQuery,
  useCreateAdminPromotionMutation,
  useDeactivateAdminPromotionMutation,
  useUpdateAdminPromotionMutation,
} from "../hooks/use-promotions";
import { PROMOTION_PERMISSION, PROMOTION_STATUS } from "../promotions.constants";
import type {
  CreatePromotionInput,
  Promotion,
  UpdatePromotionInput,
} from "../schemas/promotions.schemas";

/** Formats one ISO date for compact promotion-management display. */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Renders the platform promotion list plus create/edit/lifecycle workflows. */
function AdminPromotionsContent() {
  const [page, setPage] = useState(1);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [createVersion, setCreateVersion] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const promotions = useAdminPromotionsQuery({ page, pageSize: 20 });
  const createPromotion = useCreateAdminPromotionMutation();
  const updatePromotion = useUpdateAdminPromotionMutation(selectedPromotion?.id ?? "");
  const activate = useActivateAdminPromotionMutation();
  const deactivate = useDeactivateAdminPromotionMutation();

  /** Runs one lifecycle command and closes stale inline edit state after success. */
  async function runLifecycle(promotion: Promotion): Promise<void> {
    setSuccessMessage(null);
    if (
      promotion.status === PROMOTION_STATUS.ACTIVE ||
      promotion.status === PROMOTION_STATUS.SCHEDULED
    ) {
      await deactivate.mutateAsync(promotion.id);
      setSuccessMessage(`${promotion.name} was deactivated.`);
    } else {
      await activate.mutateAsync(promotion.id);
      setSuccessMessage(`${promotion.name} was activated or scheduled.`);
    }
    setSelectedPromotion(null);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pricing & Growth</p>
            <h1 className="mt-1 text-2xl font-bold">Promotions & Coupons</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Manage platform-funded percentage promotions, eligibility scopes, coupon limits, and explicit activation/deactivation.
            </p>
          </div>
        </div>
        {successMessage ? (
          <p
            role="status"
            className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {successMessage}
          </p>
        ) : null}
        <FormError error={activate.error ?? deactivate.error} />
      </section>

      <PromotionForm
        key={`create:${createVersion}`}
        mode="admin-create"
        isPending={createPromotion.isPending}
        error={createPromotion.error}
        onSubmit={async (input) => {
          const created = await createPromotion.mutateAsync(input as CreatePromotionInput);
          setSuccessMessage(`${created.name} was created as a draft.`);
          setCreateVersion((value) => value + 1);
        }}
      />

      {promotions.isPending ? <LoadingState label="Loading promotions..." /> : null}
      {promotions.isError ? (
        <ErrorState
          title="Promotions could not be loaded"
          message={promotions.error instanceof Error ? promotions.error.message : "Please try again."}
          requestId={promotions.error instanceof ApiClientError ? promotions.error.requestId : undefined}
          onRetry={() => void promotions.refetch()}
        />
      ) : null}

      {promotions.data ? (
        <section className="space-y-3">
          {promotions.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No platform promotions have been created.</p>
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
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.data.items.map((promotion) => {
                    const editable =
                      promotion.status === PROMOTION_STATUS.DRAFT ||
                      promotion.status === PROMOTION_STATUS.SCHEDULED;
                    const lifecycleLabel =
                      promotion.status === PROMOTION_STATUS.ACTIVE ||
                      promotion.status === PROMOTION_STATUS.SCHEDULED
                        ? "Deactivate"
                        : "Activate";
                    return (
                      <tr key={promotion.id} className="border-b align-top last:border-0">
                        <td className="px-4 py-3">
                          <strong>{promotion.name}</strong>
                          <span className="block text-xs text-slate-500">{promotion.scopes.length} scope(s)</span>
                        </td>
                        <td className="px-4 py-3">{promotion.value}%</td>
                        <td className="px-4 py-3">{promotion.coupon?.code ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <span className="block">{formatDateTime(promotion.startAt)}</span>
                          <span className="block">to {formatDateTime(promotion.endAt)}</span>
                        </td>
                        <td className="px-4 py-3"><PromotionStatusBadge status={promotion.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {editable ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => setSelectedPromotion(promotion)}>
                                Edit
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={activate.isPending || deactivate.isPending}
                              onClick={() => void runLifecycle(promotion)}
                            >
                              {lifecycleLabel}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border bg-white p-4 text-sm shadow-sm">
            <Button
              type="button"
              variant="outline"
              disabled={promotions.data.meta.page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span>Page {promotions.data.meta.page} of {Math.max(1, promotions.data.meta.totalPages)}</span>
            <Button
              type="button"
              variant="outline"
              disabled={promotions.data.meta.page >= promotions.data.meta.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </section>
      ) : null}

      {selectedPromotion ? (
        <PromotionForm
          key={`edit:${selectedPromotion.id}:${selectedPromotion.status}`}
          mode="admin-edit"
          promotion={selectedPromotion}
          isPending={updatePromotion.isPending}
          error={updatePromotion.error}
          onSubmit={async (input) => {
            const updated = await updatePromotion.mutateAsync(input as UpdatePromotionInput);
            setSuccessMessage(`${updated.name} was updated.`);
            setSelectedPromotion(null);
          }}
          onCancel={() => setSelectedPromotion(null)}
        />
      ) : null}
    </div>
  );
}

/** Protects platform Promotion management with the Module 9 administrator permission. */
export function AdminPromotionsPage() {
  return (
    <AdminLayout>
      {(user) =>
        user.permissions.includes(PROMOTION_PERMISSION.ADMIN_MANAGE) ? (
          <AdminPromotionsContent />
        ) : (
          <ErrorState title="Access denied" message="Your account cannot manage platform promotions." />
        )
      }
    </AdminLayout>
  );
}
