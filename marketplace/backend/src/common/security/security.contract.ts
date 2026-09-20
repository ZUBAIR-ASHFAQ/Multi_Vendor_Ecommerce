import { z } from "zod";
import { uuidSchema } from "../schemas/primitives.schema.js";

export const ACTOR_TYPE = {
  SYSTEM: "system",
  PLATFORM_ADMIN: "platform_admin",
  SELLER: "seller",
  CUSTOMER: "customer",
} as const;

export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

/** Permission codes follow a stable domain.action convention, for example products.read. */
export const permissionCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/, "Invalid permission code");

export type PermissionCode = z.infer<typeof permissionCodeSchema>;

/**
 * Access-token claim contract only. Signing, verification, rotation and session ownership are implemented later.
 * sellerId remains nullable because platform administrators and customers are not seller-scoped actors.
 */
export const accessTokenClaimsSchema = z.object({
  sub: uuidSchema,
  sessionId: uuidSchema,
  actorType: z.enum(
    [ACTOR_TYPE.PLATFORM_ADMIN, ACTOR_TYPE.SELLER, ACTOR_TYPE.CUSTOMER] as const,
  ),
  sellerId: uuidSchema.nullable(),
  permissions: z.array(permissionCodeSchema).default([]),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
