import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

/** Shared report result frame with a consistent detail-table, empty state, and pagination slot. */
export function ReportTableSection({
  title,
  description,
  hasRows,
  emptyTitle,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  hasRows: boolean;
  emptyTitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="p-5 md:p-6">
        <SectionHeader title={title} description={description} />
      </div>
      {hasRows ? <div className="overflow-x-auto border-t border-border">{children}</div> : (
        <div className="border-t border-border p-5 md:p-6">
          <EmptyState title={emptyTitle} description="Adjust the report filters and try again." />
        </div>
      )}
      {footer ? <div className="border-t border-border p-4 md:px-6">{footer}</div> : null}
    </Surface>
  );
}
