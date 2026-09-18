import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const backendDirectory = path.join(rootDirectory, "marketplace-backend");
const frontendDirectory = path.join(rootDirectory, "marketplace-frontend");

/** Throws a focused static-verification error when one condition is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Reads one UTF-8 project file relative to the delivery root. */
function read(relativePath) {
  return readFileSync(path.join(rootDirectory, relativePath), "utf8");
}

/** Returns all files under one directory using simple recursive traversal. */
function walk(directory) {
  if (!existsSync(directory)) return [];

  const entries = [];
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) entries.push(...walk(absolute));
    else entries.push(absolute);
  }
  return entries;
}

/** Verifies the two independent project names and required release infrastructure. */
function verifyProjectLayout() {
  assertCondition(existsSync(backendDirectory), "marketplace-backend/ is missing.");
  assertCondition(existsSync(frontendDirectory), "marketplace-frontend/ is missing.");
  assertCondition(!existsSync(path.join(rootDirectory, "backend")), "Legacy backend/ directory must not remain.");
  assertCondition(!existsSync(path.join(rootDirectory, "frontend")), "Legacy frontend/ directory must not remain.");
  assertCondition(!existsSync(path.join(rootDirectory, "package.json")), "The delivery root must not become a workspace package.");
  assertCondition(!existsSync(path.join(rootDirectory, "pnpm-workspace.yaml")), "pnpm workspace coupling is not allowed.");
  assertCondition(!existsSync(path.join(rootDirectory, "turbo.json")), "Turborepo coupling is not allowed.");

  for (const required of [
    "marketplace-backend/Dockerfile",
    "marketplace-backend/.github/workflows/ci.yml",
    "marketplace-frontend/Dockerfile",
    "marketplace-frontend/.github/workflows/ci.yml",
  ]) {
    assertCondition(existsSync(path.join(rootDirectory, required)), `${required} is missing.`);
  }
}

