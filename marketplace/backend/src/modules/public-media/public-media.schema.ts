import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import { PUBLIC_MEDIA_RESOLVE_LIMIT } from "./public-media.constants.js";

/** Bounded batch request for resolving browser-usable public media URLs. */
export const resolvePublicMediaBodySchema = z
  .object({
    fileIds: z.array(uuidSchema).min(1).max(PUBLIC_MEDIA_RESOLVE_LIMIT),
  })
  .strict();

/** One short-lived URL for a file proven to be attached to a currently public resource. */
export const publicMediaItemSchema = z
  .object({
    fileId: uuidSchema,
    url: z.url(),
    mimeType: z.string().trim().min(3),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

/** Resolver response omits unknown/private file IDs instead of exposing their existence. */
export const resolvePublicMediaResponseSchema = z
  .object({
    items: z.array(publicMediaItemSchema),
  })
  .strict();

export type ResolvePublicMediaInput = z.infer<typeof resolvePublicMediaBodySchema>;
export type PublicMediaItem = z.infer<typeof publicMediaItemSchema>;
export type ResolvePublicMediaResponse = z.infer<typeof resolvePublicMediaResponseSchema>;
