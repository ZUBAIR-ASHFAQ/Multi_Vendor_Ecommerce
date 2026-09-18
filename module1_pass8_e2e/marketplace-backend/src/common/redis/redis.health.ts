import type { Redis } from "ioredis";
import { getRedisClient } from "./redis.client.js";

/** Verifies Redis responds to a lightweight PING without hiding failures. */
export async function checkRedis(redis: Redis = getRedisClient()): Promise<void> {
  const response = await redis.ping();
  if (response !== "PONG") {
    throw new Error(`Unexpected Redis PING response: ${response}`);
  }
}
