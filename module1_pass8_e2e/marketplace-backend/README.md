# Marketplace Backend

Independent **Node.js + Express + TypeScript** backend for the Multi-Vendor E-Commerce Marketplace.

## Stack

- Express + TypeScript
- route → controller → service → repository layering
- Drizzle ORM + Drizzle Kit
- PostgreSQL
- Zod boundary/environment validation
- JWT access tokens + rotating refresh sessions
- Argon2id password hashing
- RBAC + seller/store resource policies
- Redis + BullMQ
- Pino structured logging
- S3/R2-compatible signed storage
- OpenAPI/Swagger
- Vitest + Supertest
- Docker + GitHub Actions

## Implemented backend stages

The backend currently contains Foundation plus Modules 2, 21, 3, 4, 5, 6, 7, 19, 8, 9, Module 13 Shipping & Fulfillment released through Pass 8 E2E + reconciliation, Module 10 Checkout, and Module 11 Orders in dependency order. Module 11 keeps its persistence, contracts, scoped repository, authoritative service, nine approved HTTP/OpenAPI operations, same-transaction Checkout materialization, Supertest/PostgreSQL proof, and Pass 8 post-browser reconciliation gate. Module 12 Payments is released through Pass 8: persistence, contracts/service boundaries, scoped Drizzle repository, provider-authoritative Payments service, Stripe adapter, webhook/refund/reconciliation logic, the six approved HTTP/OpenAPI operations, RBAC/internal policy composition, raw Stripe webhook parsing, the BullMQ Payments worker, service/provider/Supertest/PostgreSQL backend proof, and post-browser Payment/Order/transaction reconciliation are present. Module 16 Commissions is in its final remediated state: approved persistence/contracts/repository/service and exactly seven HTTP/OpenAPI operations are covered by focused repository/service/Supertest/PostgreSQL tests, including seller isolation, exact money, rule priority/status behavior, immutable replay identity, refund reversal, audit, and outbox proof. React/Playwright remain in the independent frontend repository. Module 14 Returns, Refunds & Disputes is released through Pass 8 with its five-table persistence, exact eight-operation HTTP/OpenAPI surface, backend proof, independent React feature, Playwright workflow, and read-only post-browser reconciliation.

Module 17 Seller Wallet & Payouts is released through Pass 8: backend persistence/contracts/repository/service/HTTP/background runtime/provider composition/backend proof are complete, the independent frontend contains the React feature and Playwright workflow, and this backend contains the read-only post-browser Wallet/Payout reconciliation gate.

```text
src/modules/
├── administration/
├── documents-audit/
├── customers/
├── sellers/
├── catalog-taxonomy/
├── products/
├── inventory/
├── search-discovery/
├── cart-wishlist/
├── promotions/
├── shipping/
├── checkout/
├── orders/              # Module 11 contracts + repository + service + HTTP + backend proof
├── payments/            # Module 12 released runtime + HTTP/OpenAPI; proof lives under tests/module12
├── commissions/         # Module 16 persistence + contracts + repository + service + HTTP/OpenAPI
└── seller-wallet-payouts/ # Module 17 released backend: contracts + repository + service + HTTP + jobs
```

## Module 17 Seller Wallet & Payouts — final Pass 8 release

Pass 1 adds `src/database/schema/seller-wallet-payouts.ts` and append-only migration `0029_seller_wallet_payouts.sql`. The five base-guide tables are `seller_wallets`, `seller_wallet_entries`, `payout_accounts`, `payouts`, and `payout_allocations`. Wallet and Payout money uses exact scale-4 PostgreSQL NUMERIC values, Wallet entries enforce unique `source_key`, Payouts bind to the same seller/currency Wallet and seller-owned account, and allocations are immutable per Payout/source entry.

Pass 2 activates `REQUIREMENTS_PATCH_0010.md` as the approved additive executable contract and freezes Wallet buckets/entry types, payout-account and Payout lifecycle values, provider result values, required permissions/errors/events, exact nine-route identity, strict Zod inputs/responses, exact money, settlement/adjustment commands, and idempotency boundaries.

