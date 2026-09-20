import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import { failureResponse } from "../utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";

const allowedOrigins = new Set(env.CORS_ORIGINS);

/** Browser CORS policy. Authentication/authorization remains authoritative for API access. */
export const corsMiddleware = cors({
  credentials: true,
  /** Allows requests without an Origin header and requests from the configured allow-list. */
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
} satisfies CorsOptions);

/** Security headers for all HTTP responses. */
export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

/** Coarse global abuse protection. Sensitive Module 2 endpoints add stricter route-specific limits later. */
export const globalRateLimitMiddleware = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (request: Request) => request.path === "/health" || request.path === "/ready",
  handler: (_request: Request, response: Response) => {
    response.status(429).json(
      failureResponse(ERROR_CODE.RATE_LIMITED, "Too many requests. Try again later.", {
        requestId: getRequestId(response),
      }),
    );
  },
});
