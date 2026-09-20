/** Removes UI-only pagination/sort fields and undefined values before an asynchronous export is queued. */
export function reportExportFilters(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => !["page", "pageSize", "sort"].includes(key) && value !== undefined,
    ),
  );
}
