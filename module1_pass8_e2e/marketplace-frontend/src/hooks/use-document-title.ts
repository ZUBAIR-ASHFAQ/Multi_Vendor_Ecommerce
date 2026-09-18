import { useEffect } from "react";
import { env } from "@/lib/env";

/** Sets a route/page title while preserving the application name suffix. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} | ${env.VITE_APP_NAME}` : env.VITE_APP_NAME;
  }, [title]);
}
