# Marketplace Frontend

Independent **React + TypeScript + Vite** frontend for the Multi-Vendor E-Commerce Marketplace.

## Stack

- React + TypeScript + Vite
- TanStack Router
- TanStack Query
- TanStack Form + Zod
- Axios with credentials and centralized interceptors
- Tailwind CSS + Radix/shadcn-style UI primitives
- Vitest + React Testing Library + MSW
- Playwright
- Docker + Nginx

Server data stays in TanStack Query. Do not copy fetched entities into Redux, Zustand, or another global server-state cache.

## Implemented feature areas

```text
src/features/
├── auth/
├── administration/
├── customers/
├── sellers/
├── catalog-taxonomy/
├── products/
├── inventory/
├── search-discovery/
├── cart-wishlist/
├── promotions/
├── checkout/
├── orders/
├── payments/
├── shipping/
├── returns-refunds/
└── documents-audit/
```

Feature folders own their API functions, TanStack Query hooks, forms, schemas, components, and pages for that domain.

## Main routes

Authentication and administration:

```text
/register
/login
/account
/admin/users
/admin/users/:id
/admin/roles
/admin/roles/:id
/admin/settings
```

Customer management:

```text
/customer/profile
/customer/addresses
/admin/customers
/admin/customers/:customerId
```

Seller/store management:

```text
/seller/apply
/seller/profile
/seller/stores
/seller/staff
/stores/:slug
/admin/seller-applications
/admin/sellers/suspend
```

Catalog and Product management:

```text
/catalog
/products
/products/:slug
/seller/products
/seller/products/new
/seller/products/:productId
```

Inventory and discovery:

```text
/seller/inventory
/search
/search/stores
```

Cart, Wishlist, Checkout, and Orders:

```text
/cart
/wishlist
/checkout
/orders
/orders/:orderId
/seller/orders
/seller/orders/:sellerOrderId
/seller/shipments
/seller/orders/:sellerOrderId/shipping
/orders/:orderId/shipping
/returns
/orders/:orderId/returns/:sellerOrderId/new
/seller/returns
/admin/returns
/admin/orders
/payments/orders/:orderId
/admin/payments
/admin/payments/:paymentId
```

Documents and audit:

```text
/documents
/audit
/audit/:auditId
```

## Frontend behavior rules

- Backend authorization is authoritative; route/component permission checks are UX only.
- Forms use TanStack Form + Zod and display readable field errors.
- Normalized API failures may show the safe `requestId` so support can trace a request without exposing stack traces or secrets.
- Search and Cart price/stock values are hints only. Checkout always uses the server-authoritative quote.
- Checkout never treats confirmation as Payment capture; the Payments module owns paid state.
- Stripe Payment Element handles card entry; the frontend never sends PAN/CVC to marketplace APIs.
- Stripe redirect/query state never marks an Order paid; the Payment status page waits for the marketplace Payment API.
- Finance Payment pages are read-only in this pass and never call the trusted internal refund route.
- Customer Orders and Seller Orders remain separate UI models; seller pages never expose another seller's fulfillment unit.
- Order cancellation and seller acceptance send only explicit business commands; the browser never submits lifecycle status as authority.
- Public pages consume public-safe projections only.
- Signed storage uploads send file bytes directly to the signed storage URL; API credentials are not sent to object storage.

## Module 14 Returns, Refunds & Disputes frontend

Module 14 browser code lives under `src/features/returns-refunds/` and uses only the approved eight backend operations. Customer pages show potentially eligible delivered quantities using existing Order and Shipment reads, but the Return service remains authoritative for ownership, delivered quantity, prior Returns, and the configured Return window. Seller pages expose only approve, reject, and receive/inspection commands. The browser never sends refund amount, restock quantity, Payment identity, seller ownership, or lifecycle status.

The admin Return/dispute view uses the approved admin list and refund command. Refund execution is shown only with `admin.refunds.issue`, sends a fresh `Idempotency-Key`, and leaves Payment/Commission/Inventory calculations to the backend. The current API does not expose dispute-note CRUD, so the UI does not invent it. TanStack Query owns server state and TanStack Form + Zod own Return request, decision, inspection, and refund form state.

Run the focused RTL/MSW suite with:

```bash
npm run test:module14
```

Run the focused Playwright workflow with:

```bash
npm run test:e2e:module14
```

Pass 8 is complete. The focused browser workflow proves customer Return creation from a delivered Order, seller isolation, seller approval/inspection, provider-authoritative refund, exact idempotent replay, one physical restock path, and one refund-without-restock path. The cumulative runner then invokes the backend read-only release-data reconciliation gate.

## Module 17 Seller Wallet & Payouts frontend

