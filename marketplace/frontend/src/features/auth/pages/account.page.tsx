import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "../components/authenticated-panel";
import { useLogoutMutation } from "../hooks/use-auth";
import type { AuthenticatedUser } from "../types/auth.types";

/** Formats an account-type code for simple human-readable display. */
function accountTypeLabel(accountType: AuthenticatedUser["accountType"]): string {
  if (accountType === "platform_admin") return "Platform administrator";
  if (accountType === "seller") return "Seller user";
  return "Customer";
}

/** Renders the current server-derived identity, RBAC memberships, and marketplace scopes. */
function AccountContent({ user }: { user: AuthenticatedUser }) {
  const navigate = useNavigate();
  const logout = useLogoutMutation();

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Account</p>
            <h1 className="mt-1 text-2xl font-bold">{user.displayName}</h1>
            <p className="text-sm text-slate-600">{user.email}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
            {accountTypeLabel(user.accountType)}
          </span>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-1 font-medium">{user.status}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Permissions</dt>
            <dd className="mt-1 font-medium">{user.permissions.length}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">Role memberships</h2>
        <div className="mt-4 space-y-2">
          {user.roles.map((role) => (
            <article key={`${role.id}:${role.sellerId ?? "global"}`} className="rounded-md border p-3">
              <strong>{role.name}</strong>
              <p className="text-xs text-slate-500">
                {role.code} · {role.scopeType}
                {role.sellerId ? ` · seller ${role.sellerId}` : ""}
              </p>
            </article>
          ))}
          {user.roles.length === 0 && (
            <p className="text-sm text-slate-500">No explicit role membership is assigned.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">Marketplace scope</h2>
        <p className="mt-2 text-sm text-slate-600">
          Seller and store scope comes from the backend. The browser never chooses its own ownership scope.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Seller IDs</h3>
            <p className="mt-1 break-words text-sm text-slate-600">
              {user.scopes.sellerIds.join(", ") || "None"}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Store IDs</h3>
            <p className="mt-1 break-words text-sm text-slate-600">
              {user.scopes.storeIds.join(", ") || "None yet — Store scope is populated by Module 4."}
            </p>
          </div>
        </div>
      </section>

      {user.accountType === "customer" &&
        (user.permissions.includes("customer.profile.read_own") ||
          user.permissions.includes("customer.address.manage_own")) && (
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">Customer profile</h2>
            <p className="mt-2 text-sm text-slate-600">
              Manage commerce profile and saved delivery/billing addresses in Module 3.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {user.permissions.includes("customer.profile.read_own") && (
                <Button asChild>
                  <Link to="/customer/profile">My profile</Link>
                </Button>
              )}
              {user.permissions.includes("customer.address.manage_own") && (
                <Button asChild variant="outline">
                  <Link to="/customer/addresses">Address book</Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/seller/apply">Become a seller</Link>
              </Button>
            </div>
          </section>
        )}

      <section className="flex flex-wrap gap-3 rounded-xl border bg-white p-6 shadow-sm">
        <Button
          variant="outline"
          disabled={logout.isPending}
          onClick={() => {
            void logout.mutateAsync().then(() => navigate({ to: "/login" }));
          }}
        >
          Sign out
        </Button>
      </section>
    </div>
  );
}

/** Protects the account page and renders the current user's account/session summary. */
export function AccountPage() {
  return <AuthenticatedPanel>{(user) => <AccountContent user={user} />}</AuthenticatedPanel>;
}
