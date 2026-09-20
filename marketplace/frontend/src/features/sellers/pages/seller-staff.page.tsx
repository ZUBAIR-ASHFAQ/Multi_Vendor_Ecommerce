import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  useReplaceUserRoleAssignmentsMutation,
  useRolesQuery,
  useUsersQuery,
} from "@/features/administration/hooks/use-administration";
import type { AdminRole, AdminUser } from "@/features/administration/types/administration.types";
import { SellerLayout, RequireSellerPermission } from "../components/seller-layout";
import {
  sellerStaffAssignmentFormSchema,
  sellerStaffLookupFormSchema,
} from "../schemas/sellers.schemas";
import { sellerQueryKeys } from "../hooks/sellers.query-keys";
import { useMySellerQuery } from "../hooks/use-sellers";
import { SELLER_PERMISSION } from "../sellers.constants";

/** Renders role assignment controls for one exact-email staff candidate. */
function StaffCandidateAccess({
  actorId,
  candidate,
  roles,
  sellerId,
}: {
  actorId: string;
  candidate: AdminUser;
  roles: AdminRole[];
  sellerId: string;
}) {
  const updateRoles = useReplaceUserRoleAssignmentsMutation(candidate.id);
  const queryClient = useQueryClient();
  const currentRole = candidate.roles.find((role) => role.sellerId === sellerId) ?? null;
  const currentRoleIsAssignable = currentRole
    ? roles.some((role) => role.id === currentRole.id)
    : false;
  const isSelf = candidate.id === actorId;
  const form = useForm({
    defaultValues: {
      roleId: currentRoleIsAssignable ? currentRole?.id ?? "" : "",
    },
    validators: { onChange: sellerStaffAssignmentFormSchema },
    onSubmit: async ({ value }) => {
      if (isSelf) return;
      try {
        await updateRoles.mutateAsync([{ roleId: value.roleId, sellerId }]);
        await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller });
      } catch {
        // TanStack Query owns the safe role-assignment error rendered below.
      }
    },
  });

  /** Removes this seller's role assignment while preserving memberships owned by other seller scopes. */
  async function removeSellerAccess(): Promise<void> {
    if (isSelf) return;
    try {
      await updateRoles.mutateAsync([]);
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller });
      form.reset();
    } catch {
      // TanStack Query owns the safe removal error rendered below.
    }
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{candidate.displayName}</h2>
          <p className="text-sm text-slate-600">{candidate.email}</p>
          <p className="mt-1 text-xs text-slate-500">
            Account: {candidate.accountType} · Status: {candidate.status}
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase">
          {currentRole?.name ?? "No seller access"}
        </span>
      </div>

      {isSelf ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          You cannot change your own seller role from this screen.
        </p>
      ) : (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="roleId">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="block text-sm font-medium">
                  Seller role
                  <select
                    aria-label="Seller staff role"
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="">Select a role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {fieldError ? (
                    <span className="mt-1 block text-xs text-red-600">{fieldError}</span>
                  ) : null}
                  <span className="mt-1 block text-xs text-slate-500">
                    Only seller-scoped roles that do not contain staff-management authority are listed.
                  </span>
                </label>
              );
            }}
          </form.Field>

          <FormError error={updateRoles.error} />
          {updateRoles.isSuccess ? (
            <p className="text-sm text-emerald-700">Seller staff access saved.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={updateRoles.isPending}>
              {updateRoles.isPending ? "Saving..." : "Save seller access"}
            </Button>
            {currentRole ? (
              <Button
                type="button"
                variant="outline"
                disabled={updateRoles.isPending}
                onClick={() => void removeSellerAccess()}
              >
                Remove seller access
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

/** Provides exact-email staff lookup and safe seller-role selection for one approved seller. */
function SellerStaffManager({ actorId, sellerId }: { actorId: string; sellerId: string }) {
  const [lookupEmail, setLookupEmail] = useState("");
  const users = useUsersQuery(
    { page: 1, pageSize: 20, search: lookupEmail || undefined },
    Boolean(lookupEmail),
  );
  const roles = useRolesQuery({ page: 1, pageSize: 100, status: "active" });
  const candidate = users.data?.items[0] ?? null;
  const lookupForm = useForm({
    defaultValues: { email: "" },
    validators: { onChange: sellerStaffLookupFormSchema },
    onSubmit: async ({ value }) => {
      setLookupEmail(value.email.trim().toLowerCase());
    },
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Seller staff access</h1>
        <p className="mt-1 text-sm text-slate-600">
          Find one existing marketplace user by exact email, then assign a safe seller role for this seller only.
        </p>
        <form
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void lookupForm.handleSubmit();
          }}
        >
          <lookupForm.Field name="email">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="flex-1 text-sm font-medium">
                  Staff email
                  <input
                    aria-label="Seller staff email"
                    type="email"
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="staff@example.com"
                  />
                  {fieldError ? (
                    <span className="mt-1 block text-xs text-red-600">{fieldError}</span>
                  ) : null}
                </label>
              );
            }}
          </lookupForm.Field>
          <Button disabled={users.isFetching}>
            {users.isFetching ? "Searching..." : "Find staff user"}
          </Button>
        </form>
      </section>

      {roles.isPending ? <LoadingState label="Loading assignable seller roles..." /> : null}
      {roles.isError ? (
        <ErrorState
          title="Seller roles could not be loaded"
          message={roles.error instanceof Error ? roles.error.message : "Please try again."}
          onRetry={() => void roles.refetch()}
        />
      ) : null}
      {users.isError ? (
        <ErrorState
          title="Staff lookup failed"
          message={users.error instanceof Error ? users.error.message : "Please try again."}
          onRetry={() => void users.refetch()}
        />
      ) : null}
      {lookupEmail && !users.isPending && users.data?.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-5 text-sm text-slate-600 shadow-sm">
          No assignable marketplace user was found for {lookupEmail}.
        </p>
      ) : null}
      {candidate && roles.data ? (
        <StaffCandidateAccess
          key={candidate.id}
          actorId={actorId}
          candidate={candidate}
          roles={roles.data.items}
          sellerId={sellerId}
        />
      ) : null}
    </div>
  );
}

/** Loads the current seller scope before rendering the staff-management workflow. */
function SellerStaffContent({ actorId }: { actorId: string }) {
  const seller = useMySellerQuery();

  if (seller.isPending) return <LoadingState label="Loading seller staff scope..." />;
  if (seller.isError) {
    return (
      <ErrorState
        title="Seller staff scope could not be loaded"
        message={seller.error instanceof Error ? seller.error.message : "Please try again."}
        onRetry={() => void seller.refetch()}
      />
    );
  }

  return <SellerStaffManager actorId={actorId} sellerId={seller.data.seller.id} />;
}

/** Protects seller staff access with the seller.staff.manage permission. */
export function SellerStaffPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={SELLER_PERMISSION.STAFF_MANAGE}>
          <SellerStaffContent actorId={user.id} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
