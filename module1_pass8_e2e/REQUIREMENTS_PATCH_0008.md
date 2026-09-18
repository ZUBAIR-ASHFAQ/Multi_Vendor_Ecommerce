# Requirements Patch 0008 — Module 13 Shipping & Fulfillment Completion Contract Freeze

**Status: APPROVED additive executable contract patch for Stage 16 Module 13 completion.**

This patch supplements the 99-page marketplace requirements guide and the already-approved `REQUIREMENTS_PATCH_0003.md` Shipping Configuration Core contract. It freezes only the executable details needed to complete **Module 13 — Shipping & Fulfillment** after Orders, Payments, Inventory, and Commissions are available.

It does not replace the selected stack, independent frontend/backend repositories, seller isolation, stable API envelope, exact-money rules, audit/outbox requirements, or the Stage 11 shipping-options behavior already used by Checkout.

## 1. Pass 0 boundary

Pass 0 is inspection and contract freeze only.

It must not change:

- database schema or migrations;
- runtime Shipping/Orders/Inventory/Payments/Commission behavior;
- HTTP routes or OpenAPI operations;
- frontend runtime code;
- dependencies;
- project/repository topology.

The purpose of Pass 0 is to inspect the released prerequisites, preserve the working Shipping Configuration Core, identify the minimum shared changes required by fulfillment, and freeze ambiguous lifecycle rules before implementation begins.

## 2. Existing Shipping Configuration Core remains authoritative

Keep the Stage 11 contract from `REQUIREMENTS_PATCH_0003.md` unchanged:

```text
shipping_methods
GET /api/v1/checkout/shipping-options?addressId=<uuid>
```

The existing flat-rate method model, active/inactive lifecycle, currency matching, server-derived seller/store grouping, customer-owned address validation, and grouped Checkout response remain backward compatible.

Stage 16 must extend the same Module 13 folder. Do not create a second Shipping module or duplicate `shipping_methods`.

## 3. Approved Stage 16 HTTP surface

The final Module 13 surface is exactly:

```text
GET   /api/v1/checkout/shipping-options
GET   /api/v1/seller/shipments
POST  /api/v1/seller/orders/:sellerOrderId/shipments
PATCH /api/v1/seller/shipments/:id/tracking
POST  /api/v1/seller/shipments/:id/mark-shipped
POST  /api/v1/seller/shipments/:id/mark-delivered
GET   /api/v1/orders/:orderId/shipments
```

No generic Shipment CRUD routes are approved. In particular, this patch does not add shipment delete, shipment item edit, generic status update, carrier CRUD, or provider-webhook routes.

## 4. Shipment persistence contract

Stage 16 adds the three deferred fulfillment tables from the base guide:

```text
shipments
shipment_items
shipment_status_history
```

Required behavior:

### `shipments`

Stores:

- `id` UUID primary key;
- `seller_order_id` required FK;
- `shipment_no` required unique server-generated display number;
- `carrier` nullable before tracking is entered;
- `service_level` nullable;
- `tracking_no` nullable before tracking is entered;
- `status` required;
- `shipped_at` nullable;
- `delivered_at` nullable;
- `created_at` and `updated_at` timestamptz.

`shipment_no` is server-generated as:

```text
SHP-<uppercase UUID without hyphens>
```

The client never submits or controls `shipment_no`, seller ownership, seller order ownership, status, or lifecycle timestamps.

### `shipment_items`

Stores one immutable allocation from a Shipment to an Order Item:

- `shipment_id` required FK;
- `order_item_id` required FK;
- `quantity` positive integer;
- unique (`shipment_id`, `order_item_id`).

Shipment item quantities are immutable after creation. There is no later shipment-item edit API in the approved route surface.

### `shipment_status_history`

Append-only lifecycle history:

- `id` UUID primary key;
- `shipment_id` required FK;
- `status` required;
- `source` required;
- `occurred_at` required timestamptz;
- `payload_ref` nullable.

Normal application APIs never update or delete status-history rows.

## 5. Shipment lifecycle

The core release supports exactly these Shipment statuses:

```text
created
shipped
delivered
```

Allowed transitions:

```text
create shipment -> created
created -> shipped
shipped -> delivered
```

Rules:

