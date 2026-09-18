import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Returns a trusted inbound request ID or creates a new UUID. */
export function resolveRequestId(request: Request): string {
  const candidate = request.header(REQUEST_ID_HEADER);
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/** Reads the request ID stored by requestIdMiddleware. */
export function getRequestId(response: Response): string {
  const value = response.locals.requestId;
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}
