import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { PasswordService } from "../../src/common/security/password.service.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import type { FileRow } from "../../src/database/schema/index.js";
import { seedPlatformRbac } from "../../src/database/seeds/platform-rbac.seed.js";
import { errorMiddleware } from "../../src/common/middleware/error.middleware.js";
import { notFoundMiddleware } from "../../src/common/middleware/not-found.middleware.js";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware.js";
import {
  ACCOUNT_TYPE,
  ROLE_SCOPE_TYPE,
  SYSTEM_ROLE,
  type AccountType,
  type RoleScopeType,
} from "../../src/modules/administration/administration.constants.js";
import { AuthService } from "../../src/modules/administration/auth.service.js";
import {
  DOCUMENT_AUDIT_ERROR_CODE,
  DOCUMENT_AUDIT_OUTBOX_EVENT,
  DOCUMENT_AUDIT_PERMISSION,
  DOCUMENT_FILE_STATUS,
  DOCUMENT_PURPOSE,
  DOCUMENT_STORAGE_PROVIDER,
} from "../../src/modules/documents-audit/documents-audit.constants.js";
import { DocumentsAuditController } from "../../src/modules/documents-audit/documents-audit.controller.js";
import { DocumentsAuditRepository } from "../../src/modules/documents-audit/documents-audit.repository.js";
import type {
  AuthorizedDocumentResource,
  DocumentResourceAction,
  DocumentResourcePolicy,
} from "../../src/modules/documents-audit/documents-audit.resource-policy.js";
import {
  createAuditRouter,
  createDocumentsRouter,
} from "../../src/modules/documents-audit/documents-audit.routes.js";
import { auditListQuerySchema } from "../../src/modules/documents-audit/documents-audit.schema.js";
import { DocumentsAuditService } from "../../src/modules/documents-audit/documents-audit.service.js";
import {
  FakeObjectStorage,
  testUploadPolicy,
} from "./module21.test-helpers.js";

const TEST_PASSWORD = "Module21Password!123";

interface TestUser {
  id: string;
  email: string;
  password: string;
}

interface CreatedRole {
  id: string;
  sellerId: string | null;
}

/** Minimal future-resource policy used only to prove server-derived seller isolation in tests. */
class TestSellerResourcePolicy implements DocumentResourcePolicy {
  /** Stores the server-derived seller owner for each fake business resource. */
  constructor(private readonly sellerByResourceId: ReadonlyMap<string, string>) {}

  /** Authorizes platform actors or seller actors only inside their server-derived seller scope. */
  async authorize(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    _action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource | null> {
    if (resourceType === "user" && context.actorId === resourceId) {
      return { sellerId: null };
    }

    if (resourceType !== "seller_resource") return null;
    const sellerId = this.sellerByResourceId.get(resourceId);
    if (!sellerId) return null;
    if (
      context.actorType === ACTOR_TYPE.PLATFORM_ADMIN ||
      context.actorType === ACTOR_TYPE.SYSTEM
    ) {
      return { sellerId };
    }
    return context.sellerIds.has(sellerId) ? { sellerId } : null;
  }
}

/** Truncates Module 21 plus Module 2 state and restores the deterministic RBAC catalog. */
async function resetModule21Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      file_links,
      files,
      refresh_sessions,
      user_roles,
      role_permissions,
      platform_settings,
      users,
      permissions,
      roles,
      audit_logs,
      outbox_events,
      idempotency_keys
    RESTART IDENTITY CASCADE
  `);
  await seedPlatformRbac();
}

/** Inserts one active user identity with a securely hashed test password. */
async function createUser(
  email: string,
  accountType: AccountType,
  password = TEST_PASSWORD,
): Promise<TestUser> {
  const passwordHash = await new PasswordService().hash(password);
  const result = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status, password_changed_at)
     values ($1, $2, $3, $4, 'active', now())
     returning id`,
    [email, passwordHash, email.split("@", 1)[0] ?? "Test User", accountType],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Test user insert did not return an id.");
  return { id, email, password };
}

