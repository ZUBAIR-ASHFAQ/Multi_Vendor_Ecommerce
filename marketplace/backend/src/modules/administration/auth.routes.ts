import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { failureResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import { AuthController } from "./auth.controller.js";

/** Creates a small reusable rate limiter for authentication endpoints. */
function authRateLimit(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request: Request, response: Response) => {
      response.status(429).json(
        failureResponse(
          ERROR_CODE.RATE_LIMITED,
          "Too many authentication requests. Try again later.",
          { requestId: getRequestId(response) },
        ),
      );
    },
  });
}

const credentialRateLimit = authRateLimit(10);
const sessionRateLimit = authRateLimit(30);

/** Creates the exact Module 2 authentication route surface. */
export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post("/register", credentialRateLimit, controller.register);
  router.post("/login", credentialRateLimit, controller.login);
  router.post("/refresh", sessionRateLimit, controller.refresh);
  router.post("/logout", sessionRateLimit, controller.logout);
  router.get("/me", authenticationMiddleware, controller.me);

  return router;
}

const requestId = {
  type: "string",
  description: "Request correlation identifier.",
} as const;

const failureSchema = {
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

const authenticatedRole = {
  type: "object",
  required: ["id", "code", "name", "scopeType", "sellerId"],
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string" },
    name: { type: "string" },
    scopeType: { type: "string", enum: ["platform", "seller", "customer"] },
    sellerId: { type: ["string", "null"], format: "uuid" },
  },
} as const;

const authenticatedUser = {
  type: "object",
  required: [
    "id",
    "email",
    "displayName",
    "accountType",
    "status",
    "roles",
    "permissions",
    "scopes",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    displayName: { type: "string" },
    accountType: { type: "string", enum: ["platform_admin", "seller", "customer"] },
    status: { type: "string", enum: ["active", "inactive", "locked", "pending"] },
    roles: { type: "array", items: authenticatedRole },
    permissions: { type: "array", items: { type: "string" } },
    scopes: {
      type: "object",
      required: ["sellerIds", "storeIds"],
      properties: {
        sellerIds: { type: "array", items: { type: "string", format: "uuid" } },
        storeIds: { type: "array", items: { type: "string", format: "uuid" } },
      },
    },
  },
} as const;

const registrationData = {
  type: "object",
  required: ["id", "email", "displayName", "accountType", "status"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    displayName: { type: "string" },
    accountType: { const: "customer" },
    status: { type: "string", enum: ["active", "inactive", "locked", "pending"] },
  },
} as const;

const authSessionData = {
  type: "object",
  required: ["accessToken", "expiresInSeconds", "user"],
  properties: {
    accessToken: { type: "string" },
    expiresInSeconds: { type: "integer", minimum: 1 },
    user: authenticatedUser,
  },
} as const;

/** Builds the standard success envelope for one OpenAPI data schema. */
function successSchema(data: object) {
  return {
    type: "object",
    required: ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      requestId,
    },
  } as const;
}

/** Wraps an OpenAPI JSON request body. */
function jsonBody(schema: object) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

const standardFailureResponses = {
  "401": {
    description: "Authentication/session failure.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Request validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Authentication rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

/** Route-owned OpenAPI definitions for the exact Module 2 authentication surface. */
export const authOpenApiPaths = {
  "/api/v1/auth/register": {
    post: {
      tags: ["Authentication"],
      summary: "Register customer account",
      description: "Creates a customer identity. Account type, roles, permissions and seller scope are server-owned.",
      requestBody: jsonBody({
        type: "object",
        additionalProperties: false,
        required: ["email", "displayName", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          displayName: { type: "string", minLength: 1, maxLength: 200 },
          password: { type: "string", minLength: 12, maxLength: 128, format: "password" },
        },
      }),
      responses: {
        "201": {
          description: "Customer account created.",
          content: { "application/json": { schema: successSchema(registrationData) } },
        },
        "409": {
          description: "Registration email already exists.",
          content: { "application/json": { schema: failureSchema } },
        },
        "422": standardFailureResponses["422"],
        "429": standardFailureResponses["429"],
      },
    },
  },
  "/api/v1/auth/login": {
    post: {
      tags: ["Authentication"],
      summary: "Sign in",
      description: "Verifies credentials, creates a refresh session and sets an HttpOnly refresh cookie.",
      requestBody: jsonBody({
        type: "object",
        additionalProperties: false,
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          password: { type: "string", minLength: 1, maxLength: 128, format: "password" },
        },
      }),
      responses: {
        "200": {
          description: "Authenticated session created.",
          headers: {
            "Set-Cookie": {
              description: "HttpOnly refresh-session cookie.",
              schema: { type: "string" },
            },
          },
          content: { "application/json": { schema: successSchema(authSessionData) } },
        },
        ...standardFailureResponses,
      },
    },
  },
  "/api/v1/auth/refresh": {
    post: {
      tags: ["Authentication"],
      summary: "Rotate refresh session",
      security: [{ refreshCookie: [] }],
      responses: {
        "200": {
          description: "Refresh credential rotated and new access token issued.",
          content: { "application/json": { schema: successSchema(authSessionData) } },
        },
        ...standardFailureResponses,
      },
    },
  },
  "/api/v1/auth/logout": {
    post: {
      tags: ["Authentication"],
      summary: "Sign out current refresh session",
      security: [{ refreshCookie: [] }],
      responses: {
        "200": {
          description: "Current refresh session revoked/cleared idempotently.",
          content: {
            "application/json": {
              schema: successSchema({
                type: "object",
                required: ["loggedOut"],
                properties: { loggedOut: { const: true } },
              }),
            },
          },
        },
        "429": standardFailureResponses["429"],
      },
    },
  },
  "/api/v1/auth/me": {
    get: {
      tags: ["Authentication"],
      summary: "Current actor",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Current safe identity, roles, permissions and server-derived scopes.",
          content: { "application/json": { schema: successSchema(authenticatedUser) } },
        },
        "401": standardFailureResponses["401"],
      },
    },
  },
} as const;

export const authOpenApiComponents = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    },
    refreshCookie: {
      type: "apiKey",
      in: "cookie",
      name: "marketplace_refresh",
    },
  },
} as const;
