import express, { type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import { errorMiddleware } from "../../src/common/middleware/error.middleware.js";
import {
  createAuthenticationMiddleware,
  getRequestContext,
} from "../../src/common/middleware/authentication.middleware.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../src/common/middleware/authorization.middleware.js";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware.js";
import { ADMIN_PERMISSION } from "../../src/modules/administration/administration.constants.js";
import type { AuthService } from "../../src/modules/administration/auth.service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const roleId = "33333333-3333-4333-8333-333333333333";

/** Builds the smallest AuthService stub needed to test authentication middleware behavior. */
function fakeAuthService(permissions: string[]) {
  return {
    authenticateAccessToken: vi.fn().mockResolvedValue({
      context: {
        requestId: "will-be-replaced-by-middleware",
        actorId: userId,
        actorType: ACTOR_TYPE.PLATFORM_ADMIN,
        permissions: new Set(permissions),
        sellerIds: new Set(),
        storeIds: new Set(),
        sellerPermissions: new Map(),
        sessionId,
      },
      user: {
        id: userId,
        email: "admin@example.com",
        displayName: "Admin",
        status: "active",
        roles: [{ id: roleId, code: "admin", name: "Admin" }],
        permissions,
      },
    }),
  } as unknown as AuthService;
}

/** Creates a protected test route with an optional single-permission requirement. */
function middlewareApp(service: AuthService, requiredPermission?: string) {
  const app = express();
  app.use(requestIdMiddleware);
  app.get(
    "/protected",
    createAuthenticationMiddleware(service),
    ...(requiredPermission
      ? [requirePermission(requiredPermission as never)]
      : []),
    (_request, response: Response) => {
      const context = getRequestContext(response);
      response.json({ actorId: context.actorId, permissions: [...context.permissions] });
    },
  );
  app.use(errorMiddleware);
  return app;
}

/** Creates a test app that accepts either one of two permissions before returning the protected response. */
function anyPermissionApp(service: AuthService) {
  const app = express();
  app.use(requestIdMiddleware);
  app.get(
    "/protected",
    createAuthenticationMiddleware(service),
    requireAnyPermission(
      ADMIN_PERMISSION.USERS_ROLES_MANAGE,
      ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    ),
    (_request, response: Response) => {
      response.json({ allowed: true });
    },
  );
  app.use(errorMiddleware);
  return app;
}

describe("Module 2 authentication/authorization middleware", () => {
  it("rejects a missing bearer credential with the stable 401 envelope", async () => {
    const response = await request(middlewareApp(fakeAuthService([])))
      .get("/protected")
      .expect(401);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("rejects malformed bearer syntax before calling the AuthService", async () => {
    const service = fakeAuthService([]);
    const spy = vi.mocked(service.authenticateAccessToken);

    await request(middlewareApp(service))
      .get("/protected")
      .set("Authorization", "Basic secret")
      .expect(401);

    expect(spy).not.toHaveBeenCalled();
  });

  it("stores only server-derived auth state and allows a held permission", async () => {
    const service = fakeAuthService([ADMIN_PERMISSION.USERS_READ]);
    const response = await request(
      middlewareApp(service, ADMIN_PERMISSION.USERS_READ),
    )
      .get("/protected")
      .set("Authorization", "Bearer signed-token")
      .expect(200);

    expect(response.body).toEqual({
      actorId: userId,
      permissions: [ADMIN_PERMISSION.USERS_READ],
    });
    expect(vi.mocked(service.authenticateAccessToken)).toHaveBeenCalledWith(
      "signed-token",
      expect.any(String),
    );
  });

  it("allows the seller-staff alternative permission without requiring platform role management", async () => {
    const response = await request(
      anyPermissionApp(fakeAuthService([ADMIN_PERMISSION.SELLER_STAFF_MANAGE])),
    )
      .get("/protected")
      .set("Authorization", "Bearer signed-token")
      .expect(200);

    expect(response.body).toEqual({ allowed: true });
  });

  it("denies the either-permission precheck when neither permission is held", async () => {
    const response = await request(anyPermissionApp(fakeAuthService([])))
      .get("/protected")
      .set("Authorization", "Bearer signed-token")
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the authenticated user lacks the required permission", async () => {
    const response = await request(
      middlewareApp(
        fakeAuthService([]),
        ADMIN_PERMISSION.USERS_STATUS_MANAGE,
      ),
    )
      .get("/protected")
      .set("Authorization", "Bearer signed-token")
      .expect(403);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
