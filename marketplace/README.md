# Multi-Vendor E-Commerce Marketplace

The requested Daraz-style business-flow audit and implementation traceability are documented in [`MARKETPLACE_FLOW_ALIGNMENT.md`](./MARKETPLACE_FLOW_ALIGNMENT.md). The current source is substantially aligned; that document identifies the remaining product-rejection, COD, and explicit order-completion gaps without treating similarly named UI states as completed business transitions.

Production-oriented multi-vendor marketplace implemented as **two independent projects**:

```text
multi-vendor-marketplace/
├── marketplace-backend/
├── marketplace-frontend/
├── scripts/
├── REQUIREMENTS_PATCH_0001.md
├── ...
└── REQUIREMENTS_PATCH_0011_PROPOSED.md
```

The root is **not** an npm workspace. Frontend and backend keep separate `package.json`, TypeScript configuration, environment files, Dockerfiles, tests, and CI workflows.

## Current implementation scope

The dependency-ordered implementation currently contains Foundation plus:

1. Module 2 — Administration, Authentication & RBAC
2. Module 21 — Documents & Audit Log
3. Module 3 — Customer Management
4. Module 4 — Seller & Store Management
5. Module 5 — Catalog Taxonomy
6. Module 6 — Product Management
7. Module 7 — Inventory & Stock
8. Module 19 — Search & Discovery
9. Module 8 — Cart & Wishlist
10. Module 9 — Promotions & Coupons
11. Module 13 — Shipping & Fulfillment
12. Module 10 — Checkout
13. Module 11 — Order Management & Multi-Seller Split
14. Module 12 — Payments
15. Module 16 — Commissions & Marketplace Fees
16. Module 14 — Returns, Refunds & Disputes
17. Module 17 — Seller Wallet & Payouts
18. Module 15 — Reviews & Ratings

Module 18 — Notifications is implemented through its browser/reconciliation pass with persisted in-app/email delivery, preferences, retryable jobs, source-event fan-out, and the required seven-route surface. Module 20 — Reports & Analytics is implemented through its final Pass 8 browser/reconciliation source contract. The backend keeps the exact nine approved Reports operations, permission-safe seller/platform scopes, exact-money KPI separation, asynchronous CSV/PDF export runs, generated-document storage, audit-log export ownership, BullMQ processing, Notifications integration, and repository/service/HTTP tests. The frontend provides the permission-filtered report catalog, Sales, Seller Performance, Inventory/Low Stock, Returns/Refunds, Commissions, Payouts, asynchronous export/run status/download UI, and the approved Audit export action routed through Module 20 rather than inventing a Module 21 export endpoint. The final Playwright workflow covers catalog visibility, separated Sales money concepts, seller-to-seller scope rejection, asynchronous export generation, signed download access, requester-only run reads, and exact live OpenAPI parity; the read-only post-browser verifier reconciles report definitions, terminal runs, generated files, audit/outbox lifecycle events, Notifications dispatch, and duplicate-file protection. TanStack Query owns Reports server state; TanStack Form + Zod own report filters. Optional saved report-filter presets are browser-local because the approved nine-route Reports API does not expose saved-filter write/read commands, so no undocumented backend route was invented. Module 1 — Dashboard is implemented through its final Pass 8 browser/reconciliation source contract. The backend owns only Dashboard preferences and saved-filter persistence, reuses Module 20 Reports for stable KPI definitions, enforces trusted seller/store scope, keeps finance values permission-gated and separate, and exposes exactly the five approved authenticated Dashboard operations with PostgreSQL/service/Supertest contract coverage. The independent frontend provides `/dashboard` with Executive KPIs, GMV/order trends, seller performance, operational alerts, refund/return and commission/payout summaries, user-owned saved filters, and preference editing. TanStack Query owns Dashboard server state and TanStack Form + Zod own editable filters/preferences. Seller identity remains server-derived, finance widgets are permission-aware, unsupported historical category views surface the backend `DASHBOARD_WIDGET_UNAVAILABLE` state, and saved filters persist only through the documented preferences command rather than invented CRUD routes. The final Playwright workflow verifies platform and seller Dashboard views, finance separation, bounded filters and report drill-down, Seller A/Seller B read/write isolation, saved preferences, Module 20 Sales reconciliation, unsupported category behavior, and exact live OpenAPI parity. A read-only post-browser verifier reconciles Dashboard preference ownership, saved filters, denied cross-seller writes, audit/outbox lifecycle rows, and persisted JSON invariants. The source implementation is complete; the provisioned runtime release gate still requires committed independent lockfiles, installed dependencies, and Docker.

The database migration history currently ends at:

```text
0034_dashboard.sql
```

Migration `0030_audit_remediation_expiry_lookup.sql` remains unchanged in the append-only history.

## Required stack

### Frontend

- React + TypeScript + Vite
- TanStack Router
- TanStack Query for server state
- TanStack Form + Zod for forms and boundary validation
- Tailwind CSS + Radix/shadcn-style UI primitives
- Axios with credentials and centralized error handling
- Vitest + React Testing Library + MSW
- Playwright

### Backend

- Node.js + Express + TypeScript
- route → controller → service → repository layering
- Zod boundary schemas
- Drizzle ORM + Drizzle Kit
- PostgreSQL
- JWT access token + rotating refresh-token session
- RBAC + seller/store resource policies
- Argon2
- Redis + BullMQ
- Socket.IO for authenticated in-app realtime notification delivery
- Pino structured logging
- S3/R2-compatible signed object storage
- OpenAPI/Swagger
- Email provider boundary under `src/integrations/email/` (currently Resend-compatible)
- Vitest + Supertest

## Backend responsibilities

Keep the layers simple and predictable:

