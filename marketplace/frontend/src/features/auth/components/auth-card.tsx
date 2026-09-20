import type { ReactNode } from "react";

/** Provides a consistent centered card for public authentication workflows. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-md rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
