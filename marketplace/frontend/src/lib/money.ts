export type MoneyDecimal = string;

/** Formats an API decimal string for display only. Never use Number() results for authoritative money arithmetic. */
export function formatMoney(
  decimal: MoneyDecimal,
  currency: string,
  locale = "en-US",
): string {
  const value = Number(decimal);
  if (!Number.isFinite(value)) return decimal;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
