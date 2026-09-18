import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../db.js";
import { shippingMethods } from "../schema/shipping.js";

export const MODULE10_E2E_SHIPPING_METHOD_ID = "10101010-1010-4010-8010-101010101010";

/**
 * Seeds only the Shipping Core row that Module 10 browser tests cannot create through a public API.
 * All customer, seller, Product, Inventory, Cart, address, and Checkout state is still created through HTTP/UI.
 */
export async function seedModule10E2eShippingMethod(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Module 10 E2E fixture seed cannot run in production.");
  }

  const existing = await db
    .select({ id: shippingMethods.id })
    .from(shippingMethods)
    .where(eq(shippingMethods.id, MODULE10_E2E_SHIPPING_METHOD_ID))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(shippingMethods).values({
    id: MODULE10_E2E_SHIPPING_METHOD_ID,
    ownerType: "platform",
    sellerId: null,
    code: "E2E-CHECKOUT-STANDARD",
    name: "E2E Checkout Standard",
    pricingType: "flat",
    baseRate: "12.5000",
    currency: "USD",
    status: "active",
  });
}

/** Runs the small deterministic Module 10 E2E Shipping Core seed from the command line. */
async function main(): Promise<void> {
  try {
    await seedModule10E2eShippingMethod();
    console.log("Module 10 E2E Shipping Core fixture ready.");
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
