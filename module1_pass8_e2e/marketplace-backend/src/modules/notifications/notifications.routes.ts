import { Router } from "express";
import { z } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { NOTIFICATIONS_PERMISSION } from "./notifications.constants.js";
import { NotificationsController } from "./notifications.controller.js";
import {
  adminNotificationDeliveriesListDataSchema,
  adminNotificationDeliveriesQuerySchema,
  adminNotificationDeliveryResponseSchema,
  markAllNotificationsReadResponseSchema,
  markNotificationReadResponseSchema,
  notificationDeliveryIdParamsSchema,
  notificationIdParamsSchema,
  notificationPreferencesResponseSchema,
  notificationsListDataSchema,
  notificationsListMetaSchema,
  notificationsListQuerySchema,
  updateNotificationPreferencesBodySchema,
} from "./notifications.schema.js";

/** Creates the five authenticated current-user Notification routes. */
export function createNotificationsRouter(controller: NotificationsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN),
    controller.listNotifications,
  );
  router.post(
    "/:id/read",
    requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN),
    controller.markNotificationRead,
  );
  router.post(
    "/read-all",
    requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN),
    controller.markAllNotificationsRead,
  );
  router.get(
    "/preferences",
    requirePermission(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN),
    controller.getPreferences,
  );
  router.put(
    "/preferences",
    requirePermission(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN),
    controller.updatePreferences,
  );

  return router;
}

/** Creates the two privileged Notification delivery-failure administration routes. */
export function createAdminNotificationDeliveriesRouter(
  controller: NotificationsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_READ),
    controller.listFailedDeliveries,
  );
  router.post(
    "/:id/retry",
    requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_RETRY),
    controller.retryFailedDelivery,
  );

  return router;
}

const requestIdSchema = { type: "string", minLength: 1 } as const;

const failureSchema = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", minLength: 1 },
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

const paginationMetaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: PAGINATION.MAX_PAGE_SIZE },
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

/** Builds the stable success envelope around one non-paginated Notification response. */
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

/** Builds the standard paginated success envelope for the admin delivery-failure queue. */
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

/** Builds the current-user Notification list envelope with the required global unread count. */
function notificationListSuccess() {
  return {
    type: "object",
    required: ["success", "data", "meta", "requestId"],
    properties: {
      success: { const: true },
      data: openApiSchema(notificationsListDataSchema),
      meta: openApiSchema(notificationsListMetaSchema),
      requestId: requestIdSchema,
    },
  } as const;
}

/** Wraps one validated body contract as required application/json request content. */
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

/** Reads one property schema from the same Zod object used by the controller. */
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

/** Builds one UUID path parameter from a controller-owned Zod parameter schema. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds allow-listed query parameters from the same Zod schema parsed by the controller. */
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

const notificationIdParameter = pathParameter("id", notificationIdParamsSchema);
const deliveryIdParameter = pathParameter("id", notificationDeliveryIdParamsSchema);

const protectedFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Notification permission or ownership/policy check failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Notification or delivery was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Notification delivery lifecycle command conflicts with current state.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Path, query, or body validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Global request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const listFailures = {
  "401": protectedFailures["401"],
  "403": protectedFailures["403"],
  "422": protectedFailures["422"],
  "429": protectedFailures["429"],
  "500": protectedFailures["500"],
} as const;

/** Route-owned OpenAPI definitions for exactly the seven documented Module 18 operations. */
export const notificationsOpenApiPaths = {
  "/api/v1/notifications": {
    get: {
      tags: ["Notifications"],
      summary: "List current user's Notifications",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(notificationsListQuerySchema),
      responses: {
        "200": {
          description: "Bounded owner-scoped Notification page with global unread count.",
          content: { "application/json": { schema: notificationListSuccess() } },
        },
        ...listFailures,
      },
    },
  },
  "/api/v1/notifications/{id}/read": {
    post: {
      tags: ["Notifications"],
      summary: "Mark one owned Notification read",
      security: [{ bearerAuth: [] }],
      parameters: [notificationIdParameter],
      responses: {
        "200": {
          description: "Notification read state is current.",
          content: {
            "application/json": {
              schema: success(openApiSchema(markNotificationReadResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/notifications/read-all": {
    post: {
      tags: ["Notifications"],
      summary: "Mark all owned Notifications read",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "All currently unread owned Notifications were marked read.",
          content: {
            "application/json": {
              schema: success(openApiSchema(markAllNotificationsReadResponseSchema)),
            },
          },
        },
        ...listFailures,
      },
    },
  },
  "/api/v1/notifications/preferences": {
    get: {
      tags: ["Notifications"],
      summary: "Get current user's Notification preferences",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Current editable Notification preferences.",
          content: {
            "application/json": {
              schema: success(openApiSchema(notificationPreferencesResponseSchema)),
            },
          },
        },
        ...listFailures,
      },
    },
    put: {
      tags: ["Notifications"],
      summary: "Replace current user's allowed Notification preferences",
      security: [{ bearerAuth: [] }],
      requestBody: body(updateNotificationPreferencesBodySchema),
      responses: {
        "200": {
          description: "Updated effective editable Notification preferences.",
          content: {
            "application/json": {
              schema: success(openApiSchema(notificationPreferencesResponseSchema)),
            },
          },
        },
        ...listFailures,
      },
    },
  },
  "/api/v1/admin/notification-deliveries": {
    get: {
      tags: ["Notifications"],
      summary: "List failed Notification deliveries",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminNotificationDeliveriesQuerySchema),
      responses: {
        "200": {
          description: "Privacy-safe failed-delivery queue.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(adminNotificationDeliveriesListDataSchema)),
            },
          },
        },
        ...listFailures,
      },
    },
  },
  "/api/v1/admin/notification-deliveries/{id}/retry": {
    post: {
      tags: ["Notifications"],
      summary: "Retry one failed Notification delivery",
      security: [{ bearerAuth: [] }],
      parameters: [deliveryIdParameter],
      responses: {
        "200": {
          description: "Delivery was queued for replay or was already in a replay-safe queued state.",
          content: {
            "application/json": {
              schema: success(openApiSchema(adminNotificationDeliveryResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;
