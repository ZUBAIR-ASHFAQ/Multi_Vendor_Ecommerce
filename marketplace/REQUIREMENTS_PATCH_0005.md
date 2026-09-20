# Requirements Patch 0005 — Module 11 Orders Executable Contract

**Status: APPROVED additive contract patch for the current implementation.**

This patch freezes the minimum executable details that the 99-page marketplace guide leaves open for **Module 11 — Order Management & Multi-Seller Split**. It supplements the base guide and the approved Checkout contract in `REQUIREMENTS_PATCH_0004.md`.

It does **not** change the selected stack, the two independent frontend/backend projects, seller isolation, module ownership, generation order, or the rule that Customer Order, Seller Order, Payment, Inventory, Shipping, Return/Refund, Commission, Wallet, and Payout state remain separate concepts.

## 1. Module boundary and ownership

Module 11 owns:

- the immutable commercial Customer Order snapshot;
- deterministic split into Seller Orders;
- immutable Order Item and address snapshots;
- order/seller-order lifecycle transitions that belong to Orders;
- pre-capture cancellation and partial line cancellation;
- order/seller-order status history;
- customer, seller, and admin order reads;
- the trusted idempotent Payment-confirmed boundary consumed later by Module 12.

Module 11 does **not** own:

- provider payment intent/capture/webhook processing — Module 12;
- physical shipment/tracking/delivery — Module 13 completion;
- return/refund decisions — Module 14;
- commission calculation — Module 16;
- seller wallet/payout state — Module 17.

Orders may store a safe snapshot of downstream state only when the owning module supplies the transition through an approved service/internal boundary. Browser state can never mark an order paid, shipped, delivered, refunded, or settled.

## 2. Approved Module 11 routes remain unchanged

Do not add generic Order CRUD routes.

```text
GET  /api/v1/orders
GET  /api/v1/orders/:id
GET  /api/v1/seller/orders
GET  /api/v1/seller/orders/:id
POST /api/v1/seller/orders/:id/accept
POST /api/v1/orders/:id/cancel
POST /api/v1/admin/orders/:id/cancel
GET  /api/v1/admin/orders
POST /api/v1/internal/orders/:id/payment-confirmed
```

Rules:

- customer/seller/admin routes use normal authentication and the permissions from the base guide;
- the internal payment-confirmed route uses the existing `x-internal-api-key` / `internalServiceMiddleware` mechanism already used by trusted Inventory internal commands;
- Checkout-to-Orders creation is an **in-process service call inside the existing Checkout transaction**; it does not create a new HTTP route;
- no route accepts client-controlled authoritative totals, customer identity, seller identity, payment state, or fulfillment state.

## 3. Required permissions

The existing representative permissions are frozen as the Module 11 permission catalog:

```text
orders.read_own
seller.orders.read
seller.orders.manage
admin.orders.read
admin.orders.cancel
```

Rules:

- `orders.read_own` protects the authenticated customer's own list/detail and own cancellation command;
- `seller.orders.read` protects seller queue/detail reads;
- `seller.orders.manage` protects seller acceptance;
- `admin.orders.read` protects admin search;
- `admin.orders.cancel` protects privileged cancellation;
- service methods repeat customer/seller/store ownership checks even after route middleware.

## 4. Checkout → Orders transaction contract

A successful Module 10 confirmation must materialize the Order in the **same PostgreSQL transaction** as the Checkout attempt and Inventory reservations.

The final integration order is:

1. Checkout locks and revalidates the customer-owned quote.
2. Checkout creates the `checkout_attempt`.
3. Checkout creates every required Inventory reservation.
4. Checkout calls transaction-bound `OrdersService.createFromCheckout(...)` with the approved immutable input in this patch.
5. Orders creates the parent Customer Order, Seller Orders, Order Items, Order Address snapshots, initial status history, audit, and outbox rows.
6. Checkout stores the returned `orderId` on `checkout_attempts.order_id`.
7. The transaction commits once.
8. Checkout completes Foundation idempotency with the stable response.

If any step fails, the whole transaction rolls back. A committed Checkout attempt/reservation set must never exist without its required Order after Module 11 integration is enabled.

