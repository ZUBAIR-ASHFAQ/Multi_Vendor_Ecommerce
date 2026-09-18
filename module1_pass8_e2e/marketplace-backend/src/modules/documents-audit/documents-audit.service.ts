import type { AuditLogRow, FileLinkRow, FileRow } from "../../database/schema/index.js";
import { withTransaction } from "../../database/transaction.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { redactAuditValue } from "../../common/audit/audit-redaction.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { createObjectKey } from "../../common/storage/object-key.js";
import type {
  ObjectStorage,
  SignedUrlResult,
  StoredObjectMetadata,
} from "../../common/storage/storage.contract.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import {
  DOCUMENT_AUDIT_ERROR_CODE,
  DOCUMENT_AUDIT_OUTBOX_EVENT,
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_FILE_STATUS,
  DOCUMENT_PURPOSE_VALUES,
  DOCUMENT_STORAGE_PROVIDER,
  type DocumentPurpose,
  type DocumentStorageProvider,
} from "./documents-audit.constants.js";
import {
  DocumentsAuditRepository,
  type AuditReadScope,
} from "./documents-audit.repository.js";
import {
  CurrentDocumentResourcePolicy,
  type AuthorizedDocumentResource,
  type DocumentResourceAction,
  type DocumentResourcePolicy,
} from "./documents-audit.resource-policy.js";
import type {
  AuditListQuery,
  AuditLogDetail,
  AuditLogSummary,
  ConfirmUploadResponse,
  DocumentFileResponse,
  FileLinkResponse,
  LinkFileInput,
  LinkFileResponse,
  SignedDownloadResponse,
  SignedUploadResponse,
  SignUploadInput,
  UnlinkFileResponse,
} from "./documents-audit.schema.js";

/** One explicit upload rule. Exact MIME/size values are deployment policy, not invented by Module 21. */
export interface DocumentUploadRule {
  allowedMimeTypes: ReadonlySet<string>;
  maxSizeBytes: number;
}

/** Purpose-scoped allow-list. Missing purposes fail closed. */
export type DocumentUploadPolicy = Readonly<
  Partial<Record<DocumentPurpose, DocumentUploadRule>>
>;

/** Friendly input for building a normalized upload policy outside the service. */
export type DocumentUploadPolicyInput = Readonly<
  Partial<
    Record<
      DocumentPurpose,
      {
        allowedMimeTypes: readonly string[];
        maxSizeBytes: number;
      }
    >
  >
>;

/** Transaction runner injected so service tests can exercise orchestration without the root database. */
export type DocumentsAuditTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Dependencies required by the Module 21 application service. */
export interface DocumentsAuditServiceDependencies {
  storage: ObjectStorage;
  uploadPolicy: DocumentUploadPolicy;
  repository?: DocumentsAuditRepository;
  resourcePolicy?: DocumentResourcePolicy;
  transactionRunner?: DocumentsAuditTransactionRunner;
  storageProvider?: DocumentStorageProvider;
}

/** Trusted server-generated file input used by downstream background jobs such as report exports. */
export interface GeneratedDocumentInput {
  ownerUserId: string;
  purpose: DocumentPurpose;
  originalName: string;
  mimeType: string;
  body: Uint8Array;
}

/** Safe metadata returned after one server-generated file is durably stored and confirmed. */
export interface GeneratedDocumentResult {
  file: DocumentFileResponse;
}

/** Paginated audit-list result returned to the later HTTP controller. */
export interface PaginatedAuditLogsResult {
  items: AuditLogSummary[];
  meta: PaginationMeta;
}

/** Builds one stable Module 21 application error. */
function documentError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through wrapped error causes when present. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Builds a normalized, fail-closed upload policy from deployment/test configuration. */
export function createDocumentUploadPolicy(
  input: DocumentUploadPolicyInput,
): DocumentUploadPolicy {
  const policy: Partial<Record<DocumentPurpose, DocumentUploadRule>> = {};

  for (const purpose of DOCUMENT_PURPOSE_VALUES) {
    const rule = input[purpose];
    if (!rule) continue;
    if (!Number.isSafeInteger(rule.maxSizeBytes) || rule.maxSizeBytes <= 0) {
      throw new Error(`Invalid maxSizeBytes for document purpose ${purpose}.`);
    }

    const allowedMimeTypes = new Set(
      rule.allowedMimeTypes.map((mimeType) => mimeType.trim().toLowerCase()).filter(Boolean),
    );
    if (allowedMimeTypes.size === 0) {
      throw new Error(`At least one MIME type is required for document purpose ${purpose}.`);
    }

    policy[purpose] = {
      allowedMimeTypes,
      maxSizeBytes: rule.maxSizeBytes,
    };
  }

  return policy;
}

