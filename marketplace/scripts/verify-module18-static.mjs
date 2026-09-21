import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required Module 18 source file and reports its exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 18 file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one source fragment that proves a fixed Module 18 contract. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms the Module 18 persistence head from Pass 1 remains immutable and present. */
function verifyDatabaseContract() {
  const migration = read("backend/drizzle/0032_notifications.sql");
  const schema = read("backend/src/database/schema/notifications.ts");
  for (const tableName of [
    "notification_templates",
    "notifications",
    "notification_deliveries",
    "notification_preferences",
  ]) {
    requireText(migration, `\"${tableName}\"`, "Module 18 migration");
    requireText(schema, `\"${tableName}\"`, "Module 18 Drizzle schema");
  }
}

/** Confirms source-defined permissions, errors, events, channels, statuses, and API operations stay fixed. */
function verifyConstants() {
  const constants = read(
    "backend/src/modules/notifications/notifications.constants.ts",
  );
  for (const value of [
    'IN_APP: "in_app"',
    'EMAIL: "email"',
    'ACTIVE: "active"',
    'INACTIVE: "inactive"',
    'QUEUED: "queued"',
    'PROCESSING: "processing"',
    'SENT: "sent"',
    'FAILED: "failed"',
    'READ_OWN: "notifications.read_own"',
    'PREFERENCES_MANAGE_OWN: "notifications.preferences.manage_own"',
    'ADMIN_READ: "admin.notifications.read"',
    'ADMIN_RETRY: "admin.notifications.retry"',
    'NOT_FOUND: "NOTIFICATION_NOT_FOUND"',
    'TEMPLATE_MISSING: "NOTIFICATION_TEMPLATE_MISSING"',
    'DELIVERY_FAILED: "NOTIFICATION_DELIVERY_FAILED"',
    'SCOPE_FORBIDDEN: "NOTIFICATION_SCOPE_FORBIDDEN"',
    'QUEUED: "notification.queued"',
    'SENT: "notification.sent"',
    'FAILED: "notification.failed"',
    'READ: "notification.read"',
  ]) {
    requireText(constants, value, "Module 18 constants");
  }

  for (const route of [
    "/api/v1/notifications",
    "/api/v1/notifications/:id/read",
    "/api/v1/notifications/read-all",
    "/api/v1/notifications/preferences",
    "/api/v1/admin/notification-deliveries",
    "/api/v1/admin/notification-deliveries/:id/retry",
  ]) {
    requireText(constants, route, "Module 18 route constants");
  }
}

/** Confirms strict request/response boundaries exist without inventing undocumented list filters. */
function verifySchemas() {
  const schema = read("backend/src/modules/notifications/notifications.schema.ts");
  for (const proof of [
    "notificationsListQuerySchema = paginationQuerySchema.strict()",
    "adminNotificationDeliveriesQuerySchema = paginationQuerySchema.strict()",
    "markNotificationReadBodySchema = z.object({}).strict().default({})",
    "markAllNotificationsReadBodySchema = z.object({}).strict().default({})",
    "retryNotificationDeliveryBodySchema = z.object({}).strict().default({})",
    "updateNotificationPreferencesBodySchema",
    "Each notification event/channel preference may appear only once.",
    "notificationsListMetaSchema",
    "unreadCount: z.number().int().nonnegative()",
    "destinationMasked:",
    "notificationTemplateRecordSchema",
  ]) {
    requireText(schema, proof, "Module 18 Zod contracts");
  }
  requireText(read("backend/src/modules/notifications/index.ts"), "notifications.schema.js", "Module 18 index");
}

/** Confirms Notification permissions are composed into platform roles without moving ownership into Module 2. */
function verifyRbacComposition() {
  const seed = read("backend/src/database/seeds/platform-rbac.seed.ts");
  for (const proof of [
    "NOTIFICATIONS_PERMISSION_CATALOG",
    "NOTIFICATIONS_PERMISSION.READ_OWN",
    "NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN",
  ]) {
    requireText(seed, proof, "Platform RBAC composition");
  }
}