Pass 3 adds `src/modules/seller-wallet-payouts/seller-wallet-payouts.repository.ts`. The repository is transaction-bindable and persistence-only: it ensures/locks Wallet rows, appends replay-safe immutable ledger rows, persists complete service-approved Wallet snapshots, keeps seller reads seller-scoped, stores tokenized payout accounts, locks/persists Payout rows, stores allocations, and exposes deterministic FIFO allocation-source/usage reads.

Pass 4 adds `seller-wallet-payouts.service.ts`. It consumes persisted Module 16 Commission sources without recalculating seller net, recovers negative debt before new pending earnings, applies negative Commission adjustments through pending → available → negative, moves eligible pending earnings to available only after full Module 13 delivery plus the configured Return-window hold, creates seller-scoped tokenized payout accounts, creates retry-safe Payout requests, reserves available money into held on finance approval with FIFO allocations, and reconciles provider paid/failed/unknown outcomes without rewriting immutable history. Foundation idempotency, audit, and outbox writes are transaction-aware. Module 16 exposes `getWalletEntrySnapshot(...)`; Module 13 exposes `getWalletDeliverySnapshot(...)`; and `src/integrations/payouts/payout-provider.contract.ts` keeps provider SDKs outside business code.

Pass 5 adds the thin controller/routes/index boundary and exposes exactly the nine approved operations: seller Wallet read, seller Payout history/request, tokenized payout-account creation, finance Payout queue/approve/send, and trusted internal settle/adjust commands. Seller/admin routes use authentication plus the frozen Module 17 permissions; internal commands use `internalServiceMiddleware`. The five retryable money commands require `Idempotency-Key`. Module 17 permissions are composed into the platform RBAC seed, the routers are mounted in `src/app.ts`, and `sellerWalletPayoutsOpenApiPaths` is registered in the central OpenAPI document and exact-route regression contract. No generic Wallet/Payout CRUD or status PATCH is added.

Pass 6 adds `module17.service.test.ts`, `module17.http.test.ts`, `module17.integration.test.ts`, reusable `module17.test-helpers.ts`, `scripts/run-module17-tests.mjs`, CI wiring, and the permanent dependency-free `verify-module17-backend-proof.mjs` gate. The proof covers seller isolation, source replay, hold-gated/concurrent settlement, negative recovery, insufficient balance, atomic reservation/allocation, provider paid/failed/unknown behavior, internal-route security, exact ledger reconciliation, audit/outbox/idempotency evidence, and a later Return/refund adjustment after a paid Payout.

Focused commands:

```bash
npm run test:module17:migrations
npm run test:module17:contracts
npm run test:module17:repository
npm run test:module17:service
npm run test:module17:http
npm run test:module17:integration
npm run test:module17:provider
npm run test:module17
npm run test:module17:release-data
cd ..
node scripts/verify-module17-contracts.mjs
node scripts/verify-module17-repository.mjs
node scripts/verify-module17-service.mjs
node scripts/verify-module17-http.mjs
node scripts/verify-module17-backend-proof.mjs
node scripts/verify-module17-release.mjs
```

Pass 8 adds environment-driven provider composition and the post-browser `scripts/verify-module17-release-data.mjs` reconciliation gate without widening the nine-operation API. Production requires a deployment-owned provider module; the deterministic provider/test clock are non-production only. PostgreSQL/Vitest/release-data commands require installed backend dependencies and the disposable release environment, while the dependency-free source verifiers run directly from this archive.

## Module 13 Shipping & Fulfillment final backend state

