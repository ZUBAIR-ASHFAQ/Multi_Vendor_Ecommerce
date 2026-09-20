import type { ErrorCode } from "./error-codes.js";

export interface AppErrorOptions {
  code: ErrorCode | (string & {});
  message: string;
  statusCode: number;
  details?: unknown;
  cause?: unknown;
}

/** Safe application error that can be translated into the public API error envelope. */
export class AppError extends Error {
  readonly code: AppErrorOptions["code"];
  readonly statusCode: number;
  readonly details?: unknown;
  override readonly cause?: unknown;

  /** Creates one safe application error with a stable public code and HTTP status. */
  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.cause = options.cause;
  }
}

/** Type guard used by future HTTP middleware without leaking unknown exceptions. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
