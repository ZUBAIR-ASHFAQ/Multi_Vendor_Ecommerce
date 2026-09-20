# Requirements Patch 0009 — Module 14 Returns, Refunds & Disputes Executable Contract

**Status: APPROVED additive executable contract patch for Module 14. Sections 1-14 are active for Pass 4 implementation.**

This patch supplements the 99-page marketplace requirements guide only where Module 14 needs executable details that the base guide does not fully freeze. It does not change the selected stack, the two independent projects, seller isolation, immutable financial history, exact-money rules, or the eight Module 14 routes from the base guide.

## 1. Pass 0 boundary

Pass 0 is inspection/contract-freeze only. It must not modify runtime schema, migrations, routes, OpenAPI, frontend behavior, dependencies, or prerequisite module behavior.

## 2. HTTP surface remains exactly the base-guide surface

```text
POST /api/v1/orders/:orderId/returns
GET  /api/v1/returns
GET  /api/v1/seller/returns
POST /api/v1/seller/returns/:id/approve
POST /api/v1/seller/returns/:id/reject
POST /api/v1/seller/returns/:id/receive
POST /api/v1/returns/:id/refund
GET  /api/v1/admin/returns
```

No generic Return CRUD, arbitrary status update, refund delete, restock endpoint, or dispute-note CRUD route is added by this patch.

## 3. Proposed Return Request lifecycle

Use these Return Request statuses:

```text
requested
approved
rejected
received
closed
```

Allowed transitions:

```text
requested -> approved
requested -> rejected
approved  -> received        (physical return required)
approved  -> closed          (approved refund with no physical return)
received  -> closed          (refund resolution completed)
```

Rules:

- `rejected` and `closed` are terminal.
- Provider refund progress belongs to the `refunds` row, not to a fake Return Request payment state.
- A Return Request is closed only after every approved item resolution has reached its required refund/restock outcome.
- Normal application code never rewrites `return_status_history`.

## 4. Proposed reason, inspection, and resolution values

Return reason codes:

```text
damaged
defective
wrong_item
not_as_described
changed_mind
other
```

Inspection condition values (nullable before receipt):

```text
unopened
opened
damaged
defective
other
```

Item resolution values:

```text
refund_restock
refund_no_restock
```

These values are server allow-listed. Free-text customer/support explanation belongs in bounded note fields, not in status/reason columns.

## 5. Proposed return-window policy

Use an allow-listed platform setting:

```text
returns.window_days
```

Proposed default when the setting is absent:

```text
30
```

Proposed bounds:

```text
1..365 days
```

Eligibility compares the server clock to the authoritative Shipping delivery timestamp. The browser never submits or controls the return-window deadline.

## 6. Proposed delivery eligibility for split Shipments

Module 13 should expose a trusted read-only service boundary for Module 14 that returns, per Order Item:

```text
orderItemId
deliveredQuantity
latestDeliveredAt
```

`deliveredQuantity` is the sum of `shipment_items.quantity` only from Shipments whose current status is `delivered`.

For an Order Item delivered across more than one Shipment, this patch uses the **latest delivered_at among its delivered Shipment allocations** as the Return-window anchor. This intentionally favors a simple customer-safe rule and avoids requiring Module 14 to persist Shipment Item IDs that are not part of the base Return table contract.

## 7. Proposed concurrent returnable-quantity rule

At Return creation, lock the relevant Order Item Return allocation and calculate:

```text
returnable_quantity =
  delivered_quantity
  - quantity already reserved by non-rejected Return Requests
```

A newly created `requested` Return immediately reserves its requested quantity for Return-allocation purposes. Rejecting that Return releases the reservation logically because rejected requests are excluded from the calculation.

This prevents two concurrent Return Requests from both claiming the same delivered quantity.

## 8. Proposed exact partial refund allocation

Module 14 must calculate customer refund money from the immutable Order Item snapshots only:

```text
unit_price
discount_allocated
tax_allocated
line_total
```

Core Module 14 does **not** refund seller-order shipping charges unless a later approved patch explicitly adds shipping-refund policy.

For a partial quantity, use exact integer scale-4 arithmetic and cumulative proportional allocation so all partial refunds reconcile to the original line total when the full returnable quantity is eventually refunded.

For one Order Item:

```text
commercial_quantity = order_item.qty - order_item.cancelled_qty
cumulative_refund_quantity = prior_nonfailed_refund_quantity + current_refund_quantity
cumulative_target_amount = round_half_up(
  order_item.line_total * cumulative_refund_quantity / commercial_quantity
)
current_refund_amount = cumulative_target_amount - prior_refund_amount
```

Use the same cumulative technique when a UI/audit breakdown needs the original discount/tax portions. Do not use JavaScript floating-point arithmetic.

## 9. Proposed provider-refund ownership

