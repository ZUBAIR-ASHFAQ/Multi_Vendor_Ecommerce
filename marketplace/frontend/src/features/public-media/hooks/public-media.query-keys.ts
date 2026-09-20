export const publicMediaQueryKeys = {
  all: ["public-media"] as const,
  resolve: (fileIds: readonly string[]) => ["public-media", "resolve", fileIds] as const,
};