/**
 * Module 21 service. It owns authorization, upload lifecycle, storage calls, resource policy,
 * seller-safe audit reads, transaction boundaries, redaction, audit writes and outbox events.
 */
export class DocumentsAuditService {
  private readonly storage: ObjectStorage;
  private readonly uploadPolicy: DocumentUploadPolicy;
  private readonly repository: DocumentsAuditRepository;
  private readonly resourcePolicy: DocumentResourcePolicy;
  private readonly transactionRunner: DocumentsAuditTransactionRunner;
  private readonly storageProvider: DocumentStorageProvider;

  /** Stores explicit dependencies without creating hidden provider or business-policy defaults. */
  constructor(dependencies: DocumentsAuditServiceDependencies) {
    this.storage = dependencies.storage;
    this.uploadPolicy = dependencies.uploadPolicy;
    this.repository = dependencies.repository ?? new DocumentsAuditRepository();
    this.resourcePolicy =
      dependencies.resourcePolicy ?? new CurrentDocumentResourcePolicy();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.storageProvider =
      dependencies.storageProvider ?? DOCUMENT_STORAGE_PROVIDER.S3_COMPATIBLE;
  }


  /** Stores server-generated bytes as a confirmed private document without exposing a direct upload URL. */
  async storeGeneratedDocument(
    input: GeneratedDocumentInput,
  ): Promise<GeneratedDocumentResult> {
    if (input.body.byteLength <= 0) {
      throw this.uploadInvalid("Generated document content must not be empty.", 422);
    }

    const objectKey = createObjectKey(input.purpose, input.originalName);
    const file = await this.repository.createFile({
      storageProvider: this.storageProvider,
      objectKey,
      purpose: input.purpose,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      ownerUserId: input.ownerUserId,
      status: DOCUMENT_FILE_STATUS.PENDING,
    });

    let metadata: StoredObjectMetadata;
    try {
      metadata = await this.storage.putObject({
        objectKey,
        contentType: input.mimeType,
        body: input.body,
      });
    } catch {
      await this.markFailedUploadBestEffort(file.id);
      throw this.storageUnavailable("The generated document could not be stored right now.");
    }

    try {
      const confirmed = await this.repository.confirmPendingFile(file.id, {
        checksum: metadata.checksum,
      });
      if (!confirmed) {
        throw this.uploadInvalid("The generated document could not be confirmed.", 409);
      }
      return { file: this.toFileResponse(confirmed) };
    } catch (error) {
      try {
        await this.storage.deleteObject(objectKey);
      } catch {
        // Best-effort cleanup only; the original safe application error remains authoritative.
      }
      throw error;
    }
  }

