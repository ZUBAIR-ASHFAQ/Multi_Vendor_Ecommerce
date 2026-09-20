import type { Request, Response } from "express";
import { ERROR_CODE } from "../errors/error-codes.js";
import { failureResponse } from "../utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";

/** Produces a controlled JSON 404 instead of Express' default HTML response. */
export function notFoundMiddleware(request: Request, response: Response): void {
  response.status(404).json(
    failureResponse(ERROR_CODE.RESOURCE_NOT_FOUND, `Route ${request.method} ${request.path} was not found.`, {
      requestId: getRequestId(response),
    }),
  );
}
