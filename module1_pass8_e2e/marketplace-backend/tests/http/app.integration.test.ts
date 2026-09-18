import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/database/db.js", () => ({
  db: {},
  checkDatabaseConnection: vi.fn(),
}));

vi.mock("../../src/common/redis/redis.health.js", () => ({
  checkRedis: vi.fn(),
}));

vi.mock("../../src/common/middleware/http-logger.middleware.js", () => ({
  httpLoggerMiddleware: (
    _request: unknown,
    _response: unknown,
    next: () => void,
  ) => next(),
}));

import { checkRedis } from "../../src/common/redis/redis.health.js";
import { checkDatabaseConnection } from "../../src/database/db.js";
import { createApp } from "../../src/app.js";

const databaseCheck = vi.mocked(checkDatabaseConnection);
const redisCheck = vi.mocked(checkRedis);

beforeEach(() => {
  databaseCheck.mockResolvedValue(undefined);
  redisCheck.mockResolvedValue(undefined);
});

describe("Express Foundation", () => {
  it("boots and returns the canonical liveness envelope with a request ID", async () => {
    const response = await request(createApp()).get("/health").expect(200);

    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.body).toMatchObject({
      success: true,
      data: { status: "ok" },
      requestId: response.headers["x-request-id"],
    });
  });

  it("preserves a valid caller request ID and rejects an invalid one", async () => {
    const trusted = await request(createApp())
      .get("/health")
      .set("X-Request-ID", "checkout:test-request-001")
      .expect(200);
    expect(trusted.headers["x-request-id"]).toBe("checkout:test-request-001");

    const regenerated = await request(createApp())
      .get("/health")
      .set("X-Request-ID", "invalid id with spaces")
      .expect(200);
    expect(regenerated.headers["x-request-id"]).not.toBe("invalid id with spaces");
  });

  it("returns ready only when PostgreSQL and Redis checks succeed", async () => {
    const response = await request(createApp()).get("/ready").expect(200);

    expect(databaseCheck).toHaveBeenCalledTimes(1);
    expect(redisCheck).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: "ready",
        dependencies: { database: "ready", redis: "ready" },
      },
    });
  });

  it("returns a controlled 503 readiness error when a dependency is unavailable", async () => {
    databaseCheck.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await request(createApp()).get("/ready").expect(503);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service dependencies are not ready.",
        details: { database: "unavailable", redis: "ready" },
      },
    });
  });

  it("returns a controlled JSON 404 instead of Express HTML", async () => {
    const response = await request(createApp()).get("/does-not-exist").expect(404);

    expect(response.type).toContain("json");
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "RESOURCE_NOT_FOUND" },
    });
  });

  it("normalizes malformed JSON without exposing parser internals", async () => {
    const response = await request(createApp())
      .post("/does-not-exist")
      .set("Content-Type", "application/json")
      .send('{"broken":')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: "INVALID_REQUEST", message: "Request body contains invalid JSON." },
    });
    expect(JSON.stringify(response.body)).not.toContain("SyntaxError");
  });

  it("rejects bodies above the configured limit with a safe 413 envelope", async () => {
    const response = await request(createApp())
      .post("/does-not-exist")
      .set("Content-Type", "application/json")
      .send({ payload: "x".repeat(20_000) })
      .expect(413);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
    });
  });

  it("applies the CORS allow-list", async () => {
    const allowed = await request(createApp())
      .get("/health")
      .set("Origin", "http://localhost:5173")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await request(createApp())
      .get("/health")
      .set("Origin", "https://attacker.example")
      .expect(200);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves the Foundation OpenAPI document", async () => {
    const response = await request(createApp()).get("/openapi.json").expect(200);

    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.paths).toHaveProperty("/health");
    expect(response.body.paths).toHaveProperty("/ready");
  });
});
