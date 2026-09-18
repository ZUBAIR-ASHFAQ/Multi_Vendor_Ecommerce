import type {
  PermissionListParams,
  RoleListParams,
  UserListParams,
} from "../types/administration.types";

export const adminQueryKeys = {
  all: ["admin"] as const,
  users: (params: UserListParams) => ["admin", "users", params] as const,
  user: (id: string) => ["admin", "user", id] as const,
  roles: (params: RoleListParams) => ["admin", "roles", params] as const,
  role: (id: string) => ["admin", "role", id] as const,
  permissions: (params: PermissionListParams) => ["admin", "permissions", params] as const,
  settings: ["admin", "settings"] as const,
};
