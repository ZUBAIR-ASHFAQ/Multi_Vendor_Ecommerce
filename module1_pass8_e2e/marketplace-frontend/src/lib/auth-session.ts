let accessToken: string | null = null;

const tokenListeners = new Set<(token: string | null) => void>();

/** Notifies realtime/auth consumers whenever the in-memory access token changes. */
function notifyTokenListeners(): void {
  for (const listener of tokenListeners) listener(accessToken);
}

/** Keeps the short-lived access token in memory only; the refresh credential stays HttpOnly. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Replaces the in-memory access token after login/refresh and reconnects interested transports. */
export function setAccessToken(token: string): void {
  accessToken = token;
  notifyTokenListeners();
}

/** Clears browser-held access authorization after logout or failed refresh. */
export function clearAccessToken(): void {
  accessToken = null;
  notifyTokenListeners();
}

/** Subscribes to in-memory token changes without persisting credentials in browser storage. */
export function subscribeAccessToken(
  listener: (token: string | null) => void,
): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}
