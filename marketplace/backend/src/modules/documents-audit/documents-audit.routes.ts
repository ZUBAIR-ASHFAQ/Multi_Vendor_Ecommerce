import { Router } from "express";
import { PAGINATION } from "../../common/constants/pagination.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import {
  AUDIT_SORT,
  AUDIT_SORT_VALUES,
  DOCUMENT_AUDIT_ACTOR_TYPE_VALUES,
  DOCUMENT_AUDIT_LIMITS,
  DOCUMENT_AUDIT_PATTERN,
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_FILE_STATUS_VALUES,
  DOCUMENT_PURPOSE_VALUES,
} from "./documents-audit.constants.js";
import { DocumentsAuditController } from "./documents-audit.controller.js";

/** Creates the five required document command/read routes with route-level RBAC prechecks. */
export function createDocumentsRouter(
  controller: DocumentsAuditController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/uploads/sign",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD),
    controller.signUpload,
  );
  router.post(
    "/uploads/:id/confirm",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD),
    controller.confirmUpload,
  );
  router.post(
    "/:id/link",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK),
    controller.linkFile,
  );
  router.get(
    "/:id/download",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ),
    controller.getDownload,
  );
  router.delete(
    "/:id/link/:linkId",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK),
    controller.unlinkFile,
  );

  return router;
}

/** Creates the two required append-only audit read routes with route-level RBAC prechecks. */
export function createAuditRouter(
  controller: DocumentsAuditController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.AUDIT_READ),
    controller.listAuditLogs,
  );
  router.get(
    "/:id",
    requirePermission(DOCUMENT_AUDIT_PERMISSION.AUDIT_READ),
    controller.getAuditLog,
  );

  return router;
}

const requestId = { type: "string", minLength: 1 } as const;

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

const failure = {
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
        details: {},
      },
    },
    requestId,
  },
} as const;

const documentPurpose = {
  type: "string",
  enum: DOCUMENT_PURPOSE_VALUES,
} as const;

