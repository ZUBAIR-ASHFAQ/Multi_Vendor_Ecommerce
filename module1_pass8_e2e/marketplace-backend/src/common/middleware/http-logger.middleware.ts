import pinoHttp from "pino-http";
import { logger } from "../logger/logger.js";

/** Structured HTTP logger. Sensitive headers are redacted by the shared Pino logger. */
export const httpLoggerMiddleware = pinoHttp({
  logger,
  /** Adds request metadata that is safe to include in structured logs. */
  customProps(request, response) {
    const requestId = response.getHeader("x-request-id");
    return {
      requestId: typeof requestId === "string" ? requestId : undefined,
      method: request.method,
      path: request.url,
    };
  },
  /** Builds a concise success message for one completed HTTP request. */
  customSuccessMessage(request, response) {
    return `${request.method} ${request.url} completed with ${response.statusCode}`;
  },
  /** Builds a concise error message without exposing request secrets. */
  customErrorMessage(request, response) {
    return `${request.method} ${request.url} failed with ${response.statusCode}`;
  },
});