`ShippingService` owns seller-scoped Shipment reads, retry-safe creation, captured/processing eligibility, fulfillable-quantity checks, committed Inventory reservation validation, tracking correction policy, transaction-bound Inventory issue, `created -> shipped -> delivered`, history, audit/outbox, parent Order fulfillment refresh, and customer/admin tracking authorization. Shipping uses narrow `OrdersService` and `InventoryService` boundaries and does not import their repositories. The backend proof covers seller isolation, strict HTTP authority, idempotency replay/conflict, tracking no-op behavior, Inventory issue/rollback, immutable evidence, customer-safe tracking, and concurrent partial-Shipment reconciliation.

Pass 8 adds the read-only `scripts/verify-module13-release-data.mjs` post-browser gate. It reconciles Shipment allocation, physical Inventory issue, reservation consumption, lifecycle history, seller-scoped audit, exact-once outbox evidence, idempotency completion, and parent Order fulfillment state. Run `npm run test:release:static` for the dependency-free backend source gate, `npm run test:module13` for the provisioned cumulative backend gate, and `npm run test:module13:release-data` after the Module 13 Playwright workflow.

## Module 16 Commissions final backend state

`../REQUIREMENTS_PATCH_0007.md` is the executable Commission contract. Persistence uses append-only migrations `0025_commissions_marketplace_fees.sql` and `0026_commissions_contract_integrity.sql`; Zod contracts, scoped Drizzle persistence, authoritative service logic, thin controllers/routes, and exactly seven approved HTTP/OpenAPI operations remain aligned.

`tests/module16` proves strict status validation, active/inactive behavior, highest-priority selection and ambiguity rejection, exact scale-4 half-up calculations, seller/platform discount funding behavior, zero-fee fallback snapshots, Foundation and immutable-ledger replay safety including `occurredAt`, seller isolation, immutable historical snapshots, append-only full-refund reversal, partial-refund fail-closed behavior before Module 14, and audit/outbox effects. Run `npm run test:module16` for the cumulative provisioned backend gate; the independent backend permanent static gate is `npm run test:release:static`.

## Module 12 Payments release proof

`../REQUIREMENTS_PATCH_0006.md` remains the approved executable Module 12 contract. Pass 1 persistence stays in `src/database/schema/payments.ts` and append-only migration `0024_payments_persistence.sql`. Pass 2 keeps the Zod/constants/provider-neutral contracts and narrow Module 11 Payment snapshot/unpaid-expiry service boundaries. Pass 3 keeps `src/modules/payments/payments.repository.ts` as a Drizzle-only, transaction-bindable persistence layer with race-safe Payment/webhook creation, replay lookups, current provider-intent idempotency-hash persistence, and exact pending-refund reservation totals.

Pass 4 adds `src/modules/payments/payments.service.ts`, `payments.jobs.ts`, backend-only Stripe environment validation, and `src/integrations/payments/stripe/stripe-payment-provider.adapter.ts`. The service implements Foundation idempotency, exact BigInt money conversion, active-intent reuse/retry, verified webhook processing, provider-authoritative capture, same-transaction Module 11 confirmation with reconciliation on failure, trusted refund reservation/result accounting, refund/capture reconciliation, unpaid-Payment expiry, audit/outbox events, and BullMQ job boundaries. Stripe SDK imports stay inside the adapter and Payments still never imports `OrdersRepository`. Pass 5 adds `payments.controller.ts` and `payments.routes.ts`, mounts the Stripe raw-body route before `express.json()`, composes customer/admin/internal policy middleware, registers the six operations in central OpenAPI, adds Payments permissions to the platform RBAC seed without granting `system.payments.webhook` to user roles, and starts/closes the Payments reconciliation worker with the shared service. Pass 6 adds `tests/module12/module12.service.test.ts`, `module12.provider.test.ts`, `module12.http.test.ts`, `module12.integration.test.ts`, and `module12.test-helpers.ts`. These prove exact money/idempotency, provider mapping, customer/admin/internal HTTP policy, unverified webhook rejection, duplicate capture replay, provider-truth-preserving Order reconciliation, partial/full and concurrent-refund safety, refund reconciliation, and unpaid-Payment expiry against PostgreSQL. `npm run test:module12` runs the cumulative backend gate. `npm run test:module12:release-data` performs read-only post-browser reconciliation of Payment/Order totals, capture/refund transaction sums, duplicate webhook/transaction identities, terminal webhook state, and Payment outbox events. `npm run test:release:static` is the dependency-free backend structural gate. React and Playwright stay in the independent frontend repository. The optional `STRIPE_API_BASE_URL` exists only for non-production provider-test infrastructure used by the release runner; production validation rejects it so normal deployments keep Stripe's standard API endpoint.

