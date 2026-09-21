import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { CustomerPagination } from "../components/customer-pagination";
import { CUSTOMER_PERMISSION, CUSTOMER_SORT } from "../customers.constants";
import { AdminCustomerFilterForm } from "../forms/admin-customer-filter-form";
import { useAdminCustomersQuery } from "../hooks/use-customers";
import type { CustomerListParams } from "../types/customers.types";

/** Loads and renders the permission-scoped administration customer table. */
function AdminCustomersContent() {
  const [params, setParams] = useState<CustomerListParams>({
    page: 1,
    pageSize: 20,
    sort: CUSTOMER_SORT.CREATED_DESC,
  });
  const customers = useAdminCustomersQuery(params);

  /** Applies validated filters and returns the list to page one. */
  function applyFilters(filters: CustomerListParams): void {
    setParams({ ...filters, page: 1, pageSize: 20 });
  }

  /** Changes only the current page while preserving active filters. */
  function changePage(page: number): void {
    setParams((current) => ({ ...current, page }));
  }

  return (
    <div className="space-y-5">
      <AdminCustomerFilterForm onApply={applyFilters} />

      {customers.isPending ? <LoadingState label="Loading customers..." /> : null}
      {customers.isError ? (
        <ErrorState
          title="Customers could not be loaded"
          message={customers.error instanceof Error ? customers.error.message : "Please try again."}
          onRetry={() => void customers.refetch()}
        />
      ) : null}

      {customers.data ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="mt-1 text-sm text-slate-600">Search customer identities and their current Module 3 profile/address summary.</p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2">Customer</th>
                  <th>Account</th>
                  <th>Profile</th>
                  <th>Addresses</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {customers.data.items.map((customer) => (
                  <tr key={customer.userId} className="border-b">
                    <td className="py-3">
                      <strong>{customer.displayName}</strong>
                      <span className="block text-xs text-slate-500">{customer.email}</span>
                    </td>
                    <td>{customer.accountStatus}</td>
                    <td>{customer.profileStatus}</td>
                    <td>{customer.addressCount}</td>
                    <td className="text-right">
                      <Link className="underline" to="/admin/customers/$customerId" params={{ customerId: customer.userId }}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {customers.data.items.length === 0 && <p className="py-8 text-center text-slate-500">No customers found.</p>}
          </div>

          <div className="mt-4">
            <CustomerPagination meta={customers.data.meta} onPage={changePage} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Protects the admin customer search page with the Module 3 privileged read permission. */
export function AdminCustomersPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ}>
          <AdminCustomersContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
