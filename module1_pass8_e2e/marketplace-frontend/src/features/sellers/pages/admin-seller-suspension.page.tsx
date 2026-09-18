import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { useSuspendSellerMutation } from "../hooks/use-sellers";
import { suspendSellerFormSchema } from "../schemas/sellers.schemas";
import { SELLER_PERMISSION } from "../sellers.constants";

/** Renders the explicit admin-only seller suspension command with a clear audit reason. */
function SellerSuspensionContent() {
  const suspend = useSuspendSellerMutation();
  const form = useForm({
    defaultValues: { sellerId: "", reason: "" },
    validators: { onChange: suspendSellerFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await suspend.mutateAsync({
          id: value.sellerId.trim(),
          reason: value.reason.trim() || undefined,
        });
      } catch {
        // TanStack Query owns the safe suspension error rendered below.
      }
    },
  });

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-bold">Suspend seller</h1>
      <p className="mt-1 text-sm text-slate-600">
        Suspend an approved seller by ID. This blocks new seller commerce while preserving historical orders and finance records.
      </p>
      <form
        className="mt-5 max-w-2xl space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="sellerId">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Seller ID
                <input
                  aria-label="Seller ID to suspend"
                  className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="00000000-0000-4000-8000-000000000000"
                />
                {fieldError ? (
                  <span className="mt-1 block text-xs text-red-600">{fieldError}</span>
                ) : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="reason">
          {(field) => (
            <label className="block text-sm font-medium">
              Suspension reason <span className="font-normal text-slate-500">(optional)</span>
              <textarea
                aria-label="Seller suspension reason"
                className="mt-1 min-h-24 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>

        <FormError error={suspend.error} />
        {suspend.data ? (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            Seller {suspend.data.displayName} is now {suspend.data.status}.
          </p>
        ) : null}
        <Button disabled={suspend.isPending}>
          {suspend.isPending ? "Suspending..." : "Suspend seller"}
        </Button>
      </form>
    </section>
  );
}

/** Protects the explicit seller suspension page with admin.sellers.suspend. */
export function AdminSellerSuspensionPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={SELLER_PERMISSION.ADMIN_SUSPEND}>
          <SellerSuspensionContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
