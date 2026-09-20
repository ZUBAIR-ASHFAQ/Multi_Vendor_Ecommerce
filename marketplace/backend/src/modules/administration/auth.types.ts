import type { z } from "zod";
import type {
  authenticatedUserSchema,
  loginBodySchema,
  registerBodySchema,
  registerResponseSchema,
} from "./auth.schema.js";

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/** Server-derived request metadata associated with a session write. */
export interface AuthClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}