### Exactly-once source identity

Add an append-only database uniqueness guard so one Checkout attempt creates at most one Order:

```text
orders.checkout_attempt_id UNIQUE NOT NULL
```

When the Orders table exists, add an append-only foreign key from:

```text
checkout_attempts.order_id -> orders.id
```

`checkout_attempts.order_id` remains the Checkout-side link used by the existing expiry guard.

An exact retry returns the existing Order. A different attempt can never reuse an existing Order source.

## 5. Approved `CreateOrderFromCheckoutInput`

Checkout passes a trusted service DTO. Controllers never construct it.

```text
checkoutAttemptId
customerUserId
currency
subtotal
discountTotal
taxTotal
shippingTotal
grandTotal
shippingAddress
billingAddress
lines[]
shippingSelections[]
```

### Address snapshot input

Each address contains exactly:

```text
sourceAddressId
recipientName
phone
line1
line2 nullable
city
region
postalCode nullable
countryCode
```

Rules:

- values come from the final authoritative Checkout revalidation;
- strings use the same Checkout normalization as the approved Checkout state hash;
- `countryCode` is uppercase;
- Order Address rows are immutable snapshots; later Customer-address edits never rewrite them.

### Order line input

Each line contains:

```text
productId
variantId
sellerId
storeId
inventoryReservationId
skuSnapshot
nameSnapshot
variantTitleSnapshot nullable
quantity
unitPrice
discountAllocated
taxAllocated
lineTotal
```

Rules:

- `productId`, `variantId`, seller/store ownership, SKU, Product name, optional variant title, price, and currency are server-derived;
- Module 6 must expose the SKU/name/title through the trusted Checkout Product service boundary before Orders integration;
- `inventoryReservationId` is the reservation just created for this exact Checkout line;
- the same Inventory reservation cannot back more than one Order Item;
- historical SKU/name/title/price are never recalculated from the mutable Product after Order creation;
- `commission_rule_snapshot_json` starts `NULL`; Module 16 owns commission-rule snapshotting.

### Shipping-selection input

Each selection contains:

```text
sellerId
storeId
shippingMethodId
shippingMethodCodeSnapshot
shippingMethodNameSnapshot
amount
currency
```

There must be exactly one selection for every non-empty Seller Order store group.

## 6. Deterministic multi-seller split

Order Items are grouped by the exact tuple:

```text
(sellerId, storeId)
```

Rules:

- one group creates exactly one `seller_orders` row;
- every Order Item belongs to exactly one Seller Order;
- no Seller Order may contain another seller/store's item;
- groups are created in deterministic `storeId`, then `sellerId` order for stable tests/logs;
- Customer Order totals are not duplicated into each Seller Order.

### Seller Order money

For one Seller Order group:

```text
subtotal       = sum(unitPrice * quantity)
discountTotal  = sum(discountAllocated)
taxTotal       = sum(taxAllocated)
shippingTotal  = selected Shipping snapshot amount for that store
grandTotal     = subtotal - discountTotal + taxTotal + shippingTotal
```

The sum of all Seller Order values must reconcile exactly to the Customer Order/Checkout snapshot:

```text
sum(seller subtotal)       = order subtotal
sum(seller discountTotal)  = order discountTotal
sum(seller taxTotal)       = order taxTotal
sum(seller shippingTotal)  = order shippingTotal
sum(seller grandTotal)     = order grandTotal
```

All money is PostgreSQL `NUMERIC(18,4)` and JSON decimal strings. Do not use JavaScript floating-point money.

Order financial snapshots remain unchanged by later cancellation. Cancellation/refund effects are represented by controlled state/quantity/adjustment records owned by the appropriate module; historical Checkout totals are not rewritten.

## 7. Stable IDs and human-readable order numbers

Module 11 uses UUID primary keys.

To avoid a new sequence library or collision-prone random display code, generate the display numbers deterministically from the already generated UUID:

```text
order_no        = "ORD-" + uppercase UUID hex without dashes
seller_order_no = "SOR-" + uppercase UUID hex without dashes
```

Example:

```text
ORD-550E8400E29B41D4A716446655440000
SOR-6BA7B8109DAD11D180B400C04FD430C8
```

