import { Router } from "express";
import { PAGINATION } from "../../common/constants/pagination.js";
import { USER_STATUS_VALUES } from "../administration/administration.constants.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import {
  CUSTOMER_ADDRESS_STATUS_VALUES,
  CUSTOMER_LIMITS,
  CUSTOMER_PATTERN,
  CUSTOMER_PERMISSION,
  CUSTOMER_PROFILE_STATUS_VALUES,
  CUSTOMER_SORT,
  CUSTOMER_SORT_VALUES,
} from "./customers.constants.js";
import { CustomersController } from "./customers.controller.js";

/** Creates customer self-service routes with explicit route-level permission checks. */
export function createCustomersRouter(
  controller: CustomersController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/me",
    requirePermission(CUSTOMER_PERMISSION.PROFILE_READ_OWN),
    controller.getMyProfile,
  );
  router.patch(
    "/me",
    requirePermission(CUSTOMER_PERMISSION.PROFILE_UPDATE_OWN),
    controller.updateMyProfile,
  );
  router.get(
    "/me/addresses",
    requirePermission(CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN),
    controller.listMyAddresses,
  );
  router.post(
    "/me/addresses",
    requirePermission(CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN),
    controller.createMyAddress,
  );
  router.patch(
    "/me/addresses/:id",
    requirePermission(CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN),
    controller.updateMyAddress,
  );
  router.delete(
    "/me/addresses/:id",
    requirePermission(CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN),
    controller.archiveMyAddress,
  );

  return router;
}

/** Creates privileged customer read routes without moving customer business logic into Administration. */
export function createAdminCustomersRouter(
  controller: CustomersController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ),
    controller.listCustomersForAdmin,
  );
  router.get(
    "/:id",
    requirePermission(CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ),
    controller.getCustomerForAdmin,
  );

  return router;
}


const requestId = { type: "string" } as const;

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

const paginationMeta = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: PAGINATION.MAX_PAGE_SIZE },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Builds the standard success envelope used by Module 3 OpenAPI contracts. */
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

/** Wraps a JSON schema as a required application/json request body. */
function body(schema: object) {
  return {
    required: true,
    content: {
      "application/json": { schema },
    },
  } as const;
}

const idPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

const phone = {
  type: "string",
  minLength: 3,
  maxLength: CUSTOMER_LIMITS.PHONE_MAX_LENGTH,
  pattern: CUSTOMER_PATTERN.PHONE,
} as const;

const countryCode = {
  type: "string",
  minLength: CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH,
  maxLength: CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH,
  pattern: CUSTOMER_PATTERN.COUNTRY_CODE,
  description: "Two-letter country code. The server normalizes it to uppercase.",
} as const;

const customerProfile = {
  type: "object",
  additionalProperties: false,
  required: [
    "userId",
    "displayName",
    "phone",
    "status",
    "marketingOptIn",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    userId: { type: "string", format: "uuid" },
    displayName: {
      type: "string",
      minLength: 1,
      maxLength: CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH,
    },
    phone: {
      anyOf: [phone, { type: "null" }],
    },
    status: { type: "string", enum: CUSTOMER_PROFILE_STATUS_VALUES },
    marketingOptIn: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const customerAddress = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "customerUserId",
    "label",
    "recipientName",
    "phone",
    "line1",
    "line2",
    "city",
    "region",
    "postalCode",
    "countryCode",
    "isDefaultShipping",
    "isDefaultBilling",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    customerUserId: { type: "string", format: "uuid" },
    label: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LABEL_MAX_LENGTH },
    recipientName: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.RECIPIENT_NAME_MAX_LENGTH },
    phone,
    line1: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH },
    line2: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH },
        { type: "null" },
      ],
    },
    city: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.CITY_MAX_LENGTH },
    region: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.REGION_MAX_LENGTH },
    postalCode: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.POSTAL_CODE_MAX_LENGTH },
        { type: "null" },
      ],
    },
    countryCode: {
      type: "string",
      minLength: CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH,
      maxLength: CUSTOMER_LIMITS.COUNTRY_CODE_LENGTH,
      pattern: "^[A-Z]{2}$",
    },
    isDefaultShipping: { type: "boolean" },
    isDefaultBilling: { type: "boolean" },
    status: { type: "string", enum: CUSTOMER_ADDRESS_STATUS_VALUES },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const editableAddressProperties = {
  label: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LABEL_MAX_LENGTH },
  recipientName: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.RECIPIENT_NAME_MAX_LENGTH },
  phone,
  line1: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH },
  line2: {
    anyOf: [
      { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.ADDRESS_LINE_MAX_LENGTH },
      { type: "null" },
    ],
  },
  city: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.CITY_MAX_LENGTH },
  region: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.REGION_MAX_LENGTH },
  postalCode: {
    anyOf: [
      { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.POSTAL_CODE_MAX_LENGTH },
      { type: "null" },
    ],
  },
  countryCode,
  isDefaultShipping: { type: "boolean" },
  isDefaultBilling: { type: "boolean" },
} as const;