/** Verifies the final Module 2 backend boundary and database contract. */
function verifyBackendContract() {
  const schema = read("marketplace-backend/src/database/schema/administration.ts");
  const authService = read("marketplace-backend/src/modules/administration/auth.service.ts");
  const administrationService = read(
    "marketplace-backend/src/modules/administration/administration.service.ts",
  );
  const requestContext = read("marketplace-backend/src/common/types/request-context.ts");
  const apiTypes = read("marketplace-backend/src/common/types/api.ts");
  const authRoutes = read("marketplace-backend/src/modules/administration/auth.routes.ts");
  const adminRoutes = read("marketplace-backend/src/modules/administration/administration.routes.ts");
  const authOpenApi = read("marketplace-backend/src/modules/administration/auth.routes.ts");
  const adminOpenApi = read("marketplace-backend/src/modules/administration/administration.routes.ts");

  for (const token of [
    "accountType",
    "scopeType",
    "sellerId",
    "platformSettings",
    "userAgentHash",
    "refreshSessions",
    "tokenFamilyHash",
    '"refresh_sessions"',
    '"token_family_hash"',
  ]) {
    assertCondition(schema.includes(token), `Database schema is missing ${token}.`);
  }
  assertCondition(
    !schema.includes('"auth_sessions"'),
    "Current Drizzle schema must use refresh_sessions, not the legacy auth_sessions table.",
  );
  assertCondition(
    !schema.includes('familyId: uuid("family_id")'),
    "Current Drizzle schema must use token_family_hash, not the legacy family_id column.",
  );
  for (const token of ["sellerIds", "storeIds", "sellerPermissions"]) {
    assertCondition(requestContext.includes(token), `RequestContext is missing ${token}.`);
  }
  assertCondition(authService.includes("actorTypeForAccountType"), "AuthService must derive actor type from persisted account type.");
  assertCondition(!authService.includes("actorType: ACTOR_TYPE.PLATFORM_ADMIN"), "AuthService must not hard-code every request as platform admin.");
  assertCondition(
    administrationService.includes("eventType: ADMIN_OUTBOX_EVENT.ROLE_UPDATED"),
    "Updating an existing role must emit the required role.updated outbox event.",
  );
  assertCondition(
    administrationService.includes("eventType: ADMIN_OUTBOX_EVENT.ROLE_PERMISSIONS_CHANGED"),
    "Role permission updates must preserve the existing granular role.permissions_changed event.",
  );
  assertCondition(apiTypes.includes("fieldErrors?:"), "Stable API errors must expose fieldErrors.");
  assertCondition(!apiTypes.includes("fields?:"), "Legacy fields error property must not remain.");

  const routeExpectations = [
    [authRoutes, 'router.post("/register"', "POST /api/v1/auth/register"],
    [authRoutes, 'router.post("/login"', "POST /api/v1/auth/login"],
    [authRoutes, 'router.post("/refresh"', "POST /api/v1/auth/refresh"],
    [authRoutes, 'router.post("/logout"', "POST /api/v1/auth/logout"],
    [authRoutes, 'router.get("/me"', "GET /api/v1/auth/me"],
    [adminRoutes, '"/users/:id/status"', "PATCH /api/v1/admin/users/:id/status"],
    [adminRoutes, '"/users/:id/roles"', "PUT /api/v1/admin/users/:id/roles"],
    [adminRoutes, '"/roles/:id/permissions"', "PUT /api/v1/admin/roles/:id/permissions"],
    [adminRoutes, '"/settings"', "platform settings routes"],
  ];
  for (const [source, token, label] of routeExpectations) {
    assertCondition(source.includes(token), `${label} is missing.`);
  }
  assertCondition(
    /router\.patch\(\s*"\/users\/:id\/status"/s.test(adminRoutes),
    "User status must use PATCH, not POST.",
  );

  const forbiddenOperations = [
    "/logout-all",
    "/change-password",
    "/forgot-password",
    "/reset-password",
    'router.post("/users"',
    'router.get("/users/:id"',
    'router.patch("/users/:id"',
    'router.get("/roles/:id"',
    'router.patch("/roles/:id"',
    '"/permissions"',
  ];
  for (const operation of forbiddenOperations) {
    assertCondition(
      !authRoutes.includes(operation) && !adminRoutes.includes(operation),
      `Unapproved Module 2 HTTP operation remains: ${operation}`,
    );
  }
  assertCondition(
    !existsSync(path.join(backendDirectory, "src/modules/administration/auth.openapi.ts")) &&
      !existsSync(path.join(backendDirectory, "src/modules/administration/administration.openapi.ts")),
    "Standalone Module 2 OpenAPI files must be removed after route-owned metadata migration.",
  );

  for (const requiredPath of [
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/me",
  ]) {
    assertCondition(authOpenApi.includes(requiredPath), `OpenAPI is missing ${requiredPath}.`);
  }
  for (const requiredPath of [
    "/api/v1/admin/users/{id}/status",
    "/api/v1/admin/users/{id}/roles",
    "/api/v1/admin/roles/{id}/permissions",
    "/api/v1/admin/settings",
  ]) {
    assertCondition(adminOpenApi.includes(requiredPath), `OpenAPI is missing ${requiredPath}.`);
  }
  assertCondition(!existsSync(path.join(backendDirectory, "src/modules/auth")), "Authentication must stay inside the Administration Module 2 boundary.");
}

/** Verifies the frontend callers and required Module 2 user workflows. */
function verifyFrontendContract() {
  const authApi = read("marketplace-frontend/src/features/auth/api/auth.api.ts");
  const adminApi = read("marketplace-frontend/src/features/administration/api/administration.api.ts");
  const authRoutes = read("marketplace-frontend/src/app/routes/auth.routes.tsx");
  const adminRoutes = read("marketplace-frontend/src/app/routes/administration.routes.tsx");
  const loginForm = read("marketplace-frontend/src/features/auth/forms/login-form.tsx");
  const e2e = read("marketplace-frontend/e2e/module2.spec.ts");

  assertCondition(authApi.includes('"/auth/register"'), "Frontend registration API caller is missing.");
  assertCondition(adminApi.includes('"/admin/settings"'), "Frontend platform-settings API caller is missing.");
  assertCondition(adminApi.includes("assignments"), "Frontend role updates must use seller-aware assignments.");
  for (const route of ["/register", "/account"]) {
    assertCondition(authRoutes.includes(route), `Frontend route ${route} is missing.`);
  }
  assertCondition(adminRoutes.includes("/admin/settings"), "Frontend route /admin/settings is missing.");
  for (const removedRoute of ["/forgot-password", "/reset-password", "/account/security", "/admin/permissions"]) {
    assertCondition(!authRoutes.includes(removedRoute) && !adminRoutes.includes(removedRoute), `Removed frontend route remains: ${removedRoute}`);
  }
  assertCondition(!loginForm.includes('to: "/admin/users"'), "Login must not hard-code every actor to the admin users page.");
  for (const scenario of [
    "customer registration",
    "platform settings",
    "custom customer role",
    "access-denied admin page",
    "deactivating a registered customer",
    "live OpenAPI exposes only the approved",
  ]) {
    assertCondition(e2e.includes(scenario), `Playwright coverage is missing ${scenario}.`);
  }

  for (const removedE2eCall of [
    "`${apiBase}/admin/permissions",
    "context.post(`${apiBase}/admin/users`",
    'page.goto("/account/security")',
    "`${apiBase}/auth/change-password",
    "`${apiBase}/auth/logout-all",
  ]) {
    assertCondition(!e2e.includes(removedE2eCall), `Stale removed-route E2E call remains: ${removedE2eCall}`);
  }
}

/** Verifies backend Module 2 tests target only the approved production contract plus explicit removed-route negatives. */
function verifyBackendTestAlignment() {
  const integration = read("marketplace-backend/tests/module2/module2.integration.test.ts");
  const schemas = read("marketplace-backend/tests/module2/module2.schemas.test.ts");

  for (const removedRoute of [
    "/api/v1/auth/logout-all",
    "/api/v1/auth/change-password",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/admin/permissions",
  ]) {
    assertCondition(integration.includes(removedRoute), `Backend 404 regression is missing ${removedRoute}.`);
  }
  assertCondition(integration.includes(".expect(404)"), "Removed Module 2 routes must be proven as 404 responses.");
  assertCondition(
    integration.includes("test downstream provisioning failure"),
    "Registration transaction rollback coverage is missing.",
  );
  for (const removedContract of [
    "changePasswordBodySchema",
    "forgotPasswordBodySchema",
    "resetPasswordBodySchema",
    "createUserBodySchema",
    "updateUserBodySchema",
  ]) {
    assertCondition(!schemas.includes(removedContract), `Stale backend schema test remains: ${removedContract}`);
  }
  assertCondition(
    existsSync(path.join(backendDirectory, "tests/module2/module2.business-rules.integration.test.ts")),
    "Functional Module 2 business-rule integration tests are missing.",
  );
  assertCondition(
    !existsSync(path.join(backendDirectory, "tests/module2/module2.remediation.integration.test.ts")),
    "Historical remediation-named Module 2 test file must not remain.",
  );
}

/** Verifies junior-friendly source formatting and short documentation comments on named functions. */
function verifyReadability() {
  const sourceFiles = [
    ...walk(path.join(backendDirectory, "src")),
    ...walk(path.join(frontendDirectory, "src")),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

  const functionPatterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*(?:readonly\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^=]+)?\{\s*$/,
    /^\s*(?:public\s+|private\s+|protected\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  ];
  const ignoredNames = new Set(["if", "for", "while", "switch", "catch", "constructor"]);

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    assertCondition(!/\b(TODO|FIXME|HACK)\b/.test(source), `${path.relative(rootDirectory, file)} contains unfinished TODO/FIXME/HACK text.`);
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      assertCondition(lines[index].length <= 140, `${path.relative(rootDirectory, file)}:${index + 1} exceeds 140 characters.`);
      let functionName = null;
      for (const pattern of functionPatterns) {
        const match = lines[index].match(pattern);
        if (match) {
          functionName = match[1];
          break;
        }
      }
      if (!functionName || ignoredNames.has(functionName)) continue;
      const nearby = lines.slice(Math.max(0, index - 5), index).join("\n");
      assertCondition(
        nearby.includes("/**"),
        `${path.relative(rootDirectory, file)}:${index + 1} function ${functionName} needs a short documentation comment.`,
      );
    }
  }
}

