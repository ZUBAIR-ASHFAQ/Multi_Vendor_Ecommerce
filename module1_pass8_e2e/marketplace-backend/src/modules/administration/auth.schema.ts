import { z } from "zod";
import { permissionCodeSchema } from "../../common/security/security.contract.js";
import { uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  ACCOUNT_TYPE,
  ACCOUNT_TYPE_VALUES,
  ROLE_SCOPE_TYPE_VALUES,
  USER_STATUS_VALUES,
} from "./administration.constants.js";
import { AUTH_LIMITS } from "./auth.constants.js";

/** Canonical normalized login email. The transformed value is safe for DB lookup. */
export const authEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(AUTH_LIMITS.EMAIL_MAX_LENGTH)
  .email()
  .transform((value) => value.toLowerCase());

/** Password accepted at registration boundaries. */
export const passwordSchema = z
  .string()
  .min(AUTH_LIMITS.PASSWORD_MIN_LENGTH)
  .max(AUTH_LIMITS.PASSWORD_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, "Password cannot be blank");

/** Public customer registration body. Account type, roles and permissions are server-derived. */
export const registerBodySchema = z
  .object({
    email: authEmailSchema,
    displayName: z.string().trim().min(1).max(200),
    password: passwordSchema,
  })
  .strict();

/** Login request body. */
export const loginBodySchema = z
  .object({
    email: authEmailSchema,
    password: z.string().min(1).max(AUTH_LIMITS.PASSWORD_MAX_LENGTH),
  })
  .strict();

/** Refresh token is read from the HttpOnly refresh cookie. */
export const refreshBodySchema = z.object({}).strict();

/** Logout revokes the current cookie/session. */
export const logoutBodySchema = z.object({}).strict();

/** Seller/store scopes resolved by the backend for the current identity. */
const authenticatedScopeSchema = z.object({
  sellerIds: z.array(uuidSchema),
  storeIds: z.array(uuidSchema),
});

/** Safe role membership shown to the authenticated user. */
const authenticatedRoleSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(150),
  scopeType: z.enum(ROLE_SCOPE_TYPE_VALUES),
  sellerId: uuidSchema.nullable(),
});

/** Safe authenticated-user shape returned to the frontend. */
export const authenticatedUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPE_VALUES),
  status: z.enum(USER_STATUS_VALUES),
  roles: z.array(authenticatedRoleSchema),
  permissions: z.array(permissionCodeSchema),
  scopes: authenticatedScopeSchema,
});

/** Public registration response. */
export const registerResponseSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  accountType: z.literal(ACCOUNT_TYPE.CUSTOMER),
  status: z.enum(USER_STATUS_VALUES),
});
