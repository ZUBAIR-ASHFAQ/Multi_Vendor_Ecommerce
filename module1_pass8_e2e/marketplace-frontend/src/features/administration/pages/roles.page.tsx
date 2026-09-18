import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { AdminLayout } from "../components/admin-layout";
import { CreateRoleForm } from "../forms/create-role-form";
import { PaginationControls } from "../components/pagination-controls";
import { PermissionGate, RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import { useRolesQuery } from "../hooks/use-administration";

/** Loads and renders the role catalog with immutable resource-scope labels. */
function RolesContent() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const roles = useRolesQuery({
    page,
    pageSize: 20,
    search: search || undefined,
  });

  if (roles.isPending) return <LoadingState label="Loading roles..." />;
  if (roles.isError) {
    return (
      <ErrorState
        title="Roles could not be loaded"
        message={roles.error instanceof Error ? roles.error.message : "Please try again."}
        requestId={roles.error instanceof ApiClientError ? roles.error.requestId : undefined}
        onRetry={() => void roles.refetch()}
      />
    );
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="mt-1 text-sm text-slate-600">
            Reusable permission groups with platform, seller, or customer scope.
          </p>
        </div>
        <label className="text-sm">
          Search
          <input
            aria-label="Search roles"
            className="ml-2 rounded-md border px-3 py-2"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      <div className="mt-5 space-y-2">
        {roles.data.items.map((role) => (
          <Link
            key={role.id}
            to="/admin/roles/$roleId"
            params={{ roleId: role.id }}
            className="flex items-center justify-between rounded-md border p-3 hover:bg-slate-50"
          >
            <span>
              <strong>{role.name}</strong>
              <span className="ml-2 text-xs text-slate-500">
                {role.code} · {role.scopeType}
                {role.isSystem ? " · system" : ""}
              </span>
            </span>
            <StatusBadge status={role.status} />
          </Link>
        ))}
        {roles.data.items.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">
            No roles found.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <PaginationControls meta={roles.data.meta} onPage={setPage} />
      </div>
    </section>
  );
}

/** Renders role creation and catalog management for authorized actors. */
export function RolesPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={ADMIN_PERMISSION.ROLES_READ}>
          <div className="space-y-5">
            <PermissionGate user={user} permission={ADMIN_PERMISSION.ROLES_CREATE}>
              <CreateRoleForm />
            </PermissionGate>
            <RolesContent />
          </div>
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
