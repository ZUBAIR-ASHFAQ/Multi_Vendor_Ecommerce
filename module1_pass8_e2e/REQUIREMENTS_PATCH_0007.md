# Requirements Patch 0007 — Module 16 Commission Executable Contract Freeze

**Status: APPROVED additive executable contract patch for the current Module 16 remediation.**

This patch supplements the 99-page marketplace requirements guide for **Module 16 — Commissions & Marketplace Fees**. It does not replace the selected stack, two-project repository topology, RBAC model, seller isolation, immutable financial history, exact-money rules, Foundation idempotency/audit/outbox requirements, or the seven Module 16 HTTP operations already defined by the guide.

## 1. Why this patch exists

The base Module 16 guide defines the tables, routes, permissions, events, business purpose, and high-level formulas, but it does not freeze several executable finance details needed by production code. The existing implementation made those decisions explicitly in service code. This patch turns those decisions into one reviewable contract before any remediation changes are made.

Pass 0 is **contract/documentation only**. It must not change database schema, runtime business logic, HTTP routes, frontend behavior, or dependencies.

## 2. Approved HTTP surface remains unchanged

Keep exactly these seven operations:

```text
GET   /api/v1/admin/commissions/rules
POST  /api/v1/admin/commissions/rules
PATCH /api/v1/admin/commissions/rules/:id
GET   /api/v1/seller/commissions
GET   /api/v1/admin/commissions/entries
POST  /api/v1/internal/commissions/order-settle
POST  /api/v1/internal/commissions/refund-adjust
```

No generic Commission CRUD route is approved. In particular, this patch does not add a rule delete route, Commission-entry mutation route, manual-adjustment browser route, or another seller-scoped route.

## 3. Rule status lifecycle

The core release supports exactly these Commission rule statuses:

```text
active
inactive
```

Rules:

- only `active` rules participate in settlement;
- `inactive` rules remain readable for finance history/configuration but never win settlement;
- status values are lowercase canonical values;
- arbitrary free-text statuses are not part of the executable contract;
- a rule whose current `start_at` is now or in the past is historical/effective configuration and is not edited in place;
- only future-effective rules may be changed by the existing PATCH operation;
- changing historical economics requires a new future-effective rule, never rewriting old snapshots or entries.

## 4. Rule scope and precedence

Supported rule scopes remain:

```text
default
seller
category
product
```

Settlement gathers every `active` rule whose scope matches the Order Item and whose effective window includes the provider-authoritative capture time.

Effective window:

```text
start_at <= captured_at < end_at
```

When `end_at` is null, the rule has no upper time bound.

Precedence is controlled **only by numeric priority**:

```text
higher numeric priority wins
```

There is no hidden product-over-category-over-seller specificity rule. Scope specificity matters only because it determines which rules are candidates.

If two or more effective matching candidates share the highest numeric priority, settlement must fail with:

```text
COMMISSION_RULE_AMBIGUOUS
```

The service must never choose an arbitrary tie-breaker.

## 5. Rule configuration overlap

For one identical scope identity (`scope_type` + `scope_id`), two `active` rules with the same priority must not have overlapping effective windows.

Configuration validation should reject that overlap before settlement where possible. Settlement still performs the final ambiguity check because different matching scope types may legitimately overlap and can still tie at the winning priority.

## 6. No-match behavior

If no active matching rule exists for an Order Item at capture time, Module 16 snapshots a zero-fee rule result:

```text
rate_percent = 0.000000
fixed_fee = null
commission_amount = 0.0000
```

The item still receives one immutable Module 16 snapshot so later rule creation cannot retroactively change the historical Order Item economics.

## 7. Exact Commission calculation

All Commission arithmetic uses exact integer/decimal logic. JavaScript floating-point money is forbidden.

For one Order Item:

```text
gross = unit_price * quantity
seller_funded_discount = allocated discount when funding owner is seller, otherwise 0
commissionable_basis = gross - seller_funded_discount
percentage_fee = round_half_up_to_scale_4(commissionable_basis * rate_percent / 100)
fixed_fee_total = fixed_fee once per Order Item, or 0
commission_amount = percentage_fee + fixed_fee_total
shipping_credit = 0.0000 in the core Module 16 release
seller_net = gross - seller_funded_discount - commission_amount + shipping_credit
```

Additional rules:

