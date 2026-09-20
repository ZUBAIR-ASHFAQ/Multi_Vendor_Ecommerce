import { useQuery } from "@tanstack/react-query";
import { publicMediaApi } from "../api/public-media.api";
import type { ResolvePublicMediaResponse } from "../types/public-media.types";
import { publicMediaQueryKeys } from "./public-media.query-keys";

const PUBLIC_MEDIA_BATCH_SIZE = 50;

/** Normalizes requested IDs so duplicate cards/media rows share one stable resolver query. */
function normalizeFileIds(fileIds: readonly (string | null | undefined)[]): string[] {
  return [...new Set(fileIds.filter((fileId): fileId is string => Boolean(fileId)))].sort();
}

/** Keeps each public-media request within the backend resolver's documented 50-ID bound. */
async function resolvePublicMedia(fileIds: string[]): Promise<ResolvePublicMediaResponse> {
  const batches: string[][] = [];
  for (let index = 0; index < fileIds.length; index += PUBLIC_MEDIA_BATCH_SIZE) {
    batches.push(fileIds.slice(index, index + PUBLIC_MEDIA_BATCH_SIZE));
  }

  const resolved = await Promise.all(
    batches.map((batch) => publicMediaApi.resolve({ fileIds: batch })),
  );
  return { items: resolved.flatMap((response) => response.items) };
}

/** Loads short-lived browser URLs for the subset of file IDs that are currently public. */
export function usePublicMediaQuery(
  fileIds: readonly (string | null | undefined)[],
) {
  const normalized = normalizeFileIds(fileIds);

  return useQuery({
    queryKey: publicMediaQueryKeys.resolve(normalized),
    queryFn: () => resolvePublicMedia(normalized),
    enabled: normalized.length > 0,
    staleTime: 30_000,
  });
}
