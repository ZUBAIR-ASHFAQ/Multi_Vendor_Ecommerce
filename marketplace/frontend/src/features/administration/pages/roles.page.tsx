import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ApiClientError } from "@/lib/api-error";
import { AdminLayout } from "../components/admin-layout";
import {
  AdminQueueEmpty,
  AdminQueueTable,
  AdminQueueTableHead,
} from "../components/admin-queue";
import { CreateRoleForm } from "../forms/create-role-form";
import { PaginationControls } from "../components/pagination-controls";
import { PermissionGate, RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import { useRolesQuery } from "../hooks/use-administration";
import type { RoleListParams } from "../types/administration.types";

/** Loads and renders the role catalog with immutable resource-scope labels. */
function RolesContent() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [roleKind, setRoleKind] = useState<"" | "system" | "custom">("");
  const [sort, setSort] = useState<NonNullable<RoleListParams["sort"]>>("name_asc");
  const roles = useRolesQuery({
    page,
    pageSize: 20,
    search: search.trim() || undefined,
    status: status || undefined,
    system: roleKind ? roleKind === "system" : undefined,
    sort,
  });

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_170px_170px_200px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void roles.refetch();
        }}
      >
        <label className="text-sm font-medium text-foreground">
          Search
          <Input
            aria-label="Search roles"
            className="mt-1"
            placeholder="Role name or code"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Status
          <Select
            aria-label="Filter roles by status"
            className="mt-1"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "" | "active" | "inactive");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </label>
        <label className="text-sm font-medium text-foreground">
          Type
          <Select
            aria-label="Filter roles by type"
            className="mt-1"
            value={roleKind}
            onChange={(event) => {
              setRoleKind(event.target.value as "" | "system" | "custom");
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="system">System roles</option>
            <option value="custom">Custom roles</option>
          </Select>
        </label>
        <label className="text-sm font-medium text-foreground">
          Sort
          <Select
            aria-label="Sort roles"
            className="mt-1"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as NonNullable<RoleListParams["sort"]>);
              setPage(1);
            }}
          >
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
          </Select>
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="w-full lg:w-auto"
            onClick={() => {
              setSearch("");
              setStatus("");
              setRoleKind("");
              setSort("name_asc");
              setPage(1);
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      {roles.isPending ? <LoadingState label="Loading roles..." /> : null}
      {roles.isError ? (
        <ErrorState
          title="Roles could not be loaded"
          message={roles.error instanceof Error ? roles.error.message : "Please try again."}
          requestId={roles.error instanceof ApiClientError ? roles.error.requestId : undefined}
          onRetry={() => void roles.refetch()}
        />
      ) : null}

      {roles.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No roles found."
          description="Change the role filters to review another part of the access catalog."
        />
      ) : null}

      {roles.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[820px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {roles.data.items.map((role) => (
              <tr key={role.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{role.name}</strong>
                  <span className="block text-xs text-foreground-muted">{role.code}</span>
                </td>
                <td className="px-4 py-3 capitalize text-foreground-muted">{role.scopeType}</td>
                <td className="px-4 py-3 text-foreground-muted">{role.isSystem ? "System" : "Custom"}</td>
                <td className="px-4 py-3 text-foreground-muted">{role.permissions.length}</td>
                <td className="px-4 py-3"><StatusBadge status={role.status} /></td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/roles/$roleId" params={{ roleId: role.id }}>Manage</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {roles.data ? <PaginationControls meta={roles.data.meta} onPage={setPage} /> : null}
    </div>
  );
}

/** Renders role creation and catalog management for authorized actors. */
export function RolesPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={ADMIN_PERMISSION.ROLES_READ}>
          <div className="space-y-5">
            <PageHeader
              eyebrow="Access · Roles"
              title="Roles & permissions"
              description="Manage reusable permission groups while preserving the backend-owned platform, seller, and customer scope boundaries."
            />
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
