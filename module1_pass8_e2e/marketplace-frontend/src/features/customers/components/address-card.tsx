import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { CustomerAddressForm } from "../forms/customer-address-form";
import {
  useArchiveCustomerAddressMutation,
  useUpdateCustomerAddressMutation,
} from "../hooks/use-customers";
import type { CustomerAddress, CustomerAddressWriteInput } from "../types/customers.types";

/** Displays one active saved address and its explicit edit/default/archive commands. */
export function AddressCard({ address }: { address: CustomerAddress }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCustomerAddressMutation(address.id);
  const archive = useArchiveCustomerAddressMutation(address.id);

  /** Saves all editable address fields and then closes the edit form. */
  async function saveAddress(input: CustomerAddressWriteInput): Promise<void> {
    await update.mutateAsync(input);
    setEditing(false);
  }

  /** Makes this address the shipping default using the normal scoped PATCH command. */
  function makeShippingDefault(): void {
    update.mutate({ isDefaultShipping: true });
  }

  /** Makes this address the billing default using the normal scoped PATCH command. */
  function makeBillingDefault(): void {
    update.mutate({ isDefaultBilling: true });
  }

  /** Archives the address while leaving historical data in PostgreSQL. */
  function archiveAddress(): void {
    archive.mutate();
  }

  if (editing) {
    return (
      <article className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Edit {address.label}</h2>
        <div className="mt-4">
          <CustomerAddressForm
            address={address}
            submitLabel="Save address"
            isPending={update.isPending}
            error={update.error}
            onSubmit={saveAddress}
            onCancel={() => setEditing(false)}
          />
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{address.label}</h2>
          <p className="mt-1 text-sm text-slate-700">{address.recipientName} · {address.phone}</p>
          <p className="mt-2 text-sm text-slate-600">
            {address.line1}{address.line2 ? `, ${address.line2}` : ""}<br />
            {address.city}, {address.region}{address.postalCode ? ` ${address.postalCode}` : ""}<br />
            {address.countryCode}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {address.isDefaultShipping && <span className="rounded-full bg-slate-100 px-2 py-1">Default shipping</span>}
          {address.isDefaultBilling && <span className="rounded-full bg-slate-100 px-2 py-1">Default billing</span>}
        </div>
      </div>

      <FormError error={update.error ?? archive.error} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        {!address.isDefaultShipping && (
          <Button type="button" variant="outline" size="sm" disabled={update.isPending} onClick={makeShippingDefault}>
            Make shipping default
          </Button>
        )}
        {!address.isDefaultBilling && (
          <Button type="button" variant="outline" size="sm" disabled={update.isPending} onClick={makeBillingDefault}>
            Make billing default
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={archive.isPending} onClick={archiveAddress}>
          {archive.isPending ? "Archiving..." : "Archive"}
        </Button>
      </div>
    </article>
  );
}
