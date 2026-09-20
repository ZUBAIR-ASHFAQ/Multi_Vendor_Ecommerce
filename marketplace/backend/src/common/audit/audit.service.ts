import type { DatabaseExecutor } from "../../database/types.js";
import { AuditRepository, type AppendAuditEventInput } from "./audit.repository.js";
import { redactAuditValue } from "./audit-redaction.js";

/** Thin audit service so business services can use the same transaction executor as their write. */
export class AuditService {
  /** Stores the audit repository used for append-only writes. */
  constructor(private readonly repository: AuditRepository) {}

  /** Creates a transaction-aware audit service for one database executor. */
  static using(executor: DatabaseExecutor): AuditService {
    return new AuditService(new AuditRepository(executor));
  }

  /** Appends one immutable, secret-redacted audit event and returns its generated identifier. */
  async record(input: AppendAuditEventInput): Promise<string> {
    const row = await this.repository.append({
      ...input,
      ...(input.before !== undefined
        ? { before: redactAuditValue(input.before) }
        : {}),
      ...(input.after !== undefined ? { after: redactAuditValue(input.after) } : {}),
      ...(input.metadata !== undefined
        ? { metadata: redactAuditValue(input.metadata) }
        : {}),
    });
    return row.id;
  }
}
