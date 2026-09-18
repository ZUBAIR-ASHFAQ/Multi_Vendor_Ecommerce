import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { seedAdministrationRbac } from "../../src/database/seeds/administration.seed.js";
import {
  ACCOUNT_TYPE,
  ADMIN_PERMISSION,
  ROLE_SCOPE_TYPE,
  USER_STATUS,
} from "../../src/modules/administration/administration.constants.js";
import { AdministrationRepository } from "../../src/modules/administration/administration.repository.js";

/** Restores only the Module 2 persistence needed by focused repository tests. */
async function resetModule2RepositoryTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      refresh_sessions,
      user_roles,
      role_permissions,
      platform_settings,
      users,
      permissions,
      roles,
      audit_logs,
      outbox_events,
      idempotency_keys
    RESTART IDENTITY CASCADE
  `);
  await seedAdministrationRbac();
}

beforeEach(async () => {
  await resetModule2RepositoryTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 2 repository persistence boundaries", () => {
  it("returns safe user records and persists role permission membership without password leakage", async () => {
    const repository = new AdministrationRepository();
    const user = await repository.createUser({
      email: `module2-repo-${randomUUID()}@example.com`,
      passwordHash: "repository-test-password-hash",
      displayName: "Repository User",
      accountType: ACCOUNT_TYPE.PLATFORM_ADMIN,
      status: USER_STATUS.ACTIVE,
    });
    expect(user).not.toHaveProperty("passwordHash");

    const role = await repository.createRole({
      code: `repo_role_${randomUUID().replaceAll("-", "")}`,
      name: "Repository Role",
      scopeType: ROLE_SCOPE_TYPE.PLATFORM,
      isSystem: false,
      status: "active",
    });
    const permissionResult = await databasePool.query<{ id: string }>(
      "select id from permissions where code = $1",
      [ADMIN_PERMISSION.USERS_READ],
    );
    const permissionId = permissionResult.rows[0]?.id;
    if (!permissionId) throw new Error("Seeded admin.users.read permission was not found.");

    await repository.replaceRolePermissions(role.id, [permissionId], user.id);
    await repository.replaceUserRoleAssignments(
      user.id,
      [{ roleId: role.id, sellerId: null }],
      user.id,
    );

    await expect(repository.findUserById(user.id)).resolves.toMatchObject({
      id: user.id,
      roles: [expect.objectContaining({ id: role.id, sellerId: null })],
    });
    const grants = await repository.getUserPermissions(user.id);
    expect(grants).toEqual([
      expect.objectContaining({
        roleId: role.id,
        sellerId: null,
        permission: expect.objectContaining({ code: ADMIN_PERMISSION.USERS_READ }),
      }),
    ]);
    await expect(repository.findRoleById(role.id)).resolves.toMatchObject({
      id: role.id,
      permissions: [expect.objectContaining({ code: ADMIN_PERMISSION.USERS_READ })],
    });
  });
});
