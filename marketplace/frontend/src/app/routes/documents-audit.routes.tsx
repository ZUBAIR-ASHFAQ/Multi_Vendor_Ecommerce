import { createRoute } from "@tanstack/react-router";
import { AuditDetailPage } from "@/features/documents-audit/pages/audit-detail.page";
import { AuditPage } from "@/features/documents-audit/pages/audit.page";
import { DocumentsPage } from "@/features/documents-audit/pages/documents.page";
import { rootRoute } from "./root.route";

export const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsPage,
});

export const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  component: AuditPage,
});

export const auditDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit/$auditId",
  component: AuditDetailPage,
});
