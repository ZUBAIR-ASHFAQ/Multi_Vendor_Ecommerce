import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import { permissionCodeSchema } from "../../common/security/security.contract.js";
import {
  ACCOUNT_TYPE_VALUES,
  ADMIN_LIMITS,
  ROLE_SCOPE_TYPE_VALUES,
  ROLE_STATUS_VALUES,
  USER_STATUS_VALUES,
} from "./administration.constants.js";

/** Creates a trimmed non-blank string schema with one explicit maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

const optionalNullableDescriptionSchema = z
  .string()
  .trim()
  .max(ADMIN_LIMITS.ROLE_DESCRIPTION_MAX_LENGTH)
  .nullable()
  .optional();

const booleanQuerySchema = z.union([
  z.boolean(),
  z.enum(["true", "false"] as const).transform((value) => value === "true"),
]);

/** Creates a UUID-array schema that rejects duplicate identifiers. */
function uniqueUuidArraySchema(maxItems: number) {
  return z
    .array(uuidSchema)
    .max(maxItems)
    .refine((values) => new Set(values).size === values.length, {
      message: "Duplicate identifiers are not allowed",
    });
}

/** Core user account categories accepted by Module 2 contracts. */
const accountTypeSchema = z.enum(ACCOUNT_TYPE_VALUES);

/** Role resource-scope categories accepted by Module 2 contracts. */
const roleScopeTypeSchema = z.enum(ROLE_SCOPE_TYPE_VALUES);

/** URL params for user-owned Administration routes. */
export const userIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** URL params for role-owned Administration routes. */
export const roleIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Controlled platform-user lifecycle transition. */
export const changeUserStatusBodySchema = z
  .object({
    status: z.enum(USER_STATUS_VALUES),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

/** Paginated user list/filter query. */
export const userListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(ADMIN_LIMITS.SEARCH_MAX_LENGTH).optional(),
  status: z.enum(USER_STATUS_VALUES).optional(),
  roleId: uuidSchema.optional(),
  sort: z
    .enum(["created_desc", "created_asc", "name_asc", "name_desc"] as const)
    .default("created_desc"),
});

/** Create a non-system role with an explicit stable resource scope. */
export const createRoleBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(ADMIN_LIMITS.ROLE_CODE_MAX_LENGTH)
      .regex(/^[a-z][a-z0-9_]*$/, "Invalid role code")
      .transform((value) => value.toLowerCase()),
    name: nonBlankString(ADMIN_LIMITS.ROLE_NAME_MAX_LENGTH),
    description: optionalNullableDescriptionSchema,
    scopeType: roleScopeTypeSchema.default("platform"),
    status: z.enum(ROLE_STATUS_VALUES).default("active"),
  })
  .strict();

/** Paginated role list/filter query. */
export const roleListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(ADMIN_LIMITS.SEARCH_MAX_LENGTH).optional(),
  status: z.enum(ROLE_STATUS_VALUES).optional(),
  system: booleanQuerySchema.optional(),
  sort: z
    .enum(["created_desc", "created_asc", "name_asc", "name_desc"] as const)
    .default("name_asc"),
});

/** One seller-aware role assignment item for the Module 2 role replacement command. */
const userRoleAssignmentInputSchema = z
  .object({
    roleId: uuidSchema,
    sellerId: uuidSchema.nullable().optional().default(null),
  })
  .strict();

/** Seller-aware role replacement body used by PUT /api/v1/admin/users/:id/roles. */
export const replaceUserRoleAssignmentsBodySchema = z
  .object({
    assignments: z
      .array(userRoleAssignmentInputSchema)
      .max(ADMIN_LIMITS.MAX_ROLE_ASSIGNMENTS_PER_USER)
      .refine(
        (values) =>
          new Set(values.map((value) => `${value.roleId}:${value.sellerId ?? "platform"}`))
            .size === values.length,
        { message: "Duplicate role assignments are not allowed" },
      ),
  })
  .strict();

/** Replace all permission assignments for a role atomically. */
export const replaceRolePermissionsBodySchema = z
  .object({
    permissionIds: uniqueUuidArraySchema(ADMIN_LIMITS.MAX_PERMISSIONS_PER_ROLE),
  })
  .strict();

/** Safe role summary used by role/admin responses. */
export const roleSummarySchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(ADMIN_LIMITS.ROLE_CODE_MAX_LENGTH),
  name: z.string().min(1).max(ADMIN_LIMITS.ROLE_NAME_MAX_LENGTH),
  scopeType: roleScopeTypeSchema,
  isSystem: z.boolean(),
  status: z.enum(ROLE_STATUS_VALUES),
});

/** Safe role membership summary used by user/auth responses. */
const userRoleSummarySchema = roleSummarySchema.extend({
  sellerId: uuidSchema.nullable(),
});

/** Safe permission representation. */
export const permissionResponseSchema = z.object({
  id: uuidSchema,
  code: permissionCodeSchema,
  domain: z.string().min(1).max(50),
  description: z.string().min(1),
});

/** Safe administration user representation. Password and session secrets are intentionally absent. */
export const userResponseSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(ADMIN_LIMITS.DISPLAY_NAME_MAX_LENGTH),
  accountType: accountTypeSchema,
  status: z.enum(USER_STATUS_VALUES),
  emailVerifiedAt: isoDateTimeSchema.nullable(),
  passwordChangedAt: isoDateTimeSchema.nullable(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  failedLoginAttempts: z.number().int().nonnegative(),
  lockedUntil: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  roles: z.array(userRoleSummarySchema),
});

/** Safe role detail representation. */
export const roleResponseSchema = roleSummarySchema.extend({
  description: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  permissions: z.array(permissionResponseSchema),
});

/** Normalized non-secret platform setting key. */
const platformSettingKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_.-]*$/, "Invalid platform setting key")
  .transform((value) => value.toLowerCase());

/** One platform-setting update item. Service code applies the allow-list and per-key validation. */
const platformSettingUpdateSchema = z
  .object({
    key: platformSettingKeySchema,
    value: z.unknown(),
  })
  .strict();

/** Batch settings update used by PATCH /api/v1/admin/settings. */
export const updatePlatformSettingsBodySchema = z
  .object({
    settings: z
      .array(platformSettingUpdateSchema)
      .min(1)
      .max(100)
      .refine((values) => new Set(values.map((value) => value.key)).size === values.length, {
        message: "Duplicate platform setting keys are not allowed",
      }),
  })
  .strict();

/** Safe platform-setting representation. Secret configuration is never stored here. */
export const platformSettingResponseSchema = z.object({
  key: platformSettingKeySchema,
  value: z.unknown(),
  updatedBy: uuidSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});

/** Current platform-settings response. */
export const platformSettingsResponseSchema = z.object({
  settings: z.array(platformSettingResponseSchema),
});

