import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AddressCard } from "../components/address-card";
import { CustomerLayout, RequireCustomerPermission } from "../components/customer-layout";
import { CUSTOMER_PERMISSION } from "../customers.constants";
import { CustomerAddressForm } from "../forms/customer-address-form";
import {
  useCreateCustomerAddressMutation,
  useCustomerAddressesQuery,
} from "../hooks/use-customers";
import type { CustomerAddressWriteInput } from "../types/customers.types";

/** Loads active addresses and provides the create-address workflow. */
function CustomerAddressesContent() {
  const addresses = useCustomerAddressesQuery();
  const create = useCreateCustomerAddressMutation();

  /** Creates a new saved address through the customer-scoped API. */
  async function createAddress(input: CustomerAddressWriteInput): Promise<void> {
    await create.mutateAsync(input);
  }

  if (addresses.isPending) return <LoadingState label="Loading saved addresses..." />;
  if (addresses.isError) {
    return (
      <ErrorState
        title="Addresses could not be loaded"
        message={addresses.error instanceof Error ? addresses.error.message : "Please try again."}
        onRetry={() => void addresses.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Address book</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saved addresses stay editable here. Future orders copy immutable address snapshots instead of depending on later edits.
        </p>
        <div className="mt-5">
          <CustomerAddressForm
            submitLabel="Add address"
            isPending={create.isPending}
            error={create.error}
            resetAfterSubmit
            onSubmit={createAddress}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Saved addresses</h2>
        {addresses.data.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No saved addresses yet.</p>
        ) : (
          addresses.data.map((address) => <AddressCard key={address.id} address={address} />)
        )}
      </section>
    </div>
  );
}

/** Protects the address-book route with the customer-owned address permission. */
export function CustomerAddressesPage() {
  return (
    <CustomerLayout>
      {(user) => (
        <RequireCustomerPermission user={user} permission={CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN}>
          <CustomerAddressesContent />
        </RequireCustomerPermission>
      )}
    </CustomerLayout>
  );
}
