import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  AdminQueueEmpty,
  AdminQueueHeader,
  AdminQueueTable,
  AdminQueueTableHead,
} from "@/features/administration/components/admin-queue";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
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

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Operations · Notifications"
        title="Failed delivery queue"
        description="The current admin API exposes failed deliveries only, with masked destinations. Retry reuses the original durable event, recipient, channel, and delivery identity."
        meta={deliveries.data?.meta}
        visibleCount={deliveries.data?.items.length}
      />

      {deliveries.isPending ? <LoadingState variant="table" label="Loading failed notification deliveries..." /> : null}
      {deliveries.isError ? (
        <ErrorState
          title="Failed deliveries could not be loaded"
          message={deliveries.error instanceof Error ? deliveries.error.message : "Please try again."}
          requestId={deliveries.error instanceof ApiClientError ? deliveries.error.requestId : undefined}
          onRetry={() => void deliveries.refetch()}
        />
      ) : null}

      {retry.isError ? (
        <ErrorState
          title="Delivery could not be retried"
          message={retry.error instanceof Error ? retry.error.message : "Please try again."}
          requestId={retry.error instanceof ApiClientError ? retry.error.requestId : undefined}
        />
      ) : null}

      {deliveries.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No failed notification deliveries"
          description="There is no failed-delivery work in the current queue. The existing endpoint does not expose additional search or status filters."
        />
      ) : null}

      {deliveries.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[1050px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Channel / destination</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">Last error</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {deliveries.data.items.map((delivery) => (
              <tr key={delivery.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{delivery.templateCode}</strong>
                  <span className="block break-all text-xs text-foreground-muted">User {delivery.userId}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="block">{NOTIFICATION_CHANNEL_LABEL[delivery.channel]}</span>
                  <span className="block text-xs text-foreground-muted">{delivery.destinationMasked}</span>
                </td>
                <td className="px-4 py-3"><StatusPill tone="negative">{NOTIFICATION_DELIVERY_STATUS_LABEL[delivery.status]}</StatusPill></td>
                <td className="px-4 py-3">{delivery.attempts}</td>
                <td className="px-4 py-3 text-xs text-foreground-muted">{delivery.lastErrorCode ?? "Unknown"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(delivery.updatedAt)}</td>
                <td className="px-4 py-3 text-right">
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
                  ) : (
                    <span className="text-xs text-foreground-muted">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {deliveries.data ? (
        <NotificationPagination meta={deliveries.data.meta} label="Failed deliveries" onPageChange={setPage} />
      ) : null}
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
