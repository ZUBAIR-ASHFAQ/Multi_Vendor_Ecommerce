import { z } from "zod";

/** Builds the runtime success-envelope schema for a concrete payload schema. */
export function apiSuccessSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.unknown().optional(),
    requestId: z.string().min(1),
  });
}

export const apiFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Runtime contract for every public failure response. */
export const apiFailureSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldErrors: z.array(apiFieldErrorSchema).optional(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().min(1),
});
