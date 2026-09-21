import { Component, type ErrorInfo, type ReactNode } from "react";
import { UnavailableState } from "@/components/feedback/system-state";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/** Last-resort render boundary; route/query errors should use their more specific UI first. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  /** Switches the boundary into its controlled fallback state after a render error. */
  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  /** Reports a render failure during development without showing internals to the user. */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error("React render boundary", error, info);
  }

  /** Renders the normal application tree or the controlled fallback screen. */
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="mx-auto max-w-3xl p-6">
          <UnavailableState
            message="This page could not be displayed. Reload the browser and try again."
            onRetry={() => window.location.reload()}
          />
        </main>
      );
    }

    return this.props.children;
  }
}
