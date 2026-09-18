import IORedis, { type Redis } from "ioredis";
import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";

let sharedRedis: Redis | null = null;

/** Creates a Redis connection suitable for ordinary cache/infrastructure commands. */
function createRedisClient(): Redis {
  return new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    connectionName: `${env.SERVICE_NAME}:app`,
  });
}

/** Returns the process-wide Redis client without connecting at import time. */
export function getRedisClient(): Redis {
  if (!sharedRedis) {
    sharedRedis = createRedisClient();
    sharedRedis.on("error", (error) => {
      logger.error({ err: error }, "Redis client error");
    });
  }

  return sharedRedis;
}

/** Connects the shared client explicitly during application bootstrap. */
export async function connectRedis(): Promise<Redis> {
  const redis = getRedisClient();
  if (redis.status === "wait") {
    await redis.connect();
  }
  return redis;
}

/** Closes the shared Redis connection during graceful shutdown. */
export async function closeRedis(): Promise<void> {
  if (!sharedRedis) return;

  if (sharedRedis.status !== "end") {
    await sharedRedis.quit();
  }
  sharedRedis = null;
}