/** Confirms the Pass 3 repository keeps ownership, idempotency, template, preference, and retry persistence boundaries. */
function verifyRepositoryPass() {
  const repository = read(
    "backend/src/modules/notifications/notifications.repository.ts",
  );
  for (const proof of [
    "listOwnedNotifications",
    "findOwnedNotificationById",
    "markOwnedNotificationRead",
    "markAllOwnedNotificationsRead",
    "listUserPreferences",
    "findUserPreference",
    "replaceUserPreferences",
    "ensureTemplate",
    "findActiveTemplate",
    "findSourceEventById",
    "findDeliveryByEventRecipientChannel",
    "createDeliveryIfMissing",
    "attachNotificationToDelivery",
    "findDeliveryByIdForUpdate",
    "updateDeliveryState",
    "listFailedDeliveries",
    "onConflictDoNothing",
    "destinationMasked",
  ]) {
    requireText(repository, proof, "Module 18 repository");
  }

  requireText(
    read("backend/src/modules/notifications/index.ts"),
    "notifications.repository.js",
    "Module 18 index",
  );

  const tests = read("backend/tests/module18/module18.repository.test.ts");
  requireText(tests, "keeps Notification reads and read-state writes inside the owning user scope", "Module 18 repository tests");
  requireText(tests, "idempotent by event/recipient/channel", "Module 18 repository tests");
  requireText(tests, "masked destinations", "Module 18 repository tests");

  const packageJson = JSON.parse(read("backend/package.json"));
  if (
    packageJson.scripts?.["test:module18:repository"] !==
    "vitest run tests/module18/module18.schemas.test.ts tests/module18/module18.repository.test.ts"
  ) {
    throw new Error("Backend package.json must expose the Module 18 repository test command.");
  }

  const ci = read("backend/.github/workflows/ci.yml");
  requireText(ci, "npm run test:module18:repository", "Backend CI");
}

/** Confirms Pass 4 service orchestration owns policy, durable preparation, read state, retry audit, and outbox behavior. */
function verifyServicePass() {
  const service = read(
    "backend/src/modules/notifications/notifications.service.ts",
  );
  for (const proof of [
    "class NotificationsService",
    "listNotifications",
    "markNotificationRead",
    "markAllNotificationsRead",
    "getPreferences",
    "updatePreferences",
    "listFailedDeliveries",
    "retryFailedDelivery",
    "dispatchCommittedEvent",
    "prepareDispatchTarget",
    "findDeliveryByEventRecipientChannel",
    "createDeliveryIfMissing",
    "attachNotificationToDelivery",
    "findActiveTemplate",
    "findUserPreference",
    "resolveNotificationRecipient",
    "NOTIFICATIONS_OUTBOX_EVENT.READ",
    "NOTIFICATIONS_OUTBOX_EVENT.QUEUED",
    "NOTIFICATIONS_AUDIT_ACTION.DELIVERY_RETRY_REQUESTED",
    "This mandatory notification channel cannot be disabled.",
    "Notification template contains unsupported template syntax.",
  ]) {
    requireText(service, proof, "Module 18 service");
  }

  requireText(
    read("backend/src/modules/administration/administration.service.ts"),
    "resolveNotificationRecipient",
    "Module 2 Notification identity boundary",
  );
  requireText(
    read("backend/src/modules/notifications/index.ts"),
    "notifications.service.js",
    "Module 18 index",
  );

  const tests = read("backend/tests/module18/module18.service.test.ts");
  for (const proof of [
    "Module 18 Notifications service invariants",
    "owner-scoped",
    "policy-mandatory channel",
    "replays idempotently",
    "masked email destination",
    "non-allow-listed template variables",
    "duplicate retries harmless",
  ]) {
    requireText(tests, proof, "Module 18 service tests");
  }

  const packageJson = JSON.parse(read("backend/package.json"));
  if (
    packageJson.scripts?.["test:module18:service"] !==
    "vitest run tests/module18/module18.schemas.test.ts tests/module18/module18.repository.test.ts tests/module18/module18.service.test.ts"
  ) {
    throw new Error("Backend package.json must expose the Module 18 service test command.");
  }

  const ci = read("backend/.github/workflows/ci.yml");
  requireText(ci, "npm run test:module18:service", "Backend CI");
}