const documentFile = {
  type: "object",
  additionalProperties: false,
  required: ["id", "originalName", "mimeType", "sizeBytes", "status", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    originalName: {
      type: "string",
      minLength: 1,
      maxLength: DOCUMENT_AUDIT_LIMITS.ORIGINAL_NAME_MAX_LENGTH,
    },
    mimeType: {
      type: "string",
      minLength: 3,
      maxLength: DOCUMENT_AUDIT_LIMITS.MIME_TYPE_MAX_LENGTH,
      pattern: DOCUMENT_AUDIT_PATTERN.MIME_TYPE,
    },
    sizeBytes: {
      type: "integer",
      minimum: 1,
      maximum: DOCUMENT_AUDIT_LIMITS.SIZE_BYTES_MAX,
    },
    status: { type: "string", enum: DOCUMENT_FILE_STATUS_VALUES },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const fileLink = {
  type: "object",
  additionalProperties: false,
  required: ["id", "fileId", "resourceType", "resourceId", "purpose", "createdBy", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    fileId: { type: "string", format: "uuid" },
    resourceType: {
      type: "string",
      minLength: 1,
      maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH,
      pattern: DOCUMENT_AUDIT_PATTERN.RESOURCE_TYPE,
    },
    resourceId: { type: "string", format: "uuid" },
    purpose: documentPurpose,
    createdBy: { type: "string", format: "uuid" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const auditSummary = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "actorUserId",
    "actorType",
    "action",
    "resourceType",
    "resourceId",
    "sellerId",
    "requestId",
    "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    actorUserId: { type: ["string", "null"], format: "uuid" },
    actorType: { type: "string", enum: DOCUMENT_AUDIT_ACTOR_TYPE_VALUES },
    action: {
      type: "string",
      minLength: 1,
      maxLength: DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH,
    },
    resourceType: {
      type: "string",
      minLength: 1,
      maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH,
    },
    resourceId: {
      type: ["string", "null"],
      maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH,
    },
    sellerId: { type: ["string", "null"], format: "uuid" },
    requestId: {
      type: ["string", "null"],
      maxLength: DOCUMENT_AUDIT_LIMITS.REQUEST_ID_MAX_LENGTH,
    },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const auditDetail = {
  ...auditSummary,
  required: [...auditSummary.required, "before", "after"],
  properties: {
    ...auditSummary.properties,
    before: {},
    after: {},
  },
} as const;

/** Builds the standard success envelope with the HTTP request ID always present. */
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

/** Wraps one JSON schema as a required OpenAPI JSON request body. */
function body(schema: object) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

const idPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

const linkIdParameter = {
  name: "linkId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

const baseFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Required permission or resource scope denied.",
    content: { "application/json": { schema: failure } },
  },
  "422": {
    description: "Request or business validation failed.",
    content: { "application/json": { schema: failure } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failure } },
  },
  "500": {
    description: "Unexpected server error with a safe public message.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const requestBodyFailures = {
  "400": {
    description: "Request body contains invalid JSON.",
    content: { "application/json": { schema: failure } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP body limit.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const notFoundFailure = {
  "404": {
    description: "Resource not found or safely hidden by resource policy.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const conflictFailure = {
  "409": {
    description: "Document lifecycle or link state conflicts with the requested command.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const serviceUnavailableFailure = {
  "503": {
    description: "Required object-storage operation is temporarily unavailable.",
    content: { "application/json": { schema: failure } },
  },
} as const;

/** Active OpenAPI paths for the seven Module 21 HTTP endpoints. */
export const documentsAuditOpenApiPaths = {
  "/api/v1/documents/uploads/sign": {
    post: {
      tags: ["Documents"],
      summary: "Create constrained signed upload",
      operationId: "signDocumentUpload",
      description:
        "Requires documents.upload. Purpose, MIME type and size are validated against deployment " +
        "policy; ownership and object key are server-derived.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["originalName", "mimeType", "sizeBytes", "purpose"],
        properties: {
          originalName: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_AUDIT_LIMITS.ORIGINAL_NAME_MAX_LENGTH,
          },
          mimeType: {
            type: "string",
            minLength: 3,
            maxLength: DOCUMENT_AUDIT_LIMITS.MIME_TYPE_MAX_LENGTH,
            pattern: DOCUMENT_AUDIT_PATTERN.MIME_TYPE,
          },
          sizeBytes: {
            type: "integer",
            minimum: 1,
            maximum: DOCUMENT_AUDIT_LIMITS.SIZE_BYTES_MAX,
          },
          purpose: documentPurpose,
        },
      }),
      responses: {
        "201": {
          description: "Pending file metadata and short-lived upload grant created.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["fileId", "uploadUrl", "expiresAt", "requiredHeaders"],
                properties: {
                  fileId: { type: "string", format: "uuid" },
                  uploadUrl: { type: "string", format: "uri" },
                  expiresAt: { type: "string", format: "date-time" },
                  requiredHeaders: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
              }),
            },
          },
        },
        ...baseFailures,
        ...requestBodyFailures,
        ...serviceUnavailableFailure,
      },
    },
  },
  "/api/v1/documents/uploads/{id}/confirm": {
    post: {
      tags: ["Documents"],
      summary: "Confirm uploaded object metadata",
      operationId: "confirmDocumentUpload",
      description:
        "Requires documents.upload. Provider metadata is verified before pending file metadata is confirmed. " +
        "The command has no request body because provider metadata is authoritative.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      responses: {
        "200": {
          description: "Upload verified and confirmed.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["file"],
                properties: { file: documentFile },
              }),
            },
          },
        },
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
        ...serviceUnavailableFailure,
      },
    },
  },
  "/api/v1/documents/{id}/link": {
    post: {
      tags: ["Documents"],
      summary: "Link file to authorized resource",
      operationId: "linkDocumentFile",
      description: "Requires documents.link. The service rechecks file ownership and linked-resource policy.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["resourceType", "resourceId", "purpose"],
        properties: {
          resourceType: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH,
            pattern: DOCUMENT_AUDIT_PATTERN.RESOURCE_TYPE,
          },
          resourceId: { type: "string", format: "uuid" },
          purpose: documentPurpose,
        },
      }),
      responses: {
        "201": {
          description: "File linked to the authorized resource.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["link"],
                properties: { link: fileLink },
              }),
            },
          },
        },
        ...baseFailures,
        ...requestBodyFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/documents/{id}/download": {
    get: {
      tags: ["Documents"],
      summary: "Create permission-checked signed download",
      operationId: "createDocumentDownload",
      description: "Requires documents.read. A short-lived signed URL is returned only after file/resource authorization.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      responses: {
        "200": {
          description: "Short-lived download grant for the authorized file.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["file", "downloadUrl", "expiresAt"],
                properties: {
                  file: documentFile,
                  downloadUrl: { type: "string", format: "uri" },
                  expiresAt: { type: "string", format: "date-time" },
                },
              }),
            },
          },
        },
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
        ...serviceUnavailableFailure,
      },
    },
  },
  "/api/v1/documents/{id}/link/{linkId}": {
    delete: {
      tags: ["Documents"],
      summary: "Remove active file link",
      operationId: "unlinkDocumentFile",
      description: "Requires documents.link. Unlinking does not automatically delete the physical object.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter, linkIdParameter],
      responses: {
        "200": {
          description: "File link removed.",
          content: {
            "application/json": {
              schema: success({
                type: "object",
                additionalProperties: false,
                required: ["unlinked"],
                properties: { unlinked: { const: true } },
              }),
            },
          },
        },
        ...baseFailures,
        ...notFoundFailure,
      },
    },
  },
  "/api/v1/audit": {
    get: {
      tags: ["Audit"],
      summary: "Search audit records",
      operationId: "listAuditLogs",
      description: "Requires audit.read. Seller scope is derived server-side and cannot be widened by query parameters.",
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
        { name: "actorUserId", in: "query", schema: { type: "string", format: "uuid" } },
        {
          name: "action",
          in: "query",
          schema: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH,
          },
        },
        {
          name: "resourceType",
          in: "query",
          schema: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH,
            pattern: DOCUMENT_AUDIT_PATTERN.RESOURCE_TYPE,
          },
        },
        {
          name: "resourceId",
          in: "query",
          schema: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH,
          },
        },
        { name: "sellerId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
        { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
        {
          name: "sort",
          in: "query",
          schema: {
            type: "string",
            enum: AUDIT_SORT_VALUES,
            default: AUDIT_SORT.CREATED_DESC,
          },
        },
      ],
      responses: {
        "200": {
          description: "Permission-filtered paginated audit records.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: auditSummary }, true),
            },
          },
        },
        ...baseFailures,
      },
    },
  },
  "/api/v1/audit/{id}": {
    get: {
      tags: ["Audit"],
      summary: "Read audit entry detail",
      operationId: "getAuditLog",
      description: "Requires audit.read. Returns only an authorized record with redacted snapshots.",
      security: [{ bearerAuth: [] }],
      parameters: [idPathParameter],
      responses: {
        "200": {
          description: "Authorized audit entry detail with redacted snapshots.",
          content: { "application/json": { schema: success(auditDetail) } },
        },
        ...baseFailures,
        ...notFoundFailure,
      },
    },
  },
} as const;
