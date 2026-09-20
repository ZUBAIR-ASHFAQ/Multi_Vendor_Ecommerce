/** Durable delivery states for transactional outbox records. */
export const OUTBOX_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  PUBLISHED: "published",
  FAILED: "failed",
} as const;

/** Minimal domain-event shape passed from the outbox to async consumers. */
export interface DomainEvent<TPayload = unknown> {
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: TPayload;
  headers?: Record<string, unknown>;
}
