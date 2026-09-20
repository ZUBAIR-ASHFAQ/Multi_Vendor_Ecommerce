import { describe, expect, it } from "vitest";
import { loginBodySchema, registerBodySchema } from "../../src/modules/administration/auth.schema.js";
import {
  changeUserStatusBodySchema,
  createRoleBodySchema,
  replaceRolePermissionsBodySchema,
  replaceUserRoleAssignmentsBodySchema,
  roleListQuerySchema,
  updatePlatformSettingsBodySchema,
  userListQuerySchema,
} from "../../src/modules/administration/administration.schema.js";

const TEST_ID = "11111111-1111-4111-8111-111111111111";

describe("Module 2 approved boundary schemas", () => {
  it("keeps public registration strict so account type and roles remain server-owned", () => {
    expect(
      registerBodySchema.parse({
        email: " CUSTOMER@EXAMPLE.COM ",
        displayName: " Customer ",
        password: "CustomerPassword!123",
      }),
    ).toEqual({
      email: "customer@example.com",
      displayName: "Customer",
      password: "CustomerPassword!123",
    });

    expect(() =>
      registerBodySchema.parse({
        email: "customer@example.com",
        displayName: "Customer",
        password: "CustomerPassword!123",
        accountType: "platform_admin",
      }),
    ).toThrow();
  });

  it("normalizes authentication email without mutating the password", () => {
    const parsed = loginBodySchema.parse({
      email: "  ADMIN@Example.COM ",
      password: "  exact password value  ",
    });

    expect(parsed).toEqual({
      email: "admin@example.com",
      password: "  exact password value  ",
    });
  });

  it("rejects unknown login fields and overlong credentials", () => {
    expect(() =>
      loginBodySchema.parse({
        email: "admin@example.com",
        password: "correct-value",
        actorId: "client-controlled-id",
      }),
    ).toThrow();

    expect(() =>
      loginBodySchema.parse({
        email: "admin@example.com",
        password: "x".repeat(129),
      }),
    ).toThrow();
  });

  it("keeps user status changes explicit and rejects unrelated user fields", () => {
    expect(
      changeUserStatusBodySchema.parse({
        status: "inactive",
        reason: "Support-approved deactivation",
      }),
    ).toEqual({
      status: "inactive",
      reason: "Support-approved deactivation",
    });

    expect(() =>
      changeUserStatusBodySchema.parse({
        status: "inactive",
        email: "client-controlled@example.com",
      }),
    ).toThrow();
  });

  it("normalizes stable role codes and keeps role scope explicit", () => {
    expect(
      createRoleBodySchema.parse({ code: "support_agent", name: "Support Agent" }),
    ).toMatchObject({
      code: "support_agent",
      scopeType: "platform",
      status: "active",
    });

    expect(() =>
      createRoleBodySchema.parse({ code: "Support-Agent", name: "Support Agent" }),
    ).toThrow(/Invalid role code/i);
  });

  it("rejects duplicate seller-aware role assignments", () => {
    expect(() =>
      replaceUserRoleAssignmentsBodySchema.parse({
        assignments: [
          { roleId: TEST_ID, sellerId: null },
          { roleId: TEST_ID, sellerId: null },
        ],
      }),
    ).toThrow(/Duplicate/i);
  });

  it("rejects duplicate permission identifiers before service execution", () => {
    expect(() =>
      replaceRolePermissionsBodySchema.parse({ permissionIds: [TEST_ID, TEST_ID] }),
    ).toThrow(/Duplicate/i);
  });

  it("rejects duplicate platform-setting keys before service execution", () => {
    expect(() =>
      updatePlatformSettingsBodySchema.parse({
        settings: [
          { key: "commerce.default_currency", value: "USD" },
          { key: "commerce.default_currency", value: "EUR" },
        ],
      }),
    ).toThrow(/Duplicate/i);
  });

  it("inherits bounded pagination defaults for user and role lists", () => {
    const users = userListQuerySchema.parse({});
    const roles = roleListQuerySchema.parse({});

    expect(users).toMatchObject({ page: 1, sort: "created_desc" });
    expect(roles).toMatchObject({ page: 1, sort: "name_asc" });
    expect(users.pageSize).toBeGreaterThan(0);
    expect(roles.pageSize).toBeGreaterThan(0);

    expect(() => userListQuerySchema.parse({ pageSize: "1000000" })).toThrow();
    expect(() => roleListQuerySchema.parse({ pageSize: "1000000" })).toThrow();
  });
});
