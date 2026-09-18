import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  AUDIT_SORT,
  AUDIT_SORT_VALUES,
  DOCUMENT_AUDIT_ACTOR_TYPE_VALUES,
  DOCUMENT_AUDIT_LIMITS,
  DOCUMENT_AUDIT_PATTERN,
  DOCUMENT_FILE_STATUS_VALUES,
  DOCUMENT_PURPOSE_VALUES,
} from "./documents-audit.constants.js";

const normalizedResourceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH)
  .regex(new RegExp(DOCUMENT_AUDIT_PATTERN.RESOURCE_TYPE), "Invalid resource type")
  .transform((value) => value.toLowerCase());

const normalizedMimeTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(DOCUMENT_AUDIT_LIMITS.MIME_TYPE_MAX_LENGTH)
  .regex(new RegExp(DOCUMENT_AUDIT_PATTERN.MIME_TYPE), "Invalid MIME type")
  .transform((value) => value.toLowerCase());

/** Request body for creating one constrained signed-upload grant. */
export const signUploadBodySchema = z
  .object({
    originalName: z
      .string()
      .trim()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.ORIGINAL_NAME_MAX_LENGTH),
    mimeType: normalizedMimeTypeSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(DOCUMENT_AUDIT_LIMITS.SIZE_BYTES_MAX),
    purpose: z.enum(DOCUMENT_PURPOSE_VALUES),
  })
  .strict();

/** Path parameter shared by document commands and reads. */
export const documentIdParamsSchema = z.object({ id: uuidSchema }).strict();

/** Upload-confirmation path contract. */
export const confirmUploadParamsSchema = documentIdParamsSchema;

/** Link-file path contract. */
export const linkFileParamsSchema = documentIdParamsSchema;

/** Request body for linking a confirmed file to an authorized business resource. */
export const linkFileBodySchema = z
  .object({
    resourceType: normalizedResourceTypeSchema,
    resourceId: uuidSchema,
    purpose: z.enum(DOCUMENT_PURPOSE_VALUES),
  })
  .strict();

/** Path contract for removing one active file link. */
export const unlinkFileParamsSchema = z
  .object({
    id: uuidSchema,
    linkId: uuidSchema,
  })
  .strict();

/** Audit-entry path contract. */
export const auditIdParamsSchema = z.object({ id: uuidSchema }).strict();

/** Permission-filtered, bounded audit search query. */
export const auditListQuerySchema = paginationQuerySchema
  .extend({
    actorUserId: uuidSchema.optional(),
    action: z
      .string()
      .trim()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH)
      .optional(),
    resourceType: normalizedResourceTypeSchema.optional(),
    resourceId: z
      .string()
      .trim()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH)
      .optional(),
    sellerId: uuidSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    sort: z.enum(AUDIT_SORT_VALUES).default(AUDIT_SORT.CREATED_DESC),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to),
    {
      message: "from must be earlier than or equal to to",
      path: ["from"],
    },
  );

/** Safe file metadata returned by Module 21. Storage object keys are deliberately absent. */
export const documentFileResponseSchema = z
  .object({
    id: uuidSchema,
    originalName: z
      .string()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.ORIGINAL_NAME_MAX_LENGTH),
    mimeType: normalizedMimeTypeSchema,
    sizeBytes: z.number().int().positive(),
    status: z.enum(DOCUMENT_FILE_STATUS_VALUES),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Signed upload response. Storage credentials and raw provider configuration are never exposed. */
export const signedUploadResponseSchema = z
  .object({
    fileId: uuidSchema,
    uploadUrl: z.url(),
    expiresAt: isoDateTimeSchema,
    requiredHeaders: z.record(z.string(), z.string()),
  })
  .strict();

/** Successful upload-confirmation response. */
export const confirmUploadResponseSchema = z
  .object({
    file: documentFileResponseSchema,
  })
  .strict();

/** Safe file-link representation. */
export const fileLinkResponseSchema = z
  .object({
    id: uuidSchema,
    fileId: uuidSchema,
    resourceType: normalizedResourceTypeSchema,
    resourceId: uuidSchema,
    purpose: z.enum(DOCUMENT_PURPOSE_VALUES),
    createdBy: uuidSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Successful link command response. */
export const linkFileResponseSchema = z
  .object({
    link: fileLinkResponseSchema,
  })
  .strict();

/** Short-lived, permission-checked download grant. Object keys remain server-side. */
export const signedDownloadResponseSchema = z
  .object({
    file: documentFileResponseSchema,
    downloadUrl: z.url(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

/** Successful unlink command response. */
export const unlinkFileResponseSchema = z
  .object({
    unlinked: z.literal(true),
  })
  .strict();

/** Safe audit-list row. Detailed before/after values are reserved for the detail endpoint. */
export const auditLogSummarySchema = z
  .object({
    id: uuidSchema,
    actorUserId: uuidSchema.nullable(),
    actorType: z.enum(DOCUMENT_AUDIT_ACTOR_TYPE_VALUES),
    action: z
      .string()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH),
    resourceType: z
      .string()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH),
    resourceId: z
      .string()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH)
      .nullable(),
    sellerId: uuidSchema.nullable(),
    requestId: z
      .string()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.REQUEST_ID_MAX_LENGTH)
      .nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Safe audit detail containing already-redacted before/after snapshots. */
export const auditLogDetailSchema = auditLogSummarySchema.extend({
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});

/** Inferred request/response types stay beside their Zod source of truth. */
export type SignUploadInput = z.infer<typeof signUploadBodySchema>;
export type SignedUploadResponse = z.infer<typeof signedUploadResponseSchema>;
export type ConfirmUploadResponse = z.infer<typeof confirmUploadResponseSchema>;
export type LinkFileInput = z.infer<typeof linkFileBodySchema>;
export type LinkFileResponse = z.infer<typeof linkFileResponseSchema>;
export type UnlinkFileResponse = z.infer<typeof unlinkFileResponseSchema>;
export type DocumentFileResponse = z.infer<typeof documentFileResponseSchema>;
export type FileLinkResponse = z.infer<typeof fileLinkResponseSchema>;
export type SignedDownloadResponse = z.infer<typeof signedDownloadResponseSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditLogSummary = z.infer<typeof auditLogSummarySchema>;
export type AuditLogDetail = z.infer<typeof auditLogDetailSchema>;
