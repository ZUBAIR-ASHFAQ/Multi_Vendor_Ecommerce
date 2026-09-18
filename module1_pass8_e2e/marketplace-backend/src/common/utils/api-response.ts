import type { ApiFailure, ApiSuccess } from "../types/api.js";

/** Creates the canonical success payload without coupling contracts to Express. */
export function successResponse<TData, TMeta = Record<string, never>>(
  data: TData,
  options: { requestId: string; meta?: TMeta },
): ApiSuccess<TData, TMeta> {
  const response: ApiSuccess<TData, TMeta> = {
    success: true,
    data,
    requestId: options.requestId,
  };

  if (options.meta !== undefined) response.meta = options.meta;

  return response;
}

/** Creates the canonical public failure payload. */
export function failureResponse(
  code: string,
  message: string,
  options: {
    requestId: string;
    fieldErrors?: ApiFailure["error"]["fieldErrors"];
    details?: unknown;
  },
): ApiFailure {
  const error: ApiFailure["error"] = { code, message };
  if (options.fieldErrors !== undefined) error.fieldErrors = options.fieldErrors;
  if (options.details !== undefined) error.details = options.details;

  return { success: false, error, requestId: options.requestId };
}
