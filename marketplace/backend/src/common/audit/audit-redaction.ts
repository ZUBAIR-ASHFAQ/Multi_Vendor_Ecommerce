const REDACTED_VALUE = "[REDACTED]";
const MAX_AUDIT_REDACTION_DEPTH = 20;

/** Normalizes an object key so credential aliases with punctuation/casing are caught consistently. */
function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns true when one persisted audit field name can contain a secret or payout credential. */
function isSensitiveAuditKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);

  return (
    normalized.includes("password") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("apikey") ||
    normalized.includes("accesskeyid") ||
    normalized.includes("clientkey") ||
    normalized.includes("privatekey") ||
    normalized.includes("cardnumber") ||
    normalized === "cvv" ||
    normalized === "cvc" ||
    normalized.includes("payoutcredential") ||
    normalized.includes("bankaccount") ||
    normalized.includes("accountnumber") ||
    normalized.includes("routingnumber") ||
    normalized === "iban" ||
    normalized === "swift" ||
    normalized === "bic"
  );
}

/** Recursively copies one audit value while censoring secret-bearing keys before JSONB persistence. */
function redactValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_AUDIT_REDACTION_DEPTH) return "[REDACTED_DEPTH_LIMIT]";
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  if (seen.has(value)) return "[REDACTED_CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveAuditKey(key)
      ? REDACTED_VALUE
      : redactValue(nestedValue, seen, depth + 1);
  }
  return redacted;
}

/** Produces a JSON-safe, secret-redacted snapshot for append-only audit persistence or reads. */
export function redactAuditValue(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}
