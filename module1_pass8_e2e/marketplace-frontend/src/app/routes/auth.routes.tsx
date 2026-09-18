import { createRoute } from "@tanstack/react-router";
import { AccountPage } from "@/features/auth/pages/account.page";
import { LoginPage } from "@/features/auth/pages/login.page";
import { RegisterPage } from "@/features/auth/pages/register.page";
import { rootRoute } from "./root.route";

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountPage,
});
