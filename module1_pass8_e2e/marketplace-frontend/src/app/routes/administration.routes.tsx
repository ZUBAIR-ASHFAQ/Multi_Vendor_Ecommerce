import { createRoute } from "@tanstack/react-router";
import { RoleDetailPage } from "@/features/administration/pages/role-detail.page";
import { RolesPage } from "@/features/administration/pages/roles.page";
import { SettingsPage } from "@/features/administration/pages/settings.page";
import { UserDetailPage } from "@/features/administration/pages/user-detail.page";
import { UsersPage } from "@/features/administration/pages/users.page";
import { rootRoute } from "./root.route";

export const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  component: UsersPage,
});

export const adminUserDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users/$userId",
  component: UserDetailPage,
});

export const adminRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/roles",
  component: RolesPage,
});

export const adminRoleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/roles/$roleId",
  component: RoleDetailPage,
});

export const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/settings",
  component: SettingsPage,
});
