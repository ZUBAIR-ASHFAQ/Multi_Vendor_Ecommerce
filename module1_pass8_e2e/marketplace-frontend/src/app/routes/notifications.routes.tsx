import { createRoute } from "@tanstack/react-router";
import { AdminNotificationDeliveriesPage } from "@/features/notifications/pages/admin-notification-deliveries.page";
import { NotificationPreferencesPage } from "@/features/notifications/pages/notification-preferences.page";
import { NotificationsPage } from "@/features/notifications/pages/notifications.page";
import { rootRoute } from "./root.route";

/** Current-user in-app Notification list route. */
export const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationsPage,
});

/** Current-user Notification preference editor route. */
export const notificationPreferencesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications/preferences",
  component: NotificationPreferencesPage,
});

/** Privileged failed-delivery queue and retry route. */
export const adminNotificationDeliveriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/notification-deliveries",
  component: AdminNotificationDeliveriesPage,
});
