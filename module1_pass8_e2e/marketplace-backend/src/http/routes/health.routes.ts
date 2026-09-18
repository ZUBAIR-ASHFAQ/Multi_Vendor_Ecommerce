import { Router } from "express";
import { successResponse } from "../../common/utils/api-response.js";
import { checkDatabaseConnection } from "../../database/db.js";
import { checkRedis } from "../../common/redis/redis.health.js";
import { logger } from "../../common/logger/logger.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { failureResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../request-id.js";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  response.status(200).json(
    successResponse(
      {
        status: "ok" as const,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { requestId: getRequestId(response) },
    ),
  );
});

healthRouter.get("/ready", async (_request, response) => {
  const checks = await Promise.allSettled([checkDatabaseConnection(), checkRedis()]);
  const databaseReady = checks[0]?.status === "fulfilled";
  const redisReady = checks[1]?.status === "fulfilled";
  const ready = databaseReady && redisReady;
  const requestId = getRequestId(response);

  if (!ready) {
    logger.warn(
      {
        requestId,
        databaseReady,
        redisReady,
      },
      "Readiness check failed",
    );

    response.status(503).json(
      failureResponse(ERROR_CODE.SERVICE_UNAVAILABLE, "Service dependencies are not ready.", {
        requestId,
        details: {
          database: databaseReady ? "ready" : "unavailable",
          redis: redisReady ? "ready" : "unavailable",
        },
      }),
    );
    return;
  }

  response.status(200).json(
    successResponse(
      {
        status: "ready" as const,
        dependencies: {
          database: "ready" as const,
          redis: "ready" as const,
        },
        timestamp: new Date().toISOString(),
      },
      { requestId },
    ),
  );
});
