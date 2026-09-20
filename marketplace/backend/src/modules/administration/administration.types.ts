import type { z } from "zod";
import type {
  changeUserStatusBodySchema,
  createRoleBodySchema,
  permissionResponseSchema,
  platformSettingResponseSchema,
  platformSettingsResponseSchema,
  replaceRolePermissionsBodySchema,
  replaceUserRoleAssignmentsBodySchema,
  roleListQuerySchema,
  roleResponseSchema,
  updatePlatformSettingsBodySchema,
  userListQuerySchema,
  userResponseSchema,
} from "./administration.schema.js";

export type ChangeUserStatusInput = z.infer<typeof changeUserStatusBodySchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export type CreateRoleInput = z.infer<typeof createRoleBodySchema>;
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;

export type ReplaceUserRoleAssignmentsInput = z.infer<
  typeof replaceUserRoleAssignmentsBodySchema
>;
export type UpdatePlatformSettingsInput = z.infer<
  typeof updatePlatformSettingsBodySchema
>;
export type ReplaceRolePermissionsInput = z.infer<
  typeof replaceRolePermissionsBodySchema
>;

export type UserResponse = z.infer<typeof userResponseSchema>;
export type RoleResponse = z.infer<typeof roleResponseSchema>;
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;
export type PlatformSettingResponse = z.infer<
  typeof platformSettingResponseSchema
>;
export type PlatformSettingsResponse = z.infer<
  typeof platformSettingsResponseSchema
>;