```text
route
  -> authentication / permission / resource middleware
  -> controller
  -> service
  -> repository
  -> Drizzle / PostgreSQL
```

- **Routes** declare HTTP shape, middleware, and OpenAPI metadata.
- **Controllers** validate/forward request data and map service results to HTTP responses.
- **Services** own business rules, transactions, state transitions, idempotency, audit/outbox work, and cross-module commands.
- **Repositories** own scoped Drizzle queries only. They do not make HTTP or business-policy decisions.

Do not create generic CRUD endpoints just because a table exists. State changes use explicit business commands.

## Important marketplace invariants

- Seller A must never read or change Seller B private resources.
- Client-supplied roles, seller ownership, totals, payment state, and financial ownership are never authoritative.
- Cart totals are previews; Checkout recalculates price, discount, shipping, tax, and stock server-side.
- Available stock is `on_hand_qty - reserved_qty` and valid commands cannot make it negative.
- Checkout confirmation, provider webhooks, stock source commands, refunds, commission posting, wallet posting, and payouts are idempotent where retries can repeat writes.
- Customer Order and Seller Order are separate concepts.
- Payment, marketplace revenue, seller payable, seller wallet balance, and seller payout are separate concepts.
- Historical Product price, Order snapshots, stock movements, Payment transactions, refunds, commission entries, Wallet entries, and Payout history are not rewritten.
- Search is eventually consistent and is never authoritative at Checkout.

## Module 15 current contract

Reviews & Ratings exposes the approved eight-operation surface, including:

```text
GET /api/v1/admin/reviews
```

The admin moderation queue is permission-scoped and returns a privacy-safe projection. Review store ownership is derived server-side from the purchased Seller Order.

`REQUIREMENTS_PATCH_0011_PROPOSED.md` keeps its historical filename, but its document status is **APPROVED**. The same applies to `REQUIREMENTS_PATCH_0002_PROPOSED.md`: Module 21 keeps audit search/detail ownership, while the later Module 20 owns executable audit-export runs.

## Source-only verification

Run the permanent dependency-free source gate from the repository root:

```bash
node scripts/verify-current-release-static.mjs
```

The delivery-level gate above checks cross-project HTTP/OpenAPI parity, frontend API contracts, backend test contracts, and every currently implemented module. Each independent project also carries its own repository-local source gate, so cloning either repository by itself does not require a parent `scripts/` folder:

```bash
cd marketplace-backend
npm run test:release:static
```

```bash
cd marketplace-frontend
npm run test:release:static
```

The repository-local gates verify the required stack, folder boundaries, project independence, current migration/E2E coverage, and release entry points without importing files from the sibling repository.

## Dependency reproducibility

Frontend and backend remain independent npm projects. Each project pins the expected npm major version, enables npm lockfiles through its own `.npmrc`, and provides a lockfile bootstrap command:

```bash
cd marketplace-backend
npm run deps:lock
npm run deps:verify-lock
```

```bash
cd marketplace-frontend
npm run deps:lock
npm run deps:verify-lock
```

Commit each generated `package-lock.json` inside its own project. Do **not** create a root `package.json`, root lockfile, workspace, or shared package. CI requires each independent lockfile and uses `npm ci` only. The Dockerfiles still retain an explicit install fallback until the initial lockfile bootstrap is committed; do not fabricate or hand-write a lockfile.

## Final current-stage release gate

The final release gate is strict: both independent `package-lock.json` files must exist and match their own `package.json`, Docker + Docker Compose v2 must be available, and the machine must have network access for the initial deterministic install. Bootstrap each lockfile once on a networked machine:

```bash
cd marketplace-backend
npm run deps:lock
npm run deps:verify-lock

cd ../marketplace-frontend
npm run deps:lock
npm run deps:verify-lock
```

Then run the complete current-stage gate from the delivery root:

```bash
node scripts/run-current-release-gate.mjs
```

That command verifies both locks, runs the cross-project source contract gate, installs both dependency trees with `npm ci`, installs Playwright Chromium, and executes the existing Docker-backed E2E release runner. The E2E runner re-runs the released backend suites through Module 1, frontend lint/typecheck/tests/build, full migrations, live OpenAPI checks, every current Playwright workflow through Module 1, post-browser reconciliation checks, and both Docker image builds.

If both projects are already installed from the committed lockfiles and Playwright Chromium is already present, use:

```bash
node scripts/run-current-release-gate.mjs --skip-install
```

A release is not considered fully verified until this provisioned gate succeeds. The dependency-free static gates remain useful before that point, but they are not a substitute for the database/browser/container release gate.

## Full provisioned verification

After installing dependencies independently in both projects, run:

```bash
cd marketplace-backend
npm run verify
```

```bash
cd marketplace-frontend
npm run verify
```

For the Docker-backed end-to-end/reconciliation workflow:

```bash
cd marketplace-frontend
npm run test:e2e:ci
```

Module-specific migration, integration, release-data, and Playwright commands remain available in each project's `package.json`.

## Requirement patches

Requirement patch files are governance/source-contract documents and are intentionally retained. They record approved additive decisions without rewriting the controlling marketplace guide.

Do not delete or silently change them when implementing later modules. If a later patch replaces a rule, make that replacement explicit.

## Cleanup policy

The repository contains source, migrations, tests, CI, active verifiers, and requirement patches only. Historical audit-pass evidence directories and obsolete pass-specific static verifier scripts are intentionally excluded from the current source archive.

Do not add empty `types.ts`, `constants.ts`, placeholder evidence files, or unused helper abstractions. Keep functions small enough to follow, use short comments on functions, and prefer business-named helpers over generic indirection.

The permanent `scripts/verify-source-hygiene.mjs` gate now also rejects orphaned production source files, orphaned root verifier scripts, zero-byte source/support files, unfinished source markers, and uncommented named production functions.
