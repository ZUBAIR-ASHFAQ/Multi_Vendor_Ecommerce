import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer, type Socket } from "socket.io";

/** Payload sent after a durable in-app Notification row has committed. */
export interface RealtimeNotificationCreatedPayload {
  notificationId: string;
}

/** Authenticates one Socket.IO handshake using the same access-token rules as HTTP. */
export type RealtimeAuthenticator = (
  accessToken: string,
  requestId: string,
) => Promise<string>;

/** Small boundary consumed by Module 18 so Notification business logic does not depend on Socket.IO. */
export interface NotificationRealtimePublisher {
  /** Announces one already-persisted in-app Notification to the owning user. */
  publishNotificationCreated(userId: string, notificationId: string): void;
}

const NOTIFICATION_CREATED_EVENT = "notification.created";

/** Returns the private Socket.IO room used for one authenticated user. */
function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Reads the short-lived access token supplied in Socket.IO handshake auth data. */
function handshakeAccessToken(socket: Socket): string | null {
  const value = socket.handshake.auth?.accessToken;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Owns the small Socket.IO transport layer used for in-app push notifications.
 * PostgreSQL remains authoritative; this class only tells connected clients to refresh their persisted state.
 */
export class RealtimeService implements NotificationRealtimePublisher {
  private io: SocketIoServer | null = null;

  /** Attaches Socket.IO to the existing HTTP server and authenticates every connection server-side. */
  start(
    httpServer: HttpServer,
    allowedOrigins: readonly string[],
    authenticate: RealtimeAuthenticator,
  ): void {
    if (this.io) return;

    const io = new SocketIoServer(httpServer, {
      cors: {
        origin: [...allowedOrigins],
        credentials: true,
      },
    });

    io.use(async (socket, next) => {
      try {
        const accessToken = handshakeAccessToken(socket);
        if (!accessToken) {
          next(new Error("Authentication is required."));
          return;
        }

        const userId = await authenticate(accessToken, `socket-${randomUUID()}`);
        socket.data.userId = userId;
        next();
      } catch {
        next(new Error("Authentication is required."));
      }
    });

    io.on("connection", (socket) => {
      const userId = socket.data.userId;
      if (typeof userId !== "string" || userId.length === 0) {
        socket.disconnect(true);
        return;
      }
      void socket.join(userRoom(userId));
    });

    this.io = io;
  }

  /** Emits only a Notification identifier so clients re-read canonical state from the API. */
  publishNotificationCreated(userId: string, notificationId: string): void {
    const payload: RealtimeNotificationCreatedPayload = { notificationId };
    this.io?.to(userRoom(userId)).emit(NOTIFICATION_CREATED_EVENT, payload);
  }

  /** Disconnects active realtime clients during graceful shutdown without owning the HTTP server lifecycle. */
  closeConnections(): void {
    this.io?.disconnectSockets(true);
    this.io?.removeAllListeners();
    this.io = null;
  }
}
