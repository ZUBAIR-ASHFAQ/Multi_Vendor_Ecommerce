import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { CUSTOMER_PERMISSION } from "../customers.constants";
import { useAdminCustomerDetailQuery } from "../hooks/use-customers";

/** Loads and renders one privileged customer summary without inventing downstream order data. */
function AdminCustomerDetailContent({ customerId }: { customerId: string }) {
  const detail = useAdminCustomerDetailQuery(customerId);

  if (detail.isPending) return <LoadingState label="Loading customer detail..." />;
  if (detail.isError) {
    return (
      <ErrorState
        title="Customer detail could not be loaded"
        message={detail.error instanceof Error ? detail.error.message : "Please try again."}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer detail</p>
            <h1 className="mt-1 text-2xl font-bold">{detail.data.customer.displayName}</h1>
            <p className="text-sm text-slate-600">{detail.data.customer.email}</p>
          </div>
          <Button asChild variant="outline"><Link to="/admin/customers">Back to customers</Link></Button>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs uppercase text-slate-500">Account status</dt><dd>{detail.data.customer.accountStatus}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Profile status</dt><dd>{detail.data.customer.profileStatus}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Phone</dt><dd>{detail.data.customer.phone ?? "Not set"}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Active addresses</dt><dd>{detail.data.customer.addressCount}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Address history</h2>
        <div className="mt-4 space-y-3">
          {detail.data.addresses.map((address) => (
            <article key={address.id} className="rounded-md border p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{address.label}</strong>
                <span className="text-xs text-slate-500">{address.status}</span>
              </div>
              <p className="mt-2 text-slate-600">
                {address.recipientName} · {address.line1}, {address.city}, {address.region} · {address.countryCode}
              </p>
            </article>
          ))}
          {detail.data.addresses.length === 0 && <p className="text-sm text-slate-500">No address history.</p>}
        </div>
      </section>

      <section id="order-summary" className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Order summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          Module 11 owns customer orders. Module 3 intentionally exposes no order totals or order history before that source exists.
        </p>
      </section>
    </div>
  );
}

/** Protects one admin customer detail page with the privileged Module 3 permission. */
export function AdminCustomerDetailPage() {
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ}>
          <AdminCustomerDetailContent customerId={customerId} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
