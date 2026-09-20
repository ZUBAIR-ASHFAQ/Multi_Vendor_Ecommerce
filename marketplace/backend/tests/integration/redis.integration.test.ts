import { afterAll, describe, expect, it } from "vitest";
import { checkRedis } from "../../src/common/redis/redis.health.js";
import { closeRedis, connectRedis } from "../../src/common/redis/redis.client.js";

afterAll(async () => {
  await closeRedis();
});

describe("Foundation Redis infrastructure", () => {
  it("connects and passes the PING readiness check", async () => {
    const redis = await connectRedis();
    await expect(checkRedis(redis)).resolves.toBeUndefined();

    const key = "foundation:test:roundtrip";
    await redis.set(key, "ok", "EX", 30);
    await expect(redis.get(key)).resolves.toBe("ok");
    await redis.del(key);
  });
});
