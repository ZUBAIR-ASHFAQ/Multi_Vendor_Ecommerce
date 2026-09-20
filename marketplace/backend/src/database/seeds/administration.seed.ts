import { pathToFileURL } from "node:url";
import { eq, inArray } from "drizzle-orm";
import {
  ACCOUNT_TYPE,
  ADMIN_PERMISSION_CATALOG,
  ROLE_STATUS,
  SYSTEM_ROLE,
} from "../../modules/administration/administration.constants.js";
import { closeDatabase, db } from "../db.js";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../schema/administration.js";

/**
 * Seeds only Module 2-owned RBAC definitions.
 * Cross-module permission catalogs are composed by platform-rbac.seed.ts.
 */
export async function seedAdministrationRbac(): Promise<void> {
  await db.transaction(async (tx) => {
    for (const permission of ADMIN_PERMISSION_CATALOG) {
      await tx
        .insert(permissions)
        .values(permission)
        .onConflictDoUpdate({
          target: permissions.code,
          set: {
            domain: permission.domain,
            description: permission.description,
          },
        });
    }

    const [adminRole] = await tx
      .insert(roles)
      .values({
        ...SYSTEM_ROLE.PLATFORM_SUPER_ADMIN,
        isSystem: true,
        status: ROLE_STATUS.ACTIVE,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.name,
          description: SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.description,
          scopeType: SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.scopeType,
          isSystem: true,
          status: ROLE_STATUS.ACTIVE,
          updatedAt: new Date(),
        },
      })
      .returning({ id: roles.id });

    if (!adminRole) {
      throw new Error("Failed to resolve the platform_super_admin system role.");
    }

    const [customerRole] = await tx
      .insert(roles)
      .values({
        ...SYSTEM_ROLE.CUSTOMER_SELF_SERVICE,
        isSystem: true,
        status: ROLE_STATUS.ACTIVE,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.name,
          description: SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.description,
          scopeType: SYSTEM_ROLE.CUSTOMER_SELF_SERVICE.scopeType,
          isSystem: true,
          status: ROLE_STATUS.ACTIVE,
          updatedAt: new Date(),
        },
      })
      .returning({ id: roles.id });

    if (!customerRole) {
      throw new Error("Failed to resolve the customer_self_service system role.");
    }

    const administrationPermissionRows = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        inArray(
          permissions.code,
          ADMIN_PERMISSION_CATALOG.map((permission) => permission.code),
        ),
      );

    if (administrationPermissionRows.length !== ADMIN_PERMISSION_CATALOG.length) {
      throw new Error("Failed to resolve the complete Module 2 permission seed set.");
    }

    await tx
      .insert(rolePermissions)
      .values(
        administrationPermissionRows.map((permission) => ({
          roleId: adminRole.id,
          permissionId: permission.id,
          assignedBy: null,
        })),
      )
      .onConflictDoNothing();

    // Existing customer identities still receive the Module 2-owned protected role.
    // Module 3 permissions are attached to that role by the platform composition seed.
    const existingCustomers = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.accountType, ACCOUNT_TYPE.CUSTOMER));

    if (existingCustomers.length > 0) {
      await tx
        .insert(userRoles)
        .values(
          existingCustomers.map((customer) => ({
            userId: customer.id,
            roleId: customerRole.id,
            sellerId: null,
            assignedBy: null,
          })),
        )
        .onConflictDoNothing();
    }
  });
}

/** Runs the Module 2-only RBAC seed from the command line. */
async function main(): Promise<void> {
  try {
    await seedAdministrationRbac();
    console.log("Administration/RBAC seed completed.");
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
