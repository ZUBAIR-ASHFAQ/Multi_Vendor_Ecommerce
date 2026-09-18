import { Router } from "express";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../common/middleware/authorization.middleware.js";
import { ADMIN_PERMISSION } from "./administration.constants.js";
import { AdministrationController } from "./administration.controller.js";

/** Creates the exact Module 2 Administration/RBAC routes with permission prechecks. */
export function createAdministrationRouter(
  controller: AdministrationController,
): Router {
  const router = Router();

  router.use(authenticationMiddleware);

  router.get(
    "/users",
    requireAnyPermission(
      ADMIN_PERMISSION.USERS_READ,
      ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    ),
    controller.listUsers,
  );
  router.patch(
    "/users/:id/status",
    requirePermission(ADMIN_PERMISSION.USERS_STATUS_MANAGE),
    controller.changeUserStatus,
  );
  router.put(
    "/users/:id/roles",
    requireAnyPermission(
      ADMIN_PERMISSION.USERS_ROLES_MANAGE,
      ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    ),
    controller.replaceUserRoleAssignments,
  );

  router.get(
    "/roles",
    requireAnyPermission(
      ADMIN_PERMISSION.ROLES_READ,
      ADMIN_PERMISSION.SELLER_STAFF_MANAGE,
    ),
    controller.listRoles,
  );
  router.post(
    "/roles",
    requirePermission(ADMIN_PERMISSION.ROLES_CREATE),
    controller.createRole,
  );
  router.put(
    "/roles/:id/permissions",
    requirePermission(ADMIN_PERMISSION.ROLES_PERMISSIONS_MANAGE),
    controller.replaceRolePermissions,
  );

  router.get(
    "/settings",
    requirePermission(ADMIN_PERMISSION.SETTINGS_MANAGE),
    controller.getPlatformSettings,
  );
  router.patch(
    "/settings",
    requirePermission(ADMIN_PERMISSION.SETTINGS_MANAGE),
    controller.updatePlatformSettings,
  );

  return router;
}

const requestId = { type: "string" } as const;

const paginationMeta = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

const roleSummary = {
  type: "object",
  required: ["id", "code", "name", "scopeType", "isSystem", "status"],
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string" },
    name: { type: "string" },
    scopeType: { type: "string", enum: ["platform", "seller", "customer"] },
    isSystem: { type: "boolean" },
    status: { type: "string", enum: ["active", "inactive"] },
  },
} as const;

const userRoleSummary = {
  ...roleSummary,
  required: [...roleSummary.required, "sellerId"],
  properties: {
    ...roleSummary.properties,
    sellerId: { type: ["string", "null"], format: "uuid" },
  },
} as const;

const permission = {
  type: "object",
  required: ["id", "code", "domain", "description"],
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string" },
    domain: { type: "string" },
    description: { type: "string" },
  },
} as const;

const user = {
  type: "object",
  required: [
    "id",
    "email",
    "displayName",
    "accountType",
    "status",
    "emailVerifiedAt",
    "passwordChangedAt",
    "lastLoginAt",
    "failedLoginAttempts",
    "lockedUntil",
    "createdAt",
    "updatedAt",
    "roles",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    displayName: { type: "string" },
    accountType: { type: "string", enum: ["platform_admin", "seller", "customer"] },
    status: { type: "string", enum: ["active", "inactive", "locked", "pending"] },
    emailVerifiedAt: { type: ["string", "null"], format: "date-time" },
    passwordChangedAt: { type: ["string", "null"], format: "date-time" },
    lastLoginAt: { type: ["string", "null"], format: "date-time" },
    failedLoginAttempts: { type: "integer", minimum: 0 },
    lockedUntil: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    roles: { type: "array", items: userRoleSummary },
  },
} as const;

const role = {
  ...roleSummary,
  required: [
    "id",
    "code",
    "name",
    "scopeType",
    "description",
    "isSystem",
    "status",
    "createdAt",
    "updatedAt",
    "permissions",
  ],
  properties: {
    ...roleSummary.properties,
    description: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    permissions: { type: "array", items: permission },
  },
} as const;

const platformSetting = {
  type: "object",
  required: ["key", "value", "updatedBy", "updatedAt"],
  properties: {
    key: { type: "string", pattern: "^[a-z][a-z0-9_.-]*$", maxLength: 120 },
    value: {},
    updatedBy: { type: ["string", "null"], format: "uuid" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const failure = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        fieldErrors: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "message"],
            properties: {
              path: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    requestId,
  },
} as const;

/** Builds a standard success envelope, optionally with pagination metadata. */
function success(data: object, paginated = false) {
  return {
    type: "object",
    required: paginated
      ? ["success", "data", "meta", "requestId"]
      : ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      ...(paginated ? { meta: paginationMeta } : {}),
      requestId,
    },
  } as const;
}

/** Wraps one JSON schema as an OpenAPI request body. */
function body(schema: object) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

const listQueryParameters = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "search", in: "query", schema: { type: "string", maxLength: 200 } },
] as const;

const commonFailures = {
  "401": { description: "Authentication required.", content: { "application/json": { schema: failure } } },
  "403": { description: "Required permission/policy denied.", content: { "application/json": { schema: failure } } },
  "422": { description: "Request validation failed.", content: { "application/json": { schema: failure } } },
} as const;

