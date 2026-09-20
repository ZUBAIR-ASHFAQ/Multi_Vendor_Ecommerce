import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getCurrentUser } from "@/features/auth/api/auth.api";
import { authQueryKeys } from "@/features/auth/hooks/auth.query-keys";
import { NOTIFICATIONS_PERMISSION } from "../notifications.constants";
import { useNotificationRealtime } from "../hooks/use-notification-realtime";
import { useNotificationsQuery } from "../hooks/use-notifications";

/** Shows the Notification entry point and unread badge once authenticated user data is already in the query cache. */
export function NotificationBell() {
  const currentUser = useQuery({ queryKey: authQueryKeys.me, queryFn: getCurrentUser, enabled: false });
  const canRead = currentUser.data?.permissions.includes(NOTIFICATIONS_PERMISSION.READ_OWN) ?? false;
  useNotificationRealtime(canRead);
  const notifications = useNotificationsQuery({ page: 1, pageSize: 1 }, canRead);
  const unreadCount = notifications.data?.meta.unreadCount ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      className="marketplace-notification-link"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span className="sr-only">Notifications</span>
      {canRead && unreadCount > 0 ? (
        <span className="marketplace-count-badge marketplace-notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
      ) : null}
    </Link>
  );
}
