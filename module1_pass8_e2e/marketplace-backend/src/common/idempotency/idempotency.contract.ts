/** Durable states for one idempotent operation key. */
export const IDEMPOTENCY_STATUS = {
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type IdempotencyStatus =
  (typeof IDEMPOTENCY_STATUS)[keyof typeof IDEMPOTENCY_STATUS];

/** Stable identity and payload hash for one retry-safe operation. */
export interface IdempotencyRequest {
  scope: string;
  key: string;
  requestHash: string;
}

/** Previously completed HTTP result returned for an exact retry. */
export interface IdempotencyReplay {
  statusCode: number;
  responseBody: unknown;
}
