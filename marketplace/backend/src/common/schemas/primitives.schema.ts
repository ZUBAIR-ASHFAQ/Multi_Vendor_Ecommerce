import { z } from "zod";

/** Canonical UUID contract for API path/body identifiers. */
export const uuidSchema = z.uuid();

/**
 * Canonical money/decimal transport contract.
 * Monetary values cross the HTTP boundary as decimal strings to avoid IEEE-754 precision loss.
 */
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a canonical decimal string");

/** Non-negative monetary value transported as a decimal string. */
export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  "Value must be non-negative",
);

/** UTC/offset-aware ISO-8601 date-time contract for API transport. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