  /** Creates a signed download for a confirmed generated file after the caller module verifies run ownership. */
  async getGeneratedDocumentDownload(
    ownerUserId: string,
    fileId: string,
    purpose: DocumentPurpose,
  ): Promise<SignedDownloadResponse> {
    const file = await this.repository.findFileOwnedByUser(fileId, ownerUserId);
    if (!file) throw this.fileNotFound();
    this.assertConfirmedFile(file);
    this.assertPurposeMatchesFile(file, purpose);

    let signed: SignedUrlResult;
    try {
      signed = await this.storage.createSignedDownload({
        objectKey: file.objectKey,
        downloadFileName: file.originalName,
      });
    } catch {
      throw this.storageUnavailable("A signed download could not be created right now.");
    }

    return {
      file: this.toFileResponse(file),
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** Creates pending metadata and a constrained signed upload using server-generated ownership/key data. */
  async signUpload(
    context: RequestContext,
    input: SignUploadInput,
  ): Promise<SignedUploadResponse> {
    this.requireDocumentPermission(context, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD);
    this.assertUploadAllowed(input);

    const objectKey = createObjectKey(input.purpose, input.originalName);
    const file = await this.repository.createFile({
      storageProvider: this.storageProvider,
      objectKey,
      purpose: input.purpose,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ownerUserId: context.actorId,
      status: DOCUMENT_FILE_STATUS.PENDING,
    });

    try {
      const signed = await this.storage.createSignedUpload({
        objectKey,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
      });

      return {
        fileId: file.id,
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
        requiredHeaders: {
          "Content-Type": input.mimeType,
        },
      };
    } catch {
      await this.markFailedUploadBestEffort(file.id);
      throw this.storageUnavailable("A signed upload could not be created right now.");
    }
  }

  /** Verifies provider metadata, confirms a pending file once and emits one durable event/audit row. */
  async confirmUpload(
    context: RequestContext,
    fileId: string,
  ): Promise<ConfirmUploadResponse> {
    this.requireDocumentPermission(context, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD);
    const existing = await this.requireManagedFile(context, fileId);

    if (existing.status === DOCUMENT_FILE_STATUS.CONFIRMED) {
      return { file: this.toFileResponse(existing) };
    }
    if (existing.status !== DOCUMENT_FILE_STATUS.PENDING) {
      throw this.uploadInvalid("This file is not awaiting upload confirmation.", 409);
    }

    let metadata: StoredObjectMetadata | null;
    try {
      metadata = await this.storage.getObjectMetadata(existing.objectKey);
    } catch {
      throw this.uploadInvalid("The uploaded object could not be verified.", 503);
    }
    if (!metadata) {
      throw this.uploadInvalid("The uploaded object could not be verified.", 422);
    }
    if (
      metadata.contentType?.trim().toLowerCase() !== existing.mimeType.trim().toLowerCase() ||
      metadata.contentLength !== existing.sizeBytes
    ) {
      throw this.uploadInvalid("The uploaded object metadata does not match the signed upload.", 422);
    }

    return this.transactionRunner(async (tx) => {
      const repository = new DocumentsAuditRepository(tx);
      const confirmed = await repository.confirmPendingFile(fileId, {
        checksum: metadata.checksum,
      });

      if (!confirmed) {
        const current = await repository.findFileById(fileId);
        if (current?.status === DOCUMENT_FILE_STATUS.CONFIRMED) {
          return { file: this.toFileResponse(current) };
        }
        throw this.uploadInvalid("The upload could not be confirmed.", 409);
      }

      const safeFile = this.toFileResponse(confirmed);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UPLOAD_CONFIRMED,
        entityType: "file",
        entityId: confirmed.id,
        requestId: context.requestId,
        after: safeFile,
      });
      await outbox.enqueue({
        eventType: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UPLOAD_CONFIRMED,
        aggregateType: "file",
        aggregateId: confirmed.id,
        payload: {
          fileId: confirmed.id,
          ownerUserId: confirmed.ownerUserId,
          confirmedAt: new Date().toISOString(),
        },
      });

      return { file: safeFile };
    });
  }

  /** Returns safe confirmed file metadata after checking the caller and exact business purpose. */
  async getUsableFileForPurpose(
    context: RequestContext,
    fileId: string,
    purpose: DocumentPurpose,
  ): Promise<DocumentFileResponse> {
    this.requireDocumentPermission(
      context,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    );
    const file = await this.requireReadableFile(context, fileId);
    this.assertConfirmedFile(file);
    this.assertPurposeMatchesFile(file, purpose);
    return this.toFileResponse(file);
  }

  /** Verifies that an authorized caller can use one confirmed file for the exact requested business purpose. */
  async assertFileUsableForPurpose(
    context: RequestContext,
    fileId: string,
    purpose: DocumentPurpose,
  ): Promise<void> {
    await this.getUsableFileForPurpose(context, fileId, purpose);
  }