## Module 13 Shipping final backend proof

`tests/module13/module13.http.test.ts` covers authentication, seller permissions, strict bodies, required idempotency headers, seller-to-seller non-enumeration, customer ownership, and admin-safe reads. `module13.integration.test.ts` covers the real paid/accepted Seller Order fulfillment path: create, tracking, ship, deliver, replay/conflict behavior, allocation limits, Inventory rollback, durable audit/outbox evidence, and concurrent partial-Shipment fulfillment reconciliation.

Focused backend gates remain:

```bash
npm run test:module13:service
npm run test:module13:http
npm run test:module13:integration
```

`npm run test:module13` is the cumulative backend gate. After the live browser workflow, `npm run test:module13:release-data` performs the final read-only data reconciliation. The cross-repository Playwright workflow itself remains in the independent frontend project, preserving repository separation.

## Module 11 Orders backend regression proof

`../REQUIREMENTS_PATCH_0005.md` remains the controlling executable Orders contract. Pass 1 persistence stays unchanged in `src/database/schema/orders.ts` and append-only migration `0023_orders_persistence.sql`. Passes 2–5 retain the Zod contracts, Product/Inventory service boundaries, scoped `OrdersRepository`, authoritative `OrdersService`, thin controllers/routes, live OpenAPI, and same-transaction Checkout integration.

Pass 6 adds `tests/module11/module11.integration.test.ts` and reusable test helpers around the real HTTP/database boundary. The suite proves one Checkout attempt creates one parent Customer Order, deterministic seller/store children reconcile exactly to parent totals, mutable Product/address changes do not rewrite historical snapshots, customer/seller scopes do not leak, cancellations are idempotent and release Inventory exactly once, trusted payment confirmation commits reservations once, Seller Order acceptance is state-gated, and a later invalid reservation rolls back earlier commits in the same transaction.

Run `npm run test:module11` for the cumulative Module 11 backend gate. It verifies clean/upgrade migrations, the full Module 11 suite, implemented API regression contracts, all released prerequisite backend suites through Checkout, then typecheck, lint, and build. `npm run test:module11:specs` runs only the Module 11 Vitest suite. After the cross-repository browser flow, `npm run test:module11:release-data` performs read-only Orders reconciliation for parent/seller totals, Checkout source identity, immutable snapshots, Inventory reservation/release accounting, and lifecycle events.

## Module 10 Checkout backend proof

Module 10 keeps exactly the approved Checkout operations:

```text
POST /api/v1/checkout/quote
GET  /api/v1/checkout/quote/:id
POST /api/v1/checkout/quote/:id/confirm
GET  /api/v1/checkout/:attemptId/status
```

`checkout.controller.ts` only validates HTTP input, obtains the authenticated request context, calls `CheckoutService`, and writes the stable response envelope. `checkout.routes.ts` owns authentication, route-level RBAC, and OpenAPI metadata. Confirmation requires the Zod-validated `Idempotency-Key` header; idempotency behavior itself remains in `CheckoutService`.

Focused service tests plus Supertest/PostgreSQL integration coverage verify authoritative totals, customer isolation, authentication/RBAC, expiry, stale Product/Inventory/Promotion/Shipping/tax state, idempotency replay/conflict, concurrent confirmation, atomic reservation rollback, seller/store grouping, and supported currencies. The cross-repository Playwright gate now exercises the real customer Checkout flow and the post-browser release-data verifier reconciles Checkout with Inventory and durable events.

