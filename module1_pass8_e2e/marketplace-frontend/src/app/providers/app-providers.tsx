import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppErrorBoundary } from "@/components/feedback/app-error-boundary";
import { queryClient as defaultQueryClient } from "@/app/query";

interface AppProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

/** Composes cross-cutting React providers without importing any business module. */
export function AppProviders({ children, queryClient = defaultQueryClient }: AppProvidersProps) {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppErrorBoundary>
  );
}