const adminCustomerListItem = {
  type: "object",
  additionalProperties: false,
  required: [
    "userId",
    "email",
    "accountStatus",
    "profileStatus",
    "displayName",
    "phone",
    "marketingOptIn",
    "addressCount",
    "createdAt",
  ],
  properties: {
    userId: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    accountStatus: { type: "string", enum: USER_STATUS_VALUES },
    profileStatus: { type: "string", enum: CUSTOMER_PROFILE_STATUS_VALUES },
    displayName: { type: "string", minLength: 1, maxLength: CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH },
    phone: { anyOf: [phone, { type: "null" }] },
    marketingOptIn: { type: "boolean" },
    addressCount: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const adminCustomerDetail = {
  type: "object",
  additionalProperties: false,
  required: ["customer", "addresses"],
  properties: {
    customer: adminCustomerListItem,
    addresses: { type: "array", items: customerAddress },
  },
} as const;

const authFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Required permission or resource policy denied.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const validationFailure = {
  "422": {
    description: "Request validation failed.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const notFoundFailure = {
  "404": {
    description: "Customer/address resource was not found or is not visible in the current private scope.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const conflictFailure = {
  "409": {
    description: "The requested customer/address state conflicts with an existing invariant.",
    content: { "application/json": { schema: failure } },
  },
} as const;

/**
 * Module 3 OpenAPI path contracts.
 * The application registers these paths only after controller/routes and RBAC middleware exist.
 */
export const customersOpenApiPaths = {
  "/api/v1/customers/me": {
    get: {
      tags: ["Customers"],
      summary: "Get current customer profile",
      operationId: "getCurrentCustomerProfile",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Authenticated customer's commerce profile.",
          content: { "application/json": { schema: success(customerProfile) } },
        },
        ...authFailures,
        ...notFoundFailure,
      },
    },
    patch: {
      tags: ["Customers"],
      summary: "Update current customer profile",
      operationId: "updateCurrentCustomerProfile",
      description: "Ownership, account authority, and customer status are derived server-side.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          displayName: {
            type: "string",
            minLength: 1,
            maxLength: CUSTOMER_LIMITS.DISPLAY_NAME_MAX_LENGTH,
          },
          phone: { anyOf: [phone, { type: "null" }] },
          marketingOptIn: { type: "boolean" },
        },
      }),
      responses: {
        "200": {
          description: "Updated customer profile.",
          content: { "application/json": { schema: success(customerProfile) } },
        },
        ...authFailures,
        ...validationFailure,
        ...notFoundFailure,
      },
    },
  },
  "/api/v1/customers/me/addresses": {
    get: {
      tags: ["Customers"],
      summary: "List current customer's saved addresses",
      operationId: "listCurrentCustomerAddresses",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Active and policy-visible saved addresses owned by the authenticated customer.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: customerAddress }),
            },
          },
        },
        ...authFailures,
        ...notFoundFailure,
      },
    },
    post: {
      tags: ["Customers"],
      summary: "Create saved customer address",
      operationId: "createCurrentCustomerAddress",
      description: "The customer owner ID and address lifecycle status are derived server-side.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "recipientName",
          "phone",
          "line1",
          "city",
          "region",
          "countryCode",
        ],
        properties: editableAddressProperties,
      }),
      responses: {
        "201": {
          description: "Saved customer address created.",
          content: { "application/json": { schema: success(customerAddress) } },
        },
        ...authFailures,
        ...validationFailure,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/customers/me/addresses/{id}": {
    patch: {
      tags: ["Customers"],
      summary: "Update saved customer address",
      operationId: "updateCurrentCustomerAddress",
      description: "The service must repeat ownership checks before writing the private address.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: editableAddressProperties,
      }),
      responses: {
        "200": {
          description: "Saved customer address updated.",
          content: { "application/json": { schema: success(customerAddress) } },
        },
        ...authFailures,
        ...validationFailure,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
    delete: {
      tags: ["Customers"],
      summary: "Archive saved customer address",
      operationId: "archiveCurrentCustomerAddress",
      description: "Archives an unused saved address; historical commerce references are never hard-deleted.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      responses: {
        "200": {
          description: "Saved customer address archived.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["archived"],
                properties: { archived: { const: true } },
              }),
            },
          },
        },
        ...authFailures,
        ...validationFailure,
        ...notFoundFailure,
      },
    },
  },
  "/api/v1/admin/customers": {
    get: {
      tags: ["Customers"],
      summary: "Search customers",
      operationId: "listCustomersForAdmin",
      description: "Requires admin.customers.read. Results contain Module 2/3 data only until downstream commerce modules exist.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, default: PAGINATION.DEFAULT_PAGE },
        },
        {
          name: "pageSize",
          in: "query",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: PAGINATION.MAX_PAGE_SIZE,
            default: PAGINATION.DEFAULT_PAGE_SIZE,
          },
        },
        {
          name: "search",
          in: "query",
          schema: { type: "string", maxLength: CUSTOMER_LIMITS.SEARCH_MAX_LENGTH },
        },
        {
          name: "profileStatus",
          in: "query",
          schema: { type: "string", enum: CUSTOMER_PROFILE_STATUS_VALUES },
        },
        {
          name: "accountStatus",
          in: "query",
          schema: { type: "string", enum: USER_STATUS_VALUES },
        },
        {
          name: "sort",
          in: "query",
          schema: {
            type: "string",
            enum: CUSTOMER_SORT_VALUES,
            default: CUSTOMER_SORT.CREATED_DESC,
          },
        },
      ],
      responses: {
        "200": {
          description: "Permission-scoped paginated customer results.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: adminCustomerListItem }, true),
            },
          },
        },
        ...authFailures,
        ...validationFailure,
      },
    },
  },
  "/api/v1/admin/customers/{id}": {
    get: {
      tags: ["Customers"],
      summary: "Get customer commerce summary",
      operationId: "getCustomerForAdmin",
      description: "Returns only currently implemented Module 2/3 account, profile, and address data. Orders remain owned by Module 11.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      responses: {
        "200": {
          description: "Permission-scoped customer detail.",
          content: { "application/json": { schema: success(adminCustomerDetail) } },
        },
        ...authFailures,
        ...validationFailure,
        ...notFoundFailure,
      },
    },
  },
} as const;
