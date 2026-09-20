import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../db.js";
import { users } from "../schema/administration.js";
import { outboxEvents } from "../schema/foundation.js";
import { notificationDeliveries } from "../schema/notifications.js";

export const MODULE18_E2E_FAILED_SOURCE_EVENT_ID = "18181818-0000-4000-8000-000000000001";
export const MODULE18_E2E_FAILED_SELLER_ID = "18181818-0000-4000-8000-000000000002";
export const MODULE18_E2E_FAILED_DELIVERY_ID = "18181818-0000-4000-8000-000000000003";

/** Masks one email address for the admin delivery queue without persisting its local-part in full. */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) throw new Error("The Module 18 E2E admin identity has an invalid email address.");
  return `${localPart.slice(0, 1)}***@${domain}`;
}

/**
 * Seeds one deterministic failed email delivery that the browser admin workflow can retry.
 * The source event is already published so this fixture does not create a second dispatch when the server starts.
 */
export async function seedModule18E2eFailedDelivery(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Module 18 E2E fixture seed cannot run in production.");
  }

  const adminEmail = (process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test")
    .trim()
    .toLowerCase();
  const [administrator] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);
  if (!administrator) {
    throw new Error(`Module 18 E2E administrator was not found: ${adminEmail}`);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(outboxEvents)
      .values({
        id: MODULE18_E2E_FAILED_SOURCE_EVENT_ID,
        eventType: "seller.approved",
        aggregateType: "seller",
        aggregateId: MODULE18_E2E_FAILED_SELLER_ID,
        payload: {
          sellerId: MODULE18_E2E_FAILED_SELLER_ID,
          applicationId: "18181818-0000-4000-8000-000000000004",
          ownerUserId: administrator.id,
          approvedAt: now.toISOString(),
        },
        status: "published",
        attempts: 1,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await tx
      .insert(notificationDeliveries)
      .values({
        id: MODULE18_E2E_FAILED_DELIVERY_ID,
        notificationId: null,
        sourceEventId: MODULE18_E2E_FAILED_SOURCE_EVENT_ID,
        userId: administrator.id,
        channel: "email",
        templateCode: "seller.approved.email",
        destinationMasked: maskEmail(administrator.email),
        status: "failed",
        attempts: 2,
        providerRef: null,
        lastErrorCode: "EMAIL_PROVIDER_REQUEST_FAILED",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  });
}

/** Runs the deterministic Module 18 failed-delivery browser fixture from the command line. */
async function main(): Promise<void> {
  try {
    await seedModule18E2eFailedDelivery();
    console.log(`Module 18 E2E failed delivery ready: ${MODULE18_E2E_FAILED_DELIVERY_ID}`);
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