## Permanent architecture rules

- Controllers translate validated HTTP input to service calls. They do not contain business rules or Drizzle queries.
- Services own business invariants, state transitions, transactions, idempotency, audit/outbox orchestration, and cross-module service calls.
- Repositories contain persistence-only Drizzle queries with mandatory ownership/resource filters.
- Seller/store identity and permissions are always derived and enforced server-side.
- Foundation owns transactional-outbox dispatch. Each asynchronous consumer receives an independent BullMQ queue.
- Inventory keeps on-hand, reserved, consumed, and movement history separate so partial shipments remain retry-safe.
- Search is a derived public read model and never becomes authoritative for Checkout price or stock.
- Historical commerce and ledger facts are corrected with explicit adjustments rather than row-history rewrites.

## Approved API scope notes

Two read-only workflow routes intentionally extend the literal module tables because required editing screens need them:

```text
GET /api/v1/catalog/categories/:id/attributes
GET /api/v1/seller/products/:id
```

They are not generic CRUD. Module 21 audit export is deferred to Module 20 Reports & Analytics.

Password-reset HTTP commands are not part of the approved Module 2 route table. The unused reset-token persistence was therefore removed through append-only migration `0015_remove_unused_password_reset_tokens.sql` instead of shipping a partial feature.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

Generate and verify this independent project's lockfile before making CI a required release gate:

```bash
npm run deps:lock
npm run deps:verify-lock
```

Commit the generated `package-lock.json` in this project only. CI and Docker use `npm ci` when it is present.

## Verification

Core commands:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Migration gates:

```bash
npm run test:module2:migrations
npm run test:module21:migrations
npm run test:module3:migrations
npm run test:module4:migrations
npm run test:module5:migrations
npm run test:module6:migrations
npm run test:module7:migrations
npm run test:module19:migrations
npm run test:module8:migrations
npm run test:module9:migrations
npm run test:module13:migrations
npm run test:module14:migrations
npm run test:module17:migrations
npm run test:module10:migrations
```

Focused backend suites:

```bash
npm run test:regression:contracts
npm run test:foundation:specs
npm run test:module2:specs
npm run test:module21:specs
npm run test:module3:specs
npm run test:module4:specs
npm run test:module5:specs
npm run test:module6:specs
npm run test:module7:specs
npm run test:module19:specs
npm run test:module8:specs
npm run test:module9:specs
npm run test:module13:specs
npm run test:module10:specs
```

Full Module 8 backend verification (starts disposable PostgreSQL/Redis, runs migrations, Module 8 tests, prerequisite regressions, typecheck, lint, and build):

```bash
npm run test:module8
```

Full Module 10 backend verification (starts disposable PostgreSQL/Redis, verifies clean/supported migrations, runs Checkout and all released prerequisite backend regressions, then typecheck, lint, and build):

```bash
npm run test:module10
```

Post-browser integrity checks:

```bash
npm run test:module6:release-data
npm run test:module7:release-data
npm run test:module19:release-data
npm run test:module8:release-data
npm run test:module9:release-data
npm run test:module10:release-data
```

The delivery-level `scripts/verify-module10.mjs` runs the complete current cross-project release gate: dependency-free structural checks, backend Module 10 migration/service/API regressions, frontend lint/typecheck/RTL/build, live OpenAPI verification, every released Playwright workflow through Checkout, post-browser data integrity, production builds, and Docker builds.

## CI and container

- `.github/workflows/ci.yml` runs the backend migration/test/build regression with PostgreSQL and Redis service containers.
- `Dockerfile` creates the production backend image.
- `docker-compose.test.yml` provides disposable local test infrastructure.
- Frontend and backend remain independent projects; do not add a root workspace package.



### Module 14 final Pass 8 release