Module 17 browser code lives under `src/features/seller-wallet-payouts/`. The seller Wallet page keeps pending, available, held, and negative balances visually separate, shows the immutable Wallet ledger, and exposes only safe masked payout-account details. Payout-account setup accepts a configured provider/token reference only; raw bank/card credentials are never collected by this marketplace form. The seller Payout page reads server-owned available balance/account facts, normalizes user-entered money to exact scale 4 without floating point, and sends a fresh `Idempotency-Key` for each request.

The finance page exposes the approved Payout queue with safe allocation/provider reconciliation detail. Approval/reservation and provider send/reconciliation remain explicit permission-gated commands, each with a fresh idempotency key. The browser never calls `/internal/wallet/settle` or `/internal/wallet/adjust`, and it never submits seller identity, Wallet balances, or Payout status as authoritative fields.

Focused React Testing Library/MSW proof is available with:

```bash
npm run test:module17
npm run test:module15
npm run test:module18
```

Pass 8 is complete. `e2e/module17.spec.ts` proves the paid Payout path, authoritative provider failure/release, unknown-then-paid reconciliation with held money preserved, and a later Return/refund that appends a negative Wallet adjustment without rewriting paid Payout history. The finance send mutation refreshes on both success and error because a provider 502 can still correspond to persisted `failed` or `processing` state.

Run the focused browser workflow with:

```bash
npm run test:e2e:module17
```

The cumulative `npm run test:e2e:ci` gate configures the deterministic non-production payout adapter, includes Module 17 in the serial browser chain, and invokes the backend read-only `test:module17:release-data` reconciliation check.

## Module 13 Shipping & Fulfillment frontend

Module 13 browser code lives under `src/features/shipping/` and keeps the backend as the authority for seller scope, payment state, Shipment status, Inventory issue, and customer ownership. The seller UI provides the fulfillment queue, Seller Order Shipment allocation, tracking entry/correction, and explicit mark-shipped/mark-delivered commands. The customer/support route exposes only the customer-safe shipped/delivered tracking projection. TanStack Query owns Shipping server state, TanStack Form + Zod own Shipment creation/tracking form state, and every retryable create/ship/deliver command sends a fresh `Idempotency-Key`.

The focused React Testing Library/MSW suite is:

```bash
npm run test:module13
```

Pass 8 is also complete. Run the focused browser workflow with:

```bash
npm run test:e2e:module13
```

The cumulative `npm run test:e2e:ci` runner executes the Module 13 browser flow after its released prerequisites and then calls the independent backend `test:module13:release-data` read-only reconciliation gate. The E2E proves idempotent Shipment create/ship/deliver replay, seller isolation, customer-safe tracking, exactly-once Inventory issue, delivery, and concurrent partial Shipments reconciling the parent Order to `fulfilled`.

## Module 12 Payments release

Module 12 React code lives only under `src/features/payments/` plus the small Checkout/router/admin-navigation integration points. The customer flow creates/reuses a PaymentIntent with an `Idempotency-Key`, gives the returned `clientSecret` only to Stripe.js/Payment Element, and navigates to `/payments/orders/:orderId` after browser confirmation. That status page ignores Stripe redirect status as authority and polls `GET /payments/order/:orderId` while the Payment is pending/processing. Finance users with `admin.payments.read` can search `/admin/payments` and inspect `/admin/payments/:paymentId`, including transaction/refund provider references.

Only `VITE_STRIPE_PUBLISHABLE_KEY` is browser-visible Stripe configuration. Backend `sk_*` keys and webhook secrets must never be placed in frontend environment files. The focused React Testing Library/MSW suite is:

```bash
npm run test:module12
```

Module 12 Playwright release proof is implemented in `e2e/module12.spec.ts`. The release runner starts a small local Stripe-compatible provider-test server, available only to non-production backend configuration, so the real Stripe adapter can exercise PaymentIntent/refund HTTP behavior without external network dependence. The browser proof keeps redirect query state non-authoritative, sends the same signed capture webhook twice, verifies exactly-once Payment/Order effects, executes a trusted partial refund, and confirms the finance transaction timeline/refund reference.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Focused feature suites:

```bash
npm run test:module21
npm run test:module3
npm run test:module4
npm run test:module5
npm run test:module6
npm run test:module7
npm run test:module19
npm run test:module8
npm run test:module9
npm run test:module10
npm run test:module11
npm run test:module12
npm run test:module13
npm run test:module14
npm run test:module16
npm run test:module17
npm run test:module15
npm run test:module18
npm run test:e2e:module12
npm run test:e2e:module10
npm run test:e2e:module11
npm run test:e2e:module15
npm run test:e2e:module18
npm run test:e2e:module8
```

Browser suites are available through the corresponding `test:e2e:module*` commands when the independent backend/frontend servers and test infrastructure are running.

For the complete current browser gate, this repository also provides:

```bash
E2E_BACKEND_DIR=../marketplace-backend npm run test:e2e:ci
```

