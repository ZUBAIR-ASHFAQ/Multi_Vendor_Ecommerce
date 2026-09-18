import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import {
  ACTOR_TYPE,
  type PermissionCode,
} from "../../src/common/security/security.contract.js";
import {
  DOCUMENT_AUDIT_ERROR_CODE,
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_FILE_STATUS,
  DOCUMENT_PURPOSE,
} from "../../src/modules/documents-audit/documents-audit.constants.js";
import { auditListQuerySchema } from "../../src/modules/documents-audit/documents-audit.schema.js";
import { DocumentsAuditService } from "../../src/modules/documents-audit/documents-audit.service.js";
import {
  FakeObjectStorage,
  repositoryStub,
  testAuditRow,
  testContext,
  testFileLinkRow,
  testFileRow,
  testUploadPolicy,
} from "./module21.test-helpers.js";

const ONE_MEGABYTE = 1024 * 1024;

describe("Module 21 service policy", () => {
  it("rejects invalid upload policy inputs before file metadata is persisted", async () => {
    const storage = new FakeObjectStorage();
    const transactionRunner = vi.fn();
    const createFile = vi.fn();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({ createFile }),
      transactionRunner,
    });
    const context = testContext(randomUUID(), [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    ]);

    await expect(
      service.signUpload(context, {
        originalName: "image.png",
        mimeType: "image/png",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      }),
    ).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
      statusCode: 422,
    });

    await expect(
      service.signUpload(context, {
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: ONE_MEGABYTE + 1,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      }),
    ).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
      statusCode: 422,
    });

    expect(createFile).not.toHaveBeenCalled();
    expect(transactionRunner).not.toHaveBeenCalled();
    expect(storage.uploadRequests).toHaveLength(0);
  });

  it("marks pending metadata failed and returns a safe 503 when signed-upload creation fails", async () => {
    const ownerId = randomUUID();
    const pendingFile = testFileRow(ownerId, {
      status: DOCUMENT_FILE_STATUS.PENDING,
    });
    const storage = new FakeObjectStorage();
    storage.uploadError = new Error("provider credentials must never escape");
    const markPendingFileFailed = vi.fn().mockResolvedValue({
      ...pendingFile,
      status: DOCUMENT_FILE_STATUS.FAILED,
    });
    const transactionRunner = vi.fn();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        createFile: vi.fn().mockResolvedValue(pendingFile),
        markPendingFileFailed,
      }),
      transactionRunner,
    });
    const context = testContext(ownerId, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    ]);

    await expect(
      service.signUpload(context, {
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.SERVICE_UNAVAILABLE,
      statusCode: 503,
    });

    expect(markPendingFileFailed).toHaveBeenCalledWith(pendingFile.id);
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("hides foreign upload metadata before object storage is contacted", async () => {
    const ownerId = randomUUID();
    const file = testFileRow(ownerId, {
      status: DOCUMENT_FILE_STATUS.PENDING,
    });
    const storage = new FakeObjectStorage();
    const findFileOwnedByUser = vi.fn().mockResolvedValue(null);
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({ findFileOwnedByUser }),
    });
    const context = testContext(randomUUID(), [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    ]);

    await expect(service.confirmUpload(context, file.id)).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      statusCode: 404,
    });

    expect(findFileOwnedByUser).toHaveBeenCalledWith(file.id, context.actorId);
    expect(storage.metadataRequests).toHaveLength(0);
  });

  it("returns an already confirmed upload without re-reading provider metadata", async () => {
    const ownerId = randomUUID();
    const file = testFileRow(ownerId, {
      status: DOCUMENT_FILE_STATUS.CONFIRMED,
    });
    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findFileOwnedByUser: vi.fn().mockResolvedValue(file),
      }),
    });
    const context = testContext(ownerId, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    ]);

    const result = await service.confirmUpload(context, file.id);

    expect(result.file.id).toBe(file.id);
    expect(storage.metadataRequests).toHaveLength(0);
  });

  it("maps provider verification failure and metadata mismatch to safe upload errors", async () => {
    const ownerId = randomUUID();
    const file = testFileRow(ownerId, {
      status: DOCUMENT_FILE_STATUS.PENDING,
    });
    const findFileOwnedByUser = vi.fn().mockResolvedValue(file);
    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({ findFileOwnedByUser }),
    });
    const context = testContext(ownerId, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    ]);

    storage.metadataError = new Error("provider credential details must not escape");
    await expect(service.confirmUpload(context, file.id)).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
      statusCode: 503,
    });

    storage.metadataError = null;
    storage.setMetadata(file.objectKey, {
      contentType: "application/pdf",
      contentLength: file.sizeBytes + 1,
      checksum: null,
    });
    await expect(service.confirmUpload(context, file.id)).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
      statusCode: 422,
    });
  });

  it("uses the same not-found result for missing and unrelated private files", async () => {
    const storage = new FakeObjectStorage();
    const findFileOwnedByUser = vi.fn().mockResolvedValue(null);
    const listFileLinks = vi.fn().mockResolvedValue([]);
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findFileOwnedByUser,
        listFileLinks,
      }),
    });
    const context = testContext(randomUUID(), [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);

    const firstError = await service.getDownload(context, randomUUID()).catch((error) => error);
    const secondError = await service.getDownload(context, randomUUID()).catch((error) => error);

    expect(firstError).toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      statusCode: 404,
      message: "File metadata was not found.",
    });
    expect(secondError).toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      statusCode: 404,
      message: "File metadata was not found.",
    });
    expect(storage.downloadRequests).toHaveLength(0);
  });

  it("allows linked-resource download only after policy and repository link checks both succeed", async () => {
    const ownerId = randomUUID();
    const readerId = randomUUID();
    const file = testFileRow(ownerId);
    const link = testFileLinkRow(file.id, ownerId, {
      resourceType: "shared_test_resource",
      resourceId: randomUUID(),
    });
    const authorize = vi.fn().mockResolvedValue({ sellerId: null });
    const findFileLinkedToResource = vi.fn().mockResolvedValue(file);
    const service = new DocumentsAuditService({
      storage: new FakeObjectStorage(),
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findFileOwnedByUser: vi.fn().mockResolvedValue(null),
        listFileLinks: vi.fn().mockResolvedValue([link]),
        findFileLinkedToResource,
      }),
      resourcePolicy: { authorize },
    });
    const context = testContext(readerId, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);

    const result = await service.getDownload(context, file.id);

    expect(result.file.id).toBe(file.id);
    expect(authorize).toHaveBeenCalledWith(
      context,
      link.resourceType,
      link.resourceId,
      "read",
    );
    expect(findFileLinkedToResource).toHaveBeenCalledWith(
      file.id,
      link.resourceType,
      link.resourceId,
    );
  });

  it("fails closed when resource policy passes but the repository link no longer exists", async () => {
    const ownerId = randomUUID();
    const file = testFileRow(ownerId);
    const link = testFileLinkRow(file.id, ownerId, {
      resourceType: "shared_test_resource",
      resourceId: randomUUID(),
    });
    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findFileOwnedByUser: vi.fn().mockResolvedValue(null),
        listFileLinks: vi.fn().mockResolvedValue([link]),
        findFileLinkedToResource: vi.fn().mockResolvedValue(null),
      }),
      resourcePolicy: {
        authorize: vi.fn().mockResolvedValue({ sellerId: null }),
      },
    });
    const context = testContext(randomUUID(), [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);

    await expect(service.getDownload(context, file.id)).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      statusCode: 404,
    });
    expect(storage.downloadRequests).toHaveLength(0);
  });

  it("maps signed-download provider failures to a safe service-unavailable error", async () => {
    const ownerId = randomUUID();
    const file = testFileRow(ownerId);
    const storage = new FakeObjectStorage();
    storage.downloadError = new Error("provider secret must never escape");
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findFileOwnedByUser: vi.fn().mockResolvedValue(file),
      }),
    });
    const context = testContext(ownerId, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);

    await expect(service.getDownload(context, file.id)).rejects.toMatchObject({
      code: ERROR_CODE.SERVICE_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it("forces seller audit reads to the exact server-derived seller permission scope", async () => {
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const auditPermission = DOCUMENT_AUDIT_PERMISSION.AUDIT_READ as PermissionCode;
    const listAuditLogs = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
    const service = new DocumentsAuditService({
      storage: new FakeObjectStorage(),
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({ listAuditLogs }),
    });
    const context = testContext(randomUUID(), [auditPermission], {
      actorType: ACTOR_TYPE.SELLER,
      sellerIds: [sellerA, sellerB],
      sellerPermissions: new Map([
        [sellerA, new Set<PermissionCode>([auditPermission])],
        [sellerB, new Set<PermissionCode>()],
      ]),
    });

    await service.listAuditLogs(
      context,
      auditListQuerySchema.parse({ sellerId: sellerA }),
    );
    expect(listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: sellerA }),
      { kind: "seller", sellerIds: [sellerA] },
    );

    await expect(
      service.listAuditLogs(
        context,
        auditListQuerySchema.parse({ sellerId: sellerB }),
      ),
    ).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.AUDIT_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
  });

  it("defensively redacts legacy audit snapshots again on read", async () => {
    const actorId = randomUUID();
    const row = testAuditRow(null, {
      password: "never-return",
      nested: {
        accessToken: "never-return",
        accessKeyId: "never-return",
        cardNumber: "never-return",
        cvv: "never-return",
        routing_number: "never-return",
        safeValue: "visible",
      },
    });
    const service = new DocumentsAuditService({
      storage: new FakeObjectStorage(),
      uploadPolicy: testUploadPolicy(),
      repository: repositoryStub({
        findAuditLogById: vi.fn().mockResolvedValue(row),
      }),
    });
    const context = testContext(actorId, [DOCUMENT_AUDIT_PERMISSION.AUDIT_READ], {
      actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    });

    const result = await service.getAuditLog(context, row.id);

    expect(result.after).toEqual({
      password: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        accessKeyId: "[REDACTED]",
        cardNumber: "[REDACTED]",
        cvv: "[REDACTED]",
        routing_number: "[REDACTED]",
        safeValue: "visible",
      },
    });
  });
});
