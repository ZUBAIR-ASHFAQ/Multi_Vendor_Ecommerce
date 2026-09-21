import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import type { PaginationMeta } from "@/types/api";

interface AdminQueueHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  meta?: PaginationMeta;
  visibleCount?: number;
}

/** Shared queue-first heading and API-backed paging summary for admin operational lists. */
export function AdminQueueHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  visibleCount,
}: AdminQueueHeaderProps) {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {meta ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Matching records" value={meta.totalItems.toLocaleString()} />
          <StatCard
            label="Visible on this page"
            value={(visibleCount ?? 0).toLocaleString()}
            meta={`Page size ${meta.pageSize}`}
          />
          <StatCard
            label="Queue page"
            value={`${meta.page} / ${Math.max(meta.totalPages, 1)}`}
            meta={meta.totalPages > 1 ? "Use pagination to continue review" : "All matching records fit on one page"}
          />
        </div>
      ) : null}
    </div>
  );
}

interface AdminQueueTableProps {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
}

/** Consistent horizontally-safe operational table surface. */
export function AdminQueueTable({ children, className, tableClassName }: AdminQueueTableProps) {
  return (
    <Surface padding="none" className={cn("overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className={cn("w-full min-w-[760px] text-left text-sm", tableClassName)}>{children}</table>
      </div>
    </Surface>
  );
}

/** Standard admin queue header row styling. */
export function AdminQueueTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-muted text-xs font-semibold uppercase tracking-[0.08em] text-foreground-muted">
      {children}
    </thead>
  );
}

/** Standard no-results state for filtered operational queues. */
export function AdminQueueEmpty({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) {
  return <EmptyState title={title} description={description} />;
}
