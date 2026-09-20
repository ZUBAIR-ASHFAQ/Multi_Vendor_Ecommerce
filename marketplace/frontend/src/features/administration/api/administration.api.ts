import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  AdminRole,
  AdminUser,
  Paginated,
  Permission,
  PermissionListParams,
  PlatformSettingsResponse,
  RoleAssignmentInput,
  RoleListParams,
  RoleScopeType,
  UserListParams,
  UserStatus,
} from "../types/administration.types";

/** Removes empty query values before they are sent to the API. */
function queryParams(value: object): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) => entry !== undefined && entry !== "",
    ),
  ) as Record<string, string | number | boolean>;
}

/** Unwraps one successful API response or throws its safe API message. */
async function unwrapData<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Unwraps one paginated API response and requires the documented pagination metadata. */
async function unwrapPage<T>(
  request: Promise<{ data: ApiResponse<T[], PaginationMeta> }>,
): Promise<Paginated<T>> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("The API response is missing pagination metadata.");
  return { items: response.data.data, meta: response.data.meta };
}

/** Loads one approved page from the administration user-list endpoint. */
function loadUsers(params: UserListParams = {}): Promise<Paginated<AdminUser>> {
  return unwrapPage<AdminUser>(
    apiClient.get("/admin/users", { params: queryParams(params) }),
  );
}

/** Loads one approved page from the administration role-list endpoint. */
function loadRoles(params: RoleListParams = {}): Promise<Paginated<AdminRole>> {
  return unwrapPage<AdminRole>(
    apiClient.get("/admin/roles", { params: queryParams(params) }),
  );
}

/** Finds one record by scanning the approved paginated list route instead of inventing a detail route. */
async function findById<T extends { id: string }>(
  loadPage: (page: number) => Promise<Paginated<T>>,
  id: string,
): Promise<T> {
  let page = 1;

  while (true) {
    const result = await loadPage(page);
    const match = result.items.find((item) => item.id === id);
    if (match) return match;
    if (page >= result.meta.totalPages) throw new Error("The requested record was not found.");
    page += 1;
  }
}

/** Loads every role through the approved paginated role-list endpoint. */
async function loadAllRoles(): Promise<AdminRole[]> {
  const roles: AdminRole[] = [];
  let page = 1;

  while (true) {
    const result = await loadRoles({ page, pageSize: 100 });
    roles.push(...result.items);
    if (page >= result.meta.totalPages) return roles;
    page += 1;
  }
}

/** Builds a readable permission catalog from permissions already exposed by approved role responses. */
async function loadPermissionCatalog(
  params: PermissionListParams = {},
): Promise<Paginated<Permission>> {
  const roles = await loadAllRoles();
  const permissionsById = new Map<string, Permission>();

  for (const role of roles) {
    for (const permission of role.permissions) {
      permissionsById.set(permission.id, permission);
    }
  }

  const search = params.search?.trim().toLowerCase();
  const filtered = [...permissionsById.values()]
    .filter((permission) => !params.domain || permission.domain === params.domain)
    .filter(
      (permission) =>
        !search ||
        permission.code.toLowerCase().includes(search) ||
        permission.description.toLowerCase().includes(search),
    )
    .sort((left, right) => left.code.localeCompare(right.code));

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const start = (page - 1) * pageSize;

  return {
    items: filtered.slice(start, start + pageSize),
    meta: {
      page,
      pageSize,
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / pageSize),
    },
  };
}

export const administrationApi = {
  /** Lists users using only documented filter values. */
  listUsers: loadUsers,

  /** Finds one user through the approved user-list route. */
  findUser: (id: string) =>
    findById((page) => loadUsers({ page, pageSize: 100 }), id),

  /** Applies the controlled user-status PATCH command. */
  changeUserStatus: (id: string, status: UserStatus, reason?: string) =>
    unwrapData<AdminUser>(
      apiClient.patch(`/admin/users/${id}/status`, {
        status,
        ...(reason ? { reason } : {}),
      }),
    ),

  /** Replaces role memberships with explicit seller scope when a seller role is used. */
  replaceUserRoleAssignments: (id: string, assignments: RoleAssignmentInput[]) =>
    unwrapData<AdminUser>(apiClient.put(`/admin/users/${id}/roles`, { assignments })),

  /** Lists roles using only documented filter values. */
  listRoles: loadRoles,

  /** Finds one role through the approved role-list route. */
  findRole: (id: string) =>
    findById((page) => loadRoles({ page, pageSize: 100 }), id),

  /** Creates one custom role with a fixed platform, seller, or customer scope. */
  createRole: (input: {
    code: string;
    name: string;
    description: string | null;
    scopeType: RoleScopeType;
    status: "active" | "inactive";
  }) => unwrapData<AdminRole>(apiClient.post("/admin/roles", input)),

  /** Replaces all permissions assigned to one mutable role. */
  replaceRolePermissions: (id: string, permissionIds: string[]) =>
    unwrapData<AdminRole>(
      apiClient.put(`/admin/roles/${id}/permissions`, { permissionIds }),
    ),

  /** Derives the permission catalog without calling an undocumented permissions endpoint. */
  listPermissionCatalog: loadPermissionCatalog,

  /** Reads allow-listed non-secret commerce settings owned by Module 2. */
  getPlatformSettings: () =>
    unwrapData<PlatformSettingsResponse>(apiClient.get("/admin/settings")),

  /** Updates allow-listed non-secret platform settings in one request. */
  updatePlatformSettings: (settings: Array<{ key: string; value: unknown }>) =>
    unwrapData<PlatformSettingsResponse>(
      apiClient.patch("/admin/settings", { settings }),
    ),
};