/** Route-owned OpenAPI definitions for the exact Module 2 Administration surface. */
export const administrationOpenApiPaths = {
  "/api/v1/admin/users": {
    get: {
      tags: ["Administration"],
      summary: "List users",
      security: [{ bearerAuth: [] }],
      parameters: [
        ...listQueryParameters,
        { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive", "locked", "pending"] } },
        { name: "roleId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["created_desc", "created_asc", "name_asc", "name_desc"] } },
      ],
      responses: {
        "200": {
          description: "Paginated users.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: user }, true),
            },
          },
        },
        ...commonFailures,
      },
    },
  },
  "/api/v1/admin/users/{id}/status": {
    patch: {
      tags: ["Administration"],
      summary: "Change user status",
      security: [{ bearerAuth: [] }],
      parameters: [idParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["active", "inactive", "locked", "pending"] },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
      }),
      responses: {
        "200": { description: "Status transition applied.", content: { "application/json": { schema: success(user) } } },
        "404": { description: "User not found.", content: { "application/json": { schema: failure } } },
        "409": { description: "Status transition conflict.", content: { "application/json": { schema: failure } } },
        ...commonFailures,
      },
    },
  },
  "/api/v1/admin/users/{id}/roles": {
    put: {
      tags: ["Administration"],
      summary: "Replace platform/seller-scoped user roles",
      security: [{ bearerAuth: [] }],
      parameters: [idParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["assignments"],
        properties: {
          assignments: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["roleId"],
              properties: {
                roleId: { type: "string", format: "uuid" },
                sellerId: { type: ["string", "null"], format: "uuid" },
              },
            },
          },
        },
      }),
      responses: {
        ...commonFailures,
        "200": { description: "Role assignments replaced.", content: { "application/json": { schema: success(user) } } },
        "400": { description: "Invalid role assignment.", content: { "application/json": { schema: failure } } },
        "403": { description: "Seller/resource scope is not allowed.", content: { "application/json": { schema: failure } } },
        "404": { description: "User/role not found.", content: { "application/json": { schema: failure } } },
      },
    },
  },
  "/api/v1/admin/roles": {
    get: {
      tags: ["Administration"],
      summary: "List roles",
      security: [{ bearerAuth: [] }],
      parameters: [
        ...listQueryParameters,
        { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive"] } },
        { name: "system", in: "query", schema: { type: "boolean" } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["created_desc", "created_asc", "name_asc", "name_desc"] } },
      ],
      responses: {
        "200": {
          description: "Paginated roles.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: role }, true),
            },
          },
        },
        ...commonFailures,
      },
    },
    post: {
      tags: ["Administration"],
      summary: "Create custom role",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["code", "name"],
        properties: {
          code: { type: "string", minLength: 2, maxLength: 100, pattern: "^[a-z][a-z0-9_]*$" },
          name: { type: "string", minLength: 1, maxLength: 150 },
          description: { type: ["string", "null"], maxLength: 2000 },
          scopeType: { type: "string", enum: ["platform", "seller", "customer"], default: "platform" },
          status: { type: "string", enum: ["active", "inactive"], default: "active" },
        },
      }),
      responses: {
        "201": { description: "Role created.", content: { "application/json": { schema: success(role) } } },
        "409": { description: "Duplicate role code.", content: { "application/json": { schema: failure } } },
        ...commonFailures,
      },
    },
  },
  "/api/v1/admin/roles/{id}/permissions": {
    put: {
      tags: ["Administration"],
      summary: "Replace role permissions",
      security: [{ bearerAuth: [] }],
      parameters: [idParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["permissionIds"],
        properties: { permissionIds: { type: "array", uniqueItems: true, items: { type: "string", format: "uuid" } } },
      }),
      responses: {
        "200": { description: "Permission assignments replaced.", content: { "application/json": { schema: success(role) } } },
        "400": { description: "Invalid permission assignment.", content: { "application/json": { schema: failure } } },
        "404": { description: "Role/permission not found.", content: { "application/json": { schema: failure } } },
        "409": { description: "Protected role conflict.", content: { "application/json": { schema: failure } } },
        ...commonFailures,
      },
    },
  },
  "/api/v1/admin/settings": {
    get: {
      tags: ["Administration"],
      summary: "Read platform settings",
      description: "Returns only non-secret settings allowed by the Module 2 settings service.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Allow-listed platform settings.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                required: ["settings"],
                properties: { settings: { type: "array", items: platformSetting } },
              }),
            },
          },
        },
        ...commonFailures,
      },
    },
    patch: {
      tags: ["Administration"],
      summary: "Update platform settings",
      description: "Updates only service allow-listed, non-secret setting keys.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["settings"],
        properties: {
          settings: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: {
                key: { type: "string", pattern: "^[a-z][a-z0-9_.-]*$", maxLength: 120 },
                value: {},
              },
            },
          },
        },
      }),
      responses: {
        "200": {
          description: "Platform settings updated.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                required: ["settings"],
                properties: { settings: { type: "array", items: platformSetting } },
              }),
            },
          },
        },
        "400": { description: "Setting key/value is not allowed.", content: { "application/json": { schema: failure } } },
        ...commonFailures,
      },
    },
  },
} as const;
