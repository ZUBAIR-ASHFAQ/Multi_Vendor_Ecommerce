import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { NotificationPagination } from "../components/notification-pagination";
import {
  useAdminNotificationDeliveriesQuery,
  useRetryNotificationDeliveryMutation,
} from "../hooks/use-notifications";
import {
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_DELIVERY_STATUS_LABEL,
  NOTIFICATIONS_PERMISSION,
} from "../notifications.constants";

/** Renders the privacy-safe failed-delivery queue and privileged retry command. */
function AdminNotificationDeliveriesContent({ canRetry }: { canRetry: boolean }) {
  const [page, setPage] = useState(1);
  const deliveries = useAdminNotificationDeliveriesQuery({ page, pageSize: 20 });
  const retry = useRetryNotificationDeliveryMutation();

  if (deliveries.isPending) return <LoadingState label="Loading failed notification deliveries..." />;
  if (deliveries.isError) {
    return (
      <ErrorState
        title="Failed deliveries could not be loaded"
        message={deliveries.error instanceof Error ? deliveries.error.message : "Please try again."}
        requestId={deliveries.error instanceof ApiClientError ? deliveries.error.requestId : undefined}
        onRetry={() => void deliveries.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notifications</p>
        <h1 className="mt-1 text-2xl font-bold">Failed delivery queue</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Destinations are masked. Retry reuses the original durable event, recipient, channel, and delivery identity.
        </p>
      </section>

      {retry.isError ? (
        <ErrorState
          title="Delivery could not be retried"
          message={retry.error instanceof Error ? retry.error.message : "Please try again."}
          requestId={retry.error instanceof ApiClientError ? retry.error.requestId : undefined}
        />
      ) : null}

      {deliveries.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">There are no failed Notification deliveries.</p>
      ) : (
        <div className="space-y-3">
          {deliveries.data.items.map((delivery) => (
            <article key={delivery.id} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 text-sm">
                  <h2 className="font-semibold">{delivery.templateCode}</h2>
                  <p>{NOTIFICATION_CHANNEL_LABEL[delivery.channel]} · {delivery.destinationMasked}</p>
                  <p className="text-xs text-slate-500">User {delivery.userId}</p>
                  <p className="text-xs text-slate-500">Attempts: {delivery.attempts} · Error: {delivery.lastErrorCode ?? "Unknown"}</p>
                  <p className="text-xs text-slate-500">Updated {new Date(delivery.updatedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-800">
                    {NOTIFICATION_DELIVERY_STATUS_LABEL[delivery.status]}
                  </span>
                  {canRetry ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={retry.isPending && retry.variables === delivery.id}
                      onClick={() => retry.mutate(delivery.id)}
                    >
                      {retry.isPending && retry.variables === delivery.id ? "Retrying..." : "Retry"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <NotificationPagination meta={deliveries.data.meta} label="Failed deliveries" onPageChange={setPage} />
      </section>
    </div>
  );
}

/** Protects failed-delivery reads and separately hides retry commands without the privileged retry permission. */
export function AdminNotificationDeliveriesPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={NOTIFICATIONS_PERMISSION.ADMIN_READ}>
          <AdminNotificationDeliveriesContent
            canRetry={user.permissions.includes(NOTIFICATIONS_PERMISSION.ADMIN_RETRY)}
          />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}
