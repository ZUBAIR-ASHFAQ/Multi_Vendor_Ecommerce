import { Router } from "express";
import { PUBLIC_MEDIA_RESOLVE_LIMIT } from "./public-media.constants.js";
import { PublicMediaController } from "./public-media.controller.js";

/** Creates the deliberately unauthenticated public media delivery route. */
export function createPublicMediaRouter(controller: PublicMediaController): Router {
  const router = Router();
  router.post("/public/resolve", controller.resolve);
  return router;
}

const requestId = { type: "string", minLength: 1 } as const;

const failure = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        fieldErrors: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "message"],
            properties: {
              path: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    requestId,
  },
} as const;

/** OpenAPI contract for the public batch resolver. */
export const publicMediaOpenApiPaths = {
  "/api/v1/media/public/resolve": {
    post: {
      tags: ["Public Media"],
      summary: "Resolve public media URLs",
      operationId: "resolvePublicMedia",
      description:
        "Returns short-lived inline URLs only for confirmed files currently attached to a public " +
        "published Product or active Store logo. Unknown and private file IDs are silently omitted.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["fileIds"],
              properties: {
                fileIds: {
                  type: "array",
                  minItems: 1,
                  maxItems: PUBLIC_MEDIA_RESOLVE_LIMIT,
                  items: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Short-lived URLs for the subset of requested files that are currently public.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["success", "data", "requestId"],
                properties: {
                  success: { const: true },
                  data: {
                    type: "object",
                    additionalProperties: false,
                    required: ["items"],
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["fileId", "url", "mimeType", "expiresAt"],
                          properties: {
                            fileId: { type: "string", format: "uuid" },
                            url: { type: "string", format: "uri" },
                            mimeType: { type: "string", minLength: 3 },
                            expiresAt: { type: "string", format: "date-time" },
                          },
                        },
                      },
                    },
                  },
                  requestId,
                },
              },
            },
          },
        },
        "400": {
          description: "Invalid or oversized resolver request.",
          content: { "application/json": { schema: failure } },
        },
        "503": {
          description: "Object storage could not create signed URLs.",
          content: { "application/json": { schema: failure } },
        },
      },
    },
  },
} as const;
