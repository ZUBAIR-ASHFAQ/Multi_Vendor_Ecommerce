import express, { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { internalServiceMiddleware } from "../../common/middleware/internal-service.middleware.js";
import { appConfig } from "../../config/app.config.js";
import {
  PAYMENTS_ERROR_CODE,
  PAYMENTS_PERMISSION,
} from "./payments.constants.js";
import { PaymentsController } from "./payments.controller.js";
import {
  adminPaymentDetailSchema,
  adminPaymentListItemSchema,
  adminPaymentListQuerySchema,
  createPaymentIntentBodySchema,
  customerPaymentStatusSchema,
  internalRefundBodySchema,
  paymentIdParamsSchema,
  paymentIntentHeadersSchema,
  paymentIntentResponseSchema,
  paymentOrderIdParamsSchema,
  paymentTransactionResponseSchema,
  stripeWebhookHeadersSchema,
} from "./payments.schema.js";

/** Creates the two authenticated customer Payment routes. */
export function createPaymentsRouter(controller: PaymentsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/order/:orderId/intent",
    requirePermission(PAYMENTS_PERMISSION.READ_OWN),
    controller.createPaymentIntent,
  );
  router.get(
    "/order/:orderId",
    requirePermission(PAYMENTS_PERMISSION.READ_OWN),
    controller.getCustomerPaymentStatus,
  );

  return router;
}

/** Creates the raw-body Stripe webhook route that must be mounted before normal JSON parsing. */
export function createStripeWebhookRouter(controller: PaymentsController): Router {
  const router = Router();

  router.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json", limit: appConfig.bodyLimit }),
    controller.processStripeWebhook,
  );

  return router;
}

/** Creates the two authenticated finance-admin Payment read routes. */
export function createAdminPaymentsRouter(controller: PaymentsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(PAYMENTS_PERMISSION.ADMIN_READ),
    controller.listAdminPayments,
  );
  router.get(
    "/:id",
    requirePermission(PAYMENTS_PERMISSION.ADMIN_READ),
    controller.getAdminPaymentDetail,
  );

  return router;
}

/** Creates the trusted internal refund route with no browser/customer authentication fallback. */
export function createInternalPaymentsRouter(controller: PaymentsController): Router {
  const router = Router();
  router.use(internalServiceMiddleware);
  router.post("/:id/refund", controller.refundPayment);
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

const paymentWebhookResultSchema = z
  .object({
    providerEventId: z.string().min(1),
    status: z.enum(["processed", "ignored", "failed", "processing"]),
  })
  .strict();

/** Converts one runtime Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the stable success envelope around one Payments response schema. */
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

/** Builds the stable paginated success envelope around one Payments list response schema. */
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

/** Wraps one strict Zod body contract as required application/json content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: openApiSchema(schema),
      },
    },
  } as const;
}

/** Wraps one strict Zod body contract as optional application/json content. */
function optionalBody(schema: z.ZodType) {
  return {
    required: false,
    content: {
      "application/json": {
        schema: openApiSchema(schema),
      },
    },
  } as const;
}

/** Reads one object-property JSON schema from the same Zod contract parsed at runtime. */
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

/** Converts one Zod query object into allow-listed optional OpenAPI query parameters. */
function queryParameters(schema: z.ZodType) {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query" as const,
    required: false,
    schema: property as Record<string, unknown>,
  }));
}

/** Builds the required customer PaymentIntent Idempotency-Key header parameter. */
function idempotencyKeyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(paymentIntentHeadersSchema, "idempotency-key"),
    description: "Customer-scoped retry key. Raw values are never persisted or forwarded to Stripe.",
  } as const;
}

