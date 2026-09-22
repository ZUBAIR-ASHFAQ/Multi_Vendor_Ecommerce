import { useRef } from "react";
import { StableIdempotencyKey } from "./stable-idempotency-key";

/** Keeps an idempotency key stable across retries for the lifetime of one mounted command surface. */
export function useStableIdempotencyKey(): StableIdempotencyKey {
  const controller = useRef(new StableIdempotencyKey());
  return controller.current;
}