/** Confirms the required Socket.IO transport is authenticated, user-scoped, and fed only after durable in-app creation. */
function verifyRealtimePass() {
  const backendPackage = JSON.parse(read("backend/package.json"));
  const frontendPackage = JSON.parse(read("frontend/package.json"));
  if (!backendPackage.dependencies?.["socket.io"]) {
    throw new Error("Backend package.json must include socket.io for required realtime Notification delivery.");
  }
  if (!frontendPackage.dependencies?.["socket.io-client"]) {
    throw new Error("Frontend package.json must include socket.io-client for required realtime Notification delivery.");
  }

  const realtimeService = read("backend/src/common/realtime/realtime.service.ts");
  for (const proof of [
    'Server as SocketIoServer',
    'auth?.accessToken',
    'socket.data.userId = userId',
    'socket.join(userRoom(userId))',
    'NOTIFICATION_CREATED_EVENT = "notification.created"',
    'publishNotificationCreated',
  ]) {
    requireText(realtimeService, proof, "Module 18 Socket.IO service");
  }

  const notificationsService = read("backend/src/modules/notifications/notifications.service.ts");
  for (const proof of [
    "realtimePublisher?: NotificationRealtimePublisher",
    "publishPreparedInAppNotification(prepared)",
    "prepared.replayed",
    "prepared.notificationId",
    "publishNotificationCreated",
  ]) {
    requireText(notificationsService, proof, "Module 18 realtime service integration");
  }

  const server = read("backend/src/server.ts");
  for (const proof of [
    "createServer(app)",
    "realtimeService.start(",
    "authService.authenticateAccessToken",
    "env.CORS_ORIGINS",
    "realtimeService.closeConnections()",
  ]) {
    requireText(server, proof, "Backend realtime bootstrap");
  }

  const realtimeTest = read("backend/tests/module18/module18.realtime.test.ts");
  requireText(
    realtimeTest,
    "publishes only after a new durable in-app notification is prepared",
    "Module 18 realtime tests",
  );

  const frontendRealtime = read(
    "frontend/src/features/notifications/hooks/use-notification-realtime.ts",
  );
  for (const proof of [
    'from "socket.io-client"',
    'auth: { accessToken }',
    'NOTIFICATION_CREATED_EVENT = "notification.created"',
    "notificationsQueryKeys.all",
    "subscribeAccessToken",
  ]) {
    requireText(frontendRealtime, proof, "Frontend realtime Notification hook");
  }
}

/** Confirms Pass 5 controller, routes, RBAC middleware, app mounts, and OpenAPI registration are complete. */
function verifyHttpPass() {
  const controller = read(
    "backend/src/modules/notifications/notifications.controller.ts",
  );
  for (const proof of [
    "class NotificationsController",
    "listNotifications",
    "markNotificationRead",
    "markAllNotificationsRead",
    "getPreferences",
    "updatePreferences",
    "listFailedDeliveries",
    "retryFailedDelivery",
    "notificationsListQuerySchema.parse(request.query)",
    "notificationIdParamsSchema.parse(request.params)",
    "updateNotificationPreferencesBodySchema.parse(request.body)",
    "adminNotificationDeliveriesQuerySchema.parse(request.query)",
    "notificationDeliveryIdParamsSchema.parse(request.params)",
    "successResponse",
  ]) {
    requireText(controller, proof, "Module 18 controller");
  }

  const routes = read(
    "backend/src/modules/notifications/notifications.routes.ts",
  );
  for (const proof of [
    "createNotificationsRouter",
    "createAdminNotificationDeliveriesRouter",
    "router.use(authenticationMiddleware)",
    "requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN)",
    "requirePermission(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN)",
    "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_READ)",
    "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_RETRY)",
    '"/api/v1/notifications"',
    '"/api/v1/notifications/{id}/read"',
    '"/api/v1/notifications/read-all"',
    '"/api/v1/notifications/preferences"',
    '"/api/v1/admin/notification-deliveries"',
    '"/api/v1/admin/notification-deliveries/{id}/retry"',
    'required: ["success", "error", "requestId"]',
    'required: ["success", "data", "requestId"]',
  ]) {
    requireText(routes, proof, "Module 18 routes/OpenAPI");
  }

  const index = read("backend/src/modules/notifications/index.ts");
  requireText(index, "notifications.controller.js", "Module 18 index");
  requireText(index, "notifications.routes.js", "Module 18 index");

  const app = read("backend/src/app.ts");
  for (const proof of [
    "new NotificationsService({",
    "emailProvider: notificationEmailProvider",
    "new NotificationsController(notificationsService)",
    "createNotificationsRouter(notificationsController)",
    "createAdminNotificationDeliveriesRouter(",
    "`${API_V1_PREFIX}/notifications`",
    "`${API_V1_PREFIX}/admin/notification-deliveries`",
  ]) {
    requireText(app, proof, "Module 18 application composition");
  }

  const openApi = read("backend/src/http/openapi/openapi.document.ts");
  requireText(openApi, "notificationsOpenApiPaths", "Central OpenAPI");
  requireText(openApi, "...notificationsOpenApiPaths", "Central OpenAPI");
  requireText(openApi, 'name: "Notifications"', "Central OpenAPI");
}