/** Creates one role and grants only server-seeded permission codes requested by the test. */
async function createRoleWithPermissions(
  scopeType: RoleScopeType,
  permissionCodes: readonly string[],
  sellerId: string | null = null,
): Promise<CreatedRole> {
  const code = `test_${scopeType}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const roleResult = await databasePool.query<{ id: string }>(
    `insert into roles (code, name, scope_type, status)
     values ($1, $2, $3, 'active') returning id`,
    [code, `Test ${scopeType} role`, scopeType],
  );
  const roleId = roleResult.rows[0]?.id;
  if (!roleId) throw new Error("Test role insert did not return an id.");

  if (permissionCodes.length > 0) {
    const permissionResult = await databasePool.query(
      `insert into role_permissions (role_id, permission_id)
       select $1, id from permissions where code = any($2::text[])`,
      [roleId, permissionCodes],
    );
    if (permissionResult.rowCount !== permissionCodes.length) {
      throw new Error("One or more requested test permissions were not present in the seeded catalog.");
    }
  }
  return { id: roleId, sellerId };
}

/** Assigns one platform/customer/seller role to a user using the correct seller scope column. */
async function assignRole(userId: string, role: CreatedRole): Promise<void> {
  await databasePool.query(
    `insert into user_roles (user_id, role_id, seller_id, assigned_by)
     values ($1, $2, $3, $1)`,
    [userId, role.id, role.sellerId],
  );
}

/** Creates the protected platform administrator used by repository/API audit tests. */
async function createPlatformAdmin(email = "module21-admin@example.com"): Promise<TestUser> {
  const user = await createUser(email, ACCOUNT_TYPE.PLATFORM_ADMIN);
  const roleResult = await databasePool.query<{ id: string }>(
    "select id from roles where code = $1",
    [SYSTEM_ROLE.PLATFORM_SUPER_ADMIN.code],
  );
  const roleId = roleResult.rows[0]?.id;
  if (!roleId) throw new Error("Seeded platform super-admin role was not found.");
  await assignRole(user.id, { id: roleId, sellerId: null });
  return user;
}

/** Creates one active customer with an optional customer-scoped Module 21 permission set. */
async function createCustomer(
  email: string,
  permissionCodes: readonly string[],
): Promise<TestUser> {
  const user = await createUser(email, ACCOUNT_TYPE.CUSTOMER);
  if (permissionCodes.length === 0) return user;
  const role = await createRoleWithPermissions(ROLE_SCOPE_TYPE.CUSTOMER, permissionCodes);
  await assignRole(user.id, role);
  return user;
}

/** Creates one active seller user whose permissions are bound to exactly one seller ID. */
async function createSellerUser(
  email: string,
  sellerId: string,
  permissionCodes: readonly string[],
): Promise<TestUser> {
  const user = await createUser(email, ACCOUNT_TYPE.SELLER);

  await databasePool.query(
    `insert into sellers
      (id, owner_user_id, legal_name, display_name, status, approval_status, approved_at)
     values ($1, $2, $3, $4, 'active', 'approved', now())`,
    [
      sellerId,
      user.id,
      `Test Seller ${sellerId}`,
      `Test Seller ${sellerId}`,
    ],
  );

  const role = await createRoleWithPermissions(
    ROLE_SCOPE_TYPE.SELLER,
    permissionCodes,
    sellerId,
  );
  await assignRole(user.id, role);
  return user;
}

/** Logs in through Module 2 and resolves the same database-derived context used by HTTP middleware. */
async function authenticateUser(user: TestUser): Promise<{
  accessToken: string;
  context: RequestContext;
}> {
  const auth = new AuthService();
  const session = await auth.login(
    { email: user.email, password: user.password },
    { ipAddress: "127.0.0.1", userAgent: "module21-vitest" },
    randomUUID(),
  );
  const authenticated = await auth.authenticateAccessToken(
    session.accessToken,
    randomUUID(),
  );
  return { accessToken: session.accessToken, context: authenticated.context };
}

/** Creates a bearer header accepted by the real Module 2 authentication middleware. */
function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Builds a compact Express app around the real Module 21 routers and an injected fake-storage service. */
function createModule21TestApp(service: DocumentsAuditService): Express {
  const app = express();
  const controller = new DocumentsAuditController(service);
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use("/api/v1/documents", createDocumentsRouter(controller));
  app.use("/api/v1/audit", createAuditRouter(controller));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}

/** Inserts one confirmed private file for authorization tests without invoking the upload workflow. */
async function insertConfirmedFile(ownerUserId: string): Promise<FileRow> {
  const result = await databasePool.query<FileRow & {
    storage_provider: string;
    object_key: string;
    purpose: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    checksum: string | null;
    owner_user_id: string | null;
    created_at: Date;
  }>(
    `insert into files
      (storage_provider, object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
     values ('s3_compatible', $1, 'operational_evidence', 'proof.pdf', 'application/pdf', 512, $2, 'confirmed')
     returning *`,
    [
      `${DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE}/2026-09-03/${randomUUID()}-proof.pdf`,
      ownerUserId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Confirmed file insert did not return a row.");
  return {
    id: row.id,
    storageProvider: row.storage_provider,
    objectKey: row.object_key,
    purpose: row.purpose as FileRow["purpose"],
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    ownerUserId: row.owner_user_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Inserts one audit row for a chosen seller to exercise append-only read scoping. */
async function insertAuditLog(
  actorUserId: string,
  sellerId: string | null,
  afterJson: unknown = { safe: true },
): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into audit_logs
      (actor_user_id, actor_type, action, resource_type, resource_id, seller_id, request_id, after_json_redacted)
     values ($1, 'platform_admin', 'test.audit', 'test_resource', $2, $3, $4, $5::jsonb)
     returning id`,
    [actorUserId, randomUUID(), sellerId, randomUUID(), JSON.stringify(afterJson)],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Audit insert did not return an id.");
  return id;
}

/** Counts durable outbox events for one exact event type. */
async function countOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts append-only audit rows for one exact action. */
async function countAuditActions(action: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where action = $1",
    [action],
  );
  return result.rows[0]?.count ?? 0;
}

