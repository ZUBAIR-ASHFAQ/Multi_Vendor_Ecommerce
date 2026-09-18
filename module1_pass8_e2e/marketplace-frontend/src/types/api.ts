export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: ApiFieldError[];
  details?: unknown;
}

export interface ApiSuccess<TData, TMeta = Record<string, never>> {
  success: true;
  data: TData;
  meta?: TMeta;
  requestId: string;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResponse<TData, TMeta = Record<string, never>> =
  | ApiSuccess<TData, TMeta>
  | ApiFailure;

