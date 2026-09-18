import { apiClient } from "@/lib/api-client";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import type { ApiResponse } from "@/types/api";
import type {
  AuthenticatedUser,
  AuthSessionData,
  RegisteredCustomer,
} from "../types/auth.types";

/** Unwraps the stable API success envelope used by all authentication calls. */
async function dataOf<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** Registers a public customer account. */
export async function registerCustomer(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<RegisteredCustomer> {
  return dataOf<RegisteredCustomer>(apiClient.post("/auth/register", input));
}

/** Authenticates a user and stores only the short-lived access token in memory. */
export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthSessionData> {
  const data = await dataOf<AuthSessionData>(apiClient.post("/auth/login", input));
  setAccessToken(data.accessToken);
  return data;
}

/** Loads the current server-derived actor, permissions, and marketplace scopes. */
export async function getCurrentUser(): Promise<AuthenticatedUser> {
  return dataOf<AuthenticatedUser>(apiClient.get("/auth/me"));
}

/** Revokes the current refresh session and clears the in-memory access token. */
export async function logout(): Promise<void> {
  try {
    await dataOf(apiClient.post("/auth/logout", {}));
  } finally {
    clearAccessToken();
  }
}
