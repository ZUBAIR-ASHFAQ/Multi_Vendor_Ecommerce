import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
import { ApiClientError } from "@/lib/api-error";
import { NotificationCard } from "../components/notification-card";
import { NotificationPagination } from "../components/notification-pagination";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "../hooks/use-notifications";
import { NOTIFICATIONS_PERMISSION } from "../notifications.constants";

/** Renders the current user's persisted in-app Notification list and unread controls. */
function NotificationsContent() {
  const [page, setPage] = useState(1);
  const notifications = useNotificationsQuery({ page, pageSize: 10 });
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();

  if (notifications.isPending) return <LoadingState label="Loading notifications..." />;
  if (notifications.isError) {
    return (
      <ErrorState
        title="Notifications could not be loaded"
        message={notifications.error instanceof Error ? notifications.error.message : "Please try again."}
        requestId={notifications.error instanceof ApiClientError ? notifications.error.requestId : undefined}
        onRetry={() => void notifications.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notifications</p>
            <h1 className="mt-1 text-2xl font-bold">Your notifications</h1>
            <p className="mt-1 text-sm text-slate-600">
              {notifications.data.meta.unreadCount} unread across your account.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={markAllRead.isPending || notifications.data.meta.unreadCount === 0}
              onClick={() => markAllRead.mutate()}
            >
              {markAllRead.isPending ? "Marking all..." : "Mark all read"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/notifications/preferences">Preferences</Link>
            </Button>
          </div>
        </div>
      </section>

      {markRead.isError ? (
        <ErrorState
          title="Notification could not be updated"
          message={markRead.error instanceof Error ? markRead.error.message : "Please try again."}
          requestId={markRead.error instanceof ApiClientError ? markRead.error.requestId : undefined}
        />
      ) : null}
      {markAllRead.isError ? (
        <ErrorState
          title="Notifications could not be updated"
          message={markAllRead.error instanceof Error ? markAllRead.error.message : "Please try again."}
          requestId={markAllRead.error instanceof ApiClientError ? markAllRead.error.requestId : undefined}
        />
      ) : null}

      {notifications.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">You have no notifications yet.</p>
      ) : (
        <div className="space-y-3">
          {notifications.data.items.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              isMarkingRead={markRead.isPending && markRead.variables === notification.id}
              onMarkRead={(notificationId) => markRead.mutate(notificationId)}
            />
          ))}
        </div>
      )}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <NotificationPagination meta={notifications.data.meta} label="Notifications" onPageChange={setPage} />
      </section>
    </div>
  );
}

/** Protects the own-Notification page with the server-provided read permission. */
export function NotificationsPage() {
  return (
    <CustomerAccountLayout>
      {(user) => user.permissions.includes(NOTIFICATIONS_PERMISSION.READ_OWN) ? (
        <NotificationsContent />
      ) : (
        <ErrorState title="Access denied" message="Your account cannot read notifications." />
      )}
    </CustomerAccountLayout>
  );
}
