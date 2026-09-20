import { RouterProvider } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppProviders } from "@/app/providers/app-providers";
import { appRouter } from "@/app/router/router";

interface AppProps {
  router?: typeof appRouter;
  queryClient?: QueryClient;
}

/** Composes the Query provider and TanStack Router for production and tests. */
export function App({ router = appRouter, queryClient }: AppProps) {
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