/** Verifies obsolete pass-evidence artifacts and known dead helper functions were removed. */
function verifyCleanup() {
  assertCondition(!existsSync(path.join(rootDirectory, "PASS_STATE.json")), "PASS_STATE.json is obsolete release evidence and must be removed.");
  assertCondition(
    !existsSync(path.join(rootDirectory, "docs/REMEDIATION_CONTRACT.md")),
    "Historical remediation/pass evidence must not remain in the final release tree.",
  );
  const docsDirectory = path.join(rootDirectory, "docs");
  const obsoleteDocs = walk(docsDirectory).filter((file) => /PASS_|REMEDIATION_PASS_|PASS_HISTORY|PASS_SEQUENCE/i.test(path.basename(file)));
  assertCondition(obsoleteDocs.length === 0, `Obsolete pass evidence remains: ${obsoleteDocs.map((file) => path.relative(rootDirectory, file)).join(", ")}`);

  const backendScripts = readdirSync(path.join(backendDirectory, "scripts"));
  const obsoleteScripts = backendScripts.filter((name) => /pass\d|pass-\d/i.test(name));
  assertCondition(obsoleteScripts.length === 0, `Obsolete backend pass scripts remain: ${obsoleteScripts.join(", ")}`);
  const frontendScriptsDirectory = path.join(frontendDirectory, "scripts");
  const obsoleteFrontendScripts = existsSync(frontendScriptsDirectory)
    ? readdirSync(frontendScriptsDirectory).filter((name) => /pass\d|pass-\d/i.test(name))
    : [];
  assertCondition(
    obsoleteFrontendScripts.length === 0,
    `Obsolete frontend pass scripts remain: ${obsoleteFrontendScripts.join(", ")}`,
  );
  assertCondition(!existsSync(path.join(rootDirectory, "scripts/verify-pass-8.mjs")), "Old Foundation pass runner must be removed.");
  assertCondition(!existsSync(path.join(rootDirectory, "scripts/verify-module2-pass-8.mjs")), "Old Module 2 pass runner must be removed.");

  for (const requiredPath of [
    "marketplace-frontend/src/features/auth/forms/login-form.tsx",
    "marketplace-frontend/src/features/auth/forms/register-form.tsx",
    "marketplace-frontend/src/features/auth/schemas/auth.schemas.ts",
    "marketplace-frontend/src/features/auth/types/auth.types.ts",
    "marketplace-frontend/src/features/administration/forms/create-role-form.tsx",
    "marketplace-frontend/src/features/administration/schemas/administration.schemas.ts",
    "marketplace-frontend/src/features/administration/types/administration.types.ts",
    "marketplace-frontend/src/features/payments/forms/payment-element-form.tsx",
  ]) {
    assertCondition(existsSync(path.join(rootDirectory, requiredPath)), `Required feature file is missing: ${requiredPath}`);
  }

  for (const obsoletePath of [
    "marketplace-frontend/src/features/auth/components/login-form.tsx",
    "marketplace-frontend/src/features/auth/components/register-form.tsx",
    "marketplace-frontend/src/features/auth/auth.schemas.ts",
    "marketplace-frontend/src/features/auth/auth.types.ts",
    "marketplace-frontend/src/features/administration/components/create-role-form.tsx",
    "marketplace-frontend/src/features/administration/administration.schemas.ts",
    "marketplace-frontend/src/features/administration/administration.types.ts",
    "marketplace-frontend/src/features/payments/components/payment-element-form.tsx",
  ]) {
    assertCondition(!existsSync(path.join(rootDirectory, obsoletePath)), `Misplaced feature file must be removed: ${obsoletePath}`);
  }

  const internalServiceMiddleware = read("marketplace-backend/src/common/middleware/internal-service.middleware.ts");
  const policySource = read("marketplace-backend/src/common/policies/policy.ts");
  const redisSource = read("marketplace-backend/src/common/redis/redis.client.ts");
  assertCondition(!internalServiceMiddleware.includes("export const INTERNAL_API_KEY_HEADER"), "Internal API header constant must stay private to its middleware.");
  assertCondition(!policySource.includes("export function assertSellerScope"), "Internal seller-scope helper must stay private to the policy module.");
  assertCondition(!redisSource.includes("export function createRedisClient"), "Raw Redis client factory must stay private behind get/connect helpers.");

  const authMiddleware = read("marketplace-backend/src/common/middleware/authentication.middleware.ts");
  const refreshTokens = read("marketplace-backend/src/common/security/refresh-token.service.ts");
  assertCondition(!authMiddleware.includes("getAuthenticatedUser"), "Unused authenticated-user response-local helper must be removed.");
  assertCondition(!refreshTokens.includes("matches("), "Unused refresh-token matches helper must be removed.");
  assertCondition(
    !existsSync(path.join(backendDirectory, "src/modules/administration/password-reset-token.service.ts")),
    "Password-reset service must be removed with the unapproved password-reset HTTP operations.",
  );

  const administrationSchema = readFileSync(
    path.join(backendDirectory, "src/database/schema/administration.ts"),
    "utf8",
  );
  const relationDefinitionsSource = readFileSync(
    path.join(backendDirectory, "src/database/relations.ts"),
    "utf8",
  );
  const passwordResetCleanupMigrationPath = path.join(
    backendDirectory,
    "drizzle/0015_remove_unused_password_reset_tokens.sql",
  );
  assertCondition(
    !administrationSchema.includes("passwordResetTokens") &&
      !administrationSchema.includes("password_reset_tokens"),
    "Unused password-reset persistence must not remain in the current Drizzle schema.",
  );
  assertCondition(
    !relationDefinitionsSource.includes("passwordResetTokens"),
    "Unused password-reset relations must not remain in the current relation definitions.",
  );
  assertCondition(
    existsSync(passwordResetCleanupMigrationPath),
    "Append-only password-reset persistence cleanup migration is missing.",
  );
  const passwordResetCleanupMigration = readFileSync(passwordResetCleanupMigrationPath, "utf8");
  assertCondition(
    passwordResetCleanupMigration.includes('DROP TABLE "password_reset_tokens"'),
    "Password-reset cleanup migration must drop the unused persistence table.",
  );
  const refreshSessionAlignmentMigrationPath = path.join(
    backendDirectory,
    "drizzle/0016_refresh_session_contract_alignment.sql",
  );
  assertCondition(
    existsSync(refreshSessionAlignmentMigrationPath),
    "Append-only refresh-session contract alignment migration is missing.",
  );
  const refreshSessionAlignmentMigration = readFileSync(
    refreshSessionAlignmentMigrationPath,
    "utf8",
  );
  for (const requiredText of [
    'RENAME TO "refresh_sessions"',
    '"token_family_hash"',
    'DROP COLUMN "family_id"',
    '"refresh_sessions_token_family_hash_check"',
  ]) {
    assertCondition(
      refreshSessionAlignmentMigration.includes(requiredText),
      `Refresh-session alignment migration is missing: ${requiredText}`,
    );
  }

  const module2MigrationVerifier = read(
    "marketplace-backend/scripts/verify-module2-migrations.mjs",
  );
  assertCondition(
    module2MigrationVerifier.includes("0015_remove_unused_password_reset_tokens.sql"),
    "Module 2 migration verification must cover the append-only password-reset cleanup.",
  );
  assertCondition(
    module2MigrationVerifier.includes("0016_refresh_session_contract_alignment.sql"),
    "Module 2 migration verification must cover the refresh-session contract alignment.",
  );
  assertCondition(
    module2MigrationVerifier.includes("password_reset_tokens persistence must not remain"),
    "Module 2 migration verification must prove the removed table is absent.",
  );
}

/** Runs the dependency-free Module 2 release-structure verification. */
function main() {
  const administrationConstants = read(
    "marketplace-backend/src/modules/administration/administration.constants.ts",
  );
  assertCondition(
    administrationConstants.includes('ROLE_UPDATED: "role.updated"'),
    "Module 2 contract must retain the required role.updated domain event name.",
  );
  verifyProjectLayout();
  verifyBackendContract();
  verifyFrontendContract();
  verifyBackendTestAlignment();
  verifyReadability();
  verifyCleanup();
  console.log("Module 2 static release verification passed.");
}

main();
