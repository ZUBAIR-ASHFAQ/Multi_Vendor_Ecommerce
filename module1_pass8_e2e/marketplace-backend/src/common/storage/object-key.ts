import { randomUUID } from "node:crypto";

const SAFE_SEGMENT = /[^a-zA-Z0-9._-]+/g;

/** Converts one object-key segment into a bounded storage-safe value. */
function sanitizeSegment(segment: string): string {
  const normalized = segment.trim().replace(SAFE_SEGMENT, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Storage key segment cannot be empty after normalization.");
  return normalized.slice(0, 120);
}

/** Generates collision-resistant provider-neutral object keys. */
export function createObjectKey(namespace: string, originalFileName: string): string {
  const safeNamespace = sanitizeSegment(namespace);
  const safeName = sanitizeSegment(originalFileName);
  return `${safeNamespace}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
}