- no transition may skip directly from `created` to `delivered`;
- `delivered` is terminal in Module 13;
- no `cancelled`, `returned`, `lost`, or arbitrary free-text Shipment status is added in Stage 16;
- Returns/Refunds owns post-delivery correction workflows later;
- exact replay of an already-completed command returns the existing Shipment result instead of creating duplicate history/effects;
- conflicting replay fails with a stable conflict/business error.

## 6. Inventory issue timing — ambiguity resolved

The base guide contains two descriptions that can be read differently: the workflow mentions shipment creation/issues reserved stock, while the route table explicitly describes `mark-shipped` as **Mark shipped and issue inventory**.

Stage 16 freezes the executable behavior as:

```text
POST create shipment
  -> validates committed reservation and quantity
  -> persists Shipment allocation
  -> DOES NOT consume physical/reserved stock

POST mark-shipped
  -> revalidates Shipment and Order eligibility
  -> consumes the matching committed Inventory reservation
  -> appends Inventory ship movement exactly once
  -> moves Shipment created -> shipped
```

This preserves a clear physical-fulfillment boundary: stock is issued when the Shipment is actually marked shipped, not when a Shipment record is prepared.

## 7. Seller Order and payment eligibility

A Shipment may be created only when all of the following are true:

- the authenticated seller actor has `seller.shipping.manage` inside the Shipment's server-derived seller/store scope;
- the Seller Order belongs to that scope;
- the parent Order has provider-authoritative `payment_status = captured`;
- the Seller Order has already been accepted and is `processing`;
- each requested Order Item belongs to that Seller Order;
- each requested Order Item has remaining non-cancelled quantity;
- each Order Item is backed by its immutable committed Inventory reservation.

Shipping consumes payment/order facts through an **Orders service boundary**. Shipping must not query Orders or Payments persistence through another module's repository.

Module 12 remains the authority that causes Orders to reach provider-verified captured state. Shipping never marks a payment captured.

## 8. Fulfillable quantity

For one Order Item:

```text
commercial_remaining = order_item.qty - order_item.cancelled_qty
allocated_to_shipments = sum(shipment_items.quantity for every persisted shipment allocation)
fulfillable_quantity = commercial_remaining - allocated_to_shipments
```

Rules:

- `fulfillable_quantity` must never be negative;
- creating a Shipment allocation consumes fulfillable allocation immediately, even while Shipment status is `created`;
- this prevents two Shipment records from allocating the same Order Item quantity;
- requested Shipment quantity must be `<= fulfillable_quantity` at creation;
- `mark-shipped` also verifies the Shipment's Inventory reservation can still cover its immutable allocated quantity;
- one Seller Order may have multiple Shipments;
- the sum of Shipment allocations for an Order Item may never exceed its non-cancelled commercial quantity.

Because the approved route surface has no Shipment cancellation/delete command, a created Shipment allocation is intentionally immutable. Incorrect allocation must be prevented by validation rather than repaired by silently rewriting history.

## 9. Inventory command contract and deterministic source keys

Module 7 already exposes the trusted service boundary:

```text
InventoryService.shipStock(context, {
  reservationId,
  quantity,
  sourceId,
  sourceKey
})
```

Stage 16 must call this service boundary, preferably inside the same database transaction using the existing transaction-aware service composition. Shipping must never decrement `inventory_items` directly.

For each Shipment Item, use:

```text
sourceId  = shipment.id
sourceKey = shipment:<shipmentId>:item:<orderItemId>
```

The Inventory module may apply its own stable movement-key prefix internally. The combination above is deterministic and unique per physical Shipment Item issue.

Retrying `mark-shipped` must therefore never create a second Inventory ship movement for the same Shipment Item.

## 10. Tracking contract

Create Shipment request does not accept authoritative tracking/status fields.

Tracking is set or corrected through:

```text
PATCH /api/v1/seller/shipments/:id/tracking
```

Writable fields:

```text
carrier       required non-blank string
trackingNo    required non-blank string
serviceLevel  optional nullable non-blank string
```

Rules:

- tracking may be set/replaced while status is `created`;
- tracking may be corrected while status is `shipped`, but the correction must be audited with before/after values;
- tracking is immutable after status becomes `delivered`;
- tracking values are normalized by trimming whitespace;
- setting the exact current values is a no-op replay and must not append duplicate audit/outbox evidence;
- `mark-shipped` requires both `carrier` and `tracking_no` to exist;
- the client cannot directly set Shipment status or timestamps through the tracking route.

