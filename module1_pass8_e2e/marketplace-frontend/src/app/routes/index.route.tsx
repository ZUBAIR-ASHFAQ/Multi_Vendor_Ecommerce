import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { rootRoute } from "@/app/routes/root.route";

/** Introduces the current marketplace foundation and Module 2 entry points. */
function FoundationHomePage() {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Marketplace foundation + catalog
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Multi-vendor marketplace
      </h1>
      <p className="mt-4 leading-7 text-slate-600">
        Browse published Products or sign in to manage the marketplace according to your server-derived role and seller/store scope.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/register">Create customer account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/search">Search marketplace</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/products">Browse Products</Link>
        </Button>
      </div>
    </section>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationHomePage,
});
