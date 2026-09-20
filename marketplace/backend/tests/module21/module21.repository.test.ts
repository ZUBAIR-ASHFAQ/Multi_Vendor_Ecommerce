import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  DOCUMENT_FILE_STATUS,
  DOCUMENT_PURPOSE,
  DOCUMENT_STORAGE_PROVIDER,
} from "../../src/modules/documents-audit/documents-audit.constants.js";
import { DocumentsAuditRepository } from "../../src/modules/documents-audit/documents-audit.repository.js";
import { auditListQuerySchema } from "../../src/modules/documents-audit/documents-audit.schema.js";

/** Clears only Module 21 and prerequisite user rows needed by focused repository tests. */
async function resetModule21RepositoryTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      file_links,
      files,
      audit_logs,
      refresh_sessions,
      user_roles,
      role_permissions,
      platform_settings,
      users,
      permissions,
      roles,
      outbox_events,
      idempotency_keys
    RESTART IDENTITY CASCADE
  `);
}

/** Inserts one minimal active user for file ownership without invoking authentication services. */
async function createRepositoryUser(email: string): Promise<string> {
  const result = await databasePool.query<{ id: string }>(
    `insert into users
      (email, password_hash, display_name, account_type, status)
     values ($1, 'repository-test-hash', 'Repository User', 'customer', 'active')
     returning id`,
    [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Module 21 repository user insert did not return an id.");
  return id;
}

beforeEach(async () => {
  await resetModule21RepositoryTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 21 repository resource scope", () => {
  it("keeps file ownership, resource links, and seller audit reads scoped in SQL", async () => {
    const ownerA = await createRepositoryUser(
      `module21-repo-a-${randomUUID()}@example.com`,
    );
    const ownerB = await createRepositoryUser(
      `module21-repo-b-${randomUUID()}@example.com`,
    );
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const repository = new DocumentsAuditRepository();

    const fileA = await repository.createFile({
      storageProvider: DOCUMENT_STORAGE_PROVIDER.S3_COMPATIBLE,
      objectKey: `repository-tests/${randomUUID()}-a.pdf`,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      originalName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      ownerUserId: ownerA,
      status: DOCUMENT_FILE_STATUS.CONFIRMED,
    });

    await expect(repository.findFileOwnedByUser(fileA.id, ownerB)).resolves.toBeNull();
    await expect(repository.findFileOwnedByUser(fileA.id, ownerA)).resolves.toMatchObject({
      id: fileA.id,
      ownerUserId: ownerA,
    });

    const resourceA = randomUUID();
    const link = await repository.createFileLink({
      fileId: fileA.id,
      resourceType: "user",
      resourceId: resourceA,
      purpose: DOCUMENT_PURPOSE.OPERATIONAL_EVIDENCE,
      createdBy: ownerA,
    });
    await expect(
      repository.findFileLinkedToResource(fileA.id, "user", randomUUID()),
    ).resolves.toBeNull();
    await expect(
      repository.findFileLinkedToResource(fileA.id, "user", resourceA),
    ).resolves.toMatchObject({ id: fileA.id });
    await expect(repository.findFileLink(fileA.id, link.id)).resolves.toMatchObject({
      id: link.id,
      fileId: fileA.id,
    });

    const auditA = randomUUID();
    const auditB = randomUUID();
    await databasePool.query(
      `insert into audit_logs
        (id, actor_user_id, actor_type, action, resource_type, resource_id, seller_id)
       values
        ($1, $3, 'customer', 'repository.test', 'test_resource', $4, $5),
        ($2, $3, 'customer', 'repository.test', 'test_resource', $6, $7)`,
      [auditA, auditB, ownerA, randomUUID(), sellerA, randomUUID(), sellerB],
    );

    const query = auditListQuerySchema.parse({ page: 1, pageSize: 20 });
    const sellerAList = await repository.listAuditLogs(query, {
      kind: "seller",
      sellerIds: [sellerA],
    });
    expect(sellerAList.items).toHaveLength(1);
    expect(sellerAList.items[0]).toMatchObject({ id: auditA, sellerId: sellerA });
    await expect(
      repository.findAuditLogById(auditB, { kind: "seller", sellerIds: [sellerA] }),
    ).resolves.toBeNull();
  });
});
