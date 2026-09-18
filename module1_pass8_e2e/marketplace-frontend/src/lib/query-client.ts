import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api-error";

/** Retries only transient query failures and stops after two failed attempts. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiClientError && error.status !== undefined) {
    if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
      return false;
    }
  }
  return true;
}

/** Creates one isolated QueryClient; tests call this factory to avoid cross-test cache state. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();
