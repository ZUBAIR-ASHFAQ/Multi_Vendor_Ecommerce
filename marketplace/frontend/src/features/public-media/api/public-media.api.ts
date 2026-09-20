import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api";
import type {
  ResolvePublicMediaInput,
  ResolvePublicMediaResponse,
} from "../types/public-media.types";

/** Unwraps one successful public-media response while preserving normalized API failures. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export const publicMediaApi = {
  /** Resolves a bounded set of file IDs to short-lived URLs only when the backend proves them public. */
  resolve: (input: ResolvePublicMediaInput) =>
    one<ResolvePublicMediaResponse>(apiClient.post("/media/public/resolve", input)),
};
