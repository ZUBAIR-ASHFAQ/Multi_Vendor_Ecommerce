import axios from "axios";
import type { ApiFailure } from "@/types/api";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly fieldErrors: ApiFailure["error"]["fieldErrors"] | undefined;
  readonly details: unknown;

  /** Creates one normalized frontend error from a safe API or network failure. */
  constructor(options: {
    code: string;
    message: string;
    status?: number;
    requestId?: string;
    fieldErrors?: ApiFailure["error"]["fieldErrors"];
    details?: unknown;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

/** Checks whether an unknown response matches the stable API failure envelope. */
function isApiFailure(value: unknown): value is ApiFailure {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success !== false || typeof record.error !== "object" || record.error === null) {
    return false;
  }
  const error = record.error as Record<string, unknown>;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof record.requestId === "string" &&
    record.requestId.length > 0
  );
}

/** Converts Axios/network failures into one stable frontend error shape. */
export function normalizeApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data;

    if (isApiFailure(body)) {
      return new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status,
        requestId: body.requestId,
        fieldErrors: body.error.fieldErrors,
        details: body.error.details,
      });
    }

    return new ApiClientError({
      code: error.code ?? "NETWORK_ERROR",
      message: error.response
        ? "The server returned an unexpected response."
        : "The API could not be reached.",
      status,
    });
  }

  if (error instanceof Error) {
    return new ApiClientError({
      code: "CLIENT_ERROR",
      message: error.message,
    });
  }

  return new ApiClientError({
    code: "UNKNOWN_ERROR",
    message: "An unexpected client error occurred.",
  });
}
