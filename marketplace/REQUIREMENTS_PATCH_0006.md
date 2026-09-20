# Requirements Patch 0006 — Module 12 Payments Executable Contract

**Status: APPROVED additive contract patch for the current implementation.**

This patch freezes the executable details that the 99-page marketplace guide leaves open for **Module 12 — Payments**. It supplements the base guide and the approved Module 11 Orders contract in `REQUIREMENTS_PATCH_0005.md`.

The base guide remains authoritative for Module 12 ownership, route names, provider-authoritative payment state, idempotent webhook processing, separation from Order/Inventory/Commission/Wallet/Payout state, and the rule that browser state never marks an Order paid. This patch only makes those requirements executable without inventing behavior during later code-generation passes.

## 1. Module boundary and ownership

Module 12 owns:

- one provider-neutral Payment aggregate per Customer Order;
- Stripe sandbox/test PaymentIntent creation through an adapter;
- provider-authoritative payment status transitions;
- verified Stripe webhook ingestion and replay protection;
- payment transaction history;
- captured/refunded amount accounting;
- the trusted call into Module 11's Payment-confirmed boundary;
- the provider-side refund command used later by Module 14;
- payment reconciliation state/evidence and retryable background work;
- customer payment-status reads and finance-admin payment reads.

Module 12 does **not** own:

- Customer Order commercial totals or Seller Order splitting — Module 11;
- Product price, Promotion, Shipping, tax, or Checkout recalculation — Module 10 and its prerequisites;
- shipment/tracking/delivery state — Module 13 completion;
- return/refund eligibility decisions — Module 14;
- commission calculation — Module 16;
- seller wallet/payout state — Module 17.

Payment, Order, Inventory, Commission, Wallet, Payout, Return, and Refund remain separate concepts. A provider capture may cause an approved Order transition, but it never rewrites historical Order totals.

## 2. Approved Module 12 routes remain unchanged

Do not add generic Payment CRUD routes.

```text
POST /api/v1/payments/order/:orderId/intent
GET  /api/v1/payments/order/:orderId
POST /api/v1/payments/webhooks/stripe
GET  /api/v1/admin/payments
GET  /api/v1/admin/payments/:id
POST /api/v1/internal/payments/:id/refund
```

Rules:

- the two customer routes use normal authentication and customer ownership checks;
- admin reads use normal authentication plus `admin.payments.read`;
- the Stripe webhook route does not trust browser/customer authentication and is authorized only by successful Stripe signature verification;
- the internal refund route uses the existing `x-internal-api-key` / `internalServiceMiddleware` mechanism;
- no route accepts client-controlled Order amount, currency, payment status, capture status, seller identity, or refundable amount.

## 3. Permission contract

The representative permissions from the base guide are frozen as follows:

```text
payments.read_own
admin.payments.read
admin.payments.refund
system.payments.webhook
```

Rules:

- `payments.read_own` protects both create/get intent and customer payment-status access for the authenticated customer's own Order;
- `admin.payments.read` protects finance search/detail;
- `admin.payments.refund` remains the privileged business permission used by the future Module 14/admin refund orchestrator; Module 12 does not add a direct public admin-refund route;
- `system.payments.webhook` is assigned to the system context created only after a Stripe webhook signature verifies; it is never trusted from a public caller token;
- the internal refund route trusts only the internal-service key and records actor provenance supplied by the trusted upstream service when present.

## 4. Stripe provider strategy

The core release uses **Stripe sandbox/test mode** behind one provider-neutral adapter. Stripe SDK types and Stripe-specific status names stay inside the integration adapter.

The approved payment mode is:

```text
PaymentIntent
capture_method = automatic
```

The browser uses Stripe.js / Payment Element later in Pass 7. Card PAN/CVC never enters this backend and is never persisted or logged.

