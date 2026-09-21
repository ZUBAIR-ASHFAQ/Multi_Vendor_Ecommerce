import { CART_WISHLIST_LIMITS } from "@/features/cart-wishlist/cart-wishlist.constants";
import { z } from "zod";

/** UUID-shaped value used only for client form validation; ownership remains server-enforced. */
const uuidSchema = z.string().uuid("Choose a valid saved address or shipping method.");

/** Validated Buy Now route state; all fields must travel together or the flow is rejected. */
export const checkoutRouteSearchSchema = z
  .object({
    buyNowVariantId: z.string().uuid().optional(),
    buyNowQuantity: z.coerce.number().int().min(1).max(CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY).optional(),
    productSlug: z.string().trim().min(1).max(240).optional(),
  })
  .superRefine((value, context) => {
    const present = [value.buyNowVariantId, value.buyNowQuantity, value.productSlug].filter(
      (item) => item !== undefined,
    ).length;
    if (present !== 0 && present !== 3) {
      context.addIssue({
        code: "custom",
        message: "Buy Now requires a product, variant, and quantity.",
      });
    }
  });

export type CheckoutRouteSearch = z.infer<typeof checkoutRouteSearchSchema>;

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