## 11. Mark-shipped command

`POST /api/v1/seller/shipments/:id/mark-shipped` requires an `Idempotency-Key` header.

The service must:

1. resolve seller scope server-side;
2. lock/read the Shipment and its immutable items;
3. require current Shipment status `created` unless this is an exact replay;
4. require carrier/tracking values;
5. revalidate captured/processing Order eligibility;
6. call `InventoryService.shipStock` once per Shipment Item using the deterministic source contract;
7. persist `status = shipped` and server `shipped_at = now`;
8. append Shipment status history;
9. append required audit evidence;
10. enqueue `shipment.shipped` through the transactional outbox.

The Shipping state transition and Inventory stock issue must participate in one database transaction so a failed Inventory issue cannot leave a Shipment marked shipped without the corresponding stock movement.

## 12. Mark-delivered command

`POST /api/v1/seller/shipments/:id/mark-delivered` requires an `Idempotency-Key` header.

Rules:

- only `shipped -> delivered` is valid;
- exact replay returns the existing delivered Shipment;
- server sets `delivered_at = now`;
- delivery does not capture or change Payment state;
- manual seller delivery is allowed only inside seller scope with `seller.shipping.manage`;
- the action is audited;
- enqueue `shipment.delivered` through the transactional outbox;
- the delivery timestamp becomes authoritative input for Module 14 return windows, Module 15 verified reviews, and Module 17 payout availability.

No client-supplied delivered timestamp is authoritative in the core release.

## 13. Create-shipment idempotency

`POST /api/v1/seller/orders/:sellerOrderId/shipments` requires an `Idempotency-Key` header.

The idempotency request hash includes at minimum:

- path Seller Order ID;
- canonical sorted list of (`orderItemId`, `quantity`).

Rules:

- repeated identical request/key returns the original Shipment;
- same key with different Seller Order/items/quantities fails as an idempotency conflict;
- successful replay never inserts another Shipment, Shipment Item, history row, audit event, or outbox event.

## 14. Tracking PATCH retry behavior

The tracking PATCH does not require an idempotency header because it is an exact-value update command.

Rules:

- same normalized tracking values return the current Shipment without a second mutation event;
- different tracking values perform one controlled correction if the current Shipment status permits it;
- after delivery, any different value is rejected.

## 15. Shipping permissions and seller isolation

Stage 16 owns this permission catalog:

```text
shipping.read_own_order
seller.shipping.read
seller.shipping.manage
admin.shipping.read
```

Role composition:

- customer self-service receives `shipping.read_own_order`;
- seller owner and seller manager receive `seller.shipping.read` and `seller.shipping.manage`;
- platform super-admin receives the Shipping catalog through central RBAC composition;
- `admin.shipping.read` is available for support/admin shipment reads but does not grant seller mutation rights.

Every seller-scoped repository read/write must include seller/store scope. Service methods repeat ownership checks for private reads and all writes.

Seller A must not be able to infer whether Seller B's Shipment/Seller Order exists. Use the stable scope/not-found policy rather than leaking cross-seller existence.

## 16. Read contracts

### Seller Shipment list

```text
GET /api/v1/seller/shipments
```

Uses bounded pagination and allow-listed filters:

```text
sellerOrderId? UUID
status?        created | shipped | delivered
page?
pageSize?
sort?          createdAt | shipmentNo
order?         asc | desc
```

The server derives seller/store scope. The client does not submit a seller ID to widen access.

Each list item may include its immutable Shipment Items and status timeline so the approved seller UI can render fulfillment detail without inventing an unapproved Shipment-detail route.

### Customer/Admin Order tracking

```text
GET /api/v1/orders/:orderId/shipments
```

Policy:

- a customer with `shipping.read_own_order` may read Shipments only for their own Order;
- an authorized platform actor with `admin.shipping.read` may read the same safe tracking projection for support;
- seller staff use the seller Shipment route instead;
- customer/admin output contains customer-safe tracking and timeline data, never Inventory reservation IDs or other private seller finance/configuration data;
- customer-facing output includes only `shipped` and `delivered` Shipments; internal `created` preparation is not exposed to the customer.

