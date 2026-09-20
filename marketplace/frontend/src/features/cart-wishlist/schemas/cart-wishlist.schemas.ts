import { z } from "zod";
import { CART_WISHLIST_LIMITS } from "../cart-wishlist.constants";

/** Validates one Cart quantity before it reaches the Module 8 API. */
export const cartQuantityFormSchema = z.object({
  quantity: z
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(
      CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY,
      `Quantity cannot exceed ${CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY}.`,
    ),
});

export type CartQuantityFormValues = z.infer<typeof cartQuantityFormSchema>;
