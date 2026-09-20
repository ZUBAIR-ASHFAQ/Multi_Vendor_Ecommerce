import { z } from "zod";

/** UUID-shaped value used only for client form validation; ownership remains server-enforced. */
const uuidSchema = z.string().uuid("Choose a valid saved address or shipping method.");

/** One seller/store Shipping Core choice captured by the Checkout form. */
export const checkoutShippingSelectionFormSchema = z
  .object({
    storeId: uuidSchema,
    shippingMethodId: uuidSchema,
  })
  .strict();

/** TanStack Form values for building one authoritative Checkout quote request. */
export const checkoutQuoteFormSchema = z
  .object({
    shippingAddressId: uuidSchema,
    billingAddressId: z.union([uuidSchema, z.literal("")]),
    couponCode: z.string().trim().max(120, "Coupon code is too long."),
    shippingSelections: z.array(checkoutShippingSelectionFormSchema),
  })
  .superRefine((value, context) => {
    const storeIds = new Set<string>();
    value.shippingSelections.forEach((selection, index) => {
      if (storeIds.has(selection.storeId)) {
        context.addIssue({
          code: "custom",
          path: ["shippingSelections", index, "storeId"],
          message: "Choose only one shipping method for each store.",
        });
      }
      storeIds.add(selection.storeId);
    });
  });

export type CheckoutQuoteFormValues = z.infer<typeof checkoutQuoteFormSchema>;