Required future runtime configuration:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CURRENCY_EXPONENTS_JSON
```

Frontend later uses only:

```text
VITE_STRIPE_PUBLISHABLE_KEY
```

Rules:

- backend secrets never appear in frontend environment files or API responses;
- `STRIPE_CURRENCY_EXPONENTS_JSON` is an explicit uppercase three-letter currency -> minor-unit exponent map, for example `{"USD":2}`;
- a currency must be allowed by Administration **and** configured in the Stripe exponent map before Module 12 can create an intent;
- this patch does not add FX conversion.

## 5. Payment aggregate state model

The `payments.status` values for the core release are:

```text
pending
processing
captured
failed
cancelled
partially_refunded
refunded
```

Allowed high-level transitions:

```text
pending -> processing | captured | failed | cancelled
processing -> captured | failed | cancelled
failed -> pending
cancelled -> pending
captured -> partially_refunded | refunded
partially_refunded -> partially_refunded | refunded
refunded -> terminal
```

Rules:

- a new Payment aggregate starts `pending`;
- a failed/cancelled provider attempt may create a new PaymentIntent on the same Payment aggregate when the Order is still payable and before the payment deadline;
- `captured`, `partially_refunded`, and `refunded` never transition back to `pending`;
- `amount_captured` and `amount_refunded` are provider-authoritative successful money movement totals;
- `amount_authorized` is set to the captured amount when automatic capture succeeds; the core release does not expose a manual-capture flow;
- Payment status never derives from query parameters, browser redirects, or frontend state.

## 6. Provider PaymentIntent status mapping

The Stripe adapter maps verified/retrieved PaymentIntent status into the provider-neutral domain as follows:

```text
requires_payment_method -> pending
requires_confirmation   -> pending
requires_action         -> pending
processing              -> processing
succeeded               -> captured
canceled                -> cancelled
requires_capture         -> provider-contract error in automatic-capture mode
```

A provider status not explicitly supported by the adapter fails closed with `PAYMENT_PROVIDER_ERROR` and must not invent a local capture.

`payment_intent.succeeded` is the normal capture source. A server-side Stripe retrieve may also be used by reconciliation/background code; customer/browser state itself is never authoritative.

## 7. Exact money and provider minor units

Marketplace money remains PostgreSQL `NUMERIC(18,4)` and canonical four-decimal JSON strings.

Stripe receives an integer amount in the configured currency minor unit. Conversion is exact and must never use JavaScript floating-point money.

For configured exponent `e`:

```text
provider_minor_amount = order_amount * 10^e
```

The conversion is allowed only when the four-decimal Order amount is exactly representable at exponent `e`.

Examples for exponent `2`:

```text
10.1200 -> 1012
10.1234 -> rejected; no silent rounding
```

Rules:

- the Payment intent amount and currency come only from the immutable Module 11 Order snapshot;
- the provider amount must round-trip exactly to the same canonical scale-4 Order amount;
- unsupported/unrepresentable currency/amount combinations fail before provider creation;
- Stripe provider minimum/maximum limits are not guessed in marketplace code; a provider rejection maps safely to `PAYMENT_PROVIDER_ERROR`;
- refunds use the same exact minor-unit conversion and may not silently round.

This preserves the approved Module 11 rule that trusted Payment confirmation sends a captured amount exactly equal to the Order `grand_total`.

## 8. One Payment aggregate per Customer Order

Add an append-only database uniqueness guard in Pass 1:

```text
payments.order_id UNIQUE NOT NULL
```

The Payment aggregate may reference more than one historical PaymentIntent over time through transaction history, but only one current `provider_payment_id` is stored on the Payment row.

Rules:

- concurrent customer requests cannot create two Payment aggregates for one Order;
- an active `pending`/`processing` provider intent is reused rather than duplicated;
- after a terminal failed/cancelled provider attempt, a new `Idempotency-Key` may create a new provider intent on the same Payment aggregate if the Order remains payable;
- captured/refunded Orders never receive a replacement intent.

## 9. Create/get PaymentIntent contract

Route:

```text
POST /api/v1/payments/order/:orderId/intent
```

Required header:

```http
Idempotency-Key: <1..200 trimmed characters>
```

Request body is strict empty JSON or omitted. The customer does not send amount, currency, payment method details, success status, customer ID, or seller ID.

The service must load a trusted Module 11 payment snapshot containing at least:

```text
orderId
customerUserId
currency
grandTotal
paymentStatus
orderStatus
checkoutAttemptId
paymentExpiresAt
```

The intent may be created only when:

- the authenticated customer owns the Order;
- the Order remains `pending_payment` with Order `payment_status = pending`;
- at least one Order Item quantity remains;
- `paymentExpiresAt` has not elapsed;
- amount/currency are provider-representable under section 7.

### Foundation idempotency

Scope:

```text
payments.intent:<customerUserId>
```

Request hash is SHA-256 of `JSON.stringify` over this fixed-order object:

```text
version = "payments-intent-v1"
orderId
```

The database `payments.idempotency_key` field stores the SHA-256 hex of the normalized request key, not the raw header value.

Exact replay returns the same safe response. Same key for another Order uses Foundation's existing idempotency-conflict behavior.

### Stripe idempotency key

The raw browser key is never sent to Stripe. The adapter derives a provider key from stable internal identity:

```text
mkt_pi_<sha256("payments-intent-v1|<paymentId>|<normalized-key>")>
```

Only the derived provider key may be sent to Stripe or stored in safe internal metadata.

### Intent metadata

Stripe metadata contains IDs only:

```text
paymentId
orderId
```

Do not send customer email, address, Product text, seller private data, idempotency headers, or secrets as provider metadata.

### Intent response

The stable success data is:

```text
paymentId
orderId
provider = "stripe"
providerPaymentId
status
currency
amount
paymentExpiresAt
clientSecret
```

Rules:

- `clientSecret` is returned only from the intent-creation/get-intent operation when the current provider intent needs customer completion;
- `clientSecret` is never persisted, audited, logged, returned from admin search, or returned by the ordinary status endpoint;
- a captured/refunded Payment returns `clientSecret = null` and never creates another intent.

## 10. Customer payment-status contract

Route:

```text
GET /api/v1/payments/order/:orderId
```

Returns only the authenticated customer's own Payment. The response contains:

```text
paymentId
orderId
provider
status
currency
amountAuthorized
amountCaptured
amountRefunded
refundableAmount
providerPaymentId nullable
paymentExpiresAt
createdAt
updatedAt
```

`refundableAmount` is server-calculated and never accepted from the client.

This GET reads marketplace state only. It does not mark a Payment captured merely because the browser reached a success page. Provider reconciliation uses verified webhook/server-provider calls in service/background code.

## 11. Payment deadline and unpaid Order expiry

Module 12 uses the existing Checkout attempt deadline as the payment deadline:

```text
paymentExpiresAt = checkout_attempts.expires_at
```

No second arbitrary payment TTL is introduced.

Rules:

- creating/retrying an intent after the deadline is rejected;
- a `payment_intent.payment_failed` event marks the current attempt failed but does not immediately cancel the Order; the customer may retry before the deadline;
- a provider-cancelled intent may be retried before the deadline with a new idempotency key;
- after the deadline, a retryable maintenance operation cancels any still-active provider intent, marks the Payment cancelled when applicable, and invokes a narrow trusted Module 11 service boundary to cancel the unpaid Order and release remaining Inventory reservations;
- the unpaid-Order expiry path is in-process service composition; no new public/internal HTTP route is added;
- an Order that has already been provider-confirmed/captured is never expired by this job.

Pass 2 may add only the narrow Orders service boundary required to read the payment snapshot and expire an unpaid Order. Payments must not import the Orders repository.

## 12. Webhook raw-body and signature contract

Route:

```text
POST /api/v1/payments/webhooks/stripe
```

Required request header:

```text
stripe-signature
```

Implementation rule:

- request ID, logging, Helmet/CORS/rate-limit policy may run first;
- the Stripe webhook route must receive the exact raw `application/json` bytes required for signature verification;
- this route must be mounted before the application's normal `express.json(...)` body parser consumes those bytes;
- normal business routes continue to use the existing JSON parser;
- invalid/missing signature returns `PAYMENT_WEBHOOK_INVALID` and no unverified payload is persisted.

The backend never stores raw webhook bodies. It stores only approved identifiers, event type, SHA-256 `payload_hash`, processing status, safe error code, and timestamps.

## 13. Webhook event processing and idempotency

Accepted core event types are:

```text
payment_intent.processing
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
```

Any other correctly signed Stripe event is persisted as `ignored`, receives `processed_at`, and returns a successful webhook acknowledgement without a business state transition.

`payment_webhook_events.status` values are:

```text
received
processing
processed
ignored
failed
```

Rules:

- `(provider, provider_event_id)` is unique;
- a duplicate already-processed/ignored event returns success without duplicate transactions/events;
- a duplicate failed event may retry processing using the newly verified delivery;
- processing locks the Payment aggregate before state change;
- provider PaymentIntent ID, currency, amount, and metadata `paymentId/orderId` must match local state before capture is applied;
- provider transaction IDs/source identities are replay-safe;
- webhook business processing writes Payment state, Payment transaction rows, Orders integration, audit/outbox, and webhook status using explicit transaction boundaries;
- transient infrastructure failure before durable webhook receipt may return 5xx so Stripe can redeliver;
- once a verified event and provider money movement are durably recorded, reconciliation is owned by marketplace jobs rather than relying only on Stripe redelivery.

## 14. Capture transaction and Module 11 handoff

On an exact valid `payment_intent.succeeded` event:

1. verify the event signature and durable event identity;
2. lock the Payment row;
3. verify provider PaymentIntent ID, Order ID, Payment ID, currency, and exact provider amount;
4. create exactly one local `capture` transaction;
5. set `amount_authorized` and `amount_captured` to the provider-confirmed amount;
6. set Payment status to `captured`;
7. call transaction-bound `OrdersService.using(transaction).confirmPayment(...)` with:

```text
paymentId = local Payment UUID
paymentTransactionId = local capture transaction UUID
sourceKey = "payments:capture:<paymentTransactionId>"
currency = Payment currency
capturedAmount = canonical scale-4 captured amount
capturedAt = provider event/object timestamp normalized to ISO
```

8. emit `payment.captured` only once;
9. mark the webhook processed.

The browser never calls the Orders internal Payment-confirmed route directly.

### Provider capture when Order confirmation cannot complete

Provider truth must not be rolled back merely because the marketplace Order transition fails after the provider already captured funds.

If the provider capture is valid but `OrdersService.confirmPayment(...)` cannot complete:

- persist the Payment as `captured` and preserve the unique capture transaction;
- do not fake Order confirmation;
- mark the webhook processing record `failed` with a safe reconciliation error code;
- emit `payment.webhook_failed`;
- enqueue a retryable reconciliation job keyed by the capture transaction ID;
- the job first rechecks provider state and retries the exact Orders confirmation source;
- if later business policy requires a compensating refund, it must use the approved refund command/idempotency path rather than editing captured history.

This keeps provider cash truth separate from Order lifecycle truth.

## 15. Payment transaction contract

The base transaction types remain:

```text
intent
authorize
capture
refund
failure
```

Core transaction status values are:

```text
pending
succeeded
failed
```

Pass 1 adds the narrow replay field:

```text
source_key nullable
```

Rules:

- non-null `source_key` is unique;
- `intent` records one provider PaymentIntent creation/reuse boundary;
- `capture` uses the provider capture/charge identity when available and always has a unique marketplace source key;
- `refund` uses provider Refund identity when available and the trusted refund source key;
- `failure` may reference the local webhook event through `raw_event_id` and does not invent captured money;
- `authorize` remains available in the schema but is not produced by the core automatic-capture flow unless a later approved provider contract needs it;
- historical successful transaction rows are append-only; corrections use new rows/status transitions, not destructive rewrites.

## 16. Internal refund command

Route:

```text
POST /api/v1/internal/payments/:id/refund
```

It is protected by `internalServiceMiddleware`. Module 12 does not add a browser/customer/admin refund route.

Strict body:

```json
{
  "sourceKey": "refunds:<stable-business-source>",
  "amount": "25.0000",
  "providerReason": "requested_by_customer",
  "note": "Optional safe audit note",
  "requestedByUserId": "uuid-or-null"
}
```

Rules:

- `sourceKey` is required, trimmed, 1..200 characters, and supplied by the trusted future refund orchestrator;
- `amount` is positive canonical scale-4 money in the Payment currency;
- `providerReason` is optional and allow-listed to `requested_by_customer | duplicate | fraudulent`;
- `note` is optional, trimmed, max 500 characters, and is never sent to provider metadata;
- `requestedByUserId` is optional audit provenance only and does not grant authorization;
- refund eligibility/return policy remains Module 14 ownership; Module 12 enforces only provider/payment money safety;
- total successful refunds may never exceed captured amount;
- pending provider refunds reserve their requested amount when calculating a new refundable amount so concurrent refunds cannot oversubscribe capture;
- `amount_refunded` increases only when the provider refund succeeds;
- full successful refund sets Payment status `refunded`; otherwise successful non-zero refund sets `partially_refunded`;
- failed provider refund leaves `amount_refunded` unchanged and records the failed transaction.

### Refund idempotency

Marketplace source identity is the normalized `sourceKey`.

Provider idempotency key:

```text
mkt_re_<sha256("payments-refund-v1|<paymentId>|<sourceKey>")>
```

An exact replay returns the existing refund transaction/result. Reuse of one refund source with another payment/amount is a conflict and must not call Stripe again.

## 17. Persistence additions frozen for Pass 1

The three base tables remain the only Module 12 business tables required in the core pass:

```text
payments
payment_transactions
payment_webhook_events
```

Required additions/constraints beyond the base critical-field list:

### `payments`

```text
order_id UNIQUE NOT NULL
provider NOT NULL
provider_payment_id nullable
currency NOT NULL
amount_authorized NUMERIC(18,4) NOT NULL default 0
amount_captured NUMERIC(18,4) NOT NULL default 0
amount_refunded NUMERIC(18,4) NOT NULL default 0
status NOT NULL
idempotency_key nullable
created_at
automatically updated_at
```

Checks:

```text
amount_authorized >= 0
amount_captured >= 0
amount_refunded >= 0
amount_refunded <= amount_captured
currency normalized uppercase three-letter code
```

`provider_payment_id` is unique when non-null.

### `payment_transactions`

Keep the base fields and add:

```text
source_key nullable
created_at
updated_at
```

Use unique guards for non-null provider transaction identity and non-null `source_key`.

### `payment_webhook_events`

Keep the base fields and require:

```text
(provider, provider_event_id) UNIQUE
payload_hash char(64)
status
error_code nullable
received_at
processed_at nullable
```

Raw provider payload bytes, client secrets, card data, Stripe secret keys, and webhook secrets are never persisted.

## 18. Admin read/query contracts

### `GET /api/v1/admin/payments`

Allow-listed query:

```text
page
pageSize
status optional
provider optional
orderId optional
providerPaymentId optional
currency optional
createdFrom optional ISO timestamp
createdTo optional ISO timestamp
sort = createdAt | updatedAt
order = asc | desc
```

This is finance search, not generic CRUD.

### `GET /api/v1/admin/payments/:id`

Returns the safe Payment detail plus ordered transaction history.

Admin responses may include provider IDs needed for reconciliation but never include:

- client secrets;
- Stripe secret/webhook keys;
- raw webhook bodies;
- card PAN/CVC;
- raw customer `Idempotency-Key` values;
- internal API keys.

Sensitive finance reads are audited according to the base guide.

## 19. Error mapping

The base Module 12 error codes remain primary:

```text
PAYMENT_NOT_FOUND
PAYMENT_AMOUNT_MISMATCH
PAYMENT_PROVIDER_ERROR
PAYMENT_WEBHOOK_INVALID
PAYMENT_ALREADY_CAPTURED
REFUND_AMOUNT_EXCEEDED
```

Add one narrow lifecycle error required by the frozen payment deadline:

```text
PAYMENT_WINDOW_EXPIRED
```

Rules:

- unsupported provider currency/exponent, provider contract violations, or safe upstream Stripe failures map to `PAYMENT_PROVIDER_ERROR`;
- provider amount/currency disagreement with the immutable Order maps to `PAYMENT_AMOUNT_MISMATCH` and never confirms the Order;
- duplicate provider capture after a completed capture maps to replay/no-op when the exact source is already known, otherwise `PAYMENT_ALREADY_CAPTURED`;
- missing/invalid webhook signature maps to `PAYMENT_WEBHOOK_INVALID`;
- refund request above server-calculated available refundable amount maps to `REFUND_AMOUNT_EXCEEDED`;
- Foundation idempotency conflict, authentication, forbidden, validation, and internal errors continue using common stable error handling.

## 20. Events, audit, logging, and secrets

Required Payment events remain:

```text
payment.intent_created
payment.captured
payment.failed
payment.refunded
payment.webhook_failed
```

Rules:

- events are written through the Foundation transactional outbox;
- event payloads contain IDs, safe statuses, currency, and canonical amounts needed downstream, not secrets or card data;
- `payment.refunded` is emitted only when provider refund success is authoritative;
- manual/trusted refund commands and reconciliation actions are audited;
- admin finance-detail reads may be security/audit logged without raw provider payloads;
- Pino redaction must cover `stripe-signature`, `client_secret`, Stripe secret/webhook keys, Authorization/Cookie, raw Idempotency-Key, and any provider credential fields;
- never log raw webhook body bytes.

## 21. Provider adapter boundary

Later implementation uses a small provider-neutral interface. Business service code must not depend on Stripe SDK response types.

The adapter responsibilities are equivalent to:

```text
createPaymentIntent(...)
retrievePaymentIntent(...)
cancelPaymentIntent(...)
verifyAndParseWebhook(rawBody, signature)
createRefund(...)
retrieveRefund(...)
```

Rules:

- Stripe SDK calls live under the backend integration/provider boundary, not in controllers or repositories;
- the Payment service decides business state transitions;
- the adapter normalizes provider IDs, status, integer minor amounts, currency, timestamps, safe error category, and client secret where required;
- provider secrets are read only from validated backend environment configuration.

## 22. React payment handoff contract

Pass 7 later adds the base-guide UI only:

```text
Checkout payment component / Stripe Payment Element
Payment status page
Admin payment search
Transaction timeline
Refund reference display
```

Rules:

- Checkout confirmation creates the Order before payment UI begins;
- frontend calls `POST /payments/order/:orderId/intent` and uses the returned `clientSecret` only with Stripe.js;
- frontend never sends PAN/CVC to marketplace APIs;
- browser redirect/success state shows "processing" until marketplace `GET /payments/order/:orderId` reports provider-authoritative capture;
- frontend never calls the trusted internal Order Payment-confirmed or Payment refund routes;
- TanStack Query owns Payment server state; TanStack Form + Zod own real form/filter input only.

## 23. Pass sequence after this contract freeze

Generate Module 12 in this exact order:

1. **Pass 0 — contract freeze:** this patch only; no Payment runtime files/migration/frontend yet.
2. **Pass 1 — persistence:** Drizzle tables/relations/constraints and append-only migration `0024`.
3. **Pass 2 — contracts/service boundaries:** Zod/constants and narrow Orders/payment-expiry/provider-neutral interfaces.
4. **Pass 3 — repository:** scoped Drizzle persistence only.
5. **Pass 4 — service/provider adapter:** authoritative Payment service, Stripe sandbox adapter, webhook/refund/reconciliation logic.
6. **Pass 5 — HTTP/OpenAPI:** six approved operations, raw webhook parsing, RBAC/internal policy, application composition.
7. **Pass 6 — backend proof:** repository/service/Supertest/PostgreSQL/webhook/idempotency/refund/reconciliation regression suite.
8. **Pass 7 — React:** Stripe handoff, status/admin/timeline UI, RTL/MSW coverage.
9. **Pass 8 — Playwright/release:** sandbox/provider-test E2E, duplicate-webhook/browser-redirect proof, DB reconciliation, final Module 12 release gate.

Do not generate a later pass early merely to make a verifier green.

## 24. Pass 0 acceptance rule

Pass 0 is complete only when:

- this patch is present and approved;
- Module 11 Pass 8 remains intact;
- the two independent project topology is unchanged;
- no `src/modules/payments/` runtime implementation exists yet;
- no `src/database/schema/payments.ts` exists yet;
- no Module 12 migration `0024` or later exists yet;
- no frontend `src/features/payments/` exists yet;
- no Stripe runtime dependency or secret environment value is added early;
- the static verifier proves the existing Orders/Foundation integration anchors needed by the next pass.