/** Confirms Pass 6 BullMQ/provider/runtime wiring is durable, retry-safe, and independently tested. */
function verifyRuntimePass() {
  const constants = read("backend/src/modules/notifications/notifications.constants.ts");
  const policy = read("backend/src/modules/notifications/notifications.policy.ts");
  const jobs = read("backend/src/modules/notifications/notifications.jobs.ts");
  const service = read("backend/src/modules/notifications/notifications.service.ts");
  const provider = read("backend/src/integrations/email/resend-email-provider.adapter.ts");
  const factory = read("backend/src/integrations/email/notification-email-provider.factory.ts");
  const server = read("backend/src/server.ts");
  const app = read("backend/src/app.ts");

  for (const proof of [
    'SOURCE_EVENT_QUEUE: "notifications-source-events"',
    'UNCONFIGURED: "EMAIL_PROVIDER_UNCONFIGURED"',
    'DELIVERY_FAILED: "EMAIL_PROVIDER_DELIVERY_FAILED"',
  ]) {
    requireText(constants, proof, "Module 18 runtime constants");
  }
  for (const proof of [
    "DefaultNotificationDispatchPolicy",
    "DEFAULT_NOTIFICATION_TEMPLATES",
    "ORDERS_OUTBOX_EVENT.CREATED",
    "ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED",
    "SELLER_OUTBOX_EVENT.SELLER_APPROVED",
    "SELLER_OUTBOX_EVENT.SELLER_REJECTED",
    "INVENTORY_OUTBOX_EVENT.LOW_STOCK",
    "PAYMENTS_OUTBOX_EVENT.FAILED",
    "SHIPPING_OUTBOX_EVENT.DELIVERED",
    "RETURNS_OUTBOX_EVENT.REFUND_COMPLETED",
    "WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID",
    "resolveNotificationParticipants",
    "resolveNotificationOwnerUserId",
  ]) {
    requireText(policy, proof, "Module 18 event/recipient policy");
  }
  for (const proof of [
    "startNotificationsRuntime",
    "ensureDefaultTemplates",
    "processQueuedDelivery",
    "recordDeliveryFailure",
    "isFinalAttempt",
    "isNotificationLifecycleEvent",
  ]) {
    requireText(jobs, proof, "Module 18 BullMQ runtime");
  }
  for (const proof of [
    "processQueuedDelivery",
    "claimDeliveryAttempt",
    "resolveEmailMessage",
    "markDeliverySent",
    "recordDeliveryFailure",
    "NOTIFICATIONS_OUTBOX_EVENT.SENT",
    "NOTIFICATIONS_OUTBOX_EVENT.FAILED",
  ]) {
    requireText(service, proof, "Module 18 delivery service");
  }
  for (const proof of [
    '"Idempotency-Key": input.idempotencyKey',
    '`${this.baseUrl}/emails`',
    "providerRef: payload.id",
  ]) {
    requireText(provider, proof, "Module 18 Resend adapter");
  }
  requireText(factory, "DeterministicNotificationEmailProvider", "Module 18 email provider factory");
  requireText(app, "createNotificationEmailProvider", "Module 18 application composition");
  requireText(server, "startNotificationsRuntime(notificationsService)", "Module 18 server runtime");
  requireText(server, "NOTIFICATIONS_JOB.SOURCE_EVENT_QUEUE", "Foundation outbox fan-out");

  const providerTests = read("backend/tests/module18/module18.provider.test.ts");
  const jobsTests = read("backend/tests/module18/module18.jobs.test.ts");
  const policyTests = read("backend/tests/module18/module18.policy.test.ts");
  const startupTests = read("backend/tests/module18/module18.startup.test.ts");
  const integrationTests = read("backend/tests/module18/module18.integration.test.ts");
  const httpTests = read("backend/tests/module18/module18.http.test.ts");
  requireText(providerTests, "Module 18 email provider adapters", "Module 18 provider tests");
  requireText(jobsTests, "Module 18 Notification BullMQ runtime", "Module 18 jobs tests");
  requireText(policyTests, "Module 18 default Notification dispatch policy", "Module 18 policy tests");
  requireText(startupTests, "Module 18 release startup fail-fast behavior", "Module 18 startup tests");
  requireText(integrationTests, "Module 18 Notification runtime integration", "Module 18 integration tests");
  requireText(httpTests, "Module 18 Notification HTTP/RBAC integration", "Module 18 HTTP tests");

  const packageJson = JSON.parse(read("backend/package.json"));
  if (packageJson.scripts?.["test:module18:runtime"] !==
      "vitest run tests/module18/module18.provider.test.ts tests/module18/module18.jobs.test.ts tests/module18/module18.policy.test.ts tests/module18/module18.startup.test.ts") {
    throw new Error("Backend package.json must expose the Module 18 runtime test command.");
  }
  if (packageJson.scripts?.["test:module18:specs"] !== "vitest run tests/module18") {
    throw new Error("Backend package.json must expose the complete Module 18 backend spec command.");
  }
  if (packageJson.scripts?.["test:module18"] !== "node scripts/run-module18-tests.mjs") {
    throw new Error("Backend package.json must expose the complete Module 18 Docker-backed verifier.");
  }
  read("backend/scripts/run-module18-tests.mjs");
  const ci = read("backend/.github/workflows/ci.yml");
  requireText(ci, "npm run test:module18:runtime", "Backend CI");
  requireText(ci, "npm run test:module18:specs", "Backend CI");
}


