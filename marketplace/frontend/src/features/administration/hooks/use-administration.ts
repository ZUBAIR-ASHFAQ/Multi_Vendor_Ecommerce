import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authQueryKeys } from "@/features/auth/hooks/auth.query-keys";
import { administrationApi } from "../api/administration.api";
import type {
  PermissionListParams,
  RoleAssignmentInput,
  RoleListParams,
  UserListParams,
} from "../types/administration.types";
import { adminQueryKeys } from "./administration.query-keys";

/** Loads the paginated administration user list when the current workflow is ready. */
export function useUsersQuery(params: UserListParams, enabled = true) {
  return useQuery({
    queryKey: adminQueryKeys.users(params),
    queryFn: () => administrationApi.listUsers(params),
    enabled,
  });
}

/** Loads one administration user through the approved list API. */
export function useUserQuery(id: string) {
  return useQuery({
    queryKey: adminQueryKeys.user(id),
    queryFn: () => administrationApi.findUser(id),
  });
}

/** Loads the role catalog only when the current workflow may read roles. */
export function useRolesQuery(params: RoleListParams, enabled = true) {
  return useQuery({
    queryKey: adminQueryKeys.roles(params),
    queryFn: () => administrationApi.listRoles(params),
    enabled,
  });
}

/** Loads one role through the approved list API. */
export function useRoleQuery(id: string) {
  return useQuery({
    queryKey: adminQueryKeys.role(id),
    queryFn: () => administrationApi.findRole(id),
  });
}

/** Builds the permission catalog from approved role-list data. */
export function usePermissionsQuery(params: PermissionListParams, enabled = true) {
  return useQuery({
    queryKey: adminQueryKeys.permissions(params),
    queryFn: () => administrationApi.listPermissionCatalog(params),
    enabled,
  });
}

/** Loads allow-listed platform settings only when the current workflow may manage them. */
export function usePlatformSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: adminQueryKeys.settings,
    queryFn: administrationApi.getPlatformSettings,
    enabled,
  });
}

type AdminInvalidationGroup = "users" | "roles" | "settings";

/** Returns every cache prefix owned by one administration mutation group. */
function adminInvalidationKeys(group: AdminInvalidationGroup): readonly (readonly string[])[] {
  if (group === "users") return [["admin", "users"], ["admin", "user"]];
  if (group === "roles") {
    return [["admin", "roles"], ["admin", "role"], ["admin", "permissions"]];
  }
  return [["admin", "settings"]];
}

/** Creates one Administration mutation and invalidates the affected list/detail/auth cache groups. */
function useAdminMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  invalidate: AdminInvalidationGroup[],
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      for (const group of invalidate) {
        for (const queryKey of adminInvalidationKeys(group)) {
          await queryClient.invalidateQueries({ queryKey });
        }
      }
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.me });
    },
  });
}

/** Applies one controlled user status transition. */
export function useChangeUserStatusMutation(id: string) {
  return useAdminMutation(
    (input: {
      status: "active" | "inactive" | "locked" | "pending";
      reason?: string;
    }) => administrationApi.changeUserStatus(id, input.status, input.reason),
    ["users"],
  );
}

/** Replaces seller-aware role assignments for one user. */
export function useReplaceUserRoleAssignmentsMutation(id: string) {
  return useAdminMutation(
    (assignments: RoleAssignmentInput[]) =>
      administrationApi.replaceUserRoleAssignments(id, assignments),
    ["users"],
  );
}

/** Creates one custom role. */
export function useCreateRoleMutation() {
  return useAdminMutation(administrationApi.createRole, ["roles"]);
}

/** Replaces one mutable role's permission set. */
export function useReplaceRolePermissionsMutation(id: string) {
  return useAdminMutation(
    (permissionIds: string[]) =>
      administrationApi.replaceRolePermissions(id, permissionIds),
    ["roles"],
  );
}

/** Updates all edited platform settings in one validated batch. */
export function useUpdatePlatformSettingsMutation() {
  return useAdminMutation(administrationApi.updatePlatformSettings, ["settings"]);
}
