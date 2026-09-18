import { z } from "zod";
import {
  AUDIT_SORT_VALUES,
  DOCUMENT_AUDIT_LIMITS,
  DOCUMENT_PURPOSE_VALUES,
  DOCUMENT_RESOURCE_TYPE_PATTERN,
} from "../documents-audit.constants";

const optionalUuidText = z
  .string()
  .trim()
  .refine((value) => value === "" || z.uuid().safeParse(value).success, "Enter a valid UUID.");

/** Client form schema for selecting a file and one documented upload purpose. */
export const documentUploadFormSchema = z.object({
  file: z.custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "Choose a file to upload.",
  ),
  purpose: z.enum(DOCUMENT_PURPOSE_VALUES),
  linkToAccount: z.boolean(),
});

/** Client form schema for bounded audit filters; the API remains authoritative. */
export const auditFilterFormSchema = z
  .object({
    action: z.string().trim().max(DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH),
    resourceType: z
      .string()
      .trim()
      .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH)
      .refine(
        (value) => value === "" || DOCUMENT_RESOURCE_TYPE_PATTERN.test(value),
        "Use letters, numbers, dots, dashes, or underscores.",
      ),
    resourceId: z.string().trim().max(DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH),
    actorUserId: optionalUuidText,
    sellerId: optionalUuidText,
    from: z.string(),
    to: z.string(),
    sort: z.enum(AUDIT_SORT_VALUES),
  })
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to),
    { message: "From must be earlier than or equal to To.", path: ["from"] },
  );
