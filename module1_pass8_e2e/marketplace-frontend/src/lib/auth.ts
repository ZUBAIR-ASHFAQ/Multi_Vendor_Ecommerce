export const AUTH_REQUIRED_EVENT = "marketplace:auth-required";

/** Signals the future Authentication module that the current browser session requires re-authentication. */
export function emitAuthRequired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
}

