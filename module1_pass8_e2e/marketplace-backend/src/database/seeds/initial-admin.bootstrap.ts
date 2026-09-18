import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { PasswordService } from "../../common/security/password.service.js";
import { env } from "../../config/env.js";
import {
  ACCOUNT_TYPE,
  SYSTEM_ROLE,
  USER_STATUS,
} from "../../modules/administration/administration.constants.js";
import { closeDatabase, db } from "../db.js";
import { roles, userRoles, users } from "../schema/administration.js";
import { seedPlatformRbac } from "./platform-rbac.seed.js";

export interface BootstrapAdministratorResult {
  id: string;
  email: string;
}

/** Reads and validates the one-time administrator credentials from the validated environment. */
function readBootstrapCredentials(): {
  email: string;
  password: string;
  displayName: string;
} {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    throw new Error(
      "Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before running the initial administrator bootstrap.",
    );
  }

  return {
    email: env.BOOTSTRAP_ADMIN_EMAIL,
    password: env.BOOTSTRAP_ADMIN_PASSWORD,
    displayName: env.BOOTSTRAP_ADMIN_DISPLAY_NAME,
  };
}

/** Creates exactly one initial platform administrator and refuses to overwrite any existing administrator identity. */
export async function bootstrapInitialAdministrator(): Promise<BootstrapAdministratorResult> {
  const credentials = readBootstrapCredentials();

  await seedPlatformRbac();

  const [existingAdministrator] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.accountType, ACCOUNT_TYPE.PLATFORM_ADMIN))
    .limit(1);

  if (existingAdministrator) {
    throw new Error(
      `Initial administrator bootstrap refused because platform administrator ${existingAdministrator.email} already exists.`,
    );
  }

  const [existingEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, credentials.email))
    .limit(1);

  if (existingEmail) {
    throw new Error(
      "Initial administrator bootstrap refused because the requested email already belongs to an existing user.",
    );
  }

  const passwordHash = await new PasswordService().hash(credentials.password);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [systemRole] = await tx
      .select({ id: roles.id, scopeType: roles.scopeType })
      .from(roles)
      .where(eq(roles.code, SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code))
      .limit(1);

    if (!systemRole || systemRole.scopeType !== SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.scopeType) {
      throw new Error("The platform_super_admin system role is missing or has an invalid scope.");
    }

    const [administrator] = await tx
      .insert(users)
      .values({
        email: credentials.email,
        passwordHash,
        displayName: credentials.displayName,
        accountType: ACCOUNT_TYPE.PLATFORM_ADMIN,
        status: USER_STATUS.ACTIVE,
        emailVerifiedAt: now,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .returning({ id: users.id, email: users.email });

    if (!administrator) {
      throw new Error("Failed to create the initial platform administrator.");
    }

    await tx.insert(userRoles).values({
      userId: administrator.id,
      roleId: systemRole.id,
      sellerId: null,
      assignedBy: administrator.id,
    });

    return administrator;
  });
}

/** Runs the one-time bootstrap command and always closes the database pool. */
async function main(): Promise<void> {
  try {
    const administrator = await bootstrapInitialAdministrator();
    console.log(`Initial platform administrator created: ${administrator.email}`);
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