Module 14 now includes the five-table persistence/migration, strict contracts/constants, scoped Drizzle repository, business service, Pass 5 HTTP/RBAC/OpenAPI layer, and Pass 6 backend proof. The service enforces delivered-quantity/window eligibility, seller isolation, Return lifecycle rules, exact cumulative scale-4 refund allocation, provider refund idempotency, trusted partial Commission reversal, optional exactly-once Inventory restock, and audit/outbox evidence.

The minimum prerequisite service boundaries are also present: Administration owns `returns.window_days`; Orders exposes immutable Return facts; Shipping exposes delivered quantity/latest delivery time; Payments exposes provider-authoritative refundable totals; Inventory exposes system-only Return restock; and Commissions exposes the approved item-level partial-refund adjustment. Existing prerequisite public APIs remain unchanged. Pass 5 adds exactly eight Module 14 operations, thin controllers, route-level permission checks, central permission seeding, application composition, and central OpenAPI registration. Pass 6 adds focused repository/service/Supertest/PostgreSQL tests, a refund-only provider test double, cumulative `npm run test:module14`, and CI execution against clean migrations. Pass 7 adds the independent React feature in the frontend repository without changing the backend HTTP surface. Pass 8 adds the frontend Playwright Return/refund workflow and this backend's read-only `scripts/verify-module14-release-data.mjs` reconciliation gate without changing the eight-operation API surface.

Run `npm run test:module14:contracts`, `npm run test:module14:repository`, `npm run test:module14:service`, `npm run test:module14:http`, or `npm run test:module14:integration` for focused proof. `npm run test:module14` provisions PostgreSQL/Redis, runs Module 14 plus released prerequisite suites, then typechecks/lints/builds. After the Playwright flow, run `npm run test:module14:release-data` to reconcile persisted Return, refund, Inventory, Commission, lifecycle, audit/outbox, and idempotency truth. From the delivery root, `node scripts/verify-module14.mjs` is the permanent dependency-free final source gate.


## Module 15 Reviews & Ratings final release

The backend owns the final Module 15 persistence/contracts/repository/service/HTTP/test/reconciliation implementation. The approved public surface contains eight operations, including the admin moderation queue read, and immutable migration `0031_reviews_ratings.sql` remains in the append-only history. `npm run test:module15` is the cumulative backend gate and `npm run test:module15:release-data` is the read-only post-Playwright reconciliation gate. Module 18 Pass 1 advances the migration head to `0032_notifications.sql` without changing Module 15 runtime behavior. Pass 2 adds Notification boundary constants/Zod contracts and composes its four source-defined permissions into platform RBAC. Pass 3 adds the scoped Drizzle repository and focused PostgreSQL repository proof. Pass 4 adds the transaction-aware Notifications service, safe Module 2 recipient identity boundary, allow-listed template rendering, durable event/recipient/channel dispatch preparation, preference/mandatory-channel policy, read events, and audited replay-safe admin retry behavior. Pass 5 adds thin controllers, exactly seven authenticated/RBAC-protected operations, Express composition, and central OpenAPI registration. Pass 6 adds the Foundation-outbox/BullMQ runtime, replay-safe delivery execution, bounded retry/final-failure persistence, direct-recipient policy/template bootstrap, Resend-compatible provider integration, and focused runtime/HTTP/integration proof.


## Module 18 Notifications — final backend release support

