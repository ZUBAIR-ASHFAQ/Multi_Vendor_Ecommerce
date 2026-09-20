import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { internalServiceMiddleware } from "../../common/middleware/internal-service.middleware.js";
import {
  WALLET_PAYOUT_ERROR_CODE,
  WALLET_PAYOUT_PERMISSION,
} from "./seller-wallet-payouts.constants.js";
import { SellerWalletPayoutsController } from "./seller-wallet-payouts.controller.js";
import {
  adjustWalletBodySchema,
  adjustWalletResultSchema,
  adminPayoutListQuerySchema,
  createPayoutAccountBodySchema,
  payoutAccountResponseSchema,
  payoutIdParamsSchema,
  payoutResponseSchema,
  requestPayoutBodySchema,
  sellerPayoutListQuerySchema,
  sellerWalletQuerySchema,
  sellerWalletResponseSchema,
  settleWalletBodySchema,
  settleWalletResultSchema,
  walletPayoutIdempotencyHeadersSchema,
} from "./seller-wallet-payouts.schema.js";

/** Creates seller Wallet, payout-history, payout-request, and payout-account routes mounted at /api/v1/seller. */
export function createSellerWalletPayoutsRouter(
  controller: SellerWalletPayoutsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/wallet",
    requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ),
    controller.getSellerWallet,
  );
  router.get(
    "/payouts",
    requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ),
    controller.listSellerPayouts,
  );
  router.post(
    "/payouts",
    requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST),
    controller.requestPayout,
  );
  router.post(
    "/payout-accounts",
    requirePermission(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE),
    controller.createPayoutAccount,
  );

  return router;
}

/** Creates finance Payout queue and controlled approval/send commands mounted at /api/v1/admin/payouts. */
export function createAdminPayoutsRouter(
  controller: SellerWalletPayoutsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ),
    controller.listAdminPayouts,
  );
  router.post(
    "/:id/approve",
    requirePermission(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE),
    controller.approvePayout,
  );
  router.post(
    "/:id/send",
    requirePermission(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE),
    controller.sendPayout,
  );

  return router;
}

/** Creates trusted internal Wallet settlement and adjustment commands mounted at /api/v1/internal/wallet. */
export function createInternalWalletRouter(
  controller: SellerWalletPayoutsController,
): Router {
  const router = Router();
  router.use(internalServiceMiddleware);
  router.post("/settle", controller.settleWallet);
  router.post("/adjust", controller.adjustWallet);
  return router;
}

const requestIdSchema = { type: "string", minLength: 1 } as const;
const paginationMetaSchema = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Converts one runtime Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Reads one object-property JSON schema from the same Zod contract used at runtime. */
function objectPropertySchema(
  schema: z.ZodType,
  propertyName: string,
): Record<string, unknown> {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`OpenAPI schema does not expose object properties for ${propertyName}.`);
  }
  const property = (properties as Record<string, unknown>)[propertyName];
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    throw new Error(`OpenAPI schema is missing property ${propertyName}.`);
  }
  return property as Record<string, unknown>;
}

/** Builds one required path parameter from a Zod object property. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path" as const,
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds query parameters while preserving whether each Zod field is required. */
function queryParameters(schema: z.ZodType) {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = new Set(
    Array.isArray(jsonSchema.required)
      ? jsonSchema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query" as const,
    required: required.has(name),
    schema: property as Record<string, unknown>,
  }));
}

/** Builds the required Idempotency-Key header from the runtime Module 17 header contract. */
function idempotencyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(walletPayoutIdempotencyHeadersSchema, "idempotency-key"),
  } as const;
}

/** Wraps one strict Module 17 command body as required JSON content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": { schema: openApiSchema(schema) },
    },
  } as const;
}

/** Builds the canonical success envelope around one Module 17 response schema. */
function success(data: object) {
  return {
    type: "object",
    required: ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      requestId: requestIdSchema,
    },
  } as const;
}

/** Builds the canonical paginated success envelope used by Wallet-ledger and Payout-list reads. */
function paginatedSuccess(data: object) {
  return {
    type: "object",
    required: ["success", "data", "meta", "requestId"],
    properties: {
      success: { const: true },
      data,
      meta: paginationMetaSchema,
      requestId: requestIdSchema,
    },
  } as const;
}

const failureSchema = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          enum: [
            ERROR_CODE.VALIDATION_FAILED,
            ERROR_CODE.INVALID_REQUEST,
            ERROR_CODE.UNAUTHENTICATED,
            ERROR_CODE.FORBIDDEN,
            ERROR_CODE.RESOURCE_NOT_FOUND,
            ERROR_CODE.CONFLICT,
            ERROR_CODE.IDEMPOTENCY_CONFLICT,
            ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.PAYLOAD_TOO_LARGE,
            ERROR_CODE.INTERNAL_ERROR,
            ERROR_CODE.SERVICE_UNAVAILABLE,
            ...Object.values(WALLET_PAYOUT_ERROR_CODE),
          ],
        },
        message: { type: "string", minLength: 1 },
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
    requestId: requestIdSchema,
  },
} as const;

