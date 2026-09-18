import type { AuditListParams } from "../types/documents-audit.types";

export const documentsAuditQueryKeys = {
  all: ["documents-audit"] as const,
  audit: (params: AuditListParams) => ["documents-audit", "audit", params] as const,
  auditDetail: (id: string) => ["documents-audit", "audit-detail", id] as const,
};