Both columns are unique and immutable.

## 8. Required persistence additions beyond the base critical-field list

The base guide's listed fields remain required. The following additions are approved because they are necessary to make the required workflows executable and traceable.

### `orders`

Add:

```text
checkout_attempt_id UNIQUE NOT NULL
created_at
updated_at
```

`placed_at` stays nullable and is set only by the first trusted Payment-confirmed transition.

### `seller_orders`

Add:

```text
shipping_method_id
shipping_method_code_snapshot
shipping_method_name_snapshot
created_at
updated_at
```

The shipping method fields copy the approved Checkout selection for that store and are immutable commercial snapshots. Module 13 may use them as context but current Shipping eligibility remains owned by Module 13.

### `order_items`

Add:

```text
variant_title_snapshot nullable
inventory_reservation_id UNIQUE NOT NULL
cancelled_qty integer NOT NULL default 0
created_at
updated_at
```

Required checks:

```text
quantity > 0
cancelled_qty >= 0
cancelled_qty <= quantity
```

`remainingQuantity = quantity - cancelled_qty` is derived; do not persist another duplicate quantity column.

### `order_addresses`

Add:

```text
source_address_id nullable
recipient_name
phone
line1
line2 nullable
city
region
postal_code nullable
country_code
created_at
```

Each Order has exactly one `shipping` and one `billing` snapshot. `source_address_id` is traceability only; snapshot text is authoritative for the placed Order.

### `order_status_history`

Add:

```text
source_type nullable
source_key nullable
metadata_json nullable
```

Use a partial/conditional unique guard for non-null `(source_type, source_key)` values so trusted external/internal transitions can be replay-safe without making ordinary user status rows invent a source key.

## 9. Module 11 state model

State values are lowercase strings. Database fields stay varchar/extensible so later approved modules can add their own fulfillment/refund integration values without rewriting old migrations.

### Customer Order `payment_status`

Module 11 initializes:

```text
pending
```

The trusted Module 12 payment-confirmed boundary may set:

```text
captured
```

Module 11 does not invent provider success. Further payment/refund values are deferred to Modules 12/14.

### Customer Order `fulfillment_status`

Module 11 initializes:

```text
unfulfilled
```

Module 11 does not mark shipped/delivered. Module 13 completion owns later fulfillment transitions.

### Customer Order `order_status`

Module 11 may write/derive:

```text
pending_payment
confirmed
processing
cancelled
```

Current-stage derivation rule:

1. if every Order Item has `remainingQuantity = 0` → `cancelled`;
2. else if `payment_status != captured` → `pending_payment`;
3. else if any non-cancelled Seller Order is `processing` → `processing`;
4. else → `confirmed`.

The parent status is always recalculated from authoritative child/payment state after a relevant transition. There is no generic repository method that arbitrarily sets a parent status from HTTP input.

### Seller Order `status`

Module 11 may write:

```text
pending_payment
pending_acceptance
processing
cancelled
```

Rules:

- new Seller Order → `pending_payment`;
- trusted Payment confirmation → `pending_acceptance` when any quantity remains;
- seller `/accept` → `processing`;
- all item quantities cancelled → `cancelled`;
- partial line cancellation does not overwrite the Seller Order lifecycle state while quantity remains.

### Order Item `status`

Module 11 may write:

```text
active
partially_cancelled
cancelled
```

Rules:

- new item → `active`;
- `0 < cancelled_qty < quantity` → `partially_cancelled`;
- `cancelled_qty = quantity` → `cancelled`.

Payment and fulfillment are deliberately not duplicated into the item status in Module 11.

## 10. Payment-confirmed internal command

The route remains:

```text
POST /api/v1/internal/orders/:id/payment-confirmed
```

It is protected by `internalServiceMiddleware` and is **not** callable with a customer/seller access token alone.

Strict body:

```json
{
  "paymentId": "uuid",
  "paymentTransactionId": "uuid",
  "sourceKey": "payments:<stable-source>",
  "currency": "USD",
  "capturedAmount": "1000.0000",
  "capturedAt": "2026-09-12T12:34:56.000Z"
}
```

