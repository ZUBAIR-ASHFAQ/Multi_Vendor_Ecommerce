import pinoHttp from "pino-http";
import { loggerOptions } from "../logger/logger.js";

/**
 * Structured HTTP logger.
 *
 * pino-http creates its own logger from the shared options instead of
 * receiving an external Pino instance. This avoids cross-version Pino
 * internal-symbol incompatibilities while preserving application-wide
 * levels, metadata and sensitive-value redaction.
 */
export const httpLoggerMiddleware = pinoHttp({
  ...loggerOptions,

  /** Adds request metadata that is safe to include in structured logs. */
  customProps(request, response) {
    const requestId = response.getHeader("x-request-id");

    return {
      requestId:
        typeof requestId === "string"
          ? requestId
          : undefined,
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
