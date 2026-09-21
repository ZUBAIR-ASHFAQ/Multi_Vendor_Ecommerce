import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { AdminLayout } from "../components/admin-layout";
import {
  AdminQueueEmpty,
  AdminQueueTable,
  AdminQueueTableHead,
} from "../components/admin-queue";
import { PaginationControls } from "../components/pagination-controls";
import { RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import { useUsersQuery } from "../hooks/use-administration";
import type { UserListParams, UserStatus } from "../types/administration.types";

/** Loads and renders the permission-scoped administration user table. */
function UsersContent() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | UserStatus>("");
  const [sort, setSort] = useState<NonNullable<UserListParams["sort"]>>("created_desc");
  const users = useUsersQuery({
    page,
    pageSize: 20,
    search: search.trim() || undefined,
    status: status || undefined,
    sort,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access · Users"
        title="Users"
        description="Review platform identities, account state, and role membership using the existing permission-scoped administration API."
      />

      <form
        className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_180px_220px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void users.refetch();
        }}
      >
        <label className="text-sm font-medium text-foreground">
          Search
          <Input
            aria-label="Search users"
            className="mt-1"
            placeholder="Name or email"
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
            aria-label="Filter users by status"
            className="mt-1"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "" | UserStatus);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="locked">Locked</option>
            <option value="pending">Pending</option>
          </Select>
        </label>
        <label className="text-sm font-medium text-foreground">
          Sort
          <Select
            aria-label="Sort users"
            className="mt-1"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as NonNullable<UserListParams["sort"]>);
              setPage(1);
            }}
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
          </Select>
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() => {
              setSearch("");
              setStatus("");
              setSort("created_desc");
              setPage(1);
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      {users.isPending ? <LoadingState label="Loading users..." /> : null}
      {users.isError ? (
        <ErrorState
          title="Users could not be loaded"
          message={users.error instanceof Error ? users.error.message : "Please try again."}
          requestId={users.error instanceof ApiClientError ? users.error.requestId : undefined}
          onRetry={() => void users.refetch()}
        />
      ) : null}

      {users.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No users found."
          description="Change the search, status, or sort controls to review another part of the user directory."
        />
      ) : null}

      {users.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[980px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Account type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {users.data.items.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{user.displayName}</strong>
                  <span className="block text-xs text-foreground-muted">{user.email}</span>
                </td>
                <td className="px-4 py-3 capitalize text-foreground-muted">
                  {user.accountType.replaceAll("_", " ")}
                </td>
                <td className="px-4 py-3"><StatusBadge status={user.status} /></td>
                <td className="px-4 py-3 text-foreground-muted">
                  {user.roles.map((role) => role.name).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">
                  {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/users/$userId" params={{ userId: user.id }}>Manage</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {users.data ? <PaginationControls meta={users.data.meta} onPage={setPage} /> : null}
    </div>
  );
}

/** Renders the approved administration user-list page behind the user-read permission. */
export function UsersPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={ADMIN_PERMISSION.USERS_READ}>
          <UsersContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
