import { Button } from "@/components/ui/button";
import type { NotificationItem } from "../types/notifications.types";

/** Presents one safe in-app Notification and exposes read state without rendering arbitrary data_json values. */
export function NotificationCard({
  notification,
  isMarkingRead,
  onMarkRead,
}: {
  notification: NotificationItem;
  isMarkingRead: boolean;
  onMarkRead: (notificationId: string) => void;
}) {
  return (
    <article className={`rounded-xl border bg-white p-5 shadow-sm ${notification.readAt ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{notification.title}</h2>
            {!notification.readAt ? (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Unread</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-700">{notification.body}</p>
          <p className="mt-3 text-xs text-slate-500">
            {notification.type} · {new Date(notification.createdAt).toLocaleString()}
          </p>
        </div>
        {!notification.readAt ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isMarkingRead}
            onClick={() => onMarkRead(notification.id)}
          >
            {isMarkingRead ? "Marking..." : "Mark read"}
          </Button>
        ) : (
          <span className="text-xs text-slate-500">Read</span>
        )}
      </div>
    </article>
  );
}
