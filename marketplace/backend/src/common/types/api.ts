/** Standard successful HTTP envelope returned by every API controller. */
export interface ApiSuccess<TData, TMeta = Record<string, never>> {
  success: true;
  data: TData;
  meta?: TMeta;
  requestId: string;
}

/** One safe field-level validation error exposed to API clients. */
export interface ApiFieldError {
  path: string;
  message: string;
}

/** Stable application error body; implementation details stay server-side. */
export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: ApiFieldError[];
  details?: unknown;
}

/** Standard failed HTTP envelope with the request identifier for support tracing. */
export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResponse<TData, TMeta = Record<string, never>> =
  | ApiSuccess<TData, TMeta>
  | ApiFailure;

