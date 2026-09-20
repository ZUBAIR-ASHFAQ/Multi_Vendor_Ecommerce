import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/** Shows a simple recovery page for unknown client routes. */
export function NotFoundPage() {
  return (
    <section className="max-w-xl">
      <p className="text-sm font-semibold text-slate-500">404</p>
      <h1 className="mt-2 text-3xl font-bold">Page not found</h1>
      <p className="mt-3 text-slate-600">The requested route does not exist.</p>
      <Button asChild className="mt-6">
        <Link to="/">Return home</Link>
      </Button>
    </section>
  );
}
