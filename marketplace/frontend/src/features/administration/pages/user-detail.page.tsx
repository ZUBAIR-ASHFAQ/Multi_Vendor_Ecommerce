import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
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

/** Formats optional account timestamps without inventing a value for events that never happened. */
function optionalDate(value: string | null): string {
  return value ? formatDateTime(value) : "—";
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access · User detail"
        title={user.data.displayName}
        description={user.data.email}
        actions={(
          <Button asChild variant="outline">
            <Link to="/admin/users">Back to users</Link>
          </Button>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <Surface>
            <SectionHeader
              title="Account identity"
              description="Identity and security metadata are read-only on this screen."
              actions={<StatusBadge status={user.data.status} />}
            />
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Account type</dt>
                <dd className="mt-1 capitalize text-foreground">{user.data.accountType.replaceAll("_", " ")}</dd>
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Email verified</dt>
                <dd className="mt-1 text-foreground">{optionalDate(user.data.emailVerifiedAt)}</dd>
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Last login</dt>
                <dd className="mt-1 text-foreground">{user.data.lastLoginAt ? formatDateTime(user.data.lastLoginAt) : "Never"}</dd>
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Password changed</dt>
                <dd className="mt-1 text-foreground">{optionalDate(user.data.passwordChangedAt)}</dd>
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Failed logins</dt>
                <dd className="mt-1 text-foreground">{user.data.failedLoginAttempts}</dd>
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Locked until</dt>
                <dd className="mt-1 text-foreground">{optionalDate(user.data.lockedUntil)}</dd>
              </div>
            </dl>
          </Surface>

          {actor.permissions.includes(ADMIN_PERMISSION.USERS_STATUS_MANAGE) ? (
            <Surface>
              <SectionHeader
                title="Account status"
                description="Apply only the status transition supported by the existing administration command."
              />
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-medium text-foreground">
                  Status
                  <Select
                    className="mt-1"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as UserStatus)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="locked">Locked</option>
                    <option value="pending">Pending</option>
                  </Select>
                </label>
                <FormError error={statusMutation.error} />
                <Button
                  disabled={statusMutation.isPending || status === user.data.status}
                  onClick={() => statusMutation.mutate({ status })}
                >
                  Save status
                </Button>
              </div>
            </Surface>
          ) : null}
        </div>

        <Surface>
          <SectionHeader
            title="Role assignments"
            description="Assignments stay constrained by account type, role scope, seller scope, and backend authorization."
          />
          {!canReadRoles ? (
            <p className="mt-4 text-sm text-foreground-muted">
              Role assignments are read-only because this account cannot read the Administration role catalog.
            </p>
          ) : roles.isPending ? (
            <div className="mt-4"><LoadingState label="Loading roles..." /></div>
          ) : roles.isError ? (
            <div className="mt-4">
              <ErrorState
                title="Roles unavailable"
                message={roles.error.message}
                requestId={roles.error instanceof ApiClientError ? roles.error.requestId : undefined}
                onRetry={() => void roles.refetch()}
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {assignableRoles.length === 0 ? (
                <p className="rounded-control bg-surface-muted p-4 text-sm text-foreground-muted">
                  No active roles match this account type.
                </p>
              ) : (
                assignableRoles.map((role) => (
                  <label key={role.id} className="flex gap-3 rounded-control border border-border p-3 text-sm hover:bg-surface-muted/60">
                    <input
                      type="checkbox"
                      disabled={!canManageRoles}
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={(event) => toggleRole(role, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <strong className="block text-foreground">{role.name}</strong>
                      <span className="block text-xs text-foreground-muted">
                        {role.code} · {role.scopeType} scope
                      </span>
                    </span>
                  </label>
                ))
              )}

              {selectedNeedsSellerScope ? (
                <label className="block text-sm font-medium text-foreground">
                  Seller scope ID
                  <Input
                    aria-label="Seller scope ID"
                    className="mt-1 font-mono"
                    value={sellerId}
                    onChange={(event) => setSellerId(event.target.value.trim())}
                    placeholder="Seller UUID"
                  />
                  {!sellerScopeIsValid ? <span className="mt-1 block text-xs text-negative">Enter a valid seller UUID.</span> : null}
                  <span className="mt-1 block text-xs text-foreground-muted">
                    The seller module validates that this seller exists and is assignable before Administration changes the role membership.
                  </span>
                </label>
              ) : null}

              <FormError error={roleMutation.error} />
              {canManageRoles ? (
                <Button
                  disabled={roleMutation.isPending || !sellerScopeIsValid}
                  onClick={() => roleMutation.mutate(roleAssignments(selectedRoleIds, assignableRoles, sellerId))}
                >
                  Save roles
                </Button>
              ) : null}
            </div>
          )}
        </Surface>
      </div>
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
