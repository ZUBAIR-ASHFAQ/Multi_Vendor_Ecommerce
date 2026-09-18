import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ERROR_CODE } from "../errors/error-codes.js";
import { isAppError } from "../errors/app-error.js";
import { logger } from "../logger/logger.js";
import { failureResponse } from "../utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";

/** Returns true when Express/body-parser attached status/type metadata to an Error. */
function isBodyParserError(error: unknown): error is Error & { status?: number; type?: string } {
  return error instanceof Error && ("status" in error || "type" in error);
}

/** Converts all thrown errors into the stable public API envelope without exposing internals. */
export const errorMiddleware: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = getRequestId(response);

  if (error instanceof ZodError) {
    response.status(422).json(
      failureResponse(ERROR_CODE.VALIDATION_FAILED, "Request validation failed.", {
        requestId,
        fieldErrors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
    return;
  }

  if (isAppError(error)) {
    const bodyOptions: { requestId: string; details?: unknown } = { requestId };
    if (error.details !== undefined) bodyOptions.details = error.details;
    response.status(error.statusCode).json(failureResponse(error.code, error.message, bodyOptions));
    return;
  }

  if (isBodyParserError(error) && error.type === "entity.too.large") {
    response.status(413).json(
      failureResponse(ERROR_CODE.PAYLOAD_TOO_LARGE, "Request body is too large.", { requestId }),
    );
    return;
  }

  if (isBodyParserError(error) && error instanceof SyntaxError && error.status === 400) {
    response.status(400).json(
      failureResponse(ERROR_CODE.INVALID_REQUEST, "Request body contains invalid JSON.", { requestId }),
    );
    return;
  }

  logger.error(
    {
      err: error,
      requestId,
      method: request.method,
      path: request.originalUrl,
    },
    "Unhandled HTTP request error",
  );

  response.status(500).json(
    failureResponse(ERROR_CODE.INTERNAL_ERROR, "An unexpected server error occurred.", { requestId }),
  );
};
