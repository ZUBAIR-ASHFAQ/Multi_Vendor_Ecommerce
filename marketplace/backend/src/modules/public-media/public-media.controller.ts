import type { NextFunction, Request, Response } from "express";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import { resolvePublicMediaBodySchema } from "./public-media.schema.js";
import { PublicMediaService } from "./public-media.service.js";

/** Thin unauthenticated HTTP adapter for the public media resolver. */
export class PublicMediaController {
  /** Receives the resolver service so the HTTP adapter stays thin and testable. */
  constructor(private readonly service: PublicMediaService) {}

  /** Resolves only file IDs already proven public by the service/repository boundary. */
  resolve = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = resolvePublicMediaBodySchema.parse(request.body);
      const result = await this.service.resolve(input);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };
}