`test:e2e:ci` starts disposable PostgreSQL, Redis, and S3-compatible storage from the backend project, applies migrations, creates deterministic E2E fixtures, seeds the Module 20 report catalog, builds both projects, starts the built backend plus frontend preview, runs every released Playwright workflow through Module 20 serially, verifies post-browser data integrity including Checkout/Inventory/Orders/Payments/Notifications/Reports reconciliation, builds both Docker images, and always tears the disposable services down.

Module 11 Pass 8 adds the real Orders Playwright workflow. It proves multi-seller Checkout → Order creation, immutable Product snapshots, seller isolation, trusted payment-confirmed transition, seller acceptance, customer partial cancellation with retry-safe Inventory release, admin search, and status timelines without adding Payment UI behavior.

The delivery root also contains `scripts/verify-frontend-feature-contracts.mjs`, a dependency-free structural guard for the required stack, released feature/test folders, Search validation, Orders frontend contracts, request-ID error display, production-comment cleanliness, and the permanent E2E CI gate.

## CI and dependency lock

The frontend has its own CI, Dockerfile, and `Marketplace E2E Release Gate` workflow. The E2E workflow checks out the backend as a **separate repository**; it does not create a workspace or shared package.

Configure this repository before enabling the E2E workflow as a required check:

- repository variable `MARKETPLACE_BACKEND_REPOSITORY` = `owner/repository` for the independent backend;
- secret `MARKETPLACE_INTEGRATION_TOKEN` only when the normal GitHub token cannot read that backend repository (for example, a private sibling repository).

Generate and verify this repository's own lockfile with:

```bash
npm run deps:lock
npm run deps:verify-lock
```

Commit `package-lock.json` in the frontend repository only. CI and Docker use `npm ci` when it is present; until the initial bootstrap is committed they keep the explicit `npm install` fallback.

Do not create a root workspace, root package, root lockfile, or shared runtime package.


## Module 15 Reviews & Ratings final release

The React Reviews feature is released for the approved API surface with Product/Store public Reviews, rating summaries, verified-purchase create/edit UI, Helpful action, and approved moderation commands. Run `npm run test:module15` for RTL/MSW proof, `npm run test:e2e:module15` for the focused browser workflow, or `npm run test:e2e:ci` for the complete cross-repository release gate. The approved admin moderation queue uses `GET /api/v1/admin/reviews` and is covered by the Module 15 frontend and Playwright verification.


## Module 18 Notifications final release

Module 18 React code lives under `src/features/notifications/` and uses TanStack Query for Notification server state plus TanStack Form + Zod for preference editing. The UI exposes the notification bell/unread count, owned notification list, mark-one/read-all actions, preferences, and the permission-scoped admin failed-delivery retry queue. Raw destinations are never rendered; the admin queue uses only the backend-provided masked destination.

Run the focused component/API suite with:

```bash
npm run test:module18
```

Run the focused browser workflow with:

```bash
npm run test:e2e:module18
```

`e2e/module18.spec.ts` proves real `seller.approved` and `seller.rejected` source transactions flow through the Foundation outbox and Module 18 BullMQ runtime before appearing in the browser. It also covers mark-read, mark-all-read, preference editing, privacy-safe admin failure display, and retry. The cumulative `npm run test:e2e:ci` runner seeds one deterministic failed delivery and invokes the backend `test:module18:release-data` reconciliation gate after browser execution.

## Module 1 Dashboard frontend

Module 1 browser code lives under `src/features/dashboard/` and exposes the `/dashboard` route. It calls only the five approved Dashboard API operations: summary, orders, sellers, alerts, and preferences. TanStack Query owns server state; TanStack Form + Zod own filter, saved-filter, and preference input.

The page provides Executive KPI cards, GMV/order trends, seller performance, low-stock/fulfillment/return/payout alerts, refund/return summary, separate captured-cash/commission-revenue/seller-payable/payout values, saved filters, and layout/date/store preferences. Seller identity remains server-derived, seller and finance sections are permission-aware, and saved filters are persisted through `PATCH /dashboard/preferences` rather than undocumented CRUD endpoints. Unsupported historical category views render the backend `DASHBOARD_WIDGET_UNAVAILABLE` state instead of reconstructing history from mutable Product taxonomy.

Run the focused RTL/MSW contract suite with:

```bash
npm run test:module1
```

Run the focused Pass 8 browser workflow with:

```bash
npm run test:e2e:module1
```

`e2e/module1.spec.ts` verifies platform and seller Dashboard views, finance separation, bounded filters and drill-down navigation, Seller A/Seller B read/write isolation, saved preferences, Module 20 Sales reconciliation, explicit unsupported-category behavior, and exact live OpenAPI parity. The cumulative `npm run test:e2e:ci` runner executes Module 1 last and then invokes the backend `test:module1:release-data` read-only reconciliation gate.