/** Confirms the Module 18 React feature implements the required bell/list, preferences, and admin failure queue. */
function verifyFrontendPass() {
  const featureRoot = "frontend/src/features/notifications";
  for (const relativePath of [
    "api/notifications.api.ts",
    "hooks/notifications.query-keys.ts",
    "hooks/use-notifications.ts",
    "components/notification-bell.tsx",
    "components/notification-card.tsx",
    "components/notification-pagination.tsx",
    "forms/notification-preference.form.tsx",
    "schemas/notifications.schemas.ts",
    "types/notifications.types.ts",
    "pages/notifications.page.tsx",
    "pages/notification-preferences.page.tsx",
    "pages/admin-notification-deliveries.page.tsx",
  ]) {
    read(`${featureRoot}/${relativePath}`);
  }

  const api = read(`${featureRoot}/api/notifications.api.ts`);
  for (const proof of [
    'apiClient.get("/notifications"',
    'apiClient.post(`/notifications/${notificationId}/read`, {})',
    'apiClient.post("/notifications/read-all", {})',
    'apiClient.get("/notifications/preferences")',
    'apiClient.put("/notifications/preferences", input)',
    'apiClient.get("/admin/notification-deliveries"',
    'apiClient.post(`/admin/notification-deliveries/${deliveryId}/retry`, {})',
  ]) {
    requireText(api, proof, "Module 18 frontend API");
  }

  requireText(read(`${featureRoot}/hooks/use-notifications.ts`), "invalidateQueries", "Module 18 Query cache updates");
  requireText(read(`${featureRoot}/forms/notification-preference.form.tsx`), "useForm({", "Module 18 TanStack Form");
  requireText(read(`${featureRoot}/components/notification-bell.tsx`), "unreadCount", "Module 18 unread bell");
  requireText(read(`${featureRoot}/pages/admin-notification-deliveries.page.tsx`), "destinationMasked", "Module 18 masked admin queue");
  requireText(read("frontend/src/app/routes/notifications.routes.tsx"), 'path: "/admin/notification-deliveries"', "Module 18 React routes");
  requireText(read("frontend/src/components/layout/app-shell.tsx"), "MarketplaceHeader", "Module 18 shell integration");
  requireText(read("frontend/src/components/layout/marketplace-header.tsx"), "NotificationBell", "Module 18 marketplace header integration");
  requireText(read("frontend/tests/module18-notifications.test.tsx"), "Module 18 Notifications React feature", "Module 18 RTL/MSW tests");

  const packageJson = JSON.parse(read("frontend/package.json"));
  if (packageJson.scripts?.["test:module18"] !== "vitest run tests/module18-notifications.test.tsx") {
    throw new Error("Frontend package.json must expose the Module 18 React test command.");
  }
  requireText(read("frontend/.github/workflows/ci.yml"), "npm run test:module18", "Frontend CI");
}

