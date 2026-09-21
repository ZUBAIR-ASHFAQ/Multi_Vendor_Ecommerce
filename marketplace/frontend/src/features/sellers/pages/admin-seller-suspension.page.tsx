import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/feedback/confirmation-dialog";
import { SuccessFeedback } from "@/components/feedback/system-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { useSuspendSellerMutation } from "../hooks/use-sellers";
import { suspendSellerFormSchema } from "../schemas/sellers.schemas";
import { SELLER_PERMISSION } from "../sellers.constants";

/** Renders the explicit admin-only seller suspension command with a clear audit reason. */
function SellerSuspensionContent() {
  const suspend = useSuspendSellerMutation();
  const [pendingCommand, setPendingCommand] = useState<{ id: string; reason?: string } | null>(null);
  const form = useForm({
    defaultValues: { sellerId: "", reason: "" },
    validators: { onChange: suspendSellerFormSchema },
    onSubmit: async ({ value }) => {
      setPendingCommand({
        id: value.sellerId.trim(),
        reason: value.reason.trim() || undefined,
      });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Marketplace · Seller controls"
        title="Suspend seller"
        description="Use this command only for an already-approved seller. Suspension blocks new seller commerce while preserving historical order and finance records."
      />

      <Surface className="max-w-3xl" variant="elevated">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Suspension command</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">The seller ID is authoritative; display-name lookup is not part of the current API contract.</p>
          </div>
          <StatusPill tone="negative">Destructive action</StatusPill>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="sellerId">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="block text-sm font-medium text-foreground">
                  Seller ID
                  <Input
                    aria-label="Seller ID to suspend"
                    className="mt-1 font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="00000000-0000-4000-8000-000000000000"
                    aria-invalid={Boolean(fieldError)}
                  />
                  {fieldError ? <span className="mt-1 block text-xs text-negative">{fieldError}</span> : null}
                </label>
              );
            }}
          </form.Field>

          <form.Field name="reason">
            {(field) => (
              <label className="block text-sm font-medium text-foreground">
                Suspension reason <span className="font-normal text-foreground-muted">(optional)</span>
                <Textarea
                  aria-label="Seller suspension reason"
                  className="mt-1 min-h-28"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Add concise operational context for the audit trail"
                />
              </label>
            )}
          </form.Field>

          <FormError error={suspend.error} />
          {suspend.data ? (
            <SuccessFeedback>Seller {suspend.data.displayName} is now {suspend.data.status}.</SuccessFeedback>
          ) : null}
          <Button type="submit" variant="destructive" disabled={suspend.isPending}>
            {suspend.isPending ? "Suspending..." : "Suspend seller"}
          </Button>
        </form>
      </Surface>
      <ConfirmationDialog
        open={pendingCommand !== null}
        title="Suspend this seller?"
        description="Suspension blocks new seller commerce while preserving historical orders and finance records. Confirm the seller ID and audit reason before continuing."
        confirmLabel="Confirm suspension"
        isPending={suspend.isPending}
        onCancel={() => setPendingCommand(null)}
        onConfirm={() => {
          if (!pendingCommand) return;
          suspend.mutate(pendingCommand, { onSettled: () => setPendingCommand(null) });
        }}
      />
    </div>
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
