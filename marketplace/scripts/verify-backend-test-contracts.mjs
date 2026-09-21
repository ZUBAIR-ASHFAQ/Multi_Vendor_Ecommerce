import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and reports a useful path when it is missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required backend test file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source), null, 2)
    : source;
}

/** Requires one permanent regression proof in a test source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required regression proof: ${expected}`);
  }
}

/** Rejects one superseded regression expectation so obsolete behavior cannot silently return. */
function forbidText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} still contains superseded regression proof: ${forbidden}`);
  }
}

/** Confirms Foundation outbox fan-out, failure retry, and claim-race behavior are directly tested. */
function verifyFoundationOutboxTests() {
  const fanout = readProjectFile(
    "backend/tests/unit/outbox-fanout.test.ts",
  );
  const dispatcher = readProjectFile(
    "backend/tests/unit/outbox-dispatcher.test.ts",
  );

  for (const proof of [
    "publishes the same retry-safe event to every independent consumer queue",
    "jobId: \"event-1\"",
    "fails the publish operation when any destination queue cannot accept the event",
  ]) {
    requireText(fanout, proof, "Foundation outbox fan-out tests");
  }

  for (const proof of [
    "marks a successfully published event once",
    "schedules a failed publish for bounded retry",
    "skips an event that loses the claim race",
  ]) {
    requireText(dispatcher, proof, "Foundation outbox dispatcher tests");
  }
}

/** Confirms released repositories have direct persistence-boundary tests where scope or secrecy is important. */
function verifyRepositoryScopeTests() {
  const expectations = [
    [
      "backend/tests/module2/module2.repository.test.ts",
      "returns safe user records and persists role permission membership without password leakage",
      "Module 2 repository safety",
    ],
    [
      "backend/tests/module21/module21.repository.test.ts",
      "keeps file ownership, resource links, and seller audit reads scoped in SQL",
      "Module 21 repository scope",
    ],
    [
      "backend/tests/module3/module3.repository.test.ts",
      "keeps saved-address reads and mutations inside the exact customer owner scope",
      "Module 3 repository scope",
    ],
    [
      "backend/tests/module4/module4.repository.test.ts",
      "keeps private seller and store reads inside the exact seller ownership scope",
      "Module 4 repository scope",
    ],
    [
      "backend/tests/module6/module6.repository.test.ts",
      "keeps private Product reads inside the exact seller/store scope",
      "Module 6 repository scope",
    ],
    [
      "backend/tests/module7/module7.repository.test.ts",
      "keeps private Inventory reads inside the exact seller/store scope",
      "Module 7 repository scope",
    ],
    [
      "backend/tests/module8/module8.repository.test.ts",
      "keeps cart reads, updates, and deletes inside the exact customer owner scope",
      "Module 8 repository scope",
    ],
    [
      "backend/tests/module9/module9.repository.test.ts",
      "keeps platform listing scoped and coupon redemption identity constrained in persistence",
      "Module 9 repository scope",
    ],
    [
      "backend/tests/module10/module10.repository.test.ts",
      "persists Patch 0004 addresses, store lines, and shipping selections while keeping reads customer-scoped",
      "Module 10 Checkout repository scope",
    ],
    [
      "backend/tests/module11/module11.repository.test.ts",
      "persists immutable Order snapshots and keeps customer/seller reads scoped",
      "Module 11 Orders repository scope",
    ],
    [
      "backend/tests/module15/module15.repository.test.ts",
      "keeps one Review per purchased Order Item and enforces customer scope on edits",
      "Module 15 Review repository scope",
    ],
  ];

  for (const [relativePath, proof, label] of expectations) {
    requireText(readProjectFile(relativePath), proof, label);
  }
}

/** Confirms every released seller/private-data module keeps a negative isolation proof at the API boundary. */
function verifyIsolationTests() {
  const expectations = [
    [
      "backend/tests/module2/module2.business-rules.integration.test.ts",
      "service-level seller isolation fails before persistence",
      "Module 2 seller scope",
    ],
    [
      "backend/tests/module3/module3.integration.test.ts",
      "keeps private address reads and writes inside the authenticated customer scope",
      "Module 3 customer scope",
    ],
    [
      "backend/tests/module4/module4.integration.test.ts",
      "prevents Seller B from reading or updating Seller A private store state",
      "Module 4 seller isolation",
    ],
    [
      "backend/tests/module6/module6.integration.test.ts",
      "seller-to-seller isolation",
      "Module 6 seller isolation",
    ],
    [
      "backend/tests/module7/module7.integration.test.ts",
      "seller-to-seller isolation",
      "Module 7 seller isolation",
    ],
    [
      "backend/tests/module8/module8.integration.test.ts",
      "keeps Cart/Wishlist reads and writes inside the exact customer owner scope",
      "Module 8 customer isolation",
    ],
    [
      "backend/tests/module21/module21.integration.test.ts",
      "denies a Seller A resource operation against Seller B",
      "Module 21 seller isolation",
    ],
    [
      "backend/tests/module9/module9.integration.test.ts",
      "seller-to-seller promotion scope isolation",
      "Module 9 seller isolation",
    ],
    [
      "backend/tests/module10/module10.integration.test.ts",
      "customer quote isolation, and customer-owned addresses",
      "Module 10 customer isolation",
    ],
    [
      "backend/tests/module11/module11.integration.test.ts",
      "enforces customer and seller isolation plus admin scoped search",
      "Module 11 customer/seller isolation",
    ],
    [
      "backend/tests/module15/module15.http.test.ts",
      "keeps customer edits owner-only and exposes only privacy-safe published Review cards",
      "Module 15 customer Review isolation",
    ],
  ];

  for (const [relativePath, proof, label] of expectations) {
    requireText(readProjectFile(relativePath), proof, label);
  }
}

/** Confirms the repaired Inventory workflow is proven through the real internal HTTP commands and retry keys. */
function verifyInventoryCommandTests() {
  const inventory = readProjectFile(
    "backend/tests/module7/module7.integration.test.ts",
  );

  for (const proof of [
    "makes reserve retries idempotent without double-reserving stock",
    "supports two partial shipments through the internal HTTP command without double-deducting stock",
    '.post("/api/v1/internal/inventory/ship")',
    "partial-over-ship",
    "releases only the unshipped remainder after a partial shipment",
    '.post("/api/v1/internal/inventory/release")',
    "select count(*)::int as count from stock_movements where movement_type = 'ship'",
  ]) {
    requireText(inventory, proof, "Module 7 Inventory command tests");
  }
}

/** Confirms lifecycle maintenance is wired through repositories, services, BullMQ dispatch, and regression tests. */
function verifyRepositoryLifecycleMaintenanceTests() {
  const foundation = readProjectFile(
    "backend/tests/integration/foundation.persistence.integration.test.ts",
  );
  const inventory = readProjectFile(
    "backend/tests/module7/module7.repository.test.ts",
  );
  const inventoryIntegration = readProjectFile(
    "backend/tests/module7/module7.integration.test.ts",
  );
  const idempotencyRepository = readProjectFile(
    "backend/src/common/idempotency/idempotency.repository.ts",
  );
  const inventoryRepository = readProjectFile(
    "backend/src/modules/inventory/inventory.repository.ts",
  );
  const idempotencyService = readProjectFile(
    "backend/src/common/idempotency/idempotency.service.ts",
  );
  const inventoryService = readProjectFile(
    "backend/src/modules/inventory/inventory.service.ts",
  );
  const maintenanceRuntime = readProjectFile(
    "backend/src/common/jobs/lifecycle-maintenance.runtime.ts",
  );
  const maintenanceUnitTest = readProjectFile(
    "backend/tests/unit/lifecycle-maintenance.runtime.test.ts",
  );

  requireText(
    idempotencyRepository,
    "deleteExpiredTerminalKeys",
    "Foundation idempotency lifecycle repository",
  );
  requireText(
    foundation,
    "deletes only expired terminal idempotency records in bounded batches",
    "Foundation idempotency lifecycle tests",
  );
  requireText(
    inventoryRepository,
    "findExpiredReservedReservations",
    "Module 7 reservation lifecycle repository",
  );
  requireText(
    inventory,
    "finds only expired uncommitted reservations in a bounded oldest-first batch",
    "Module 7 reservation lifecycle tests",
  );
  requireText(
    idempotencyService,
    "cleanupExpiredIdempotencyKeys",
    "Foundation idempotency lifecycle service",
  );
  requireText(
    foundation,
    "cleanupExpiredIdempotencyKeys",
    "Foundation idempotency lifecycle service test",
  );
  requireText(
    inventoryService,
    "releaseExpiredReservations",
    "Module 7 reservation expiry service",
  );
  requireText(
    inventoryService,
    "expireReservationIfStillEligible",
    "Module 7 reservation expiry race guard",
  );
  requireText(
    inventoryIntegration,
    "expires abandoned reservations once while leaving committed stock reserved",
    "Module 7 reservation expiry integration test",
  );
  requireText(
    maintenanceRuntime,
    "upsertJobScheduler",
    "BullMQ lifecycle maintenance schedule",
  );
  requireText(
    maintenanceUnitTest,
    "dispatches idempotency cleanup with the bounded maintenance batch size",
    "Lifecycle maintenance dispatch test",
  );
  requireText(
    maintenanceUnitTest,
    "dispatches Inventory reservation expiry with the bounded maintenance batch size",
    "Lifecycle maintenance dispatch test",
  );
}

/** Confirms Module 8 has direct regression proof for its most important Cart/Wishlist invariants. */
function verifyCartWishlistTests() {
  const schemas = readProjectFile(
    "backend/tests/module8/module8.schemas.test.ts",
  );
  const repository = readProjectFile(
    "backend/tests/module8/module8.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module8/module8.service.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module8/module8.integration.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const runner = readProjectFile("backend/scripts/run-module8-tests.mjs");

  requireText(
    schemas,
    "documents exactly the eight approved operations with bearer authentication",
    "Module 8 schema/OpenAPI tests",
  );
  requireText(
    repository,
    "keeps cart reads, updates, and deletes inside the exact customer owner scope",
    "Module 8 repository scope tests",
  );
  requireText(
    service,
    "enforces quantity rules again inside the service before any Product lookup",
    "Module 8 service validation tests",
  );
  for (const proof of [
    "keeps Cart/Wishlist reads and writes inside the exact customer owner scope",
    "merges duplicate variants and rejects invalid quantity, currency mismatch, unpublished Products, and inactive variants",
    "proves Cart mutation does not reserve Inventory",
    "stock_reservations where variant_id = $1",
    "validates Product/variant pairing",
    "never removes a saved item when Cart add fails",
    "keeps duplicate Wishlist adds event-idempotent",
  ]) {
    requireText(integration, proof, "Module 8 integration tests");
  }

  requireText(backendPackage, '"test:module8:specs"', "Module 8 focused test script");
  requireText(backendPackage, '"test:module8"', "Module 8 cumulative backend test script");
  requireText(runner, '"test:module8:migrations"', "Module 8 migration gate in test runner");
  requireText(runner, '"test:module19:specs"', "Module 8 prerequisite Search regression");
}

/** Confirms Module 9 has direct schema/repository/service/API, isolation, and redemption concurrency proof. */
function verifyPromotionsTests() {
  const schemas = readProjectFile(
    "backend/tests/module9/module9.schemas.test.ts",
  );
  const repository = readProjectFile(
    "backend/tests/module9/module9.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module9/module9.service.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module9/module9.integration.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const runner = readProjectFile("backend/scripts/run-module9-tests.mjs");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  requireText(
    schemas,
    "documents the approved promotion operations with bearer authentication",
    "Module 9 schema/OpenAPI tests",
  );
  requireText(
    repository,
    "keeps platform listing scoped and coupon redemption identity constrained in persistence",
    "Module 9 repository tests",
  );
  for (const proof of [
    "rejects seller-to-seller promotion scope before any persistence transaction",
    "allocates a percentage discount deterministically in stable Cart-item order",
    "rejects a coupon before Cart loading when the customer usage limit is already reached",
  ]) {
    requireText(service, proof, "Module 9 service tests");
  }
  for (const proof of [
    "enforces authentication, permissions, and seller-to-seller promotion scope isolation",
    "creates, updates, lists, activates, and deactivates platform promotions with audit/outbox history",
    "rolls promotion creation back when normalized coupon uniqueness conflicts",
    "validates coupon eligibility from the authenticated Cart and never trusts a client discount amount",
    "keeps coupon redemption idempotent and enforces concurrent global usage limits transactionally",
    "enforces a per-customer redemption limit without consuming another customer allowance",
    "serializes two competing first redemptions so maxUses one can succeed only once",
  ]) {
    requireText(integration, proof, "Module 9 integration tests");
  }

  requireText(backendPackage, '"test:module9:specs"', "Module 9 focused test script");
  requireText(backendPackage, '"test:module9"', "Module 9 cumulative backend test script");
  requireText(runner, '"test:module9:migrations"', "Module 9 migration gate in test runner");
  requireText(runner, '"test:module8:specs"', "Module 9 Cart prerequisite regression");
  requireText(backendCi, "npm run test:module9:specs", "Module 9 CI backend suite");
}

/** Confirms executable Shipping Configuration Core has schema, repository, service, and API regression coverage. */
function verifyShippingCoreSourceSafeTests() {
  const schemas = readProjectFile(
    "backend/tests/module13/module13.schemas.test.ts",
  );
  const repository = readProjectFile(
    "backend/tests/module13/module13.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module13/module13.service.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module13/module13.integration.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  for (const proof of [
    "keeps the approved owner, flat pricing, lifecycle, and route values exact",
    "keeps base-rate transport exact for the persisted NUMERIC(18,4) boundary",
    "keeps the shipping-options query strict and customer input minimal",
  ]) {
    requireText(schemas, proof, "Module 13 Shipping Core schema tests");
  }

  for (const proof of [
    "returns only active flat methods for the requested currency and server-derived sellers",
    "keeps owner, flat pricing, lifecycle, currency, and non-negative rate integrity in PostgreSQL",
  ]) {
    requireText(repository, proof, "Module 13 Shipping Core repository tests");
  }

  requireText(
    service,
    "derives store groups from Cart Products and keeps seller-private methods inside their own group",
    "Module 13 Shipping Core service tests",
  );
  requireText(
    integration,
    "publishes exactly the authenticated grouped flat-rate lookup with seller isolation",
    "Module 13 Shipping Core API tests",
  );
  requireText(
    integration,
    "does not allow one customer to use another customer's address",
    "Module 13 Shipping Core address-isolation API test",
  );

  requireText(
    backendPackage,
    '"test:module13:specs"',
    "Module 13 Shipping Core focused test script",
  );
  requireText(
    backendPackage,
    '"test:module13": "node scripts/run-module13-tests.mjs"',
    "Module 13 Shipping Core cumulative backend test script",
  );
  requireText(
    backendCi,
    "npm run test:module13:migrations",
    "Module 13 Shipping Core migration CI gate",
  );
  requireText(
    backendCi,
    "npm run test:module13:specs",
    "Module 13 Shipping Core test CI gate",
  );
}

/** Confirms Checkout has permanent schema, repository, service, and API regression coverage. */
function verifyCheckoutSourceSafeTests() {
  const schemas = readProjectFile(
    "backend/tests/module10/module10.schemas.test.ts",
  );
  const repository = readProjectFile(
    "backend/tests/module10/module10.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module10/module10.service.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module10/module10.integration.test.ts",
  );
  const helpers = readProjectFile(
    "backend/tests/module10/module10.test-helpers.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  for (const proof of [
    "keeps the approved permissions, errors, events, and four route paths stable",
    "keeps Checkout money exact for the persisted NUMERIC(18,4) boundary",
    "requires the approved lowercase SHA-256 Checkout state hash",
    "matches the approved Patch 0004 persisted quote response including store and Shipping snapshots",
    "normalizes the persisted coupon code and validates the confirmation idempotency key value",
  ]) {
    requireText(schemas, proof, "Module 10 Checkout schema tests");
  }

  for (const proof of [
    "persists Patch 0004 addresses, store lines, and shipping selections while keeping reads customer-scoped",
    "finds the existing attempt by quote and enforces one attempt per quote",
    "rejects cross-customer addresses and duplicate store shipping selections in PostgreSQL",
    "keeps the redundant attempt id/customer index removed while preserving the primary key",
  ]) {
    requireText(repository, proof, "Module 10 Checkout repository tests");
  }

  for (const proof of [
    "rejects exact requested quantity when current Inventory is insufficient",
    "fails closed when the Cart currency is no longer supported before Promotion persistence is read",
    "replays a completed confirmation without opening another database transaction",
  ]) {
    requireText(service, proof, "Module 10 Checkout service tests");
  }

  for (const proof of [
    "creates authoritative totals, confirms exactly once, replays the same key, and exposes attempt status",
    "missingHeader.body.error.code",
    "hiddenAttempt.body.error.code",
    "keeps a confirmed Checkout linked to its Order and leaves overdue unpaid expiry to Module 12",
    "enforces authentication, route permissions, customer quote isolation, and customer-owned addresses",
    "rejects confirmation when a selected customer address changes after quote creation",
    "rejects an expired quote before creating an attempt or reserving stock",
    "detects a Product price change between quote and confirmation",
    "detects a Product becoming unpublished between quote and confirmation",
    "detects exact-quantity stock loss between quote and confirmation",
    "detects a coupon becoming ineligible between quote and confirmation",
    "detects a Shipping rate change through authoritative confirmation revalidation",
    "detects an Administration tax change through authoritative confirmation revalidation",
    "maps one reused idempotency key with a different quote payload to CHECKOUT_IDEMPOTENCY_CONFLICT",
    "serializes different-key concurrent confirmations into one attempt and one reservation set",
    "rolls back the attempt and the first reservation when a later reservation write fails",
    "persists one Shipping selection per server-derived seller/store group",
    "rejects a currency removed from Administration support before quote persistence",
  ]) {
    requireText(integration, proof, "Module 10 Checkout API integration tests");
  }

  requireText(helpers, "resetModule10Tables", "Module 10 Checkout test reset helper");
  requireText(helpers, "setCheckoutTaxRate", "Module 10 Checkout tax test helper");
  requireText(
    backendPackage,
    '"test:module10:specs": "vitest run tests/module10"',
    "Module 10 Checkout focused test script",
  );
  requireText(
    backendPackage,
    '"test:module10": "node scripts/run-module10-tests.mjs"',
    "Module 10 Checkout full backend verification script",
  );
  requireText(
    backendCi,
    "npm run test:module10:migrations",
    "Module 10 Checkout migration CI gate",
  );
  requireText(
    backendCi,
    "npm run test:module10:specs",
    "Module 10 Checkout service/API CI gate",
  );
}

/** Confirms Module 11 has real source-safe lifecycle, isolation, reconciliation, and rollback proof. */
function verifyOrdersSourceSafeTests() {
  const orders = readProjectFile(
    "backend/tests/module11/module11.integration.test.ts",
  );
  const runner = readProjectFile("backend/scripts/run-module11-tests.mjs");
  const releaseData = readProjectFile("backend/scripts/verify-module11-release-data.mjs");
  const backendPackage = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  for (const proof of [
    "materializes one immutable Customer Order with deterministic multi-seller split and exact money reconciliation",
    "enforces customer and seller isolation plus admin scoped search",
    "supports replay-safe pre-capture partial/full cancellation and Inventory reconciliation",
    "confirms payment exactly once, commits reservations, gates seller acceptance, and blocks post-capture cancellation",
    "rolls back partial reservation commits when payment confirmation hits a later invalid reservation",
    "countOrdersForAttempt",
    "ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED",
    "ORDERS_OUTBOX_EVENT.SELLER_ORDER_ACCEPTED",
  ]) {
    requireText(orders, proof, "Module 11 Orders regression proof");
  }

  for (const proof of [
    "test:module11:migrations",
    "test:module11:specs",
    "test:regression:contracts",
    "test:module10:specs",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, proof, "Module 11 cumulative backend runner");
  }

  requireText(backendPackage, '"test:module11"', "Module 11 backend runner command");
  requireText(
    backendPackage,
    '"test:module11:release-data": "node scripts/verify-module11-release-data.mjs"',
    "Module 11 post-E2E release-data command",
  );
  requireText(
    releaseData,
    "Parent Order to Seller Order aggregate reconciliation",
    "Module 11 post-E2E reconciliation script",
  );
  requireText(backendCi, "npm run test:module11:migrations", "Module 11 migration CI gate");
  requireText(backendCi, "npm run test:module11:specs", "Module 11 API/service CI gate");
}

/** Confirms Module 16 has repository/service/Supertest/PostgreSQL proof for immutable marketplace fee history. */
function verifyCommissionsTests() {
  const repository = readProjectFile(
    "backend/tests/module16/module16.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module16/module16.service.test.ts",
  );
  const http = readProjectFile(
    "backend/tests/module16/module16.http.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module16/module16.integration.test.ts",
  );
  const runner = readProjectFile("backend/scripts/run-module16-tests.mjs");
  const backendPackage = readProjectFile("backend/package.json");

  requireText(
    repository,
    "keeps source-key replay safe and seller statements isolated by mandatory seller scope",
    "Module 16 Commission repository isolation",
  );

  for (const proof of [
    "uses Foundation source-key replay before touching Payment, Order, or Commission persistence",
    "calculates exact seller-funded discount, percentage fee, fixed fee, seller net, audit, and outbox",
    "creates a zero-fee immutable snapshot when no active Commission rule matches",
    "rounds percentage Commission half-up to scale 4 without JavaScript floating-point money",
    "selects the unique highest numeric priority instead of using hidden scope specificity",
    "rejects equal winning priorities instead of silently inventing a Commission tie-break",
    "rejects source-key replay when only the provider-authoritative occurredAt timestamp differs",
    "reverses a full provider refund with append-only negative entries and never edits the original sale",
    "keeps seller statements inside exactly one seller scope",
  ]) {
    requireText(service, proof, "Module 16 Commission service tests");
  }

  for (const proof of [
    "protects admin, seller, and trusted internal Commission routes",
    "rejects free-text Commission rule status at the HTTP boundary",
    "keeps Seller A statement isolated from Seller B",
    "never accepts client-supplied financial amounts",
  ]) {
    requireText(http, proof, "Module 16 Commission HTTP tests");
  }

  for (const proof of [
    "posts captured Order economics once, replays the source key, and keeps immutable snapshots after later rule changes",
    "uses only active rules and selects the highest numeric priority across matching scopes",
    "creates a zero-fee immutable snapshot when no active rule exists at capture time",
    "uses Foundation idempotency to reject one settlement source key reused for another Order",
    "creates append-only full-refund reversals exactly once while preserving the original sale history",
    "keeps real multi-seller statements scoped to each seller",
  ]) {
    requireText(integration, proof, "Module 16 Commission integration tests");
  }

  for (const proof of [
    "test:module16:migrations",
    "test:module16:specs",
    "test:module12:specs",
    "test:regression:contracts",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, proof, "Module 16 cumulative backend runner");
  }

  requireText(backendPackage, '"test:module16"', "Module 16 backend runner command");
  requireText(backendPackage, '"test:module16:specs"', "Module 16 focused backend tests");
}

/** Confirms the repaired Module 2 role-update contract has durable runtime regression proof. */
function verifyAdministrationEventTests() {
  const businessRules = readProjectFile(
    "backend/tests/module2/module2.business-rules.integration.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module2/module2.integration.test.ts",
  );

  for (const proof of [
    "writes role.updated together with the compatibility permission-change event",
    "role.permissions_changed",
    "role.updated",
    'changedFields: ["permissions"]',
  ]) {
    requireText(businessRules, proof, "Module 2 role-update event tests");
  }

  requireText(
    integration,
    "and event_type in (",
    "Module 2 failed role-update outbox rollback test",
  );
  requireText(
    integration,
    '{ event_type: "role.updated", count: 1 }',
    "Module 2 failed role-update outbox rollback test",
  );
}

/** Confirms retry/idempotency coverage remains present where the currently released modules require it. */
function verifyRetryAndIdempotencyTests() {
  const expectations = [
    [
      "backend/tests/module2/module2.integration.test.ts",
      "keeps logout retry-safe",
      "Module 2 auth retry safety",
    ],
    [
      "backend/tests/module21/module21.integration.test.ts",
      "idempotent link",
      "Module 21 file-link idempotency",
    ],
    [
      "backend/tests/module7/module7.integration.test.ts",
      "reserve retries idempotent",
      "Module 7 reservation idempotency",
    ],
    [
      "backend/tests/module19/module19.integration.test.ts",
      "repeating the completed job does not duplicate Search documents",
      "Module 19 reindex idempotency",
    ],
    [
      "backend/tests/module9/module9.integration.test.ts",
      "keeps coupon redemption idempotent and enforces concurrent global usage limits transactionally",
      "Module 9 coupon redemption idempotency",
    ],
    [
      "backend/tests/module16/module16.integration.test.ts",
      "uses Foundation idempotency to reject one settlement source key reused for another Order",
      "Module 16 Commission settlement idempotency",
    ],
  ];

  for (const [relativePath, proof, label] of expectations) {
    requireText(readProjectFile(relativePath), proof, label);
  }
}

/** Confirms Pass 7 keeps the critical security, lifecycle, and exact API regression guards executable. */
function verifyRepairRegressionGate() {
  const apiContracts = readProjectFile(
    "backend/tests/regression/implemented-api-contracts.test.ts",
  );
  const environmentSecurity = readProjectFile(
    "backend/tests/unit/environment-security.test.ts",
  );
  const foundationPersistence = readProjectFile(
    "backend/tests/integration/foundation.persistence.integration.test.ts",
  );
  const inventoryIntegration = readProjectFile(
    "backend/tests/module7/module7.integration.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  requireText(
    apiContracts,
    "locks every implemented Module 2 Authentication route to its approved method set",
    "Pass 7 exact API contract tests",
  );
  requireText(
    apiContracts,
    "/api/v1/internal/inventory/commit",
    "Pass 7 Inventory route regression guard",
  );
  requireText(
    apiContracts,
    "locks Module 8 Cart and Wishlist to exactly the eight approved operations",
    "Module 8 exact API contract regression guard",
  );
  requireText(
    apiContracts,
    "locks Module 9 Promotions and Coupons to the approved operations",
    "Module 9 exact API contract regression guard",
  );
  requireText(
    apiContracts,
    "locks Module 11 Orders to exactly the nine approved business operations",
    "Module 11 exact API contract regression guard",
  );
  requireText(
    environmentSecurity,
    "COOKIE_SECURE must be true in production",
    "Pass 7 production refresh-cookie regression test",
  );
  requireText(
    foundationPersistence,
    "cleanupExpiredIdempotencyKeys(10, now)).resolves.toBe(0)",
    "Pass 7 idempotency repeated-cleanup regression test",
  );
  requireText(
    inventoryIntegration,
    "releaseExpiredReservations(10)).resolves.toBe(0)",
    "Pass 7 Inventory repeated-expiry regression test",
  );
  requireText(
    backendPackage,
    '"test:regression:contracts"',
    "Pass 7 backend regression script",
  );
  requireText(
    backendCi,
    "npm run test:regression:contracts",
    "Pass 7 backend CI regression gate",
  );

  for (const migrationCommand of [
    "npm run test:module2:migrations",
    "npm run test:module21:migrations",
    "npm run test:module3:migrations",
    "npm run test:module4:migrations",
    "npm run test:module5:migrations",
    "npm run test:module6:migrations",
    "npm run test:module7:migrations",
    "npm run test:module19:migrations",
    "npm run test:module8:migrations",
    "npm run test:module9:migrations",
    "npm run test:module13:migrations",
    "npm run test:module10:migrations",
    "npm run test:module11:migrations",
  ]) {
    requireText(backendCi, migrationCommand, "Pass 8 migration upgrade regression gate");
  }
}

/** Confirms Module 15 keeps executable proof for eligibility, concurrency, moderation, privacy, and Search propagation. */
function verifyReviewsTests() {
  const service = readProjectFile(
    "backend/tests/module15/module15.service.test.ts",
  );
  const http = readProjectFile(
    "backend/tests/module15/module15.http.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module15/module15.integration.test.ts",
  );

  for (const proof of [
    "creates a server-derived verified Review only after owned purchase and full-delivery checks",
    "rejects foreign, cancelled, and incompletely delivered purchases before Review persistence",
    "keeps customer edits owner-only and returns published Reviews to pending when moderation is required",
    "lists only moderation-safe fields for actors with the admin moderation permission",
    "keeps Helpful replay-safe and moderation idempotent while refreshing published aggregates",
  ]) {
    requireText(service, proof, "Module 15 Review service tests");
  }

  for (const proof of [
    "allows exactly one concurrent Review for an eligible delivered purchase",
    "keeps customer edits owner-only and exposes only privacy-safe published Review cards",
    "lists a bounded privacy-safe moderation queue only for authorized admins",
    "keeps Helpful and moderation commands replay-safe while aggregates follow published state",
  ]) {
    requireText(http, proof, "Module 15 Review HTTP tests");
  }

  requireText(
    integration,
    "propagates published and hidden rating.aggregate_updated events into the Search read model",
    "Module 15 Search integration test",
  );
}

/** Confirms Pass 6 covers the service changes introduced by the audit before later frontend/E2E work. */
function verifyPass6ServiceChangeTests() {
  const checkout = readProjectFile(
    "backend/tests/module10/module10.integration.test.ts",
  );
  const paymentsPrerequisites = readProjectFile(
    "backend/tests/module12/module12.prerequisite-services.test.ts",
  );
  const sellers = readProjectFile(
    "backend/tests/module4/module4.service.test.ts",
  );
  const orders = readProjectFile(
    "backend/tests/module11/module11.service.test.ts",
  );
  const notificationPolicy = readProjectFile(
    "backend/tests/module18/module18.policy.test.ts",
  );
  const startup = readProjectFile(
    "backend/tests/module18/module18.startup.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");

  requireText(
    checkout,
    "keeps a confirmed Checkout linked to its Order and leaves overdue unpaid expiry to Module 12",
    "Pass 6 Checkout lifecycle ownership test",
  );
  forbidText(
    checkout,
    "expires an abandoned confirmed attempt and releases its still-reserved Inventory hold",
    "Pass 6 Checkout lifecycle ownership test",
  );
  requireText(
    paymentsPrerequisites,
    "expires one overdue unpaid Order and releases every remaining Inventory reservation exactly once",
    "Module 12 unpaid Order expiry ownership",
  );
  requireText(
    sellers,
    "resolves the stable seller owner used by Notification policy without exposing seller persistence",
    "Module 4 Notification directory boundary",
  );
  requireText(
    orders,
    "resolves Notification participants from the immutable Order and de-duplicates seller identities",
    "Module 11 Notification directory boundary",
  );

  for (const proof of [
    "uses the committed order.created payload for the customer without requiring cross-module lookups",
    "notifies sellers on payment-confirmed/cancelled Orders but keeps payment, shipping, and return outcomes customer-facing",
    "routes seller operational and finance events only to the persisted seller owner",
    "fails closed on malformed events",
    "bootstraps exactly one in-app and one email template for every built-in source event",
  ]) {
    requireText(notificationPolicy, proof, "Module 18 Notification policy tests");
  }

  for (const proof of [
    "never starts HTTP when a required database/Redis dependency cannot become ready",
    "closes every partially started runtime and never starts HTTP when required outbox startup fails",
    "expect(mocks.appListen).not.toHaveBeenCalled()",
  ]) {
    requireText(startup, proof, "Module 18 fail-fast startup tests");
  }

  requireText(
    backendPackage,
    "tests/module18/module18.policy.test.ts",
    "Module 18 focused runtime test script",
  );
  requireText(
    backendPackage,
    "tests/module18/module18.startup.test.ts",
    "Module 18 focused runtime test script",
  );
}


/** Confirms Module 20 Reports has direct repository/service/runtime/HTTP/integration regression proof. */
function verifyReportsTests() {
  const repository = readProjectFile(
    "backend/tests/module20/module20.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module20/module20.service.test.ts",
  );
  const exportRenderer = readProjectFile(
    "backend/tests/module20/module20.export.test.ts",
  );
  const jobs = readProjectFile(
    "backend/tests/module20/module20.jobs.test.ts",
  );
  const http = readProjectFile(
    "backend/tests/module20/module20.http.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module20/module20.integration.test.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const runner = readProjectFile("backend/scripts/run-module20-tests.mjs");

  for (const proof of [
    "enforces seller/store scope in SQL while keeping GMV and captured seller-order value exact and read-only",
    "persists asynchronous run transitions monotonically and refuses terminal replay transitions",
  ]) {
    requireText(repository, proof, "Module 20 repository tests");
  }
  for (const proof of [
    "keeps GMV, captured customer cash, and refunds separate",
    "rejects a seller request for another seller before any report repository read executes",
    "preserves signed seller payable separately from terminal paid Payout totals",
    "returns a signed download only to the report requester after completion",
  ]) {
    requireText(service, proof, "Module 20 service tests");
  }
  requireText(exportRenderer, "Module 20 report export renderer", "Module 20 export tests");
  requireText(jobs, "Module 20 Reports BullMQ runtime", "Module 20 jobs tests");
  for (const proof of [
    "denies missing report permission and rejects Seller B access to Seller A report scope",
    "creates and reads a requester-owned export run while hiding it from another seller",
    "allows the approved audit export only to the platform actor",
  ]) {
    requireText(http, proof, "Module 20 HTTP tests");
  }
  for (const proof of [
    "queues, generates, stores, downloads, and replays one export without duplicating terminal effects",
    "records only the final export failure and keeps failure notification replay-safe",
  ]) {
    requireText(integration, proof, "Module 20 integration tests");
  }
  for (const proof of [
    '"test:module20:repository"',
    '"test:module20:service"',
    '"test:module20:runtime"',
    '"test:module20:http"',
    '"test:module20:integration"',
    '"test:module20:specs"',
    '"test:module20"',
  ]) {
    requireText(backendPackage, proof, "Module 20 backend test scripts");
  }
  requireText(runner, '"test:module20:specs"', "Module 20 backend runner");
}


/** Confirms Module 1 Dashboard has repository/service/HTTP/integration regression proof. */
function verifyDashboardTests() {
  const repository = readProjectFile(
    "backend/tests/module1/module1.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module1/module1.service.test.ts",
  );
  const http = readProjectFile(
    "backend/tests/module1/module1.http.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module1/module1.integration.test.ts",
  );
  const helpers = readProjectFile(
    "backend/tests/module1/module1.test-helpers.ts",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const runner = readProjectFile("backend/scripts/run-module1-tests.mjs");

  for (const proof of [
    "persists preferences and saved filters only for the requested user",
    "enforces seller and store scope for current low-stock reads",
    "enforces seller/store scope before surfacing fulfillment attention rows",
  ]) {
    requireText(repository, proof, "Module 1 repository tests");
  }
  for (const proof of [
    "keeps seller summary reads inside the trusted seller/store scope and hides finance without permission",
    "rejects a foreign seller before a report source can be queried",
    "updates preferences atomically with one audit row and one durable event",
  ]) {
    requireText(service, proof, "Module 1 service tests");
  }
  for (const proof of [
    "requires authentication and Dashboard permission before private reads",
    "rejects Seller B reads and preference writes against Seller A scope",
    "persists only the current user's preferences and commits audit/outbox in the same successful command",
    "rejects a mixed-scope preference payload before any Dashboard write is committed",
    "keeps OpenAPI parity with exactly the documented Dashboard paths and methods",
  ]) {
    requireText(http, proof, "Module 1 HTTP tests");
  }
  for (const proof of [
    "matches Dashboard seller GMV/order KPIs to the stable Module 20 Sales source",
    "keeps one parent Order count while its seller-order GMV is aggregated exactly once in the Dashboard trend",
    "returns finance fields only to the platform actor while preserving separate money concepts",
  ]) {
    requireText(integration, proof, "Module 1 integration tests");
  }
  requireText(helpers, "resetModule1HttpTables", "Module 1 test helpers");

  for (const proof of [
    '"test:module1:repository"',
    '"test:module1:service"',
    '"test:module1:http"',
    '"test:module1:integration"',
    '"test:module1:specs"',
    '"test:module1"',
  ]) {
    requireText(backendPackage, proof, "Module 1 backend test scripts");
  }
  requireText(runner, '"test:module1:specs"', "Module 1 backend runner");
}

/** Confirms each released business module retains repository/service/API-oriented backend regression coverage. */
function verifyReleasedModuleTestFiles() {
  const requiredFiles = [
    "backend/tests/module2/module2.repository.test.ts",
    "backend/tests/module2/module2.integration.test.ts",
    "backend/tests/module2/module2.business-rules.integration.test.ts",
    "backend/tests/module21/module21.repository.test.ts",
    "backend/tests/module21/module21.service.test.ts",
    "backend/tests/module21/module21.integration.test.ts",
    "backend/tests/module3/module3.repository.test.ts",
    "backend/tests/module3/module3.service.test.ts",
    "backend/tests/module3/module3.integration.test.ts",
    "backend/tests/module4/module4.repository.test.ts",
    "backend/tests/module4/module4.service.test.ts",
    "backend/tests/module4/module4.integration.test.ts",
    "backend/tests/module5/module5.repository.test.ts",
    "backend/tests/module5/module5.service.test.ts",
    "backend/tests/module5/module5.integration.test.ts",
    "backend/tests/module6/module6.repository.test.ts",
    "backend/tests/module6/module6.service.test.ts",
    "backend/tests/module6/module6.integration.test.ts",
    "backend/tests/module7/module7.repository.test.ts",
    "backend/tests/module7/module7.service.test.ts",
    "backend/tests/module7/module7.integration.test.ts",
    "backend/tests/module8/module8.schemas.test.ts",
    "backend/tests/module8/module8.repository.test.ts",
    "backend/tests/module8/module8.service.test.ts",
    "backend/tests/module8/module8.integration.test.ts",
    "backend/tests/module9/module9.schemas.test.ts",
    "backend/tests/module9/module9.repository.test.ts",
    "backend/tests/module9/module9.service.test.ts",
    "backend/tests/module9/module9.integration.test.ts",
    "backend/tests/module10/module10.schemas.test.ts",
    "backend/tests/module10/module10.repository.test.ts",
    "backend/tests/module10/module10.service.test.ts",
    "backend/tests/module10/module10.integration.test.ts",
    "backend/tests/module11/module11.repository.test.ts",
    "backend/tests/module11/module11.service.test.ts",
    "backend/tests/module11/module11.http.test.ts",
    "backend/tests/module11/module11.integration.test.ts",
    "backend/tests/module19/module19.repository.test.ts",
    "backend/tests/module19/module19.service.test.ts",
    "backend/tests/module19/module19.integration.test.ts",
    "backend/tests/module13/module13.schemas.test.ts",
    "backend/tests/module13/module13.repository.test.ts",
    "backend/tests/module13/module13.service.test.ts",
    "backend/tests/module13/module13.http.test.ts",
    "backend/tests/module13/module13.integration.test.ts",
    "backend/tests/module12/module12.schemas.test.ts",
    "backend/tests/module12/module12.repository.test.ts",
    "backend/tests/module12/module12.service.test.ts",
    "backend/tests/module12/module12.http.test.ts",
    "backend/tests/module12/module12.integration.test.ts",
    "backend/tests/module12/module12.provider.test.ts",
    "backend/tests/module16/module16.repository.test.ts",
    "backend/tests/module16/module16.service.test.ts",
    "backend/tests/module16/module16.http.test.ts",
    "backend/tests/module16/module16.integration.test.ts",
    "backend/tests/module14/module14.schemas.test.ts",
    "backend/tests/module14/module14.repository.test.ts",
    "backend/tests/module14/module14.service.test.ts",
    "backend/tests/module14/module14.http.test.ts",
    "backend/tests/module14/module14.integration.test.ts",
    "backend/tests/module17/module17.schemas.test.ts",
    "backend/tests/module17/module17.repository.test.ts",
    "backend/tests/module17/module17.service.test.ts",
    "backend/tests/module17/module17.http.test.ts",
    "backend/tests/module17/module17.integration.test.ts",
    "backend/tests/module17/module17.provider.test.ts",
    "backend/tests/module17/module17.jobs.test.ts",
    "backend/tests/module15/module15.repository.test.ts",
    "backend/tests/module15/module15.service.test.ts",
    "backend/tests/module15/module15.http.test.ts",
    "backend/tests/module15/module15.integration.test.ts",
    "backend/tests/module18/module18.schemas.test.ts",
    "backend/tests/module18/module18.repository.test.ts",
    "backend/tests/module18/module18.service.test.ts",
    "backend/tests/module18/module18.http.test.ts",
    "backend/tests/module18/module18.integration.test.ts",
    "backend/tests/module18/module18.provider.test.ts",
    "backend/tests/module18/module18.jobs.test.ts",
    "backend/tests/module18/module18.policy.test.ts",
    "backend/tests/module18/module18.startup.test.ts",
    "backend/tests/module20/module20.schemas.test.ts",
    "backend/tests/module20/module20.repository.test.ts",
    "backend/tests/module20/module20.service.test.ts",
    "backend/tests/module20/module20.export.test.ts",
    "backend/tests/module20/module20.jobs.test.ts",
    "backend/tests/module20/module20.http.test.ts",
    "backend/tests/module20/module20.integration.test.ts",
    "backend/tests/module20/module20.test-helpers.ts",
    "backend/tests/module1/module1.schemas.test.ts",
    "backend/tests/module1/module1.repository.test.ts",
    "backend/tests/module1/module1.service.test.ts",
    "backend/tests/module1/module1.http.test.ts",
    "backend/tests/module1/module1.integration.test.ts",
    "backend/tests/module1/module1.test-helpers.ts",
    "backend/tests/regression/implemented-api-contracts.test.ts",
  ];

  for (const relativePath of requiredFiles) {
    readProjectFile(relativePath);
  }
}

/** Runs the permanent cumulative backend-test structure gate for all currently released modules. */
function main() {
  verifyFoundationOutboxTests();
  verifyRepositoryScopeTests();
  verifyIsolationTests();
  verifyInventoryCommandTests();
  verifyRepositoryLifecycleMaintenanceTests();
  verifyCartWishlistTests();
  verifyPromotionsTests();
  verifyShippingCoreSourceSafeTests();
  verifyCheckoutSourceSafeTests();
  verifyOrdersSourceSafeTests();
  verifyCommissionsTests();
  verifyAdministrationEventTests();
  verifyRetryAndIdempotencyTests();
  verifyRepairRegressionGate();
  verifyReviewsTests();
  verifyPass6ServiceChangeTests();
  verifyReportsTests();
  verifyDashboardTests();
  verifyReleasedModuleTestFiles();
  console.log("Backend test-contract verification passed.");
}

main();