/** Confirms Pass 8 browser coverage and post-E2E reconciliation are wired into the cumulative release gate. */
function verifyE2ePass() {
  const e2e = read("frontend/e2e/module18.spec.ts");
  for (const proof of [
    "Module 18 Notifications E2E",
    "approveSellerApplication",
    "rejectSellerApplication",
    "waitForNotification",
    'page.goto("/notifications")',
    'page.goto("/notifications/preferences")',
    'page.goto("/admin/notification-deliveries")',
    'name: "Mark read"',
    'name: "Mark all read"',
    'name: "Save preference"',
    'name: "Retry"',
  ]) {
    requireText(e2e, proof, "Module 18 Playwright E2E");
  }

  const seed = read("backend/src/database/seeds/module18-e2e.seed.ts");
  for (const proof of [
    "seedModule18E2eFailedDelivery",
    "MODULE18_E2E_FAILED_DELIVERY_ID",
    'eventType: "seller.approved"',
    'status: "failed"',
    "destinationMasked: maskEmail(administrator.email)",
  ]) {
    requireText(seed, proof, "Module 18 E2E seed");
  }

  const releaseData = read("backend/scripts/verify-module18-release-data.mjs");
  for (const proof of [
    "Module 18 seller-approved in-app notification",
    "Module 18 seller-rejected in-app notification",
    "Module 18 persisted user preference",
    "Module 18 privileged retry audit evidence",
    "Module 18 deterministic provider reconciliation",
    "Module 18 event/recipient/channel idempotency",
    "Module 18 raw email destination persistence",
  ]) {
    requireText(releaseData, proof, "Module 18 release-data verifier");
  }

  const frontendPackage = JSON.parse(read("frontend/package.json"));
  if (frontendPackage.scripts?.["test:e2e:module18"] !== "playwright test e2e/module18.spec.ts") {
    throw new Error("Frontend package.json must expose the Module 18 Playwright command.");
  }

  const backendPackage = JSON.parse(read("backend/package.json"));
  if (backendPackage.scripts?.["db:seed:module18-e2e"] !== "tsx src/database/seeds/module18-e2e.seed.ts") {
    throw new Error("Backend package.json must expose the Module 18 browser fixture seed.");
  }
  if (backendPackage.scripts?.["test:module18:release-data"] !== "node scripts/verify-module18-release-data.mjs") {
    throw new Error("Backend package.json must expose the Module 18 post-E2E reconciliation verifier.");
  }

  const runner = read("frontend/e2e/run-e2e-ci.mjs");
  for (const proof of [
    'NOTIFICATION_EMAIL_PROVIDER_MODE: "deterministic_test"',
    '"db:seed:module18-e2e"',
    '"test:module18"',
    '"e2e/module18.spec.ts"',
    '"test:module18:release-data"',
    '"/api/v1/notifications"',
    '"/api/v1/admin/notification-deliveries/{id}/retry"',
  ]) {
    requireText(runner, proof, "Cumulative E2E release gate");
  }
}

/** Confirms focused contract tests and CI/package commands are permanently wired. */
function verifyContractProof() {
  const packageJson = JSON.parse(read("backend/package.json"));
  if (
    packageJson.scripts?.["test:module18:contracts"] !==
    "vitest run tests/module18/module18.schemas.test.ts"
  ) {
    throw new Error("Backend package.json must expose the Module 18 contract test command.");
  }
  const tests = read("backend/tests/module18/module18.schemas.test.ts");
  requireText(tests, "Module 18 fixed contract values", "Module 18 contract tests");
  requireText(tests, "privacy-safe admin delivery boundary", "Module 18 contract tests");
  const ci = read("backend/.github/workflows/ci.yml");
  requireText(ci, "npm run test:module18:migrations", "Backend CI");
  requireText(ci, "npm run test:module18:contracts", "Backend CI");
}

verifyDatabaseContract();
verifyConstants();
verifySchemas();
verifyRbacComposition();
verifyRepositoryPass();
verifyServicePass();
verifyRealtimePass();
verifyHttpPass();
verifyRuntimePass();
verifyFrontendPass();
verifyE2ePass();
verifyContractProof();
console.log("Module 18 database + contract + repository + service + realtime + HTTP + runtime + frontend + E2E static verification passed.");
