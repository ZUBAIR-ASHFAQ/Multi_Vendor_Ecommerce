import { randomUUID } from "node:crypto";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type {
  ObjectStorage,
  SignedDownloadRequest,
  SignedUploadRequest,
  SignedUrlResult,
  StoredObjectMetadata,
  StoredObjectWriteRequest,
} from "../../src/common/storage/storage.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type {
  AuditLogRow,
  FileLinkRow,
  FileRow,
} from "../../src/database/schema/index.js";
import {
  DOCUMENT_FILE_STATUS,
  DOCUMENT_PURPOSE,
  DOCUMENT_STORAGE_PROVIDER,
} from "../../src/modules/documents-audit/documents-audit.constants.js";
import { DocumentsAuditRepository } from "../../src/modules/documents-audit/documents-audit.repository.js";
import { createDocumentUploadPolicy } from "../../src/modules/documents-audit/documents-audit.service.js";

const ONE_MEGABYTE = 1024 * 1024;

/** In-memory storage adapter used by Module 21 tests so no real S3/R2 request is made. */
export class FakeObjectStorage implements ObjectStorage {
  readonly uploadRequests: SignedUploadRequest[] = [];
  readonly putRequests: StoredObjectWriteRequest[] = [];
  readonly downloadRequests: SignedDownloadRequest[] = [];
  readonly deleteRequests: string[] = [];
  readonly metadataRequests: string[] = [];
  readonly metadata = new Map<string, StoredObjectMetadata | null>();
  uploadError: Error | null = null;
  downloadError: Error | null = null;
  metadataError: Error | null = null;

  /** Returns the most recently server-generated object key requested for upload. */
  get latestUploadObjectKey(): string | null {
    return this.uploadRequests.at(-1)?.objectKey ?? null;
  }

  /** Records one signed-upload request and returns a deterministic test URL. */
  async createSignedUpload(request: SignedUploadRequest): Promise<SignedUrlResult> {
    if (this.uploadError) throw this.uploadError;
    this.uploadRequests.push(request);
    return {
      url: `https://storage.test/upload/${encodeURIComponent(request.objectKey)}`,
      objectKey: request.objectKey,
      expiresAt: new Date(Date.now() + 300_000),
    };
  }

  /** Stores one server-written object and returns deterministic provider metadata. */
  async putObject(request: StoredObjectWriteRequest): Promise<StoredObjectMetadata> {
    this.putRequests.push(request);

    const metadata: StoredObjectMetadata = {
      contentType: request.contentType,
      contentLength: request.body.byteLength,
      checksum: null,
    };

    this.metadata.set(request.objectKey, metadata);
    return metadata;
  }

  /** Records one signed-download request and returns a deterministic test URL. */
  async createSignedDownload(request: SignedDownloadRequest): Promise<SignedUrlResult> {
    if (this.downloadError) throw this.downloadError;
    this.downloadRequests.push(request);
    return {
      url: `https://storage.test/download/${encodeURIComponent(request.objectKey)}`,
      objectKey: request.objectKey,
      expiresAt: new Date(Date.now() + 300_000),
    };
  }

  /** Records physical delete attempts so unlink tests can prove object history is preserved. */
  async deleteObject(objectKey: string): Promise<void> {
    this.deleteRequests.push(objectKey);
  }

  /** Returns configured provider metadata or throws one configured provider failure. */
  async getObjectMetadata(objectKey: string): Promise<StoredObjectMetadata | null> {
    this.metadataRequests.push(objectKey);
    if (this.metadataError) throw this.metadataError;
    return this.metadata.get(objectKey) ?? null;
  }

  /** Reports whether provider metadata exists for one object. */
  async objectExists(objectKey: string): Promise<boolean> {
    return (await this.getObjectMetadata(objectKey)) !== null;
  }

  /** Configures provider metadata for one object created by a signed upload. */
  setMetadata(objectKey: string, metadata: StoredObjectMetadata): void {
    this.metadata.set(objectKey, metadata);
  }
}

/** Builds a fail-closed test policy with one explicitly enabled upload purpose. */
export function testUploadPolicy() {
  return createDocumentUploadPolicy({
    [DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE]: {
      allowedMimeTypes: ["application/pdf"],
      maxSizeBytes: ONE_MEGABYTE,
    },
  });
}

/** Creates a request context without touching authentication persistence for focused service tests. */
export function testContext(
  actorId: string,
  permissions: readonly string[],
  options: {
    actorType?: RequestContext["actorType"];
    sellerIds?: readonly string[];
    sellerPermissions?: ReadonlyMap<string, ReadonlySet<PermissionCode>>;
  } = {},
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: options.actorType ?? ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions as PermissionCode[]),
    sellerIds: new Set(options.sellerIds ?? []),
    storeIds: new Set(),
    sellerPermissions: options.sellerPermissions ?? new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates a complete persisted file row for service tests that do not require PostgreSQL. */
export function testFileRow(
  ownerUserId: string,
  overrides: Partial<FileRow> = {},
): FileRow {
  return {
    id: randomUUID(),
    storageProvider: DOCUMENT_STORAGE_PROVIDER.S3_COMPATIBLE,
    objectKey: `${DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE}/2026-09-03/${randomUUID()}-proof.pdf`,
    purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
    originalName: "proof.pdf",
    mimeType: "application/pdf",
    sizeBytes: 512,
    checksum: null,
    ownerUserId,
    status: DOCUMENT_FILE_STATUS.CONFIRMED,
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
    ...overrides,
  };
}

/** Creates one complete file-link row for focused service authorization tests. */
export function testFileLinkRow(
  fileId: string,
  createdBy: string,
  overrides: Partial<FileLinkRow> = {},
): FileLinkRow {
  return {
    id: randomUUID(),
    fileId,
    resourceType: "user",
    resourceId: createdBy,
    purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
    createdBy,
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
    ...overrides,
  };
}

/** Creates a complete audit row for service redaction tests. */
export function testAuditRow(sellerId: string | null, after: unknown): AuditLogRow {
  return {
    id: randomUUID(),
    actorUserId: randomUUID(),
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    action: "test.secret_write",
    resourceType: "test_resource",
    resourceId: randomUUID(),
    sellerId,
    requestId: randomUUID(),
    beforeJsonRedacted: null,
    afterJsonRedacted: after,
    metadata: null,
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
  };
}

/** Returns a partial repository cast suitable for focused service unit tests. */
export function repositoryStub(
  overrides: Partial<Record<keyof DocumentsAuditRepository, unknown>>,
): DocumentsAuditRepository {
  return overrides as unknown as DocumentsAuditRepository;
}