The Module 18 migration remains `0032_notifications.sql`; the current project migration head is `0034_dashboard.sql` after Module 1 Pass 1. Boundary contracts live in `src/modules/notifications/notifications.constants.ts` and `notifications.schema.ts`; `notifications.repository.ts` remains persistence-only; and `notifications.service.ts` owns current-user read state, preferences, mandatory-channel enforcement hooks, safe active-template rendering, committed-outbox-event dispatch preparation, masked destinations, replay handling, failed-delivery reads, provider execution, and audited retry behavior. The HTTP layer still exposes exactly the seven documented operations with the four Notification permissions. The dedicated Foundation-outbox/BullMQ consumer performs bounded retry/final-failure persistence and replay-safe delivery execution. Built-in policy now covers direct recipients plus narrow service-boundary recipient resolution for order/payment, seller suspension/low-stock, shipping, returns/refunds, wallet availability, and payout events without importing another module's repository. The Resend-compatible email adapter uses the durable delivery ID as its provider idempotency key. Raw recipient email is resolved only at send time and is never persisted in `notification_deliveries`, and source modules remain unaware of provider code. Pass 7 adds the independent React feature. Pass 8 adds the deterministic failed-delivery E2E fixture, real outbox-to-BullMQ browser proof, read/read-all/preferences/admin retry coverage, and the read-only `test:module18:release-data` reconciliation gate. Socket.IO now provides authenticated in-app push invalidation after the durable Notification row commits; persisted Notification state remains authoritative.

Current implemented backend HTTP/OpenAPI surface: 165 business operations.

Run `npm run test:module18:runtime`, `npm run test:module18:specs`, `npm run test:module18`, or `npm run test:release:static` for the current cumulative proofs.


## Module 20 Reports & Analytics — final Pass 8 release support

Module 20 now includes the append-only `0033_reports_analytics.sql` persistence, server-controlled report catalog seed, strict Zod contracts, scoped Drizzle repository, service-owned KPI/status/scope rules, exact nine-operation HTTP/OpenAPI surface, asynchronous CSV/PDF export worker, generated Module 21 document storage, report-ready/failed Notification events, backend repository/service/runtime/HTTP/integration tests, and the independent React Reports feature. The final browser gate adds `e2e/module20.spec.ts` after Module 18, seeds report definitions after every disposable database reset, checks live OpenAPI parity, proves seller-to-seller reporting isolation and requester-only export reads, completes real BullMQ export generation to signed storage, and downloads the generated CSV. `npm run test:module20:release-data` then reconciles active report definitions, terminal export runs, generated-file ownership/purpose, request/generated audit and outbox events, report-ready Notifications, and unique generated-file references. Run `npm run test:module20` for the cumulative backend suite and run the frontend `npm run test:e2e:ci` for the full provisioned browser/reconciliation gate through Module 1.

## Module 1 Dashboard — final Pass 8 release support

Module 1 is source-complete through Pass 8. Migration `0034_dashboard.sql` owns only Dashboard preferences and saved-filter persistence. `dashboard.repository.ts` remains scoped data access only, while `dashboard.service.ts` owns Dashboard RBAC/resource checks, reuse of Module 20 Reports for stable KPI definitions, exact-money trend aggregation, finance-field gating, source-owned operational alert projection, and same-transaction preference/audit/outbox writes. `dashboard.controller.ts` and `dashboard.routes.ts` expose exactly the five approved authenticated operations, apply route-level permission checks, translate malformed Dashboard read filters to the stable module error code, and register the same Zod contracts in OpenAPI. The backend suite covers PostgreSQL repositories, service invariants, Supertest authentication/RBAC/seller isolation, stable error codes, OpenAPI parity, preference persistence plus audit/outbox transaction proof, and reconciliation against the Module 20 Sales source. Historical category filtering is not silently reconstructed from mutable Product taxonomy; report-backed Dashboard reads return `DASHBOARD_WIDGET_UNAVAILABLE` until an approved historical category source exists.

The final browser gate adds `e2e/module1.spec.ts` in the independent frontend and `scripts/verify-module1-release-data.mjs` here. It verifies platform and seller Dashboard views, finance separation, bounded filters and report drill-down, Seller A/Seller B read/write isolation, saved preferences, Module 20 Sales reconciliation, unsupported category behavior, and exact live OpenAPI parity. The read-only post-browser verifier checks preference ownership, saved-filter persistence, denied cross-seller writes, audit/outbox lifecycle rows, and JSON invariants. Run `npm run test:module1` for the provisioned backend gate or `npm run test:module1:release-data` after the browser workflow. The complete release gate still requires committed independent lockfiles, installed dependencies, and Docker.
