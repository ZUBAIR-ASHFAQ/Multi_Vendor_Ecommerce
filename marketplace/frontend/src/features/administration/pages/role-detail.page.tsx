import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { AdminLayout } from "../components/admin-layout";
import { RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import {
  usePermissionsQuery,
  useReplaceRolePermissionsMutation,
  useRoleQuery,
} from "../hooks/use-administration";

/** Renders one role and its approved permission-replacement workflow. */
function RoleDetailContent({ roleId, canManage }: { roleId: string; canManage: boolean }) {
  const role = useRoleQuery(roleId);
  const permissions = usePermissionsQuery({ page: 1, pageSize: 100 });
  const replace = useReplaceRolePermissionsMutation(roleId);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (role.data) setSelected(role.data.permissions.map((permission) => permission.id));
  }, [role.data]);

  if (role.isPending) return <LoadingState label="Loading role..." />;
  if (role.isError) {
    return (
      <ErrorState
        title="Role could not be loaded"
        message={role.error.message}
        requestId={role.error instanceof ApiClientError ? role.error.requestId : undefined}
        onRetry={() => void role.refetch()}
      />
    );
  }

  const immutable = role.data.isSystem;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{role.data.name}</h1>
            <p className="text-sm text-slate-500">
              {role.data.code} · {role.data.scopeType}{immutable ? " · protected system role" : ""}
            </p>
          </div>
          <StatusBadge status={role.data.status} />
        </div>
        <p className="mt-4 text-sm text-slate-600">{role.data.description || "No description."}</p>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Permission matrix</h2>
        <p className="mt-1 text-sm text-slate-600">
          The catalog is derived from the approved role-list response; no undocumented permission API is called.
        </p>
        {permissions.isPending ? (
          <LoadingState label="Loading permissions..." />
        ) : permissions.isError ? (
          <ErrorState
            title="Permissions unavailable"
            message={permissions.error.message}
            requestId={
              permissions.error instanceof ApiClientError
                ? permissions.error.requestId
                : undefined
            }
            onRetry={() => void permissions.refetch()}
          />
        ) : (
          <div className="mt-4 space-y-2">
            {permissions.data.items.map((permission) => (
              <label key={permission.id} className="flex gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  disabled={!canManage || immutable}
                  checked={selected.includes(permission.id)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, permission.id]
                        : current.filter((id) => id !== permission.id),
                    );
                  }}
                />
                <span>
                  <strong>{permission.code}</strong>
                  <span className="block text-xs text-slate-500">{permission.description}</span>
                </span>
              </label>
            ))}
            <FormError error={replace.error} />
            {canManage && !immutable && (
              <Button disabled={replace.isPending} onClick={() => replace.mutate(selected)}>
                Save permissions
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Protects role detail with the approved role-read permission. */
export function RoleDetailPage() {
  const { roleId } = useParams({ strict: false }) as { roleId: string };
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={ADMIN_PERMISSION.ROLES_READ}>
          <RoleDetailContent
            roleId={roleId}
            canManage={user.permissions.includes(ADMIN_PERMISSION.ROLES_PERMISSIONS_MANAGE)}
          />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
