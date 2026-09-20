import { z } from "zod";

/** Validates the approved custom-role creation form. */
export const createRoleFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores."),
  name: z.string().trim().min(1, "Role name is required.").max(150),
  description: z.string().trim().max(2000),
  scopeType: z.enum(["platform", "seller", "customer"]),
  status: z.enum(["active", "inactive"]),
});

/** Validates the allow-listed platform settings form. */
export const platformSettingsFormSchema = z
  .object({
    supportedCurrencies: z
      .string()
      .trim()
      .min(3, "Add at least one three-letter currency code."),
    defaultCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use one three-letter currency code."),
    defaultTaxRatePercent: z
      .string()
      .trim()
      .min(1, "Tax rate is required."),
  })
  .refine(
    (value) => {
      const rate = Number(value.defaultTaxRatePercent);
      return Number.isFinite(rate) && rate >= 0 && rate <= 100;
    },
    {
      message: "Tax rate must be between 0 and 100.",
      path: ["defaultTaxRatePercent"],
    },
  );