- `commissionable_basis` may not be negative;
- tax is not part of the Commission percentage basis in the current contract;
- shipping charges are not part of the Commission percentage basis in the current contract;
- the fixed fee applies once per Order Item, not once per unit quantity and not once per Seller Order;
- percentage rounding is deterministic **half-up to scale 4**;
- a fixed fee may make seller net negative; later Wallet logic owns negative-balance handling rather than rewriting Commission history.

## 8. Discount funding ownership

Promotion discount funding remains owned by Module 9.

For Commission settlement:

- seller-funded allocated discounts reduce both Commission basis and seller net;
- platform-funded allocated discounts do not reduce seller net and do not reduce Commission basis;
- Module 16 never trusts a caller-supplied funding owner;
- the current implementation resolves historical funding from the immutable Checkout coupon identity through the Promotions service boundary;
- if an Order contains a non-zero allocated discount but historical funding provenance cannot be resolved safely, settlement fails closed with `COMMISSION_RULE_INVALID` rather than guessing.

A later patch may move funding ownership into a more direct immutable Order Item snapshot, but that change must preserve historical economics.

## 9. `funding_rules_json` core-release rule

The database field remains because it is part of the base Module 16 table contract, but the core release does not define a Commission-side funding rule engine.

Therefore:

- `funding_rules_json` has **no arithmetic effect** in the current core release;
- new/updated core rules should omit it or store `null`;
- frontend forms must not present arbitrary JSON as if it were an active pricing feature;
- an existing non-null value may be preserved/read for backward compatibility but must not silently change Commission calculations;
- any future executable use requires a later approved requirements patch with a typed Zod contract and tests.

## 10. Snapshot ownership

`commission_rule_snapshots` is the canonical Module 16 historical rule/economic snapshot.

Rules:

- one snapshot exists per `order_item_id`;
- snapshot creation happens at first successful Commission settlement for that Order Item;
- later Commission rule edits never rewrite a snapshot;
- `order_items.commission_rule_snapshot_json` remains a compatibility field from the Orders schema and is not a second source of truth for Module 16;
- snapshot `basis_json` records enough calculation facts to reproduce/inspect the original result, including calculation-policy version, gross, allocated discount, funding owner, seller-funded discount, Commission basis, rounding, fixed-fee unit, and shipping credit.

## 11. Settlement trigger and command ownership

The trusted internal command remains the only posting trigger in the current Module 16 release:

```text
POST /api/v1/internal/commissions/order-settle
```

Body stays minimal:

```json
{
  "sourceKey": "stable trusted business source",
  "orderId": "uuid"
}
```

Rules:

- the command is protected by internal-service authentication;
- client/browser code never calls it;
- Order, Product classification, Promotion funding, and provider-authoritative Payment capture facts are reloaded server-side through owning service boundaries;
- caller-supplied financial totals, rate, seller, category, Product, currency, or captured amount are not trusted;
- Payment domain events may notify other systems, but Module 16 does not also auto-post from a Payment event consumer in this contract because that would create two posting triggers for the same financial effect.

## 12. Settlement idempotency and ledger source identity

The trusted command `sourceKey` is handled by Foundation idempotency and is never used as the raw Commission ledger identity.

The immutable per-item sale ledger source key is:

```text
commission:sale:<paymentTransactionId>:<orderItemId>
```

An exact replay returns the existing result. A collision is `COMMISSION_SOURCE_DUPLICATE` if any immutable ledger fact differs.

Immutable replay comparison must include at least:

```text
seller_id
seller_order_id
order_item_id
type
gross_amount
commission_amount
seller_net_amount
currency
occurred_at
```

`occurred_at` for a sale is the provider-authoritative capture timestamp.

## 13. Refund adjustment command

The trusted internal route remains:

```text
POST /api/v1/internal/commissions/refund-adjust
```

The caller supplies only stable source identity, Order identity, and provider-authoritative refund transaction identity. Module 16 reloads refund facts from Module 12.

Per-item refund ledger source key:

```text
commission:refund:<refundPaymentTransactionId>:<orderItemId>
```

`occurred_at` is the provider-authoritative refund timestamp.

### Full refund behavior available before Module 14

When the authoritative provider refund equals the captured amount for the Order, Module 16 creates append-only `refund` entries that exactly negate each original sale entry:

