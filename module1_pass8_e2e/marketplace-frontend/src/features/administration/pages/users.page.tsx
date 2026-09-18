import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { AdminLayout } from "../components/admin-layout";
import { PaginationControls } from "../components/pagination-controls";
import { RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import { useUsersQuery } from "../hooks/use-administration";

/** Loads and renders the permission-scoped administration user table. */
function UsersContent() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const users = useUsersQuery({
    page,
    pageSize: 20,
    search: search || undefined,
  });

  if (users.isPending) return <LoadingState label="Loading users..." />;
  if (users.isError) {
    return (
      <ErrorState
        title="Users could not be loaded"
        message={users.error instanceof Error ? users.error.message : "Please try again."}
        requestId={users.error instanceof ApiClientError ? users.error.requestId : undefined}
        onRetry={() => void users.refetch()}
      />
    );
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-slate-600">
            Search platform identities and review their server-owned account type and role memberships.
          </p>
        </div>
        <label className="text-sm">
          Search
          <input
            aria-label="Search users"
            className="ml-2 rounded-md border px-3 py-2"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Type</th>
              <th>Status</th>
              <th>Roles</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.data.items.map((user) => (
              <tr key={user.id} className="border-b">
                <td className="py-3 font-medium">{user.displayName}</td>
                <td>{user.email}</td>
                <td>{user.accountType}</td>
                <td>
                  <StatusBadge status={user.status} />
                </td>
                <td>{user.roles.map((role) => role.name).join(", ") || "—"}</td>
                <td className="text-right">
                  <Link
                    className="underline"
                    to="/admin/users/$userId"
                    params={{ userId: user.id }}
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.data.items.length === 0 && (
          <p className="py-8 text-center text-slate-500">No users found.</p>
        )}
      </div>

      <div className="mt-4">
        <PaginationControls meta={users.data.meta} onPage={setPage} />
      </div>
    </section>
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
