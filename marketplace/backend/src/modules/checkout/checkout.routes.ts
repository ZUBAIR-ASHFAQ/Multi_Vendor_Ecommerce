import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import {
  CHECKOUT_ERROR_CODE,
  CHECKOUT_PERMISSION,
} from "./checkout.constants.js";
import { CheckoutController } from "./checkout.controller.js";
import {
  checkoutAttemptContractSchema,
  checkoutAttemptIdParamsSchema,
  checkoutConfirmHeadersSchema,
  checkoutQuoteIdParamsSchema,
  checkoutQuoteWithLinesContractSchema,
  confirmCheckoutQuoteBodySchema,
  createCheckoutQuoteBodySchema,
} from "./checkout.schema.js";

/** Creates the four approved Module 10 Checkout routes with authentication and route-level RBAC. */
export function createCheckoutRouter(controller: CheckoutController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/quote",
    requirePermission(CHECKOUT_PERMISSION.CREATE_OWN),
    controller.createQuote,
  );
  router.get(
    "/quote/:id",
    requirePermission(CHECKOUT_PERMISSION.CREATE_OWN),
    controller.getQuote,
  );
  router.post(
    "/quote/:id/confirm",
    requirePermission(CHECKOUT_PERMISSION.CONFIRM_OWN),
    controller.confirmQuote,
  );
  router.get(
    "/:attemptId/status",
    requirePermission(CHECKOUT_PERMISSION.CONFIRM_OWN),
    controller.getAttemptStatus,
  );

  return router;
}

const requestIdSchema = { type: "string", minLength: 1 } as const;

/** Converts one Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the standard success envelope around one Checkout response schema. */
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

/** Wraps one Zod body contract as required application/json request content. */
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

/** Builds the required confirmation Idempotency-Key header from the runtime Zod contract. */
function idempotencyKeyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(checkoutConfirmHeadersSchema, "idempotency-key"),
    description: "Customer-scoped retry key. Exact completed retries replay the same confirmation result.",
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
            ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.INTERNAL_ERROR,
            ...Object.values(CHECKOUT_ERROR_CODE),
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
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Checkout permission or customer ownership policy denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Private Checkout resource was not found without leaking another customer's resource existence.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Quote state, price, stock, promotion, address, shipping, expiry, or idempotency business rule changed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Request body, path parameter, or required confirmation header validation failed.",
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
} as const;

const quoteIdParameter = pathParameter("id", checkoutQuoteIdParamsSchema);
const attemptIdParameter = pathParameter("attemptId", checkoutAttemptIdParamsSchema);
const idempotencyHeader = idempotencyKeyHeaderParameter();

/** Live OpenAPI contract for exactly the four approved Module 10 Checkout operations. */
export const checkoutOpenApiPaths = {
  "/api/v1/checkout/quote": {
    post: {
      tags: ["Checkout"],
      summary: "Create an authoritative Checkout quote",
      operationId: "createCheckoutQuote",
      description: [
        "Reloads the authenticated customer's Cart or Buy Now item and server-authoritative Product, Inventory,",
        "Promotion, Shipping, address, currency, and tax state before persisting a short-lived quote.",
      ].join(" "),
      security: [{ bearerAuth: [] }],
      requestBody: body(createCheckoutQuoteBodySchema),
      responses: {
        "201": {
          description: "Authoritative Checkout quote created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(checkoutQuoteWithLinesContractSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/checkout/quote/{id}": {
    get: {
      tags: ["Checkout"],
      summary: "Read an unexpired customer-owned Checkout quote",
      operationId: "getCheckoutQuote",
      security: [{ bearerAuth: [] }],
      parameters: [quoteIdParameter],
      responses: {
        "200": {
          description: "Customer-owned unexpired Checkout quote returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(checkoutQuoteWithLinesContractSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/checkout/quote/{id}/confirm": {
    post: {
      tags: ["Checkout"],
      summary: "Confirm a Checkout quote idempotently",
      operationId: "confirmCheckoutQuote",
      description: [
        "Requires Idempotency-Key, revalidates the complete authoritative quote state, and creates one",
        "Checkout attempt plus all Inventory reservations atomically.",
      ].join(" "),
      security: [{ bearerAuth: [] }],
      parameters: [quoteIdParameter, idempotencyHeader],
      requestBody: body(confirmCheckoutQuoteBodySchema),
      responses: {
        "200": {
          description: "Quote confirmed, or an exact completed retry replayed the same Checkout attempt.",
          content: {
            "application/json": {
              schema: success(openApiSchema(checkoutAttemptContractSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/checkout/{attemptId}/status": {
    get: {
      tags: ["Checkout"],
      summary: "Read a customer-owned Checkout attempt status",
      operationId: "getCheckoutAttemptStatus",
      description: "Returns Checkout state only; Order and Payment state remain owned by their later modules.",
      security: [{ bearerAuth: [] }],
      parameters: [attemptIdParameter],
      responses: {
        "200": {
          description: "Customer-owned Checkout attempt status returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(checkoutAttemptContractSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;
