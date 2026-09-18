import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import { env } from "../../config/env.js";
import { getRequestId } from "../../http/request-id.js";
import { setSystemRequestContext } from "./authentication.middleware.js";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key" as const;

/** Compares API keys in constant time when their byte lengths match. */
function keysMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

/** Creates the stable authentication error returned for an invalid internal API key. */
function invalidInternalCredential(): AppError {
  return new AppError({
    code: ERROR_CODE.UNAUTHENTICATED,
    message: "Internal service authentication is required.",
    statusCode: 401,
  });
}

/** Creates the fail-closed error used when internal authentication is not configured. */
function internalCredentialUnavailable(): AppError {
  return new AppError({
    code: ERROR_CODE.SERVICE_UNAVAILABLE,
    message: "Internal service authentication is unavailable.",
    statusCode: 503,
  });
}

/** Protects trusted internal HTTP commands and establishes a system request context. */
export const internalServiceMiddleware: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  try {
    const expected = env.INTERNAL_API_KEY;
    if (!expected) throw internalCredentialUnavailable();

    const provided = request.header(INTERNAL_API_KEY_HEADER);
    if (!provided || !keysMatch(provided, expected)) {
      throw invalidInternalCredential();
    }

    setSystemRequestContext(response, getRequestId(response));
    next();
  } catch (error) {
    next(error);
  }
};
