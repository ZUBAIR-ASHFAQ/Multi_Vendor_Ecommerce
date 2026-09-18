import type { AccountType, RoleScopeType as AuthRoleScopeType } from "@/features/auth/types/auth.types";
import type { PaginationMeta } from "@/types/api";

export type RoleScopeType = AuthRoleScopeType;

export type UserStatus = "active" | "inactive" | "locked" | "pending";
type RoleStatus = "active" | "inactive";

interface RoleSummary {
  id: string;
  code: string;
  name: string;
  scopeType: RoleScopeType;
  isSystem: boolean;
  status: RoleStatus;
}

interface UserRoleSummary extends RoleSummary {
  sellerId: string | null;
}

export interface Permission {
  id: string;
  code: string;
  domain: string;
  description: string;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  status: UserStatus;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  roles: UserRoleSummary[];
}

export interface AdminRole extends RoleSummary {
  description: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: Permission[];
}

export interface RoleAssignmentInput {
  roleId: string;
  sellerId: string | null;
}

interface PlatformSetting {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PlatformSettingsResponse {
  settings: PlatformSetting[];
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface UserListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: UserStatus;
  roleId?: string;
  sort?: "created_desc" | "created_asc" | "name_asc" | "name_desc";
}

export interface RoleListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: RoleStatus;
  system?: boolean;
  sort?: "created_desc" | "created_asc" | "name_asc" | "name_desc";
}

export interface PermissionListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  domain?: string;
}
