import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { AdminLayout } from "../components/admin-layout";
import { RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import {
  usePermissionsQuery,
  useReplaceRolePermissionsMutation,
  useRoleQuery,
} from "../hooks/use-administration";
import type { Permission } from "../types/administration.types";

/** Groups the existing permission catalog by its backend-provided business domain. */
function groupPermissions(permissions: Permission[]): Array<[string, Permission[]]> {
  const groups = new Map<string, Permission[]>();

  for (const permission of permissions) {
    const current = groups.get(permission.domain) ?? [];
    current.push(permission);
    groups.set(permission.domain, current);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, items]) => [domain, items.sort((left, right) => left.code.localeCompare(right.code))] as [string, Permission[]]);
}

/** Renders one role and its approved permission-replacement workflow. */
function RoleDetailContent({ roleId, canManage }: { roleId: string; canManage: boolean }) {
  const role = useRoleQuery(roleId);
  const permissions = usePermissionsQuery({ page: 1, pageSize: 100 });
  const replace = useReplaceRolePermissionsMutation(roleId);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (role.data) setSelected(role.data.permissions.map((permission) => permission.id));
  }, [role.data]);

  const permissionGroups = useMemo(
    () => groupPermissions(permissions.data?.items ?? []),
    [permissions.data?.items],
  );

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access · Role detail"
        title={role.data.name}
        description={role.data.description || "No description."}
        actions={(
          <Button asChild variant="outline">
            <Link to="/admin/roles">Back to roles</Link>
          </Button>
        )}
      />

      <Surface>
        <SectionHeader
          title="Role identity"
          description={immutable ? "This protected system role is read-only." : "Role scope remains immutable after creation."}
          actions={<StatusBadge status={role.data.status} />}
        />
        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Code</dt>
            <dd className="mt-1 font-mono text-sm text-foreground">{role.data.code}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Scope</dt>
            <dd className="mt-1 capitalize text-foreground">{role.data.scopeType}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Type</dt>
            <dd className="mt-1 text-foreground">{immutable ? "System" : "Custom"}</dd>
          </div>
          <div className="rounded-control bg-surface-muted p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Updated</dt>
            <dd className="mt-1 text-sm text-foreground">{formatDateTime(role.data.updatedAt)}</dd>
          </div>
        </dl>
      </Surface>

      <Surface>
        <SectionHeader
          title="Permission matrix"
          description="Permissions are grouped by their backend-defined domain so access can be reviewed without flattening unrelated capabilities into one list."
          actions={(
            <span className="text-sm font-medium text-foreground-muted">
              {selected.length} selected
            </span>
          )}
        />

        {permissions.isPending ? (
          <div className="mt-4"><LoadingState label="Loading permissions..." /></div>
        ) : permissions.isError ? (
          <div className="mt-4">
            <ErrorState
              title="Permissions unavailable"
              message={permissions.error.message}
              requestId={permissions.error instanceof ApiClientError ? permissions.error.requestId : undefined}
              onRetry={() => void permissions.refetch()}
            />
          </div>
        ) : permissionGroups.length === 0 ? (
          <p className="mt-4 rounded-control bg-surface-muted p-4 text-sm text-foreground-muted">
            No permissions are exposed by the current role catalog.
          </p>
        ) : (
          <div className="mt-5 space-y-5">
            {permissionGroups.map(([domain, domainPermissions]) => (
              <fieldset key={domain} className="rounded-card border border-border p-4">
                <legend className="px-2 text-sm font-semibold capitalize text-foreground">
                  {domain.replaceAll("_", " ")}
                </legend>
                <div className="grid gap-2 md:grid-cols-2">
                  {domainPermissions.map((permission) => (
                    <label
                      key={permission.id}
                      className="flex gap-3 rounded-control border border-border p-3 text-sm hover:bg-surface-muted/60"
                    >
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
                      <span className="min-w-0">
                        <strong className="block break-all text-foreground">{permission.code}</strong>
                        <span className="mt-1 block text-xs leading-5 text-foreground-muted">
                          {permission.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <FormError error={replace.error} />
            {canManage && !immutable ? (
              <Button disabled={replace.isPending} onClick={() => replace.mutate(selected)}>
                Save permissions
              </Button>
            ) : null}
          </div>
        )}
      </Surface>
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
