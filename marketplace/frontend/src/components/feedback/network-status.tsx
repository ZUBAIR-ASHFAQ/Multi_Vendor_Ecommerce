import { useEffect, useState } from "react";

/** Announces browser-level offline state without pretending failed requests are queued. */
export function NetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    /** Marks the browser connection as restored. */
    const markOnline = () => setOnline(true);
    /** Marks the browser connection as unavailable. */
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div role="status" aria-live="assertive" className="sticky top-0 z-[100] border-b border-warning/25 bg-warning-soft px-4 py-2 text-center text-sm font-medium text-warning">
      You&apos;re offline. Requests that need the marketplace server may fail until your connection returns.
    </div>
  );
}
