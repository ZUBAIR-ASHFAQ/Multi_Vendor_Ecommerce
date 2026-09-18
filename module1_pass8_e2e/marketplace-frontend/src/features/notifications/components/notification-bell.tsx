import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getCurrentUser } from "@/features/auth/api/auth.api";
import { authQueryKeys } from "@/features/auth/hooks/auth.query-keys";
import { NOTIFICATIONS_PERMISSION } from "../notifications.constants";
import { useNotificationRealtime } from "../hooks/use-notification-realtime";
import { useNotificationsQuery } from "../hooks/use-notifications";

/** Shows the Notification entry point and unread badge once authenticated user data is already in the query cache. */
export function NotificationBell() {
  const currentUser = useQuery({
    queryKey: authQueryKeys.me,
    queryFn: getCurrentUser,
    enabled: false,
  });
  const canRead = currentUser.data?.permissions.includes(NOTIFICATIONS_PERMISSION.READ_OWN) ?? false;
  useNotificationRealtime(canRead);
  const notifications = useNotificationsQuery({ page: 1, pageSize: 1 }, canRead);
  const unreadCount = notifications.data?.meta.unreadCount ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      className="relative rounded-md px-3 py-2 hover:bg-slate-50"
    >
      <span aria-hidden="true">🔔</span>
      <span className="sr-only">Notifications</span>
      {canRead && unreadCount > 0 ? (
        <span
          className={[
            "absolute -right-1 -top-1 min-w-5 rounded-full bg-slate-900 px-1.5 py-0.5",
            "text-center text-[10px] font-semibold text-white",
          ].join(" ")}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