## 17. Order fulfillment status integration

The existing Orders persistence intentionally has `fulfillment_status = unfulfilled` before Module 13 completion.

Stage 16 extends the approved Order fulfillment values to:

```text
unfulfilled
partially_fulfilled
fulfilled
```

Meaning:

```text
unfulfilled         no non-cancelled Order Item quantity has been shipped
partially_fulfilled some, but not all, non-cancelled Order Item quantity has been shipped
fulfilled           all non-cancelled Order Item quantity has been shipped
```

Delivery state remains on Shipments and is not another Payment state.

Shipping must update Order fulfillment through an **Orders service boundary**, not by importing Orders repository/database queries into Shipping. Any required transaction-aware Orders service method is minimum shared infrastructure and must preserve existing Module 11 API behavior.

Seller Order `status` remains owned by Module 11 (`processing` after acceptance). Stage 16 does not invent new Seller Order status values merely to mirror Shipment states.

## 18. Events, audit, and outbox

Module 13 durable events remain exactly the guide names:

```text
shipment.created
shipment.shipped
shipment.delivered
shipment.tracking_updated
```

Rules:

- enqueue durable events only after the authoritative state change is part of the database transaction;
- core Shipping correctness must not depend on a worker finishing immediately;
- tracking edits/corrections and manual delivery are audited;
- Shipment status history is append-only business history and is not replaced by audit logs;
- audit/outbox writes participate in the same transaction as the Shipping write when possible.

## 19. Stable Module 13 business error codes

Keep the base-guide codes:

```text
SHIPMENT_NOT_FOUND
SHIPMENT_QUANTITY_INVALID
SHIPMENT_STATUS_INVALID
TRACKING_INVALID
INVENTORY_ISSUE_FAILED
```

Use Foundation/auth/RBAC/idempotency envelope codes for generic validation, authentication, authorization, rate-limit, and idempotency conflicts. Do not create near-duplicate Shipping errors where an existing stable code already describes the failure.

## 20. Frontend scope for Pass 7

Stage 16 finally creates `marketplace-frontend/src/features/shipping/` because no Shipping frontend feature currently exists.

Required UI remains:

- Shipping method setup **read/setup surface only where an approved backend contract exists**;
- seller fulfillment queue;
- create Shipment;
- tracking entry/correction;
- Shipment timeline;
- customer tracking view.

Important compatibility rule: the base guide names “Shipping method setup”, but the approved Stage 11 and Stage 16 route tables still do not define Shipping Method management CRUD. Pass 7 must **not invent browser write APIs** for Shipping Methods. The existing Checkout shipping-options flow remains the only approved Shipping Method HTTP behavior unless a later additive patch explicitly adds management endpoints.

## 21. Minimum shared files expected after Pass 0

The implementation may modify only the target Shipping module plus the minimum prerequisite/shared files needed for correct integration.

Expected areas:

```text
marketplace-backend/src/database/schema/shipping.ts
marketplace-backend/src/database/relations.ts
marketplace-backend/drizzle/0027_*.sql
marketplace-backend/src/modules/shipping/*
marketplace-backend/src/modules/orders/*          # only fulfillment service/status boundary if required
marketplace-backend/src/database/seeds/platform-rbac.seed.ts
marketplace-backend/src/http/openapi/*            # only normal Module 13 registration/contract effect
marketplace-backend/tests/module13/*
marketplace-backend/scripts/*module13*
marketplace-backend/package.json                  # only permanent Module 13 verification scripts if required
marketplace-frontend/src/features/shipping/*
marketplace-frontend/src/app/routes/shipping.routes.tsx
marketplace-frontend/src/app/router/*              # normal route registration only
marketplace-frontend/tests/module13-*.test.tsx
marketplace-frontend/e2e/module13.spec.ts
```

Do not refactor unrelated modules, rename unrelated APIs, create a monorepo/workspace, or introduce a new library/abstraction merely for Stage 16.

## 22. Pass sequence after this freeze

Continue only in this order:

```text
Pass 1 Database
Pass 2 Contracts
Pass 3 Repository
Pass 4 Service
Pass 5 HTTP/OpenAPI
Pass 6 Backend proof
Pass 7 Frontend
Pass 8 E2E/regression/release cleanup
```

Pass 1 should be the next implementation step.
