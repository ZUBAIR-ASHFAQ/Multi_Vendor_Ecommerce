# Requirements Patch 0010 — Module 17 Seller Wallet & Payouts Executable Contract

**Status: APPROVED additive executable contract patch for Module 17 Pass 2.**

This approved additive patch supplements the marketplace requirements guide only where Module 17 needs executable details that the base guide does not fully freeze. It does not change the selected stack, independent frontend/backend projects, exact nine-route surface, seller isolation, immutable Commission/Return/Payment history, or exact-money rules.

## 1. Pass 0 boundary

Pass 0 is inspection/contract-freeze only. It must not modify runtime schema, migrations, routes, OpenAPI, frontend behavior, dependencies, or prerequisite module behavior.

## 2. HTTP surface remains exactly the base-guide surface

```text
GET  /api/v1/seller/wallet
GET  /api/v1/seller/payouts
POST /api/v1/seller/payouts
POST /api/v1/seller/payout-accounts
GET  /api/v1/admin/payouts
POST /api/v1/admin/payouts/:id/approve
POST /api/v1/admin/payouts/:id/send
POST /api/v1/internal/wallet/settle
POST /api/v1/internal/wallet/adjust
```

No generic Wallet CRUD, payout status PATCH, payout delete, payout-account raw-secret read, seller-ID override, or arbitrary ledger insert route is added.

## 3. Proposed wallet ownership and source-of-truth rule

Module 16 Commission entries are the authoritative financial source for normal seller earnings and Return/refund fee adjustments.

Module 17 does **not** recalculate seller net from Order totals and does not query Module 14 refund tables to derive money.

Normal source flow:

```text
commission.posted / commission.adjusted
  -> Module 17 source-event worker
  -> verify Commission entry through Module 16 service
  -> immutable wallet entry/entries
  -> seller_wallets snapshot update
```

The Module 17 worker gets its own independent Foundation outbox/BullMQ destination queue. It must ignore unrelated domain events.

## 4. Proposed trusted Commission Wallet snapshot

Add one read-only system service boundary in Module 16 conceptually returning:

```text
commissionEntryId
orderId
sellerId
sellerOrderId
orderItemId
entryType
sellerNetAmount
currency
sourceKey
occurredAt
```

Rules:

- source is always a persisted immutable Commission entry;
- Module 17 verifies the outbox payload against this source before applying it;
- Module 17 never imports `commissions.repository.ts`;
- a `sale` entry is a positive earnings source;
- `refund`/negative `adjustment` entries are seller-net reduction sources;
- unsupported positive correction behavior must fail closed until explicitly defined.

## 5. Proposed Wallet balance semantics

One logical Wallet exists per:

```text
sellerId + currency
```

Proposed balance invariants:

```text
pending_balance   >= 0
available_balance >= 0
held_balance      >= 0
negative_balance  <= 0
```

`negative_balance = 0` means no seller debt. A negative value means prior paid/committed earnings exceed later eligible seller net after adjustments.

Every `seller_wallet_entries.amount` is an exact signed scale-4 **delta to the named balance bucket**. The current snapshot must reconcile to the sum of immutable entries for that seller/currency/bucket.

Proposed balance buckets:

```text
pending
available
held
negative
```

Proposed entry types:

```text
commission_credit
commission_adjustment
availability_transfer
negative_recovery
payout_reserve
payout_release
payout_paid
```

A transfer between buckets writes one immutable debit entry and one immutable credit entry in the same transaction. Historical ledger rows are never edited or deleted.

## 6. Proposed source-key rules

All source keys are deterministic and unique.

Commission source application:

```text
commission:<commissionEntryId>:pending
commission:<commissionEntryId>:available-adjustment
commission:<commissionEntryId>:pending-adjustment
commission:<commissionEntryId>:negative-adjustment
```

Settlement transfer:

```text
settle:<walletEntryId>:pending-debit
settle:<walletEntryId>:available-credit
```

Negative recovery from a later positive Commission entry:

```text
recover:<commissionEntryId>:negative-credit
commission:<commissionEntryId>:pending-remainder
```

Payout reservation/finalization:

```text
payout:<payoutId>:reserve:available-debit
payout:<payoutId>:reserve:held-credit
payout:<payoutId>:paid:held-debit
payout:<payoutId>:release:held-debit
payout:<payoutId>:release:available-credit
```