`POST /api/v1/returns/:id/refund` requires:

```text
admin.refunds.issue
```

Seller users may request/approve/reject/receive within seller scope, but they do not directly execute the external provider refund in the core release.

The refund command requires an `Idempotency-Key` header. Module 14 owns the business/refund record; Module 12 remains the provider-authoritative money-movement engine.

## 10. Proposed trusted Payment boundary

Add one read-only system service method in Module 12 for Module 14 with this semantic result:

```text
paymentId
orderId
currency
amountCaptured
amountRefunded
refundableAmount
```

Module 14 then calls the existing trusted `PaymentsService.refundPayment()` command using its server-derived amount and deterministic source key. Module 14 never queries Payment tables directly.

## 11. Proposed trusted Inventory restock boundary

Add one system-only Inventory service command conceptually equivalent to:

```text
restockStock(context, {
  sellerId,
  storeId,
  variantId,
  quantity,
  sourceId,
  sourceKey
})
```

Rules:

- `quantity` is positive;
- Inventory item seller/store/variant ownership must match;
- increment `on_hand_qty` only;
- do not increase `reserved_qty`;
- append one immutable `movement_type = restock` row;
- use `source_type = return`;
- use `sourceId = return_item.id`;
- retries with the same source key are exact replays and never double-restock;
- a conflicting source-key payload fails;
- Module 14 never updates `inventory_items` directly.

The deterministic Module 14 source key is proposed as:

```text
return:<returnRequestId>:item:<returnItemId>:restock
```

## 12. Proposed trusted Orders boundary

Add one system-only Orders read boundary for Module 14 containing only immutable Return facts:

```text
orderId
customerUserId
currency
paymentStatus
orderStatus
items[] {
  orderItemId
  sellerOrderId
  sellerId
  storeId
  variantId
  quantity
  cancelledQuantity
  unitPrice
  discountAllocated
  taxAllocated
  lineTotal
}
```

This avoids Module 14 importing Orders repository/database behavior into its service.

## 13. Approved partial Commission reversal contract

Module 14 owns Return eligibility and refunded Order Item quantities. Module 16 owns Commission arithmetic and immutable Commission adjustment entries. Module 14 calls one trusted system-only Module 16 command after Module 12 confirms the provider refund.

The trusted request is:

```text
sourceKey
orderId
refundPaymentTransactionId
items[] {
  orderItemId
  currentRefundQuantity
  cumulativeRefundQuantity
  currentRefundAmount
}
```

Rules:

- `items` is non-empty and has unique `orderItemId` values.
- `currentRefundQuantity` is positive.
- `cumulativeRefundQuantity >= currentRefundQuantity` and never exceeds `order_item.qty - cancelled_qty`.
- `currentRefundAmount` is exact scale-4 money and the sum of all current item refund amounts must equal the succeeded provider refund amount.
- Module 16 verifies every Order Item belongs to the supplied immutable Order snapshot and has exactly one original `sale` Commission entry before creating a partial reversal.
- Module 14 is the trusted owner of cumulative refunded item quantity. Module 16 still rejects a request whose cumulative economic target would move backward behind already-persisted Commission refund entries.
- For each original sale entry component (`gross_amount`, `commission_amount`, `seller_net_amount`), Module 16 computes the cumulative reversal target with exact integer scale-4 half-up allocation:

```text
cumulative_target = round_half_up(
  original_sale_component * cumulativeRefundQuantity / commercialQuantity
)
current_reversal = cumulative_target - absolute_sum(prior_refund_components)
```

- The current persisted Commission refund entry stores the negative of `current_reversal` for each component. This proportionally reverses any original fixed fee already embedded in the immutable sale entry and guarantees that a fully refunded commercial quantity reconciles exactly to the original sale entry.
- A current reversal may be zero for one component because of scale-4 rounding, but the overall item reversal still uses one immutable `commission_entries.type = refund` row tied to the provider refund transaction.
- Prior Commission refund rows are append-only and are never edited or deleted.
- The per-item source identity remains deterministic from the provider refund transaction and Order Item, so exact retries return the same ledger row and conflicting economics fail closed.
- Module 16 never queries Module 14 persistence.

The owner instruction to proceed with Module 14 Pass 4 approves this request shape and cumulative rounding policy.

## 14. What this patch does not change

- Existing Order, Payment, Shipping, Inventory, or Commission public HTTP routes.
- Module 13 Shipment lifecycle.
- Module 12 provider-authoritative capture/refund behavior.
- Module 16 full-refund command used by existing tests/flows.
- Future Module 17 Wallet ownership.
- Any existing migration.

## Approval record

The owner instructed implementation to continue through Module 14 Pass 4. That instruction activates Sections 1-14 as the additive executable contract. Section 13 is now frozen by the explicit trusted request shape and cumulative half-up allocation rules above.
