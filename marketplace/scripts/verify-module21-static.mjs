import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");

/** Throws one focused final Module 21 verification error. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Resolves one delivery-root relative path. */
function resolve(relativePath) {
  return path.join(rootDirectory, relativePath);
}

/** Reads one UTF-8 project file. */
function read(relativePath) {
  const source = readFileSync(resolve(relativePath), "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one file to exist in the final delivery. */
function requireFile(relativePath) {
  assertCondition(existsSync(resolve(relativePath)), `Required final file is missing: ${relativePath}`);
}

/** Requires one source file to contain every listed release marker. */
function requireText(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    assertCondition(source.includes(marker), `${relativePath} is missing release marker: ${marker}`);
  }
}

/** Recursively collects files matching one predicate. */
function collectFiles(directory, predicate) {
  const results = [];
  for (const entry of readdirSync(resolve(directory))) {
    const relativePath = path.join(directory, entry);
    if (statSync(resolve(relativePath)).isDirectory()) {
      results.push(...collectFiles(relativePath, predicate));
    } else if (predicate(entry)) {
      results.push(relativePath);
    }
  }
  return results;
}

/** Verifies the final Module 21 implementation, release wiring, E2E assets and cleanup boundary. */
function main() {
  const required = [
    "backend/src/modules/documents-audit/documents-audit.repository.ts",
    "backend/src/modules/documents-audit/documents-audit.service.ts",
    "backend/src/modules/documents-audit/documents-audit.schema.ts",
    "backend/src/modules/documents-audit/documents-audit.constants.ts",
    "backend/src/modules/documents-audit/documents-audit.routes.ts",
    "backend/src/modules/documents-audit/documents-audit.controller.ts",
    "backend/src/modules/documents-audit/documents-audit.routes.ts",
    "backend/src/database/schema/audit.ts",
    "backend/drizzle/0004_documents_audit_core.sql",
    "backend/drizzle/0005_documents_audit_integrity.sql",
    "backend/tests/module21/module21.integration.test.ts",
    "backend/tests/module21/module21.service.test.ts",
    "backend/tests/module21/module21.test-helpers.ts",
    "backend/src/database/seeds/module21-e2e.seed.ts",
    "backend/scripts/prepare-module21-e2e-storage.mjs",
    "frontend/src/features/documents-audit/pages/documents.page.tsx",
    "frontend/src/features/documents-audit/pages/audit.page.tsx",
    "frontend/src/features/documents-audit/pages/audit-detail.page.tsx",
    "frontend/tests/module21-documents-audit.test.tsx",
    "frontend/e2e/module21.spec.ts",
    "scripts/verify-module21.mjs",
  ];
  required.forEach(requireFile);

  requireText("backend/src/modules/documents-audit/documents-audit.routes.ts", [
    '"/uploads/sign"',
    '"/uploads/:id/confirm"',
    '"/:id/link"',
    '"/:id/download"',
    '"/:id/link/:linkId"',
    'router.get(\n    "/"',
    'router.get(\n    "/:id"',
    "authenticationMiddleware",
    "requirePermission",
    "DOCUMENTS_UPLOAD",
    "DOCUMENTS_LINK",
    "DOCUMENTS_READ",
    "AUDIT_READ",
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.controller.ts", [
    "signUploadBodySchema.parse",
    "confirmUploadParamsSchema.parse",
    "linkFileBodySchema.parse",
    "documentIdParamsSchema.parse",
    "unlinkFileParamsSchema.parse",
    "auditListQuerySchema.parse",
    "auditIdParamsSchema.parse",
    "this.service.signUpload",
    "this.service.confirmUpload",
    "this.service.linkFile",
    "this.service.getDownload",
    "this.service.unlinkFile",
    "this.service.listAuditLogs",
    "this.service.getAuditLog",
  ]);
  requireText("backend/src/app.ts", [
    'app.use(`${API_V1_PREFIX}/documents`, documentsRouter)',
    'app.use(`${API_V1_PREFIX}/audit`, auditRouter)',
  ]);
  requireText("backend/src/http/openapi/openapi.document.ts", [
    "documentsAuditOpenApiPaths",
    "...documentsAuditOpenApiPaths",
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.service.ts", [
    "createObjectKey",
    "getObjectMetadata",
    "FILE_SCOPE_FORBIDDEN",
    "SERVICE_UNAVAILABLE",
    "requireManagedFile",
    "requireReadableFile",
    "markFailedUploadBestEffort",
    "resolveAuditScope",
    "redactAuditValue",
    "FILE_UPLOAD_CONFIRMED",
    "FILE_LINKED",
    "FILE_UNLINKED",
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.repository.ts", [
    "findFileOwnedByUser",
    "markPendingFileFailed",
    "findFileLinkedToResource",
    "innerJoin(fileLinks",
    "auditScopeCondition",
  ]);
  requireText("backend/src/config/env.ts", [
    'STORAGE_PROVIDER: z.enum(["s3", "r2", "s3_compatible"])',
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.runtime.ts", [
    "storageProvider: env.STORAGE_PROVIDER",
  ]);
  requireText("backend/drizzle/0004_documents_audit_core.sql", [
    "files",
    "file_links",
    "audit_logs",
    "audit_logs_prevent_update_delete",
  ]);
  requireText("backend/drizzle/0005_documents_audit_integrity.sql", [
    'ADD COLUMN "purpose"',
    'files_purpose_check',
    'file_links_purpose_check',
    'audit_logs_actor_type_check',
  ]);
  requireText("frontend/e2e/module21.spec.ts", [
    "signed upload, account link, authorized download, and unlink",
    "another user's private file is hidden exactly like a missing file",
    'expect(hidden.status()).toBe(404)',
    'expect(missing.status()).toBe(404)',
    'expect(hiddenBody.error?.code).toBe("FILE_NOT_FOUND")',
    "admin audit search validates and applies the actor user ID filter",
    'getByLabel("Audit actor user ID")',
    "seller audit reads stay inside the server-derived seller scope",
    "must-never-appear-in-audit-output",
  ]);
  const module21E2e = read("frontend/e2e/module21.spec.ts");
  assertCondition(
    !module21E2e.includes("`${apiBase}/admin/permissions"),
    "Module 21 E2E must derive permission IDs from approved role-list data.",
  );
  assertCondition(
    !module21E2e.includes("context.post(`${apiBase}/admin/users`"),
    "Module 21 E2E must not recreate users through the removed Administration create-user API.",
  );
  requireText("backend/docker-compose.test.yml", [
    "minio-test:",
    'profiles: ["module21"]',
    '"59000:9000"',
  ]);
  requireText("backend/package.json", [
    '"db:seed:module21-e2e"',
    '"storage:prepare:module21-e2e"',
    '"test:module21"',
  ]);
  requireText("scripts/verify-module21.mjs", [
    'STORAGE_PROVIDER: "s3_compatible"',
    "verifyLiveOpenApi",
    'signDocumentUpload',
    'confirmDocumentUpload',
    'linkDocumentFile',
    'createDocumentDownload',
    'unlinkDocumentFile',
    'listAuditLogs',
    'getAuditLog',
    'logStage("Backend lint, typecheck and migration gates")',
    'logStage("Foundation backend regression")',
    'logStage("Module 2 backend regression")',
    'logStage("Module 21 backend regression")',
    'logStage("Frontend regression")',
    'logStage("Playwright Foundation, Module 2 and Module 21 workflows")',
    'logStage("Post-E2E database integrity")',
    'logStage("Container build regression")',
  ]);
  requireText("backend/tests/module21/module21.service.test.ts", [
    "rejects invalid upload policy inputs before file metadata is persisted",
    "returns an already confirmed upload without re-reading provider metadata",
    "uses the same not-found result for missing and unrelated private files",
    "fails closed when resource policy passes but the repository link no longer exists",
    "forces seller audit reads to the exact server-derived seller permission scope",
  ]);
  requireText("backend/tests/module21/module21.integration.test.ts", [
    "Promise.all",
    "emptySellerScope",
    "covers all seven HTTP routes with real auth, RBAC, validation, redaction, and unlink behavior",
    "returns indistinguishable private-file 404 responses and safe provider 503 responses",
    "keeps seller audit list and detail reads inside the server-derived seller scope",
    "append-only audit storage",
  ]);
  requireText("frontend/package.json", [
    '"test:e2e:module21"',
    '"test:module21"',
  ]);

  requireText("backend/src/modules/documents-audit/documents-audit.schema.ts", [
    "AUDIT_SORT_VALUES",
    "DOCUMENT_AUDIT_PATTERN",
    "export type SignUploadInput",
    "export type AuditListQuery",
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.constants.ts", [
    'AUDIT_EXPORT: "audit.export"',
    'AUDIT_EXPORT_REQUESTED: "audit.export_requested"',
  ]);
  requireText("backend/src/modules/documents-audit/documents-audit.routes.ts", [
    "DOCUMENT_PURPOSE_VALUES",
    "DOCUMENT_FILE_STATUS_VALUES",
    "DOCUMENT_AUDIT_LIMITS",
    'required: ["success", "error", "requestId"]',
    "The command has no request body",
    'operationId: "signDocumentUpload"',
    'operationId: "confirmDocumentUpload"',
    'operationId: "linkDocumentFile"',
    'operationId: "createDocumentDownload"',
    'operationId: "unlinkDocumentFile"',
    'operationId: "listAuditLogs"',
    'operationId: "getAuditLog"',
    '"/api/v1/documents/uploads/sign"',
    '"/api/v1/documents/uploads/{id}/confirm"',
    '"/api/v1/documents/{id}/link"',
    '"/api/v1/documents/{id}/download"',
    '"/api/v1/documents/{id}/link/{linkId}"',
    '"/api/v1/audit"',
    '"/api/v1/audit/{id}"',
    "...serviceUnavailableFailure",
  ]);
  requireText("frontend/src/features/documents-audit/documents-audit.constants.ts", [
    'AUDIT_EXPORT: "audit.export"',
    "AUDIT_SORT_OPTIONS",
    "DOCUMENT_PURPOSE_OPTIONS",
    "hasDocumentPermission",
  ]);
  requireText("frontend/src/features/documents-audit/schemas/documents-audit.schemas.ts", [
    "DOCUMENT_PURPOSE_VALUES",
    "AUDIT_SORT_VALUES",
    "DOCUMENT_AUDIT_LIMITS",
    "actorUserId: optionalUuidText",
  ]);
  requireText("frontend/src/features/documents-audit/forms/audit-filter-form.tsx", [
    'name="actorUserId"',
    'aria-label="Audit actor user ID"',
    "actorUserId: optionalText(value.actorUserId)",
    "AUDIT_SORT_OPTIONS.map",
  ]);
  requireText("frontend/src/features/documents-audit/forms/file-upload-form.tsx", [
    "useUploadDocumentMutation",
    "TanStack Query owns the normalized mutation error",
    "FormError",
  ]);
  requireText("frontend/src/features/documents-audit/pages/audit-detail.page.tsx", [
    "onRetry={() => void audit.refetch()}",
  ]);
  assertCondition(
    !read("frontend/src/features/documents-audit/components/module-permission-gate.tsx").includes("function ModulePermissionGate"),
    "Unused ModulePermissionGate wrapper must not be recreated.",
  );
  requireText("frontend/tests/module21-documents-audit.test.tsx", [
    "shows a safe storage-upload error without leaving the documents page",
    "searches audit metadata with actor filtering and opens redacted audit detail",
    "No audit records matched the filters.",
    "shows a clear permission state when the actor cannot use document workflows",
  ]);
  assertCondition(
    !existsSync(resolve("backend/src/modules/documents-audit/documents-audit.types.ts")),
    "Redundant Module 21 backend inferred-types file must not be recreated.",
  );

  const migrations = readdirSync(resolve("backend/drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assertCondition(
    migrations.includes("0005_documents_audit_integrity.sql"),
    "Module 21 integrity migration must remain in the append-only migration history.",
  );

  const routeSource = read("backend/src/modules/documents-audit/documents-audit.routes.ts");
  assertCondition(!/router\.(patch|put|delete)\(\s*["']\/?audit/i.test(routeSource), "Audit mutation routes are forbidden.");

  const repositorySource = read("backend/src/modules/documents-audit/documents-audit.repository.ts");
  assertCondition(
    !repositorySource.includes("listFileLinksByResource"),
    "Unused Module 21 resource-link list repository helper must not be recreated.",
  );
  assertCondition(
    !repositorySource.includes("listLinkedFilesByResource"),
    "Unused Module 21 linked-file list repository helper must not be recreated.",
  );

  const controllerSource = read("backend/src/modules/documents-audit/documents-audit.controller.ts");
  assertCondition(!controllerSource.includes("DocumentsAuditRepository"), "Module 21 controller must not access repositories directly.");
  assertCondition(!controllerSource.includes("../../common/audit/"), "Module 21 controller must not import the audit writer directly.");
  assertCondition(!controllerSource.includes("../../common/outbox/"), "Module 21 controller must not import outbox services directly.");

  const passScripts = readdirSync(resolve("scripts")).filter((name) => /^verify-module21-pass\d+\.mjs$/.test(name));
  assertCondition(passScripts.length === 0, `Temporary Module 21 pass verifiers remain: ${passScripts.join(", ")}`);
  assertCondition(!existsSync(resolve("docs/MODULE_21_CHANGE_MAP.md")), "Temporary Module 21 change map must be removed in the final pass.");

  const moduleFiles = collectFiles("backend/src/modules/documents-audit", (name) => name.endsWith(".ts"));
  assertCondition(moduleFiles.length >= 8, "Documents/Audit backend module is unexpectedly incomplete.");
  const featureFiles = collectFiles("frontend/src/features/documents-audit", (name) => name.endsWith(".ts") || name.endsWith(".tsx"));
  assertCondition(featureFiles.length >= 12, "Documents/Audit frontend feature is unexpectedly incomplete.");

  const finalModuleSources = [
    ...moduleFiles,
    ...featureFiles,
    "backend/tests/module21/module21.integration.test.ts",
    "backend/tests/module21/module21.service.test.ts",
    "frontend/tests/module21-documents-audit.test.tsx",
    "frontend/e2e/module21.spec.ts",
  ];
  for (const relativePath of finalModuleSources) {
    assertCondition(
      !/\b(TODO|FIXME|HACK|XXX)\b/.test(read(relativePath)),
      `Incomplete placeholder remains in ${relativePath}.`,
    );
  }

  console.log("Module 21 static verification passed.");
}

main();