```text
refund.gross_amount = -sale.gross_amount
refund.commission_amount = -sale.commission_amount
refund.seller_net_amount = -sale.seller_net_amount
```

Original sale entries and snapshots are never edited.

### Partial refund behavior

Before Module 14 exists, Module 16 must fail closed for a partial refund. It must not proportionally guess item allocation from the Payment amount.

After Module 14 is implemented, the **same existing internal refund-adjust route** remains. Module 16 should obtain authoritative item/quantity/refund allocation through the Module 14 service boundary using the trusted Order/refund identity, then reverse only the corresponding original snapshotted economics. No browser-supplied allocation and no new generic Commission route are required.

## 14. `adjustment` ledger type ownership

The `adjustment` entry type remains part of the immutable ledger contract for non-refund corrections.

This patch does not approve a new browser/admin adjustment endpoint.

Rules:

- refunds use `refund` entries;
- other corrections must be new `adjustment` entries, never edits/deletes of sale/refund history;
- production creation of a non-refund `adjustment` requires a later approved internal owner/workflow (for example a later finance or post-purchase workflow);
- until that owner exists, Module 16 must not invent a generic manual-adjustment API.

## 15. Required events and audit behavior

The base events remain:

```text
commission.rule_created
commission.posted
commission.adjusted
```

Rules:

- durable events are written through the Foundation outbox in the same business transaction where applicable;
- Commission posting correctness never depends on an asynchronous worker finishing immediately;
- rule changes, settlement, refund adjustments, sensitive finance reads, and later privileged corrections are audited;
- raw trusted `sourceKey` values are not written to logs/audit metadata; a hash may be stored for correlation;
- Commission entries and snapshots are append-only historical truth.

## 16. Folder/stack contract remains unchanged

Backend stays:

```text
marketplace-backend/src/modules/commissions/
  commissions.routes.ts
  commissions.controller.ts
  commissions.service.ts
  commissions.repository.ts
  commissions.schema.ts
  commissions.constants.ts
  index.ts
```

Create `commissions.types.ts` only when a real reusable type cannot be cleanly inferred from Zod/Drizzle/service interfaces.

Frontend stays:

```text
marketplace-frontend/src/features/commissions/
  api/
  hooks/
  components/
  forms/
  schemas/
  types/
  pages/
```

No monorepo/workspace, framework replacement, cross-module repository access, or additional state library is approved.

## 17. Remediation sequence after this Pass 0 freeze

This already-built Module 16 is remediated as a safe patch. Apply changes in this order:

1. **Pass 0 — contract freeze/change map:** this patch + updated `MODULE16_INSPECTION.md`; no runtime code change.
2. **Pass 1 — database constraints:** add only constraints required by this patch, primarily the `active|inactive` status contract, using a new append-only migration; verify clean and upgrade migration paths.
3. **Pass 2 — contracts:** replace free-text rule status with an enum; make `fundingRulesJson` non-configurable/null in the core API; keep exact-money and seven route contracts stable.
4. **Pass 3 — repository cleanup:** remove production-unused repository helpers/tests and add only queries genuinely required by later Module 14 partial-refund integration.
5. **Pass 4 — service cleanup:** include `occurredAt` in replay equality; keep the approved formulas explicit; implement partial-refund reversal only when Module 14 supplies authoritative allocation; do not invent another route.
6. **Pass 5 — HTTP/OpenAPI:** preserve exactly the seven current operations and align schemas/docs with the tightened contracts.
7. **Pass 6 — backend proof:** add/adjust negative status, idempotency/replay timestamp, seller isolation, immutable history, calculation, and later partial-refund tests.
8. **Pass 7 — frontend:** replace free-text status controls with the approved enum UI and remove misleading funding JSON configuration.
9. **Pass 8 — release cleanup:** remove obsolete historical pass scripts/evidence, update stale README text, run full migration/OpenAPI/typecheck/lint/test/build/Playwright/reconciliation gates.

## 18. Pass 0 acceptance rule

Pass 0 is complete when:

- this approved patch exists;
- `MODULE16_INSPECTION.md` describes the current already-built baseline and exact remediation change map;
- no Module 16 runtime/database/frontend behavior changed during Pass 0;
- the stack and two independent repositories remain unchanged;
- the existing seven route identities remain unchanged;
- later passes have explicit, minimal file ownership and do not require inventing unresolved finance policy during coding.
