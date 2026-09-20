import { env } from "../../config/env.js";
import { S3ObjectStorage } from "../../common/storage/s3-storage.service.js";
import {
  DOCUMENT_PURPOSE_VALUES,
  type DocumentPurpose,
} from "./documents-audit.constants.js";
import {
  createDocumentUploadPolicy,
  DocumentsAuditService,
  type DocumentUploadPolicyInput,
} from "./documents-audit.service.js";
import type { DocumentResourcePolicy } from "./documents-audit.resource-policy.js";

type RawUploadPolicyRule = {
  allowedMimeTypes?: unknown;
  maxSizeBytes?: unknown;
};

/** Returns true when a parsed JSON value is a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one deployment-supplied Module 21 upload policy and rejects unknown/invalid keys. */
export function parseDocumentUploadPolicyJson(value: string): DocumentUploadPolicyInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("DOCUMENT_UPLOAD_POLICY_JSON must contain valid JSON.", { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new Error("DOCUMENT_UPLOAD_POLICY_JSON must contain a JSON object.");
  }

  const knownPurposes = new Set<string>(DOCUMENT_PURPOSE_VALUES);
  for (const purpose of Object.keys(parsed)) {
    if (!knownPurposes.has(purpose)) {
      throw new Error(`Unknown document upload purpose in DOCUMENT_UPLOAD_POLICY_JSON: ${purpose}.`);
    }
  }

  const input: Partial<Record<DocumentPurpose, { allowedMimeTypes: readonly string[]; maxSizeBytes: number }>> = {};

  for (const purpose of DOCUMENT_PURPOSE_VALUES) {
    const rawRule = parsed[purpose];
    if (rawRule === undefined) continue;
    if (!isRecord(rawRule)) {
      throw new Error(`Upload policy for ${purpose} must be an object.`);
    }

    const { allowedMimeTypes, maxSizeBytes } = rawRule as RawUploadPolicyRule;
    if (
      !Array.isArray(allowedMimeTypes) ||
      allowedMimeTypes.length === 0 ||
      !allowedMimeTypes.every((item) => typeof item === "string" && item.trim().length > 0)
    ) {
      throw new Error(`Upload policy for ${purpose} requires a non-empty allowedMimeTypes string array.`);
    }
    if (!Number.isSafeInteger(maxSizeBytes) || (maxSizeBytes as number) <= 0) {
      throw new Error(`Upload policy for ${purpose} requires a positive integer maxSizeBytes.`);
    }

    input[purpose] = {
      allowedMimeTypes,
      maxSizeBytes: maxSizeBytes as number,
    };
  }

  return input;
}

/** Builds the production Module 21 service from validated shared infrastructure and optional composed resource policy. */
export function createDocumentsAuditServiceFromEnvironment(
  resourcePolicy?: DocumentResourcePolicy,
): DocumentsAuditService {
  return new DocumentsAuditService({
    storage: new S3ObjectStorage(),
    uploadPolicy: createDocumentUploadPolicy(
      parseDocumentUploadPolicyJson(env.DOCUMENT_UPLOAD_POLICY_JSON),
    ),
    storageProvider: env.STORAGE_PROVIDER,
    ...(resourcePolicy ? { resourcePolicy } : {}),
  });
}
