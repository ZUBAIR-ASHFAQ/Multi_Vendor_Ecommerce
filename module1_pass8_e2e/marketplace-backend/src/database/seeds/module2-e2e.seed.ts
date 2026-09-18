import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { PasswordService } from "../../common/security/password.service.js";
import { closeDatabase, db } from "../db.js";
import { roles, userRoles, users } from "../schema/administration.js";
import {
  ACCOUNT_TYPE,
  SYSTEM_ROLE,
} from "../../modules/administration/administration.constants.js";
import { seedPlatformRbac } from "./platform-rbac.seed.js";

/**
 * Provisions the deterministic browser-E2E administrator after the normal RBAC catalog seed.
 * This test-only fixture refuses to run in production and never prints or persists a raw password.
 */
export async function seedModule2E2eAdministrator(): Promise<{ id: string; email: string }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Module 2 E2E administrator seed cannot run in production.");
  }

  const email = (process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test")
    .trim()
    .toLowerCase();
  const password = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";
  const displayName = (process.env.E2E_ADMIN_DISPLAY_NAME ?? "E2E Platform Admin").trim();

  if (password.length < 12) {
    throw new Error("E2E_ADMIN_PASSWORD must contain at least 12 characters.");
  }

  await seedPlatformRbac();
  const passwordHash = await new PasswordService().hash(password);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [systemRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code))
      .limit(1);

    if (!systemRole) {
      throw new Error("The seeded platform_super_admin role was not found.");
    }

    const [administrator] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName,
        accountType: ACCOUNT_TYPE.PLATFORM_ADMIN,
        status: "active",
        emailVerifiedAt: now,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash,
          displayName,
          accountType: ACCOUNT_TYPE.PLATFORM_ADMIN,
          status: "active",
          emailVerifiedAt: now,
          passwordChangedAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        },
      })
      .returning({ id: users.id, email: users.email });

    if (!administrator) {
      throw new Error("Failed to provision the Module 2 E2E administrator.");
    }

    await tx
      .insert(userRoles)
      .values({
        userId: administrator.id,
        roleId: systemRole.id,
        sellerId: null,
        assignedBy: administrator.id,
      })
      .onConflictDoNothing();

    return administrator;
  });

  return result;
}

/** Runs the deterministic Module 2 E2E administrator seed from the command line. */
async function main(): Promise<void> {
  try {
    const administrator = await seedModule2E2eAdministrator();
    console.log(`Module 2 E2E administrator ready: ${administrator.email}`);
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