describe("Module 21 repository/service/API integration", () => {
  beforeEach(async () => {
    await resetModule21Tables();
  });

  it("persists file lifecycle/link records and enforces seller predicates plus append-only audit storage", async () => {
    const admin = await createPlatformAdmin();
    const repository = new DocumentsAuditRepository();
    const file = await repository.createFile({
      storageProvider: DOCUMENT_STORAGE_PROVIDER.S3_COMPATIBLE,
      objectKey: `${DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE}/2026-09-03/${randomUUID()}-repo.pdf`,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      originalName: "repo.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      ownerUserId: admin.id,
      status: DOCUMENT_FILE_STATUS.PENDING,
    });

    expect((await repository.findFileById(file.id))?.status).toBe(DOCUMENT_FILE_STATUS.PENDING);
    expect((await repository.findFileOwnedByUser(file.id, admin.id))?.id).toBe(file.id);

    const otherOwner = await createUser(
      `module21-repository-other-${randomUUID()}@example.com`,
      ACCOUNT_TYPE.CUSTOMER,
    );
    expect(await repository.findFileOwnedByUser(file.id, otherOwner.id)).toBeNull();

    const failedFile = await repository.createFile({
      storageProvider: DOCUMENT_STORAGE_PROVIDER.S3_COMPATIBLE,
      objectKey: `${DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE}/2026-09-03/${randomUUID()}-failed.pdf`,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      originalName: "failed.pdf",
      mimeType: "application/pdf",
      sizeBytes: 256,
      ownerUserId: admin.id,
      status: DOCUMENT_FILE_STATUS.PENDING,
    });
    expect((await repository.markPendingFileFailed(failedFile.id))?.status).toBe(
      DOCUMENT_FILE_STATUS.FAILED,
    );
    expect(await repository.markPendingFileFailed(failedFile.id)).toBeNull();

    const confirmed = await repository.confirmPendingFile(file.id, { checksum: "checksum-1" });
    expect(confirmed?.status).toBe(DOCUMENT_FILE_STATUS.CONFIRMED);
    expect((await repository.confirmPendingFile(file.id, { checksum: "checksum-2" }))).toBeNull();

    const link = await repository.createFileLink({
      fileId: file.id,
      resourceType: "user",
      resourceId: admin.id,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      createdBy: admin.id,
    });
    expect(
      await repository.findMatchingFileLink(
        file.id,
        "user",
        admin.id,
        DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      ),
    ).toMatchObject({ id: link.id });
    expect(await repository.listFileLinks(file.id)).toHaveLength(1);

    expect(
      (await repository.findFileLinkedToResource(file.id, "user", admin.id))?.id,
    ).toBe(file.id);
    expect(
      await repository.findFileLinkedToResource(file.id, "user", otherOwner.id),
    ).toBeNull();

    expect((await repository.deleteFileLink(file.id, link.id))?.id).toBe(link.id);
    expect(await repository.findFileLink(file.id, link.id)).toBeNull();

    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const auditA = await insertAuditLog(admin.id, sellerA);
    await insertAuditLog(admin.id, sellerB);
    const scoped = await repository.listAuditLogs(
      auditListQuerySchema.parse({ page: 1, pageSize: 20 }),
      { kind: "seller", sellerIds: [sellerA] },
    );
    expect(scoped.items.map((row) => row.id)).toEqual([auditA]);

    const crossSeller = await repository.listAuditLogs(
      auditListQuerySchema.parse({ sellerId: sellerB }),
      { kind: "seller", sellerIds: [sellerA] },
    );
    expect(crossSeller.items).toHaveLength(0);

    const emptySellerScope = await repository.listAuditLogs(
      auditListQuerySchema.parse({ page: 1, pageSize: 20 }),
      { kind: "seller", sellerIds: [] },
    );
    expect(emptySellerScope.items).toHaveLength(0);
    expect(emptySellerScope.totalItems).toBe(0);

    expect(
      await repository.findAuditLogById(auditA, {
        kind: "seller",
        sellerIds: [sellerB],
      }),
    ).toBeNull();

    await expect(
      databasePool.query("update audit_logs set action = 'changed' where id = $1", [auditA]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      databasePool.query("delete from audit_logs where id = $1", [auditA]),
    ).rejects.toThrow(/append-only/i);
  });

  it("runs signed upload -> confirm -> idempotent link -> download -> unlink with one event per successful transition", async () => {
    const owner = await createCustomer("module21-owner@example.com", [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
    ]);
    const { context } = await authenticateUser(owner);
    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
    });

    const signed = await service.signUpload(context, {
      originalName: "../../private-proof.pdf",
      mimeType: "application/pdf",
      sizeBytes: 640,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
    });
    const objectKey = storage.latestUploadObjectKey;
    expect(objectKey).toBeTruthy();
    expect(objectKey).toMatch(/^operational_evidence\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+-/);
    expect(objectKey).not.toContain("../");

    storage.setMetadata(objectKey as string, {
      contentType: "application/pdf",
      contentLength: 640,
      checksum: "provider-checksum",
    });
    const [firstConfirm, repeatedConfirm] = await Promise.all([
      service.confirmUpload(context, signed.fileId),
      service.confirmUpload(context, signed.fileId),
    ]);
    expect(repeatedConfirm.file).toEqual(firstConfirm.file);
    expect(
      await countOutboxEvents(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UPLOAD_CONFIRMED),
    ).toBe(1);
    expect(
      await countAuditActions(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UPLOAD_CONFIRMED),
    ).toBe(1);

    const linkInput = {
      resourceType: "user",
      resourceId: owner.id,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
    } as const;
    const [firstLink, repeatedLink] = await Promise.all([
      service.linkFile(context, signed.fileId, linkInput),
      service.linkFile(context, signed.fileId, linkInput),
    ]);
    expect(repeatedLink.link.id).toBe(firstLink.link.id);
    expect(await countOutboxEvents(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_LINKED)).toBe(1);
    expect(await countAuditActions(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_LINKED)).toBe(1);

    const linkCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from file_links where file_id = $1",
      [signed.fileId],
    );
    expect(linkCount.rows[0]?.count).toBe(1);

    const download = await service.getDownload(context, signed.fileId);
    expect(download.downloadUrl).toContain("https://storage.test/download/");
    expect(download.file).not.toHaveProperty("objectKey");

    await service.unlinkFile(context, signed.fileId, firstLink.link.id);
    expect(await countOutboxEvents(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UNLINKED)).toBe(1);
    expect(await countAuditActions(DOCUMENT_AUDIT_OUTBOX_EVENT.FILE_UNLINKED)).toBe(1);
    expect(storage.deleteRequests).toHaveLength(0);
  });

  it("covers all seven HTTP routes with real auth, RBAC, validation, redaction, and unlink behavior", async () => {
    const owner = await createCustomer("module21-http-owner@example.com", [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
    ]);
    const noPermissionUser = await createCustomer("module21-http-none@example.com", []);
    const admin = await createPlatformAdmin("module21-http-admin@example.com");
    const ownerAuth = await authenticateUser(owner);
    const noPermissionAuth = await authenticateUser(noPermissionUser);
    const adminAuth = await authenticateUser(admin);

    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
    });
    const app = createModule21TestApp(service);

    const unauthenticated = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .send({
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(401);
    expect(unauthenticated.body.requestId).toEqual(expect.any(String));

    const forbidden = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(noPermissionAuth.accessToken))
      .send({
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    const invalid = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(ownerAuth.accessToken))
      .send({
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 0,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(422);
    expect(invalid.body.error.code).toBe("VALIDATION_FAILED");
    expect(invalid.body.error.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "sizeBytes" })]),
    );

    const disallowedMime = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(ownerAuth.accessToken))
      .send({
        originalName: "proof.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(422);
    expect(disallowedMime.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
    );

    const sign = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(ownerAuth.accessToken))
      .send({
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(201);
    expect(sign.body.success).toBe(true);
    expect(sign.body.requestId).toEqual(expect.any(String));

    const fileId = sign.body.data.fileId as string;
    const objectKey = storage.latestUploadObjectKey;
    if (!objectKey) throw new Error("Fake storage did not receive a signed-upload request.");
    storage.setMetadata(objectKey, {
      contentType: "application/pdf",
      contentLength: 512,
      checksum: null,
    });

    await request(app)
      .post(`/api/v1/documents/uploads/${fileId}/confirm`)
      .set(bearer(ownerAuth.accessToken))
      .expect(200);

    const download = await request(app)
      .get(`/api/v1/documents/${fileId}/download`)
      .set(bearer(ownerAuth.accessToken))
      .expect(200);
    expect(download.body.data.file).not.toHaveProperty("objectKey");

    const link = await request(app)
      .post(`/api/v1/documents/${fileId}/link`)
      .set(bearer(ownerAuth.accessToken))
      .send({
        resourceType: "user",
        resourceId: owner.id,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(201);
    const linkId = link.body.data.link.id as string;

    const legacyAuditId = await insertAuditLog(admin.id, null, {
      passwordHash: "never-return",
      authorization: "Bearer never-return",
      safe: "visible",
    });

    const auditList = await request(app)
      .get("/api/v1/audit?page=1&pageSize=20")
      .set(bearer(adminAuth.accessToken))
      .expect(200);
    expect(auditList.body.success).toBe(true);
    expect(Array.isArray(auditList.body.data)).toBe(true);

    const invalidAuditPage = await request(app)
      .get("/api/v1/audit?pageSize=10000")
      .set(bearer(adminAuth.accessToken))
      .expect(422);
    expect(invalidAuditPage.body.error.code).toBe("VALIDATION_FAILED");

    const auditDetail = await request(app)
      .get(`/api/v1/audit/${legacyAuditId}`)
      .set(bearer(adminAuth.accessToken))
      .expect(200);
    expect(auditDetail.body.data.after).toEqual({
      passwordHash: "[REDACTED]",
      authorization: "[REDACTED]",
      safe: "visible",
    });

    await request(app)
      .patch(`/api/v1/audit/${legacyAuditId}`)
      .set(bearer(adminAuth.accessToken))
      .send({ action: "forbidden" })
      .expect(404);

    const unlink = await request(app)
      .delete(`/api/v1/documents/${fileId}/link/${linkId}`)
      .set(bearer(ownerAuth.accessToken))
      .expect(200);
    expect(unlink.body.data).toEqual({ unlinked: true });
    expect(storage.deleteRequests).toHaveLength(0);
  });

  it("returns indistinguishable private-file 404 responses and safe provider 503 responses", async () => {
    const owner = await createCustomer("module21-http-safe-owner@example.com", [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);
    const reader = await createCustomer("module21-http-safe-reader@example.com", [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);
    const ownerAuth = await authenticateUser(owner);
    const readerAuth = await authenticateUser(reader);

    const storage = new FakeObjectStorage();
    const service = new DocumentsAuditService({
      storage,
      uploadPolicy: testUploadPolicy(),
    });
    const app = createModule21TestApp(service);
    const privateFile = await insertConfirmedFile(owner.id);

    const foreignFile = await request(app)
      .get(`/api/v1/documents/${privateFile.id}/download`)
      .set(bearer(readerAuth.accessToken))
      .expect(404);
    const missingFile = await request(app)
      .get(`/api/v1/documents/${randomUUID()}/download`)
      .set(bearer(readerAuth.accessToken))
      .expect(404);

    expect(foreignFile.body.error).toEqual(missingFile.body.error);
    expect(foreignFile.body.error.code).toBe(DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND);

    const uploadSecret = "upload-provider-secret-must-not-escape";
    storage.uploadError = new Error(uploadSecret);
    const uploadFailure = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(ownerAuth.accessToken))
      .send({
        originalName: "proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(503);
    expect(uploadFailure.body.error.code).toBe(ERROR_CODE.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(uploadFailure.body)).not.toContain(uploadSecret);

    const failedUploadRows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from files where owner_user_id = $1 and status = $2",
      [owner.id, DOCUMENT_FILE_STATUS.FAILED],
    );
    expect(failedUploadRows.rows[0]?.count).toBe(1);

    storage.uploadError = null;
    const signForConfirmFailure = await request(app)
      .post("/api/v1/documents/uploads/sign")
      .set(bearer(ownerAuth.accessToken))
      .send({
        originalName: "confirm-provider-proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      })
      .expect(201);
    const confirmationSecret = "metadata-provider-secret-must-not-escape";
    storage.metadataError = new Error(confirmationSecret);
    const confirmFailure = await request(app)
      .post(`/api/v1/documents/uploads/${signForConfirmFailure.body.data.fileId}/confirm`)
      .set(bearer(ownerAuth.accessToken))
      .expect(503);
    expect(confirmFailure.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.FILE_UPLOAD_INVALID,
    );
    expect(JSON.stringify(confirmFailure.body)).not.toContain(confirmationSecret);
    storage.metadataError = null;

    const downloadSecret = "download-provider-secret-must-not-escape";
    storage.downloadError = new Error(downloadSecret);
    const downloadFailure = await request(app)
      .get(`/api/v1/documents/${privateFile.id}/download`)
      .set(bearer(ownerAuth.accessToken))
      .expect(503);
    expect(downloadFailure.body.error.code).toBe(ERROR_CODE.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(downloadFailure.body)).not.toContain(downloadSecret);
  });

  it("keeps seller audit list and detail reads inside the server-derived seller scope", async () => {
    const admin = await createPlatformAdmin("module21-seller-audit-admin@example.com");
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const sellerAUser = await createSellerUser(
      "module21-seller-a@example.com",
      sellerA,
      [DOCUMENT_AUDIT_PERMISSION.AUDIT_READ],
    );
    await createSellerUser(
      "module21-seller-b@example.com",
      sellerB,
      [DOCUMENT_AUDIT_PERMISSION.AUDIT_READ],
    );
    const auditA = await insertAuditLog(admin.id, sellerA);
    const auditB = await insertAuditLog(admin.id, sellerB);
    const sellerAAuth = await authenticateUser(sellerAUser);

    const app = createModule21TestApp(
      new DocumentsAuditService({
        storage: new FakeObjectStorage(),
        uploadPolicy: testUploadPolicy(),
      }),
    );

    const crossSellerList = await request(app)
      .get(`/api/v1/audit?sellerId=${sellerB}`)
      .set(bearer(sellerAAuth.accessToken))
      .expect(403);
    expect(crossSellerList.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.AUDIT_SCOPE_FORBIDDEN,
    );

    const crossSellerDetail = await request(app)
      .get(`/api/v1/audit/${auditB}`)
      .set(bearer(sellerAAuth.accessToken))
      .expect(404);
    expect(crossSellerDetail.body.error.code).toBe(
      DOCUMENT_AUDIT_ERROR_CODE.AUDIT_SCOPE_FORBIDDEN,
    );

    const ownList = await request(app)
      .get("/api/v1/audit")
      .set(bearer(sellerAAuth.accessToken))
      .expect(200);
    expect(ownList.body.data.length).toBeGreaterThan(0);
    expect(
      ownList.body.data.every((row: { sellerId: string }) => row.sellerId === sellerA),
    ).toBe(true);

    const ownDetail = await request(app)
      .get(`/api/v1/audit/${auditA}`)
      .set(bearer(sellerAAuth.accessToken))
      .expect(200);
    expect(ownDetail.body.data.id).toBe(auditA);
    expect(ownDetail.body.data.sellerId).toBe(sellerA);
  });

  it("denies a Seller A resource operation against Seller B through an injected future-resource policy", async () => {
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const sellerResourceA = randomUUID();
    const sellerResourceB = randomUUID();
    const user = await createSellerUser("module21-resource-seller-a@example.com", sellerA, [
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
      DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    ]);
    const { context } = await authenticateUser(user);
    const file = await insertConfirmedFile(user.id);
    const resourcePolicy = new TestSellerResourcePolicy(
      new Map([
        [sellerResourceA, sellerA],
        [sellerResourceB, sellerB],
      ]),
    );
    const service = new DocumentsAuditService({
      storage: new FakeObjectStorage(),
      uploadPolicy: testUploadPolicy(),
      resourcePolicy,
    });

    await service.linkFile(context, file.id, {
      resourceType: "seller_resource",
      resourceId: sellerResourceA,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
    });

    await expect(
      service.linkFile(context, file.id, {
        resourceType: "seller_resource",
        resourceId: sellerResourceB,
        purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      }),
    ).rejects.toMatchObject({
      code: DOCUMENT_AUDIT_ERROR_CODE.FILE_NOT_FOUND,
      statusCode: 404,
    });
  });
});

afterAll(async () => {
  await closeDatabase();
});
