import { createServer, type Server } from "node:http";
import {
  app,
  authService,
  inventoryService,
  notificationsService,
  reportsService,
  paymentsService,
  realtimeService,
  searchDiscoveryService,
  sellerWalletPayoutsService,
} from "./app.js";
import { env } from "./config/env.js";
import { IdempotencyService } from "./common/idempotency/idempotency.service.js";
import {
  startLifecycleMaintenanceRuntime,
  type LifecycleMaintenanceRuntime,
} from "./common/jobs/lifecycle-maintenance.runtime.js";
import { logger } from "./common/logger/logger.js";
import { closeRedis, connectRedis } from "./common/redis/redis.client.js";
import { startOutboxRuntime, type OutboxRuntime } from "./common/outbox/outbox-worker.js";
import { checkDatabaseConnection, closeDatabase } from "./database/db.js";
import {
  SEARCH_JOB,
  startSearchDiscoveryRuntime,
  type SearchDiscoveryRuntime,
} from "./modules/search-discovery/index.js";
import {
  startPaymentsRuntime,
  type PaymentsRuntime,
} from "./modules/payments/index.js";
import {
  startSellerWalletPayoutsRuntime,
  WALLET_PAYOUT_JOB,
  type SellerWalletPayoutsRuntime,
} from "./modules/seller-wallet-payouts/index.js";
import {
  NOTIFICATIONS_JOB,
  startNotificationsRuntime,
  type NotificationsRuntime,
} from "./modules/notifications/index.js";
import {
  REPORTS_JOB,
  startReportsRuntime,
  type ReportsRuntime,
} from "./modules/reports/index.js";

let httpServer: Server | null = null;
let outboxRuntime: OutboxRuntime | null = null;
let searchRuntime: SearchDiscoveryRuntime | null = null;
let lifecycleMaintenanceRuntime: LifecycleMaintenanceRuntime | null = null;
let paymentsRuntime: PaymentsRuntime | null = null;
let sellerWalletPayoutsRuntime: SellerWalletPayoutsRuntime | null = null;
let notificationsRuntime: NotificationsRuntime | null = null;
let reportsRuntime: ReportsRuntime | null = null;
let shuttingDown = false;

/** Connects the database and Redis before any required background runtime is started. */
async function connectRequiredDependencies(): Promise<void> {
  await Promise.all([checkDatabaseConnection(), connectRedis()]);
}

/** Starts every background runtime required by the current Module 0-20 service-stage application. */
async function startRequiredBackgroundRuntimes(): Promise<void> {
  searchRuntime = await startSearchDiscoveryRuntime(searchDiscoveryService);
  paymentsRuntime = await startPaymentsRuntime(paymentsService);
  sellerWalletPayoutsRuntime = await startSellerWalletPayoutsRuntime(
    sellerWalletPayoutsService,
  );
  notificationsRuntime = await startNotificationsRuntime(notificationsService);
  reportsRuntime = await startReportsRuntime(reportsService);

  // Foundation publishes each committed domain event to independent consumer queues.
  outboxRuntime = await startOutboxRuntime([
    SEARCH_JOB.SOURCE_EVENT_QUEUE,
    WALLET_PAYOUT_JOB.SOURCE_EVENT_QUEUE,
    NOTIFICATIONS_JOB.SOURCE_EVENT_QUEUE,
    REPORTS_JOB.SOURCE_EVENT_QUEUE,
  ]);

  const idempotencyService = new IdempotencyService();
  lifecycleMaintenanceRuntime = await startLifecycleMaintenanceRuntime({
    /** Deletes expired completed/failed retry keys without touching active operations. */
    async cleanupExpiredIdempotencyKeys(limit) {
      return idempotencyService.cleanupExpiredIdempotencyKeys(limit);
    },

    /** Releases only expired temporary Inventory holds; committed stock stays reserved. */
    async releaseExpiredInventoryReservations(limit) {
      return inventoryService.releaseExpiredReservations(limit);
    },
  });
}

/** Closes any background runtime that was started, including partial startup attempts. */
async function closeBackgroundRuntimes(): Promise<void> {
  if (lifecycleMaintenanceRuntime) {
    await lifecycleMaintenanceRuntime.close();
    lifecycleMaintenanceRuntime = null;
  }

  // Stop the event fan-out producer before closing its queue consumers.
  if (outboxRuntime) {
    await outboxRuntime.close();
    outboxRuntime = null;
  }

  if (reportsRuntime) {
    await reportsRuntime.close();
    reportsRuntime = null;
  }

  if (notificationsRuntime) {
    await notificationsRuntime.close();
    notificationsRuntime = null;
  }

  if (sellerWalletPayoutsRuntime) {
    await sellerWalletPayoutsRuntime.close();
    sellerWalletPayoutsRuntime = null;
  }

  if (paymentsRuntime) {
    await paymentsRuntime.close();
    paymentsRuntime = null;
  }

  if (searchRuntime) {
    await searchRuntime.close();
    searchRuntime = null;
  }
}

/** Starts required dependencies/workers first so HTTP can never advertise readiness after a startup failure. */
export async function startServer(): Promise<Server> {
  try {
    await connectRequiredDependencies();
    await startRequiredBackgroundRuntimes();

    return await new Promise<Server>((resolve, reject) => {
      const server = createServer(app);
      realtimeService.start(
        server,
        env.CORS_ORIGINS,
        async (accessToken, requestId) => {
          const authenticated = await authService.authenticateAccessToken(
            accessToken,
            requestId,
          );
          if (!authenticated.context.actorId) {
            throw new Error("Authentication is required.");
          }
          return authenticated.context.actorId;
        },
      );

      server.listen(env.PORT, env.HOST, () => {
        httpServer = server;
        logger.info({ host: env.HOST, port: env.PORT }, "Marketplace API listening");
        resolve(server);
      });

      server.once("error", reject);
    });
  } catch (error) {
    await closeBackgroundRuntimes();
    await Promise.allSettled([closeRedis(), closeDatabase()]);
    throw error;
  }
}

/** Stops accepting traffic and closes shared infrastructure in a deterministic order. */
export async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "Graceful shutdown started");

  try {
    realtimeService.closeConnections();

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((error) => (error ? reject(error) : resolve()));
      });
      httpServer = null;
    }

    await closeBackgroundRuntimes();
    await Promise.allSettled([closeRedis(), closeDatabase()]);
    logger.info("Graceful shutdown completed");
  } catch (error) {
    logger.error({ err: error }, "Graceful shutdown failed");
    exitCode = 1;
  } finally {
    process.exitCode = exitCode;
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});

if (process.env.NODE_ENV !== "test") {
  startServer().catch((error: unknown) => {
    logger.fatal({ err: error }, "Marketplace API failed to start");
    process.exitCode = 1;
  });
}