/** Builds the required Stripe signature header parameter used for raw-body verification. */
function stripeSignatureHeaderParameter() {
  return {
    name: "stripe-signature",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(stripeWebhookHeadersSchema, "stripe-signature"),
    description: "Stripe signature verified against the exact raw application/json request bytes.",
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
            ...Object.values(PAYMENTS_ERROR_CODE),
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
    description: "Malformed request or provider contract input was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Payments permission or customer ownership policy denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Payment/Order resource was not found without leaking another customer's private resource.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Payment lifecycle, capture, refund, or idempotency state conflicts with the request.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Path, query, body, or required Idempotency-Key validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or data-consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "502": {
    description: "Stripe/provider request failed or violated the provider contract.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Required queue/internal infrastructure is temporarily unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const webhookFailures = {
  "400": {
    description: "Missing/invalid Stripe signature, raw body, or signed payload.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Stripe webhook body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Webhook persistence or processing failed before a durable safe result was available.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Provider capture was recorded but required reconciliation work could not be queued.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const internalFailures = {
  "401": {
    description: "Valid internal service authentication is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Payment was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Refund source identity or Payment lifecycle state conflicts with the trusted command.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Trusted refund request validation or refundable-amount safety check failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or data-consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "502": {
    description: "Stripe/provider refund request failed or returned a rejected result.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Internal authentication or required reconciliation infrastructure is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const orderIdParameter = pathParameter("orderId", paymentOrderIdParamsSchema);
const paymentIdParameter = pathParameter("id", paymentIdParamsSchema);
const idempotencyHeader = idempotencyKeyHeaderParameter();
const stripeSignatureHeader = stripeSignatureHeaderParameter();

/** Live OpenAPI contract for exactly the six approved Module 12 Payments operations. */
export const paymentsOpenApiPaths = {
  "/api/v1/payments/order/{orderId}/intent": {
    post: {
      tags: ["Payments"],
      summary: "Create or reuse a customer PaymentIntent",
      operationId: "createPaymentIntent",
      description: [
        "Loads the immutable Order payment snapshot server-side, enforces customer ownership and payment-window rules,",
        "and creates/reuses one automatic-capture Stripe PaymentIntent with two-layer idempotency.",
      ].join(" "),
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter, idempotencyHeader],
      requestBody: optionalBody(createPaymentIntentBodySchema),
      responses: {
        "200": {
          description: "PaymentIntent created/reused, or an exact completed retry replayed the same safe response.",
          content: {
            "application/json": {
              schema: success(openApiSchema(paymentIntentResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/payments/order/{orderId}": {
    get: {
      tags: ["Payments"],
      summary: "Read customer-owned Payment status",
      operationId: "getCustomerPaymentStatus",
      description: "Reads marketplace Payment state only; browser redirect/query state never marks a Payment captured.",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter],
      responses: {
        "200": {
          description: "Provider-authoritative marketplace Payment state returned for the owning customer.",
          content: {
            "application/json": {
              schema: success(openApiSchema(customerPaymentStatusSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/payments/webhooks/stripe": {
    post: {
      tags: ["Payments"],
      summary: "Process a verified Stripe webhook",
      operationId: "processStripePaymentWebhook",
      description: [
        "Receives exact raw application/json bytes before the normal JSON parser. Stripe signature verification is the",
        "only authorization source; unsupported correctly signed events are acknowledged and recorded as ignored.",
      ].join(" "),
      parameters: [stripeSignatureHeader],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        "200": {
          description: "Verified event processed, ignored, or already durably known without duplicate money movement.",
          content: {
            "application/json": {
              schema: success(openApiSchema(paymentWebhookResultSchema)),
            },
          },
        },
        ...webhookFailures,
      },
    },
  },
  "/api/v1/admin/payments": {
    get: {
      tags: ["Payments"],
      summary: "Search Payments for finance/support",
      operationId: "listAdminPayments",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminPaymentListQuerySchema),
      responses: {
        "200": {
          description: "Permission-filtered finance Payment page returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(z.array(adminPaymentListItemSchema))),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/payments/{id}": {
    get: {
      tags: ["Payments"],
      summary: "Read Payment detail and transaction timeline",
      operationId: "getAdminPaymentDetail",
      security: [{ bearerAuth: [] }],
      parameters: [paymentIdParameter],
      responses: {
        "200": {
          description: "Safe Payment detail and ordered transaction history returned and audited.",
          content: {
            "application/json": {
              schema: success(openApiSchema(adminPaymentDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/internal/payments/{id}/refund": {
    post: {
      tags: ["Payments"],
      summary: "Execute a trusted provider refund",
      operationId: "refundPaymentInternally",
      description: "Used by trusted server-side refund orchestration only; return/refund eligibility remains Module 14 ownership.",
      security: [{ internalApiKey: [] }],
      parameters: [paymentIdParameter],
      requestBody: body(internalRefundBodySchema),
      responses: {
        "200": {
          description: "Refund completed/replayed, or a provider-authoritative transaction result returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(paymentTransactionResponseSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
} as const;
