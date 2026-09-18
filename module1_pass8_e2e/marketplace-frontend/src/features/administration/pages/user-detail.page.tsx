import { useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { AdminLayout } from "../components/admin-layout";
import { RequirePagePermission } from "../components/permission-gate";
import { StatusBadge } from "../components/status-badge";
import { ADMIN_PERMISSION } from "../administration.constants";
import type { AdminRole, AdminUser, RoleAssignmentInput, UserStatus } from "../types/administration.types";
import {
  useChangeUserStatusMutation,
  useReplaceUserRoleAssignmentsMutation,
  useRolesQuery,
  useUserQuery,
} from "../hooks/use-administration";

/** Finds an existing or unambiguous seller scope that can initialize seller-role assignment. */
function initialSellerScopeId(actor: AuthenticatedUser, target: AdminUser): string {
  const existing = target.roles.map((role) => role.sellerId).find(Boolean);
  if (existing) return existing;
  return actor.scopes.sellerIds.length === 1 ? actor.scopes.sellerIds[0] ?? "" : "";
}

/** Converts selected roles into the approved seller-aware Administration role command. */
function roleAssignments(
  roleIds: string[],
  roles: AdminRole[],
  sellerId: string,
): RoleAssignmentInput[] {
  return roleIds.map((roleId) => {
    const role = roles.find((candidate) => candidate.id === roleId);
    return { roleId, sellerId: role?.scopeType === "seller" ? sellerId : null };
  });
}

/** Returns whether the current role selection contains at least one seller-scoped role. */
function needsSellerScope(roleIds: string[], roles: AdminRole[]): boolean {
  return roleIds.some((roleId) => roles.find((role) => role.id === roleId)?.scopeType === "seller");
}

/** Renders read-only user identity plus the two approved user-management commands. */
function UserDetailContent({ actor, userId }: { actor: AuthenticatedUser; userId: string }) {
  const canReadRoles = actor.permissions.includes(ADMIN_PERMISSION.ROLES_READ);
  const canManageRoles =
    actor.permissions.includes(ADMIN_PERMISSION.USERS_ROLES_MANAGE) ||
    actor.permissions.includes(ADMIN_PERMISSION.SELLER_STAFF_MANAGE);
  const user = useUserQuery(userId);
  const statusMutation = useChangeUserStatusMutation(userId);
  const roleMutation = useReplaceUserRoleAssignmentsMutation(userId);
  const roles = useRolesQuery({ page: 1, pageSize: 100, status: "active" }, canReadRoles);
  const [status, setStatus] = useState<UserStatus>("active");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [sellerId, setSellerId] = useState("");

  useEffect(() => {
    if (!user.data) return;
    setStatus(user.data.status);
    setSelectedRoleIds(user.data.roles.map((role) => role.id));
    setSellerId(initialSellerScopeId(actor, user.data));
  }, [actor, user.data]);

  const assignableRoles = useMemo(() => {
    if (!user.data || !roles.data) return [];
    if (user.data.accountType === "platform_admin") {
      return roles.data.items.filter((role) => role.scopeType === "platform");
    }
    if (user.data.accountType === "seller") {
      return roles.data.items.filter((role) => role.scopeType === "seller");
    }
    return roles.data.items.filter((role) => role.scopeType === "customer" || role.scopeType === "seller");
  }, [roles.data, user.data]);

  if (user.isPending) return <LoadingState label="Loading user..." />;
  if (user.isError) {
    return (
      <ErrorState
        title="User could not be loaded"
        message={user.error.message}
        requestId={user.error instanceof ApiClientError ? user.error.requestId : undefined}
        onRetry={() => void user.refetch()}
      />
    );
  }

  const selectedNeedsSellerScope = needsSellerScope(selectedRoleIds, assignableRoles);
  const sellerScopeIsValid = !selectedNeedsSellerScope || z.uuid().safeParse(sellerId).success;

  /** Toggles one role and prevents mixed customer/seller scopes during customer-to-seller conversion. */
  function toggleRole(role: AdminRole, checked: boolean): void {
    setSelectedRoleIds((current) => {
      if (!checked) return current.filter((id) => id !== role.id);
      if (user.data.accountType === "customer" && role.scopeType === "seller") {
        const sellerRoleIds = new Set(assignableRoles.filter((item) => item.scopeType === "seller").map((item) => item.id));
        return [...current.filter((id) => sellerRoleIds.has(id)), role.id];
      }
      if (user.data.accountType === "customer" && role.scopeType === "customer") {
        const customerRoleIds = new Set(assignableRoles.filter((item) => item.scopeType === "customer").map((item) => item.id));
        return [...current.filter((id) => customerRoleIds.has(id)), role.id];
      }
      return [...current, role.id];
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{user.data.displayName}</h1>
            <p className="text-sm text-slate-600">{user.data.email}</p>
            <p className="mt-1 text-xs text-slate-500">Account type: {user.data.accountType}</p>
          </div>
          <StatusBadge status={user.data.status} />
        </div>

        {actor.permissions.includes(ADMIN_PERMISSION.USERS_STATUS_MANAGE) && (
          <div className="mt-6 space-y-3">
            <label className="block text-sm font-medium">
              Account status
              <select
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={status}
                onChange={(event) => setStatus(event.target.value as UserStatus)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="locked">Locked</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <FormError error={statusMutation.error} />
            <Button
              disabled={statusMutation.isPending || status === user.data.status}
              onClick={() => statusMutation.mutate({ status })}
            >
              Save status
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Role assignments</h2>
        {!canReadRoles ? (
          <p className="mt-2 text-sm text-slate-600">
            Role assignments are read-only because this account cannot read the Administration role catalog.
          </p>
        ) : roles.isPending ? (
          <LoadingState label="Loading roles..." />
        ) : roles.isError ? (
          <ErrorState
            title="Roles unavailable"
            message={roles.error.message}
            requestId={
              roles.error instanceof ApiClientError ? roles.error.requestId : undefined
            }
            onRetry={() => void roles.refetch()}
          />
        ) : (
          <div className="mt-4 space-y-3">
            {assignableRoles.map((role) => (
              <label key={role.id} className="flex gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  disabled={!canManageRoles}
                  checked={selectedRoleIds.includes(role.id)}
                  onChange={(event) => toggleRole(role, event.target.checked)}
                />
                <span>
                  {role.name}
                  <span className="block text-xs text-slate-500">{role.scopeType} scope</span>
                </span>
              </label>
            ))}

            {selectedNeedsSellerScope ? (
              <label className="block text-sm font-medium">
                Seller scope ID
                <input
                  aria-label="Seller scope ID"
                  className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm"
                  value={sellerId}
                  onChange={(event) => setSellerId(event.target.value.trim())}
                  placeholder="Seller UUID"
                />
                {!sellerScopeIsValid ? <span className="mt-1 block text-xs text-red-600">Enter a valid seller UUID.</span> : null}
                <span className="mt-1 block text-xs text-slate-500">
                  Module 4 validates that this seller exists and is assignable before Administration changes the role membership.
                </span>
              </label>
            ) : null}

            <FormError error={roleMutation.error} />
            {canManageRoles && (
              <Button
                disabled={roleMutation.isPending || !sellerScopeIsValid}
                onClick={() =>
                  roleMutation.mutate(roleAssignments(selectedRoleIds, assignableRoles, sellerId))
                }
              >
                Save roles
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Protects the user-management page with the approved user-read permission. */
export function UserDetailPage() {
  const { userId } = useParams({ strict: false }) as { userId: string };
  return (
    <AdminLayout>
      {(actor) => (
        <RequirePagePermission user={actor} permission={ADMIN_PERMISSION.USERS_READ}>
          <UserDetailContent actor={actor} userId={userId} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
