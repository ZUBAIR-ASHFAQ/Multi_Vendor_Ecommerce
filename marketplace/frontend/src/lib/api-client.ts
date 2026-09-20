import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { emitAuthRequired } from "@/lib/auth";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/auth-session";
import { normalizeApiError } from "@/lib/api-error";
import { env } from "@/lib/env";

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _authRetry?: boolean;
}

interface RefreshEnvelope {
  success: true;
  data: {
    accessToken: string;
  };
}

const NO_AUTO_REFRESH = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
];

let refreshPromise: Promise<string> | null = null;

/** Returns false for public authentication endpoints that must not trigger refresh recovery. */
function mayAttemptRefresh(url?: string): boolean {
  if (!url) return true;
  return !NO_AUTO_REFRESH.some((path) => url.includes(path));
}

/** Rotates the HttpOnly refresh session once and shares the in-flight request across callers. */
async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<RefreshEnvelope>(
        `${env.VITE_API_BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          timeout: 15_000,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Request-Id": crypto.randomUUID(),
          },
        },
      )
      .then((response) => {
        const token = response.data.data.accessToken;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export const apiClient = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  config.headers.set("X-Request-Id", crypto.randomUUID());
  const token = getAccessToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableRequestConfig | undefined;

    if (
      error.response?.status === 401 &&
      config &&
      !config._authRetry &&
      mayAttemptRefresh(config.url)
    ) {
      config._authRetry = true;
      try {
        const token = await refreshAccessToken();
        config.headers.set("Authorization", `Bearer ${token}`);
        return await apiClient.request(config);
      } catch {
        clearAccessToken();
        emitAuthRequired();
      }
    }

    const normalized = normalizeApiError(error);
    if (normalized.status === 401) {
      clearAccessToken();
      emitAuthRequired();
    }
    return Promise.reject(normalized);
  },
);
