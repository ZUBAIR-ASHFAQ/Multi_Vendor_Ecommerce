import type { NextFunction, Request, Response } from "express";
import { resolveRequestId } from "../../http/request-id.js";

/** Assigns one stable request ID and exposes it to both clients and downstream middleware. */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const requestId = resolveRequestId(request);
  response.locals.requestId = requestId;
  response.setHeader("X-Request-ID", requestId);
  next();
}