Rules:

- `sourceKey` is trimmed, 1..200 characters, and comes from Module 12's persisted payment transaction/event identity;
- `currency` must equal the Order currency;
- `capturedAmount` must equal the Order `grand_total` exactly at scale 4 in the core release;
- the command is idempotent by non-null status-history `(source_type = "payment_confirmed", source_key)`;
- an exact replay returns the already-confirmed Order;
- reuse of one payment source for a different Order maps to `ORDER_SOURCE_DUPLICATE`;
- the first successful transition sets `payment_status = captured`, sets `placed_at = capturedAt`, moves remaining Seller Orders to `pending_acceptance`, and emits `order.payment_confirmed`;
- every non-cancelled Order Item Inventory reservation must be committed through transaction-bound Inventory service logic before the transition commits;
- if a required reservation is expired/released/invalid, Order confirmation fails rather than fabricating stock commitment; Module 12 later owns payment reconciliation/refund handling for such provider-authoritative edge cases.

Browser redirects and frontend requests never call this command directly and can never mark an Order paid.

## 11. Seller acceptance contract

`POST /api/v1/seller/orders/:id/accept` uses a strict empty JSON body (or no body).

Rules:

- actor must have `seller.orders.manage` in the exact Seller Order seller/store scope;
- parent Order payment status must be `captured`;
- Seller Order must be `pending_acceptance`;
- transition sets Seller Order to `processing`;
- an exact retry when already `processing` returns the current Seller Order without a duplicate event/history row;
- acceptance does not capture payment, issue stock, create a shipment, or mark fulfillment complete;
- event: `seller_order.accepted`.

## 12. Customer/admin cancellation contract

Routes remain:

```text
POST /api/v1/orders/:id/cancel
POST /api/v1/admin/orders/:id/cancel
```

Both require:

```http
Idempotency-Key: <1..200 trimmed characters>
Content-Type: application/json
```

Strict body:

```json
{
  "items": [
    {
      "orderItemId": "uuid",
      "quantity": 1
    }
  ],
  "reason": "Changed my mind"
}
```

Rules:

- `items` is optional; omitted means cancel every remaining cancellable quantity in the Order;
- when supplied, `items` must be non-empty and contain unique `orderItemId` values;
- `quantity` is an incremental positive integer and may not exceed that item's current remaining quantity;
- `reason` is optional, trimmed, 1..500 characters when present;
- customer route can mutate only the authenticated customer's Order;
- admin route requires `admin.orders.cancel`;
- in the Module 11 stage, cancellation is allowed only while `payment_status = pending` and `fulfillment_status = unfulfilled`;
- captured/paid cancellation is rejected with `ORDER_CANCELLATION_NOT_ALLOWED` until Modules 12/14 provide the required refund coordination;
- cancelled quantities never rewrite original Order/Seller Order financial totals;
- Order Item `cancelled_qty` and status are updated under row locks;
- Seller Order/parent statuses are re-derived after the quantity changes;
- Inventory release and Order cancellation changes share one database transaction;
- event: `order.cancelled` when the parent becomes fully cancelled; otherwise emit `order.status_changed` only when the derived parent status actually changes.

### Cancellation idempotency

Foundation scopes are:

```text
orders.cancel:<customerUserId>
orders.admin-cancel:<adminActorId>
```

The request hash is SHA-256 of `JSON.stringify` over this fixed-order object:

```text
version = "orders-cancel-v1"
orderId
items
reason
```

Canonicalization:

- UUIDs lowercase;
- omitted `items` serializes as `null`;
- supplied items sort by `orderItemId` and contain `orderItemId`, then `quantity`;
- omitted `reason` serializes as `null`;
- reason is trimmed before hashing.

Exact replay returns the stored response. Same key with another payload uses Foundation's standard idempotency-conflict error; do not invent another Module 11 code.

## 13. Minimal Inventory extension required for partial cancellation

The base Order workflow allows partial item cancellation. Current Inventory reservations track original and consumed quantity but do not preserve a separate partially released quantity. Module 11 therefore requires one narrow additive Inventory capability before cancellation is executable.

In an append-only migration, add to `stock_reservations`:

