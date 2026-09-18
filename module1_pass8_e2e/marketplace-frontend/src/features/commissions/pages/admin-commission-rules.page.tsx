import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { CommissionPagination } from "../components/commission-pagination";
import { CommissionRuleFilterForm } from "../forms/commission-rule-filter.form";
import { CommissionRuleForm } from "../forms/commission-rule.form";
import {
  useCommissionRulesQuery,
  useCreateCommissionRuleMutation,
  useUpdateCommissionRuleMutation,
} from "../hooks/use-commissions";
import {
  COMMISSIONS_PERMISSION,
  hasCommissionPermission,
} from "../commissions.constants";
import type { CommissionRule } from "../schemas/commissions.schemas";
import type {
  AdminCommissionRulesParams,
  CreateCommissionRuleInput,
  UpdateCommissionRuleInput,
} from "../types/commissions.types";

/** Formats one Commission-rule effective timestamp for the admin table. */
function formatDateTime(value: string | null): string {
  if (!value) return "No end date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Owns the Commission-rule list and create/edit state for one authorized admin actor. */
function AdminCommissionRulesContent({ canManage }: { canManage: boolean }) {
  const [params, setParams] = useState<AdminCommissionRulesParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const rules = useCommissionRulesQuery(params);
  const createRule = useCreateCommissionRuleMutation();
  const updateRule = useUpdateCommissionRuleMutation(editingRule?.id ?? "");

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Commission rule manager</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Rules are effective-dated. Historical Order Item snapshots remain unchanged when future rules are edited.
            </p>
          </div>
          {canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditingRule(null);
                setShowCreateForm((value) => !value);
              }}
            >
              {showCreateForm ? "Close form" : "Create rule"}
            </Button>
          ) : null}
        </div>
      </section>

      <CommissionRuleFilterForm
        onApply={(filters) => setParams((current) => ({ ...current, ...filters, page: 1 }))}
      />

      {canManage && showCreateForm ? (
        <CommissionRuleForm
          isPending={createRule.isPending}
          error={createRule.error}
          onSubmit={async (input) => {
            await createRule.mutateAsync(input as CreateCommissionRuleInput);
            setShowCreateForm(false);
          }}
        />
      ) : null}

      {canManage && editingRule ? (
        <CommissionRuleForm
          key={editingRule.id}
          rule={editingRule}
          isPending={updateRule.isPending}
          error={updateRule.error}
          onSubmit={async (input) => {
            await updateRule.mutateAsync(input as UpdateCommissionRuleInput);
            setEditingRule(null);
          }}
          onCancel={() => setEditingRule(null)}
        />
      ) : null}

      {rules.isPending ? <LoadingState label="Loading Commission rules..." /> : null}
      {rules.isError ? (
        <ErrorState
          title="Commission rules could not be loaded"
          message={rules.error instanceof Error ? rules.error.message : "Please try again."}
          requestId={rules.error instanceof ApiClientError ? rules.error.requestId : undefined}
          onRetry={() => void rules.refetch()}
        />
      ) : null}

      {rules.data ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2">Scope</th>
                  <th>Priority</th>
                  <th>Rate</th>
                  <th>Fixed fee</th>
                  <th>Effective</th>
                  <th>Status</th>
                  {canManage ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {rules.data.items.map((rule) => (
                  <tr key={rule.id} className="border-b align-top">
                    <td className="py-3 capitalize">
                      {rule.scopeType}
                      {rule.scopeId ? <span className="block max-w-xs break-all text-xs text-slate-500">{rule.scopeId}</span> : null}
                    </td>
                    <td>{rule.priority}</td>
                    <td>{rule.ratePercent}%</td>
                    <td>{rule.fixedFee ?? "0.0000"}</td>
                    <td>
                      <span className="block">{formatDateTime(rule.startAt)}</span>
                      <span className="block text-xs text-slate-500">to {formatDateTime(rule.endAt)}</span>
                    </td>
                    <td className="capitalize">{rule.status}</td>
                    {canManage ? (
                      <td className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setShowCreateForm(false);
                            setEditingRule(rule);
                          }}
                        >
                          Edit future rule
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {rules.data.items.length === 0 ? (
              <p className="py-8 text-center text-slate-500">No Commission rules found.</p>
            ) : null}
          </div>
          <div className="mt-4">
            <CommissionPagination
              meta={rules.data.meta}
              onPageChange={(page) => setParams((current) => ({ ...current, page }))}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Protects the rule manager with read permission while showing write controls only to rule managers. */
export function AdminCommissionRulesPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={COMMISSIONS_PERMISSION.ADMIN_READ}>
          <AdminCommissionRulesContent
            canManage={hasCommissionPermission(user.permissions, COMMISSIONS_PERMISSION.ADMIN_MANAGE)}
          />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
