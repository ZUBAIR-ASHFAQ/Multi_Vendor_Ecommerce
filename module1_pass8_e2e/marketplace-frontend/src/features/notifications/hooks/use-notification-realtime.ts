import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  getAccessToken,
  subscribeAccessToken,
} from "@/lib/auth-session";
import { env } from "@/lib/env";
import { notificationsQueryKeys } from "./notifications.query-keys";

const NOTIFICATION_CREATED_EVENT = "notification.created";

/** Returns the backend origin because Socket.IO is attached beside, not under, /api/v1. */
function realtimeOrigin(): string {
  const apiUrl = new URL(env.VITE_API_BASE_URL);
  return apiUrl.origin;
}

/** Creates one authenticated Socket.IO connection using the existing in-memory access token. */
function connectRealtime(
  accessToken: string,
  onNotificationCreated: () => void,
): Socket {
  const socket = io(realtimeOrigin(), {
    auth: { accessToken },
    withCredentials: true,
  });
  socket.on(NOTIFICATION_CREATED_EVENT, onNotificationCreated);
  return socket;
}

/**
 * Keeps the Notification cache fresh when the server announces a newly persisted in-app Notification.
 * The pushed event never replaces API data; it only triggers a canonical TanStack Query refresh.
 */
export function useNotificationRealtime(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;

    let socket: Socket | null = null;

    /** Reconnects with the latest short-lived access token after login or token rotation. */
    function useToken(token: string | null): void {
      socket?.disconnect();
      socket = null;
      if (!token) return;

      socket = connectRealtime(token, () => {
        void queryClient.invalidateQueries({
          queryKey: notificationsQueryKeys.all,
        });
      });
    }

    useToken(getAccessToken());
    const unsubscribe = subscribeAccessToken(useToken);

    return () => {
      unsubscribe();
      socket?.disconnect();
    };
  }, [enabled, queryClient]);
}