Exact retries with the same source identity return the existing result. Reuse of a source key for conflicting seller/currency/amount/bucket/source facts fails with `WALLET_SOURCE_DUPLICATE`.

## 7. Proposed Commission credit and negative-balance recovery rule

For a positive `commission_entries.type = sale` seller-net amount:

1. lock the seller/currency Wallet row;
2. if `negative_balance < 0`, apply as much of the positive amount as required to bring negative toward zero;
3. write the remaining positive amount, if any, to `pending`;
4. emit `wallet.credited` exactly once for the Commission source.

This prevents a seller with recoverable debt from receiving new available/payoutable earnings before the debt is recovered.

## 8. Proposed refund/negative Commission adjustment waterfall

For a negative Commission seller-net entry, apply `abs(sellerNetAmount)` under one wallet row lock:

```text
1. reduce pending
2. reduce available
3. any remainder becomes more negative in negative_balance
```

`held` payout-reserved money is not rewritten by a later adjustment. An already-approved payout remains an immutable finance decision; any shortfall is represented as negative balance instead of rewriting the payout or its allocations.

This rule is intentionally simple and history-preserving. If a later product requirement wants approved-but-unsent payouts automatically cancelled/reduced, that requires a new explicit command/status contract.

## 9. Proposed delivery/hold settlement rule

A positive pending earning sourced from one Commission `sale` entry becomes settlement-eligible only when:

1. Module 13 confirms the corresponding Order Item's full commercial quantity has been delivered; and
2. the server clock is on or after the authoritative latest delivery timestamp plus the configured Return window.

Core Module 17 reuses:

```text
Administration setting: returns.window_days
```

No second Wallet-specific hold setting is introduced by this proposal.

For split Shipments, the eligibility anchor is the **latest delivered_at** needed to account for the full commercial Order Item quantity.

Module 13 should expose a Wallet-named system read boundary instead of making Module 17 call the Return-specific service method directly.

## 10. Proposed internal settlement command

`POST /api/v1/internal/wallet/settle` remains protected by the existing `internalServiceMiddleware` and requires `Idempotency-Key`.

Proposed body:

```text
{
  limit?: integer 1..500
}
```

Rules:

- seller/currency identity is never accepted from an untrusted browser;
- command uses the server clock;
- it scans a bounded deterministic set of pending source entries ordered by occurrence/ID;
- each candidate is independently revalidated against Module 16 and Module 13 source truth;
- already-settled entries are no-ops under a new batch key and exact replays return the original batch result;
- each successful pending -> available transfer is atomic and emits `wallet.available`;
- one ineligible candidate does not make another eligible seller's earning available early.

## 11. Proposed internal adjustment command

`POST /api/v1/internal/wallet/adjust` remains protected by `internalServiceMiddleware` and requires `Idempotency-Key`.

Proposed body:

```text
{
  commissionEntryId: uuid
}
```

Rules:

- the referenced persisted Commission entry must be `refund` or a negative `adjustment`;
- Module 17 derives seller, currency, amount, Order identities, and source key from Module 16;
- callers cannot submit an arbitrary financial amount;
- the command uses the same source-application service as the event consumer, so event delivery and explicit replay are idempotent against one ledger source;
- successful application emits `wallet.adjusted`.

This route is a trusted reconciliation/re-drive command, not a seller/admin manual-money endpoint.

## 12. Proposed payout-account contract

Core payout-account creation accepts only a tokenized/provider-owned reference and safe display metadata. Raw bank account/card credentials are never persisted in marketplace tables or logs.

Proposed request fields:

```text
providerType
providerAccountRef
```

Seller identity is derived from authenticated scope.

Proposed persisted statuses:

```text
active
disabled
```

A newly created account is stored as `active` only after the configured provider adapter confirms the supplied reference is usable; `verified_at` is set at that time. There is no separate public verify route in the base Module 17 surface.

`providerType` is normalized and must match a configured adapter. The base guide does not select a concrete provider, so production provider choice remains deployment configuration. Tests/E2E may use a deterministic test adapter without adding a production provider dependency.

## 13. Proposed payout lifecycle

Proposed payout statuses:

```text
requested
approved
processing
paid
failed
```

Allowed transitions:

```text
requested  -> approved
approved   -> processing
processing -> paid
processing -> failed
```

Rules:

- `paid` and `failed` are terminal;
- no generic status route exists;
- seller request never reserves money by itself;
- finance approval atomically reserves exact available money into `held` and creates payout allocations;
- send changes `approved -> processing` before the external provider call;
- provider success finalizes `processing -> paid` and consumes the held reservation;
- provider-authoritative failure finalizes `processing -> failed` and releases held funds back to available;
- an unknown network/provider result leaves the payout `processing` and keeps money held until an idempotent retry/reconciliation establishes paid or failed;
- no provider uncertainty may release money automatically.

## 14. Proposed payout request contract

Seller payout request body:

```text
accountId
amount
currency
```

Rules:

- seller identity is derived from auth scope;
- amount is positive exact scale-4 money;
- Wallet currency must match request currency;
- account must belong to the same seller and be active/verified;
- request amount must be <= current available balance;
- authoritative balance is rechecked again during approval under row lock;
- request requires `Idempotency-Key` so client retry cannot create two payout requests.

## 15. Proposed payout approval/allocation rule

Finance approval locks the seller/currency Wallet and the payout row.

It rechecks:

```text
payout.status == requested
payout.amount <= available_balance
account still active/verified
seller still exists
```

Allocation uses positive available settlement entries in deterministic FIFO order:

```text
occurred_at ASC, id ASC
```

Each `payout_allocations` row records the exact portion of one available wallet entry reserved for the payout. Partial allocation of the final source entry is allowed.

Approval writes the available debit, held credit, allocations, status transition, audit, and outbox evidence atomically.

## 16. Proposed payout provider adapter

Use a provider-neutral backend contract. Marketplace business code must not import a concrete SDK directly.

Conceptual operations:

```text
validateAccountReference(providerType, providerAccountRef)
sendPayout({
  payoutId,
  sellerId,
  amount,
  currency,
  providerAccountRef,
  idempotencyKey
})
```

The send result must distinguish:

```text
paid     -> providerRef, processedAt
failed   -> safe failure classification
unknown  -> no authoritative terminal result
```

The adapter must support idempotent send by stable payout identity/key. Provider secrets and raw account credentials must never enter API responses, audit payloads, or logs.

## 17. Proposed idempotency requirements

Require `Idempotency-Key` for all retryable write commands that can duplicate money movement:

```text
POST /api/v1/seller/payouts
POST /api/v1/admin/payouts/:id/approve
POST /api/v1/admin/payouts/:id/send
POST /api/v1/internal/wallet/settle
POST /api/v1/internal/wallet/adjust
```

Payout-account creation should also use idempotency if the configured provider performs a remote create/validation side effect; if it only stores an already-tokenized provider reference, database uniqueness plus request validation is sufficient.

Business persistence, audit/outbox evidence, and successful Foundation idempotency completion should commit together whenever they share one database transaction.

## 18. Proposed permissions/RBAC composition

Use exactly the base permissions:

```text
seller.wallet.read
seller.payout.request
seller.payout_account.manage
admin.payouts.read
admin.payouts.manage
```

Proposed role composition:

- seller owner/manager finance-capable role: seller wallet read, payout request, payout-account manage;
- ordinary seller staff do not automatically receive payout/account permissions unless existing role policy explicitly grants them;
- platform finance/super-admin receives admin payout read/manage;
- route middleware performs the first permission check;
- service methods repeat seller ownership/resource checks.

## 19. Proposed events and audit behavior

Emit the guide-required events only for meaningful state changes:

```text
wallet.credited
wallet.available
wallet.adjusted
payout.requested
payout.paid
payout.failed
```

Approval/reservation may be audited without inventing an extra public domain event if the base guide does not require one.

Audit payout-account changes, payout request/approval/send/failure, privileged finance reads where existing audit policy requires it, and trusted manual/re-drive wallet adjustment commands. Never log provider secrets or raw tokenized account values.

## 20. What this patch does not change

- Module 16 Commission arithmetic or immutable Commission history.
- Module 13 Shipment lifecycle or customer tracking.
- Module 14 Return/refund arithmetic or provider refund ownership.
- Module 4 seller identity/lifecycle.
- Existing public routes in prerequisite modules.
- Any existing migration.
- The Module 17 base table list or nine-route surface.
- Production payout provider selection; the adapter remains provider-neutral.

## Approval record

This patch is activated for Module 17 executable contracts from Pass 2 onward. Pass 1 intentionally stayed within the base-guide table responsibilities; later repository/service/provider behavior must use the frozen details in this patch rather than inventing alternatives.