```text
released_qty integer NOT NULL default 0
```

Required invariant:

```text
released_qty >= 0
consumed_qty + released_qty <= qty
```

Inventory service must expose a transaction-bound business method equivalent to:

```text
releaseReservationQuantity(reservationId, quantity, sourceKey)
```

Rules:

- Module 11 calls the Inventory **service**, never the Inventory repository;
- Module 11 stage partial cancellation releases only reservations still in `reserved` state;
- release decrements `inventory_items.reserved_qty` and increments `released_qty` atomically;
- a full remaining release moves the reservation to `released`;
- a partial release keeps the reservation `reserved` with a smaller derived remaining quantity;
- remaining reservation quantity becomes `qty - consumed_qty - released_qty` everywhere, including expiry and future shipment checks;
- each release appends the existing Inventory movement/audit/outbox evidence with a deterministic source key;
- Order cancellation source key is:

```text
order-cancel:<orderId>:<sha256(idempotencyKey)>:<orderItemId>
```

- no new public/internal Inventory HTTP route is required for the in-process Orders integration.

## 14. Read/query contracts

All lists use the existing bounded pagination conventions and allow-listed sort values only.

### `GET /api/v1/orders`

Customer-owned list query:

```text
page
pageSize
orderStatus optional
sort = createdAt | orderNo
order = asc | desc
```

No customer ID is accepted.

### `GET /api/v1/orders/:id`

Returns one Customer Order only when `customer_user_id` equals the authenticated customer.

### `GET /api/v1/seller/orders`

Seller-scoped list query:

```text
page
pageSize
storeId optional, but must be inside actor scope
status optional
sort = createdAt | sellerOrderNo
order = asc | desc
```

Seller identity is derived from request context; it is not trusted from query input.

### `GET /api/v1/seller/orders/:id`

Returns one Seller Order only inside the actor's authorized seller/store scope.

### `GET /api/v1/admin/orders`

Admin search query:

```text
page
pageSize
orderNo optional
customerUserId optional
sellerId optional
storeId optional
orderStatus optional
paymentStatus optional
createdFrom optional ISO timestamp
createdTo optional ISO timestamp
sort = createdAt | orderNo
order = asc | desc
```

Date ranges are bounded using the project/common pagination/filter rules. This remains a search/list route, not generic CRUD.

## 15. Frozen response shapes

Every HTTP response uses the existing stable API envelope and safe `requestId` behavior.

### Customer Order summary

```text
id
orderNo
currency
subtotal
discountTotal
taxTotal
shippingTotal
grandTotal
paymentStatus
fulfillmentStatus
orderStatus
placedAt nullable
createdAt
```

### Customer Order detail

Customer detail contains the summary fields plus:

```text
shippingAddress
billingAddress
sellerOrders[]
statusHistory[]
```

Each `sellerOrders[]` item contains:

```text
id
sellerOrderNo
sellerId
storeId
subtotal
discountTotal
taxTotal
shippingTotal
grandTotal
status
shippingMethod
items[]
```

`shippingMethod` contains:

```text
id
code
name
amount
currency
```

Each Order Item contains:

```text
id
productId
variantId
sku
name
variantTitle nullable
quantity
cancelledQuantity
remainingQuantity
unitPrice
discountAllocated
taxAllocated
lineTotal
status
```

Customer responses do not expose Inventory reservation IDs, internal source keys, commission internals, provider secrets, or another customer's private information.

### Seller Order detail

Seller detail contains the Seller Order fields, its own items, parent `orderId`/`orderNo`, safe parent payment/fulfillment status, and the **shipping address snapshot only**. It does not expose the customer's billing address or another seller's Order Items.

### Admin list

Admin search returns paginated Customer Order summaries. A new generic admin detail route is not added by this patch.

## 16. Error mapping

Keep exactly the Module 11 business codes from the base guide:

```text
ORDER_NOT_FOUND
ORDER_STATUS_INVALID
SELLER_ORDER_SCOPE_FORBIDDEN
ORDER_CANCELLATION_NOT_ALLOWED
ORDER_SOURCE_DUPLICATE
```

Use them as follows:

- `ORDER_NOT_FOUND` — private Order not found inside the allowed customer/admin read boundary;
- `ORDER_STATUS_INVALID` — lifecycle command is not valid from current authoritative state, including failed Inventory commitment during Payment confirmation;
- `SELLER_ORDER_SCOPE_FORBIDDEN` — authenticated seller cannot access/manage that Seller Order scope;
- `ORDER_CANCELLATION_NOT_ALLOWED` — cancellation is outside the currently allowed payment/fulfillment rules;
- `ORDER_SOURCE_DUPLICATE` — Checkout attempt or Payment source identity is already attached to another Order/business effect.

Authentication, generic forbidden, validation, Foundation idempotency conflicts, and safe internal errors continue to use common error handling.

## 17. Events, audit, and history

Required durable events remain:

```text
order.created
order.payment_confirmed
seller_order.created
seller_order.accepted
order.cancelled
order.status_changed
```

Rules:

- `order.created` and all `seller_order.created` events are written in the same transaction as the Order snapshot;
- event payloads contain IDs/statuses needed by downstream consumers, not entire private address/payment payloads;
- audit status transitions, seller acceptance, privileged cancellation, and source conflicts;
- normal customer/seller reads are not written as heavy business audit rows;
- never log internal API keys, Idempotency-Key values, provider secrets, or customer billing details in structured metadata.

## 18. Frontend boundary for later Pass 7

The required React feature remains:

- Customer order history/detail;
- Seller order queue/detail;
- status timeline;
- cancellation flow;
- Admin order search/support view.

UI rules:

- Customer Order and Seller Order are different frontend models;
- TanStack Query owns server state;
- TanStack Form + Zod own cancellation form state/validation;
- frontend permission hiding is convenience only;
- UI cannot write payment/fulfillment/order statuses directly;
- historical Product names/prices displayed on Order pages come from Order snapshots, not current Product queries.

## 19. Pass-by-pass implementation sequence after this Pass 0

This contract freeze does not authorize skipping dependency order.

Implement Module 11 in this order:

1. **Pass 1 — persistence:** Orders tables/relations/append-only migrations, plus the minimal `released_qty` Inventory migration required by this patch; verify clean and supported-upgrade migrations.
2. **Pass 2 — contracts/service boundaries:** Zod request/response contracts, Product snapshot fields, transaction-bound Inventory partial-release boundary, and only other narrow prerequisites actually used by Orders.
3. **Pass 3 — repository:** scoped Drizzle reads/writes/locks/source lookups only.
4. **Pass 4 — service:** snapshot creation, deterministic split, state derivation, pre-capture cancellation, seller acceptance, Payment-confirmed orchestration, audit/outbox/history.
5. **Pass 5 — HTTP/OpenAPI + Checkout integration:** publish exactly the approved routes and wire Checkout confirmation to `OrdersService.createFromCheckout(...)` inside the existing transaction.
6. **Pass 6 — backend proof:** repository/service/Supertest/PostgreSQL tests including customer/seller isolation, concurrency, source replay, money reconciliation, cancellation, Inventory release/commit, and OpenAPI parity.
7. **Pass 7 — React/RTL/MSW:** customer/seller/admin Order UI using the existing frontend stack only.
8. **Pass 8 — Playwright/release gate:** real Checkout → Order workflow, seller isolation, snapshots, cancellation/acceptance, reconciliation, builds, migrations, and cleanup checks.

Only after Module 11 passes its final release gate should Module 12 Payments implementation begin.

## 20. Simplicity and cleanup rules

Module 11 implementation must continue the repository's readability rules:

- every named function/class method gets a short useful comment/JSDoc;
- controllers stay thin;
- services own business rules and transactions;
- repositories own Drizzle queries only;
- cross-module business calls use services, never another module's repository;
- prefer explicit helpers and early returns over framework-like abstractions;
- no `any` where a small concrete type is practical;
- no empty `orders.types.ts` or `orders.constants.ts` files;
- no unused functions, dead code, duplicate response types, generated build/test output, or giant pass-evidence markdown files;
- do not add Redux/Zustand, a root workspace, shared runtime package, or new framework.
