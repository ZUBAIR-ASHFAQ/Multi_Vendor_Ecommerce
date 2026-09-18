import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";

/** Provides the shared application shell around every route. */
function RootComponent() {
  useDocumentTitle();

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export const rootRoute = createRootRoute({
  component: RootComponent,
});
