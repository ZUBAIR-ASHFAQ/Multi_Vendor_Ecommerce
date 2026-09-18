import { pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { PasswordService } from "../../common/security/password.service.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import { DOCUMENT_AUDIT_PERMISSION } from "../../modules/documents-audit/documents-audit.constants.js";
import {
  ACCOUNT_TYPE,
  ROLE_SCOPE_TYPE,
} from "../../modules/administration/administration.constants.js";
import { closeDatabase, db } from "../db.js";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../schema/administration.js";
import { auditLogs } from "../schema/audit.js";
import { sellerStaff, sellers } from "../schema/sellers.js";
import { seedModule2E2eAdministrator } from "./module2-e2e.seed.js";

export const MODULE21_E2E_SELLER_A_ID = "11111111-1111-4111-8111-111111111111";
export const MODULE21_E2E_SELLER_B_ID = "22222222-2222-4222-8222-222222222222";

const SELLER_ROLE_CODE = "e2e_seller_auditor";
const DEFAULT_SELLER_PASSWORD = "E2e-Seller-Password!123";

interface E2eSellerIdentity {
  id: string;
  email: string;
  sellerId: string;
}

/** Creates or refreshes one active seller user before its Module 4 scope rows are attached. */
async function upsertSellerUser(
  email: string,
  displayName: string,
  passwordHash: string,
): Promise<{ id: string; email: string }> {
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      displayName,
      accountType: ACCOUNT_TYPE.SELLER,
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
        accountType: ACCOUNT_TYPE.SELLER,
        status: "active",
        emailVerifiedAt: now,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      },
    })
    .returning({ id: users.id, email: users.email });

  if (!user) throw new Error(`Failed to provision Module 21 E2E seller ${email}.`);
  return user;
}

/** Ensures the deterministic audit identity has a real active Module 4 seller/staff scope. */
async function upsertSellerScope(
  user: { id: string; email: string },
  sellerId: string,
  displayName: string,
  roleId: string,
): Promise<E2eSellerIdentity> {
  const now = new Date();
  await db
    .insert(sellers)
    .values({
      id: sellerId,
      ownerUserId: user.id,
      legalName: `${displayName} Legal`,
      displayName,
      taxId: null,
      status: "active",
      approvalStatus: "approved",
      approvedAt: now,
    })
    .onConflictDoUpdate({
      target: sellers.id,
      set: {
        ownerUserId: user.id,
        legalName: `${displayName} Legal`,
        displayName,
        taxId: null,
        status: "active",
        approvalStatus: "approved",
        approvedAt: now,
        updatedAt: now,
      },
    });

  await db
    .insert(sellerStaff)
    .values({
      sellerId,
      userId: user.id,
      status: "active",
      joinedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sellerStaff.sellerId, sellerStaff.userId],
      set: {
        status: "active",
        updatedAt: now,
      },
    });

  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId, sellerId, assignedBy: null })
    .onConflictDoNothing();

  return { ...user, sellerId };
}

/** Appends one seller-scoped fixture through the real Foundation audit writer. */
async function appendSellerAuditFixture(identity: E2eSellerIdentity, label: string): Promise<void> {
  const action = `e2e.${label}.audit_fixture`;
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.sellerId, identity.sellerId)))
    .limit(1);
  if (existing) return;

  await db.transaction(async (tx) => {
    await AuditService.using(tx).record({
      actorId: identity.id,
      actorType: ACTOR_TYPE.SELLER,
      action,
      entityType: "e2e_seller_resource",
      entityId: identity.sellerId,
      sellerId: identity.sellerId,
      requestId: `module21-e2e-${label}`,
      after: {
        state: "seeded",
        accessToken: "must-never-appear-in-audit-output",
      },
    });
  });
}

/** Provisions deterministic seller-scoped audit identities against the current Module 4 ownership model. */
export async function seedModule21E2eFixtures(): Promise<{
  sellerA: E2eSellerIdentity;
  sellerB: E2eSellerIdentity;
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Module 21 E2E fixture seed cannot run in production.");
  }

  await seedModule2E2eAdministrator();

  const [auditPermission] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, DOCUMENT_AUDIT_PERMISSION.AUDIT_READ))
    .limit(1);
  if (!auditPermission) throw new Error("The seeded audit.read permission was not found.");

  const [sellerRole] = await db
    .insert(roles)
    .values({
      code: SELLER_ROLE_CODE,
      name: "E2E Seller Auditor",
      description: "Test-only seller-scoped audit role for Module 21 Playwright coverage.",
      scopeType: ROLE_SCOPE_TYPE.SELLER,
      isSystem: false,
      status: "active",
    })
    .onConflictDoUpdate({
      target: roles.code,
      set: {
        name: "E2E Seller Auditor",
        description: "Test-only seller-scoped audit role for Module 21 Playwright coverage.",
        scopeType: ROLE_SCOPE_TYPE.SELLER,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning({ id: roles.id });
  if (!sellerRole) throw new Error("Failed to provision the Module 21 E2E seller role.");

  const currentPermissionRows = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, [DOCUMENT_AUDIT_PERMISSION.AUDIT_READ]));
  await db
    .insert(rolePermissions)
    .values(
      currentPermissionRows.map((permission) => ({
        roleId: sellerRole.id,
        permissionId: permission.id,
        assignedBy: null,
      })),
    )
    .onConflictDoNothing();

  const password = process.env.E2E_SELLER_PASSWORD ?? DEFAULT_SELLER_PASSWORD;
  const passwordHash = await new PasswordService().hash(password);
  const sellerAUser = await upsertSellerUser(
    (process.env.E2E_SELLER_A_EMAIL ?? "e2e.seller.a@marketplace.test").trim().toLowerCase(),
    "E2E Seller A Auditor",
    passwordHash,
  );
  const sellerBUser = await upsertSellerUser(
    (process.env.E2E_SELLER_B_EMAIL ?? "e2e.seller.b@marketplace.test").trim().toLowerCase(),
    "E2E Seller B Auditor",
    passwordHash,
  );
  const sellerA = await upsertSellerScope(
    sellerAUser,
    MODULE21_E2E_SELLER_A_ID,
    "E2E Seller A Auditor",
    sellerRole.id,
  );
  const sellerB = await upsertSellerScope(
    sellerBUser,
    MODULE21_E2E_SELLER_B_ID,
    "E2E Seller B Auditor",
    sellerRole.id,
  );

  await appendSellerAuditFixture(sellerA, "seller_a");
  await appendSellerAuditFixture(sellerB, "seller_b");
  return { sellerA, sellerB };
}

/** Runs the deterministic Module 21 E2E fixture seed from the command line. */
async function main(): Promise<void> {
  try {
    const fixtures = await seedModule21E2eFixtures();
    console.log(
      `Module 21 E2E sellers ready: ${fixtures.sellerA.email}, ${fixtures.sellerB.email}`,
    );
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