  /** Links a confirmed file to one service-authorized resource and handles exact repeats idempotently. */
  async linkFile(
    context: RequestContext,
    fileId: string,
    input: LinkFileInput,
  ): Promise<LinkFileResponse> {
    this.requireDocumentPermission(context, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK);
    const actorId = this.requireActorId(context);
    const file = await this.requireManagedFile(context, fileId);
    this.assertConfirmedFile(file);
    this.assertPurposeMatchesFile(file, input.purpose);

    const resource = await this.requireResourceAccess(
      context,
      input.resourceType,
      input.resourceId,
      "link",
    );
    const existing = await this.repository.findMatchingFileLink(
      fileId,
      input.resourceType,
      input.resourceId,
      input.purpose,
    );
    if (existing) return { link: this.toLinkResponse(existing) };

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new DocumentsAuditRepository(tx);
        const link = await repository.createFileLink({
          fileId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          purpose: input.purpose,
          createdBy: actorId,
        });
        const safeLink = this.toLinkResponse(link);
        const audit = AuditService.using(tx);
        const outbox = OutboxService.using(tx);

        await audit.record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_LINKED,
          entityType: input.resourceType,
          entityId: input.resourceId,
          sellerId: resource.sellerId,
          requestId: context.requestId,
          after: safeLink,
        });
        await outbox.enqueue({
          eventType: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_LINKED,
          aggregateType: input.resourceType,
          aggregateId: input.resourceId,
          payload: {
            fileId,
            linkId: link.id,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            sellerId: resource.sellerId,
          },
        });

        return { link: safeLink };
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        const duplicate = await this.repository.findMatchingFileLink(
          fileId,
          input.resourceType,
          input.resourceId,
          input.purpose,
        );
        if (duplicate) return { link: this.toLinkResponse(duplicate) };
      }
      throw error;
    }
  }

  /** Returns a short-lived signed download only after direct-owner or linked-resource authorization. */
  async getDownload(
    context: RequestContext,
    fileId: string,
  ): Promise<SignedDownloadResponse> {
    this.requireDocumentPermission(context, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ);
    const file = await this.requireReadableFile(context, fileId);
    this.assertConfirmedFile(file);

    let signed: SignedUrlResult;
    try {
      signed = await this.storage.createSignedDownload({
        objectKey: file.objectKey,
        downloadFileName: file.originalName,
      });
    } catch {
      throw this.storageUnavailable("A signed download could not be created right now.");
    }

    return {
      file: this.toFileResponse(file),
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** Removes one active link after current resource policy succeeds and emits one durable event/audit row. */
  async unlinkFile(
    context: RequestContext,
    fileId: string,
    linkId: string,
  ): Promise<UnlinkFileResponse> {
    this.requireDocumentPermission(context, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK);
    const link = await this.repository.findFileLink(fileId, linkId);
    if (!link) throw this.fileNotFound();

    const resource = await this.requireResourceAccess(
      context,
      link.resourceType,
      link.resourceId,
      "unlink",
    );

    return this.transactionRunner(async (tx) => {
      const repository = new DocumentsAuditRepository(tx);
      const deleted = await repository.deleteFileLink(fileId, link.id);
      if (!deleted) return { unlinked: true };

      const safeLink = this.toLinkResponse(deleted);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UNLINKED,
        entityType: deleted.resourceType,
        entityId: deleted.resourceId,
        sellerId: resource.sellerId,
        requestId: context.requestId,
        before: safeLink,
      });
      await outbox.enqueue({
        eventType: DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UNLINKED,
        aggregateType: deleted.resourceType,
        aggregateId: deleted.resourceId,
        payload: {
          fileId: deleted.fileId,
          linkId: deleted.id,
          resourceType: deleted.resourceType,
          resourceId: deleted.resourceId,
          sellerId: resource.sellerId,
        },
      });

      return { unlinked: true };
    });
  }

  /** Lists secret-redacted audit metadata inside a server-derived platform or seller scope. */
  async listAuditLogs(
    context: RequestContext,
    query: AuditListQuery,
  ): Promise<PaginatedAuditLogsResult> {
    this.requireAuditPermission(context);
    const scope = this.resolveAuditScope(context, query.sellerId);
    const result = await this.repository.listAuditLogs(query, scope);

    return {
      items: result.items.map((row) => this.toAuditSummary(row)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Returns one secret-redacted audit detail only inside the actor's server-derived audit scope. */
  async getAuditLog(
    context: RequestContext,
    auditLogId: string,
  ): Promise<AuditLogDetail> {
    this.requireAuditPermission(context);
    const scope = this.resolveAuditScope(context);
    const row = await this.repository.findAuditLogById(auditLogId, scope);
    if (!row) {
      throw documentError(
        DOCUMENT_AUDIT_ERROR_CODE.AUDIT_SCOPE_FORBIDDEN,
        "The requested audit record is unavailable in your scope.",
        404,
      );
    }
    return this.toAuditDetail(row);
  }

  /** Enforces the deployment-configured purpose/MIME/size allow-list. */
  private assertUploadAllowed(input: SignUploadInput): void {
    const rule = this.uploadPolicy[input.purpose];
    if (!rule) {
      throw this.uploadInvalid("This upload purpose is not enabled.", 422);
    }
    if (!rule.allowedMimeTypes.has(input.mimeType.toLowerCase())) {
      throw this.uploadInvalid("This MIME type is not allowed for the upload purpose.", 422);
    }
    if (input.sizeBytes > rule.maxSizeBytes) {
      throw this.uploadInvalid("The file exceeds the allowed size for the upload purpose.", 422);
    }
  }

  /** Repeats the document permission check inside sensitive service methods. */
  private requireDocumentPermission(context: RequestContext, permission: string): void {
    if (!context.permissions.has(permission)) {
      throw documentError(
        DOCUMENT_AUDIT_ERROR_CODE.FILE_SCOPE_FORBIDDEN,
        "You do not have permission to access this document operation.",
        403,
      );
    }
  }

  /** Repeats the audit permission check inside sensitive service methods. */
  private requireAuditPermission(context: RequestContext): void {
    if (!context.permissions.has(DOCUMENT_AUDIT_PERMISSION.AUDIT_READ)) {
      throw this.auditForbidden();
    }
  }

  /** Requires a persisted user actor for operations whose database rows require created_by. */
  private requireActorId(context: RequestContext): string {
    if (context.actorId) return context.actorId;
    throw documentError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
  }

  /** Loads one file for an internal platform/system path and safely hides missing rows. */
  private async requireFile(fileId: string): Promise<FileRow> {
    const file = await this.repository.findFileById(fileId);
    if (!file) throw this.fileNotFound();
    return file;
  }

  /**
   * Loads an upload-managed file with ownership enforced in SQL for normal users.
   * A foreign file is intentionally returned as not found so callers cannot probe private file IDs.
   */
  private async requireManagedFile(
    context: RequestContext,
    fileId: string,
  ): Promise<FileRow> {
    if (
      context.actorType === ACTOR_TYPE.PLATFORM_ADMIN ||
      context.actorType === ACTOR_TYPE.SYSTEM
    ) {
      return this.requireFile(fileId);
    }

    if (!context.actorId) throw this.fileNotFound();
    const file = await this.repository.findFileOwnedByUser(fileId, context.actorId);
    if (!file) throw this.fileNotFound();
    return file;
  }

  /** Requires the file lifecycle to be confirmed before linking/downloading. */
  private assertConfirmedFile(file: FileRow): void {
    if (file.status !== DOCUMENT_FILE_STATUS.CONFIRMED) {
      throw this.uploadInvalid("This file is not available until its upload is confirmed.", 409);
    }
  }

  /** Prevents a signed upload purpose from being relabeled when it is linked later. */
  private assertPurposeMatchesFile(file: FileRow, purpose: DocumentPurpose): void {
    if (file.purpose !== purpose) {
      throw this.uploadInvalid("The file purpose does not match the signed upload purpose.", 409);
    }
  }

  /** Requires one generic business resource to approve the requested file action. */
  private async requireResourceAccess(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource> {
    const authorized = await this.resourcePolicy.authorize(
      context,
      resourceType,
      resourceId,
      action,
    );
    if (!authorized) throw this.fileNotFound();
    return authorized;
  }

  /**
   * Loads a readable file for the owner, platform/system actor, or an authorized linked resource.
   * Unauthorized and missing files intentionally share the same public not-found response.
   */
  private async requireReadableFile(
    context: RequestContext,
    fileId: string,
  ): Promise<FileRow> {
    if (
      context.actorType === ACTOR_TYPE.PLATFORM_ADMIN ||
      context.actorType === ACTOR_TYPE.SYSTEM
    ) {
      return this.requireFile(fileId);
    }

    if (context.actorId) {
      const ownedFile = await this.repository.findFileOwnedByUser(fileId, context.actorId);
      if (ownedFile) return ownedFile;
    }

    const links = await this.repository.listFileLinks(fileId);
    for (const link of links) {
      const authorized = await this.resourcePolicy.authorize(
        context,
        link.resourceType,
        link.resourceId,
        "read",
      );
      if (!authorized) continue;

      const linkedFile = await this.repository.findFileLinkedToResource(
        fileId,
        link.resourceType,
        link.resourceId,
      );
      if (linkedFile) return linkedFile;
    }

    throw this.fileNotFound();
  }

  /** Best-effort cleanup that prevents a failed signing attempt from remaining pending forever. */
  private async markFailedUploadBestEffort(fileId: string): Promise<void> {
    try {
      await this.repository.markPendingFileFailed(fileId);
    } catch {
      // The public error must remain the storage failure; later maintenance can clean a rare stale pending row.
    }
  }

  /** Resolves a platform/system audit scope or the exact seller IDs where this seller has audit.read. */
  private resolveAuditScope(
    context: RequestContext,
    requestedSellerId?: string,
  ): AuditReadScope {
    if (
      context.actorType === ACTOR_TYPE.PLATFORM_ADMIN ||
      context.actorType === ACTOR_TYPE.SYSTEM
    ) {
      return { kind: "platform" };
    }
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.auditForbidden();

    const allowedSellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId) &&
          permissions.has(DOCUMENT_AUDIT_PERMISSION.AUDIT_READ),
      )
      .map(([sellerId]) => sellerId);

    if (requestedSellerId) {
      if (!allowedSellerIds.includes(requestedSellerId)) throw this.auditForbidden();
      return { kind: "seller", sellerIds: [requestedSellerId] };
    }
    if (allowedSellerIds.length === 0) throw this.auditForbidden();
    return { kind: "seller", sellerIds: allowedSellerIds };
  }

  /** Maps private file persistence metadata to the public-safe Module 21 file response. */
  private toFileResponse(file: FileRow): DocumentFileResponse {
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status as DocumentFileResponse["status"],
      createdAt: file.createdAt.toISOString(),
    };
  }

  /** Maps one persisted file/resource link to the public-safe response contract. */
  private toLinkResponse(link: FileLinkRow): FileLinkResponse {
    return {
      id: link.id,
      fileId: link.fileId,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      purpose: link.purpose as FileLinkResponse["purpose"],
      createdBy: link.createdBy,
      createdAt: link.createdAt.toISOString(),
    };
  }

  /** Maps one audit row to the metadata-only list contract. */
  private toAuditSummary(row: AuditLogRow): AuditLogSummary {
    return {
      id: row.id,
      actorUserId: row.actorUserId,
      actorType: row.actorType as AuditLogSummary["actorType"],
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      sellerId: row.sellerId,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Maps one audit row to the detail contract and defensively redacts legacy snapshots again on read. */
  private toAuditDetail(row: AuditLogRow): AuditLogDetail {
    return {
      ...this.toAuditSummary(row),
      before: row.beforeJsonRedacted === null ? null : redactAuditValue(row.beforeJsonRedacted),
      after: row.afterJsonRedacted === null ? null : redactAuditValue(row.afterJsonRedacted),
    };
  }

  /** Creates the stable not-found error used for private file metadata. */
  private fileNotFound(): AppError {
    return documentError(
      DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      "File metadata was not found.",
      404,
    );
  }

  /** Creates the stable invalid-upload lifecycle error. */
  private uploadInvalid(message: string, statusCode: number): AppError {
    return documentError(DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID, message, statusCode);
  }

  /** Creates a safe provider-availability error without exposing SDK credentials or provider details. */
  private storageUnavailable(message: string): AppError {
    return documentError(ERROR_CODE.SERVICE_UNAVAILABLE, message, 503);
  }

  /** Creates the stable audit-scope error without exposing whether an unauthorized row exists. */
  private auditForbidden(): AppError {
    return documentError(
      DOCUMENT_AUDIT_ERROR_CODE.AUDIT_SCOPE_FORBIDDEN,
      "The requested audit scope is not available to this actor.",
      403,
    );
  }
}