const protectedFailures = {
  "400": {
    description: "Malformed Wallet/Payout request was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Wallet/Payout permission or seller scope is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "The requested Payout or required resource was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Wallet balance, payout lifecycle, source replay, or idempotency state conflicts with the command.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Wallet/Payout request validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Wallet consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "502": {
    description: "Payout provider validation, send, or reconciliation failed or remained uncertain.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "A required service or configured payout provider is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const internalFailures = {
  "400": {
    description: "Malformed trusted Wallet command was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Valid internal service authentication is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Trusted system Wallet command access is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "The referenced authoritative Commission or delivery source was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Wallet source replay, balance, or idempotency state conflicts with the trusted command.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Trusted Wallet command body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Trusted Wallet command validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Wallet consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Internal authentication or a required service dependency is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const payoutIdParameter = pathParameter("id", payoutIdParamsSchema);
const idempotencyHeader = idempotencyHeaderParameter();

/** Live OpenAPI contract for exactly the nine approved Module 17 Seller Wallet & Payouts operations. */
export const sellerWalletPayoutsOpenApiPaths = {
  "/api/v1/seller/wallet": {
    get: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Read seller Wallet balances and immutable ledger",
      operationId: "getSellerWallet",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerWalletQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Wallet snapshots, ledger page, and safe payout accounts returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerWalletResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/payouts": {
    get: {
      tags: ["Seller Wallet & Payouts"],
      summary: "List seller Payout history",
      operationId: "listSellerPayouts",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerPayoutListQuerySchema),
      responses: {
        "200": {
          description: "Seller-owned Payout history returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(z.array(payoutResponseSchema))),
            },
          },
        },
        ...protectedFailures,
      },
    },
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Request a seller Payout",
      operationId: "requestSellerPayout",
      description:
        "Creates a requested Payout only after rechecking seller scope, payout account ownership, and current " +
        "available Wallet balance. Money is not reserved until finance approval.",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body(requestPayoutBodySchema),
      responses: {
        "201": {
          description: "Payout request created or exact idempotent replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(payoutResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/payout-accounts": {
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Add a tokenized seller payout account",
      operationId: "createSellerPayoutAccount",
      description: "Accepts only an already-tokenized provider reference. Raw bank/card credentials are never accepted or returned.",
      security: [{ bearerAuth: [] }],
      requestBody: body(createPayoutAccountBodySchema),
      responses: {
        "201": {
          description: "Provider-validated seller payout account stored and returned without the provider-owned reference.",
          content: {
            "application/json": {
              schema: success(openApiSchema(payoutAccountResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/payouts": {
    get: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Read the finance Payout queue",
      operationId: "listAdminPayouts",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminPayoutListQuerySchema),
      responses: {
        "200": {
          description: "Permission-filtered Payout queue and reconciliation-safe allocation evidence returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(z.array(payoutResponseSchema))),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/payouts/{id}/approve": {
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Approve and reserve one Payout",
      operationId: "approvePayout",
      description:
        "Atomically rechecks available balance/account state, reserves exact Wallet money into held, and writes " +
        "FIFO payout allocations.",
      security: [{ bearerAuth: [] }],
      parameters: [payoutIdParameter, idempotencyHeader],
      responses: {
        "200": {
          description: "Payout approved/reserved or exact idempotent replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(payoutResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/payouts/{id}/send": {
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Send or reconcile one approved Payout",
      operationId: "sendPayout",
      description:
        "Moves an approved Payout to processing before the provider call. Paid/failure results reconcile held " +
        "money; unknown results stay processing and held for safe retry.",
      security: [{ bearerAuth: [] }],
      parameters: [payoutIdParameter, idempotencyHeader],
      responses: {
        "200": {
          description: "Provider-authoritative paid result finalized or exact successful replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(payoutResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/internal/wallet/settle": {
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Settle eligible pending Wallet earnings",
      operationId: "settleWalletInternally",
      description:
        "Trusted bounded command that revalidates Commission source and Shipment delivery/Return-window eligibility " +
        "before moving pending earnings to available.",
      security: [{ internalApiKey: [] }],
      parameters: [idempotencyHeader],
      requestBody: body(settleWalletBodySchema),
      responses: {
        "200": {
          description: "Eligible pending entries settled or exact batch replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(settleWalletResultSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
  "/api/v1/internal/wallet/adjust": {
    post: {
      tags: ["Seller Wallet & Payouts"],
      summary: "Re-drive a Commission-backed Wallet adjustment",
      operationId: "adjustWalletInternally",
      description:
        "Trusted reconciliation command that accepts only a Commission entry identity and derives seller, currency, " +
        "and amount from Module 16 source truth.",
      security: [{ internalApiKey: [] }],
      parameters: [idempotencyHeader],
      requestBody: body(adjustWalletBodySchema),
      responses: {
        "200": {
          description: "Negative Commission source applied once or exact replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(adjustWalletResultSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
} as const;
