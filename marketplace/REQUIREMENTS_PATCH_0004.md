# Requirements Patch 0004 — Module 10 Checkout Executable Contract

**Status: APPROVED additive contract patch for the current implementation.**

This patch freezes the minimum executable details that the 99-page guide intentionally leaves open for Module 10 Checkout. It supplements the base guide and approved Requirements Patch 0003. It does not change the selected stack, repository topology, seller isolation, module ownership, or the rule that Checkout totals are authoritative only when calculated server-side.

## 1. Approved Checkout routes remain unchanged

No additional Checkout CRUD routes are authorized.

```text
POST /api/v1/checkout/quote
GET  /api/v1/checkout/quote/:id
POST /api/v1/checkout/quote/:id/confirm
GET  /api/v1/checkout/:attemptId/status
```

All four routes require authentication. The existing permissions remain authoritative:

```text
checkout.create_own
checkout.confirm_own
```

Customer ownership is rechecked in the service even after route middleware.

## 2. Create-quote request contract

`POST /api/v1/checkout/quote` uses a strict JSON body:

```json
{
  "shippingAddressId": "uuid",
  "billingAddressId": "uuid",
  "couponCode": "SAVE10",
  "shippingSelections": [
    {
      "storeId": "uuid",
      "shippingMethodId": "uuid"
    }
  ]
}
```

Rules:

- `shippingAddressId` is required;
- `billingAddressId` is optional; when omitted, it equals `shippingAddressId`;
- `couponCode` is optional and is normalized with Module 9's existing trim/uppercase rule;
- `shippingSelections` is required and must contain exactly one selection for every server-derived non-empty store shipment group;
- duplicate `storeId` selections are rejected;
- missing or extra store selections are rejected;
- `shippingMethodId` must be one of the options currently eligible for that group under approved Patch 0003;
- customer ID, Cart ID, seller ID, currency, quantities, prices, discounts, tax, shipping amount, and totals are never accepted as authoritative client input.

The current authenticated customer's Cart is always loaded server-side.

## 3. Address rules

Both selected addresses must:

- belong to the authenticated customer;
- have `status = active`;
- still exist when the quote is confirmed.

Billing may be the same address as shipping. Checkout does not copy address text into mutable Customer tables. Module 11 remains responsible for immutable order-address snapshots.

To make a quote confirmable without trusting the client, Checkout persistence must later add `shipping_address_id` and `billing_address_id` to `checkout_quotes` through an append-only migration.

## 4. Shipping selection persistence

Checkout must persist the selected shipping option for each server-derived store group. Add a dedicated table in an append-only Checkout migration rather than hiding this data in an opaque JSON blob:

```text
checkout_quote_shipping_selections
- quote_id
- seller_id
- store_id
- shipping_method_id
- shipping_method_code_snapshot
- shipping_method_name_snapshot
- amount NUMERIC(18,4)
- currency char/varchar(3)
```

Required rules:

- primary/unique identity is one row per `(quote_id, store_id)`;
- seller/store/method ownership is derived and validated server-side;
- `amount` is the approved flat rate returned by Shipping Core at quote time;
- `currency` equals the quote currency;
- `shipping_total` equals the exact sum of these persisted group amounts;
- the short-lived quote may snapshot method display code/name for stable UI display, but Module 13 remains the source of current method eligibility.

`checkout_quotes` must also persist normalized `coupon_code` nullable so confirmation can re-run the same Promotion decision.

## 5. Authoritative money and tax rules

All Checkout money uses exact decimal arithmetic at scale 4. Do not use JavaScript `number` for money calculations.

Canonical money formatting uses exactly four fractional digits, for example:

```text
12.0000
0.1250
```

For each quote line:

```text
line_subtotal = unit_price * quantity
line_discount = authoritative Promotion allocation
line_taxable = line_subtotal - line_discount
line_tax = round_half_up(line_taxable * tax_rate_percent / 100, 4 decimal places)
line_total = line_taxable + line_tax
```

Quote totals are:

```text
subtotal       = sum(line_subtotal)
discount_total = sum(line_discount)
tax_total      = sum(line_tax)
shipping_total = sum(selected shipping group amount)
grand_total    = subtotal - discount_total + tax_total + shipping_total
```

Core-release tax rules:

- the tax rate comes from Administration setting `commerce.default_tax_rate_percent`;
- the setting must exist and be between `0` and `100`;
- its canonical Checkout representation is a decimal percentage with at most four fractional digits;
- product tax exemptions, category-specific rates, address-based tax tables, and external tax engines are outside this release;
- shipping is **not taxable** in the core release;
- tax is calculated per line after discount, rounded half-up to scale 4, then summed;
- no tax calculation may depend on browser-submitted totals.

A later tax-engine patch may replace these rules explicitly; until then this patch controls.

## 6. Quote and attempt expiry

Add these typed backend environment settings in the implementation pass:

```text
CHECKOUT_QUOTE_TTL_SECONDS=900
CHECKOUT_ATTEMPT_TTL_SECONDS=900
```

Both settings:

- are integer seconds;
- have a minimum of 300 seconds;
- have a maximum of 3600 seconds;
- default to 900 seconds.

Rules:

- `quote.expires_at = quote_created_time + CHECKOUT_QUOTE_TTL_SECONDS`;
- `attempt.expires_at = confirmation_time + CHECKOUT_ATTEMPT_TTL_SECONDS`;
- every Inventory reservation created by that confirmation uses exactly the attempt's `expires_at`;
- there is no separate reservation TTL setting in Module 10.

## 7. Deterministic `state_hash`

Use SHA-256 over UTF-8 bytes and persist the lowercase 64-character hexadecimal digest.

The hash input is a JSON object built in this exact top-level key order:

```text
version
customerUserId
currency
couponCode
shippingAddress
billingAddress
taxRatePercent
lines
shippingSelections
totals
```

Canonicalization rules:

- `version` is the literal string `checkout-state-v1`;
- UUID strings are lowercase;
- money strings use exactly four fractional digits;
- `taxRatePercent` uses a normalized decimal string with no exponent notation;
- `couponCode` is the normalized uppercase code or `null`;
- address objects contain, in this order: `id`, `recipientName`, `phone`, `line1`, `line2`, `city`, `region`, `postalCode`, `countryCode`;
- nullable address fields are serialized as `null`, not omitted;
- address strings are trimmed and `countryCode` is uppercase;
- `lines` are sorted by `variantId` and each item contains, in order: `variantId`, `sellerId`, `storeId`, `quantity`, `unitPrice`, `discount`, `tax`, `lineTotal`;
- `shippingSelections` are sorted by `storeId` and each item contains, in order: `sellerId`, `storeId`, `shippingMethodId`, `amount`, `currency`;
- `totals` contains, in order: `subtotal`, `discountTotal`, `taxTotal`, `shippingTotal`, `grandTotal`;
- `quoteId`, timestamps, request IDs, and display-only shipping method names are not part of the state hash.

Implementation must build the canonical object explicitly, call `JSON.stringify` once, then hash that exact string. Do not hash arbitrary database rows or rely on object-key sorting libraries.

## 8. Confirm request and idempotency transport

`POST /api/v1/checkout/quote/:id/confirm` requires:

```http
Idempotency-Key: <1..200 trimmed characters>
Content-Type: application/json
```

with strict body:

```json
{
  "stateHash": "64-character lowercase sha256 hex"
}
```

Rules:

- missing/blank `Idempotency-Key` is a validation error;
- the body `stateHash` must equal the persisted quote state hash before confirmation proceeds;
- Foundation idempotency scope is `checkout.confirm:<customerUserId>`;
- Foundation request hash is SHA-256 of the UTF-8 JSON string produced from this fixed-order object:

```json
{
  "version": "checkout-confirm-v1",
  "quoteId": "lowercase-uuid",
  "stateHash": "lowercase-sha256"
}
```

- the same key with a different request hash maps to `CHECKOUT_IDEMPOTENCY_CONFLICT`;
- an exact completed retry replays the stored response;
- controllers do not own idempotency logic.

## 9. One quote creates at most one Checkout attempt

Add an append-only database uniqueness guard so `checkout_attempts.quote_id` can create at most one attempt.

Confirmation behavior:

- same quote + same key + same payload: replay the same result;
- same quote + a different key after a successful confirmation: return the existing customer-owned attempt without creating another attempt or another Inventory reservation, provided the submitted state hash still matches the quote;
- a concurrent confirmation race must resolve to one persisted attempt and one reservation set;
- never use the idempotency key itself as the only protection against duplicate business effects.

## 10. Checkout attempt states owned by Module 10

The database field remains extensible for later Orders/Payments integration, but Module 10 itself writes only:

```text
confirmed
expired
failed
```

Meaning:

- `confirmed` — quote confirmation succeeded and all required Inventory reservations exist;
- `expired` — the attempt timed out before downstream commitment and its still-reserved Inventory was released;
- `failed` — confirmation failed after an attempt row became necessary to record the failure; ordinary transaction rollback should avoid creating failed rows when nothing committed.

Later modules may add their own approved integration states without conflating payment/order/fulfillment state with Checkout state.

## 11. Inventory reservation identity and expiry behavior

For each quote line, confirmation creates one Inventory reservation with:

```text
orderAttemptId = checkout_attempt.id
sourceKey      = checkout:<attemptId>:<variantId>
expiresAt      = checkout_attempt.expires_at
```

All reservation creation and the Checkout attempt write must share the same database transaction. A partial reservation set must never commit.

Expiry release uses deterministic source keys:

```text
checkout-expire:<attemptId>:<variantId>
```

Only reservations still in Inventory `reserved` state may be released by Checkout expiry. Reservations already committed by later Order/Payment logic must not be released by the Checkout expiry job.

## 12. Confirmation revalidation order

Inside the confirmation transaction, the service must:

1. acquire/resolve Foundation idempotency;
2. lock the customer-owned quote;
3. reject an expired quote;
4. verify the submitted state hash matches the stored hash;
5. return an existing attempt if this quote is already confirmed;
6. reload the customer's current Cart and both selected addresses;
7. reload Product/Variant sellability, seller/store ownership, current prices, and currency;
8. verify exact available Inventory quantity for every line;
9. re-run the same coupon/Promotion calculation;
10. revalidate every selected Shipping method through Module 13;
11. re-read the Administration tax rate;
12. rebuild totals and `state_hash` using this patch;
13. reject any mismatch before creating an attempt/reservation;
14. create the Checkout attempt and all Inventory reservations atomically;
15. write audit/outbox records in the same transaction where applicable;
16. complete the Foundation idempotency record with the stable API response.

## 13. Error mapping without inventing new Checkout codes

Keep the six Checkout error codes from the base guide.

Use them as follows:

- `CHECKOUT_QUOTE_EXPIRED` — quote TTL elapsed;
- `CHECKOUT_PRICE_CHANGED` — Product price, tax setting, Shipping rate/eligibility, currency, or another non-Promotion monetary input changed;
- `CHECKOUT_STOCK_CHANGED` — exact required quantity is no longer available;
- `CHECKOUT_PROMOTION_CHANGED` — coupon/promotion eligibility or allocation changed;
- `CHECKOUT_ADDRESS_INVALID` — selected shipping/billing address is missing, archived, changed outside accepted normalization, or not customer-owned;
- `CHECKOUT_IDEMPOTENCY_CONFLICT` — the same idempotency key is reused for a different confirmation payload.

Generic authentication, forbidden, validation, not-found/non-enumerating, and internal errors continue to use Foundation/common error handling.

## 14. Service-boundary rule

Checkout may compose prerequisite **services**, but it must not import another business module's repository directly.

Required narrow service capabilities are:

- Customer: resolve one active address owned by the customer;
- Cart: load the current authenticated customer's authoritative Cart intent;
- Product: resolve current sellable variant + seller/store + exact price/currency;
- Inventory: check exact available quantity and reserve inside an existing transaction;
- Promotions: calculate/revalidate authoritative Checkout discount allocation;
- Shipping: resolve/revalidate approved Patch 0003 options;
- Administration: read supported currency and `commerce.default_tax_rate_percent`.

Repositories remain persistence-only.

## 15. Persisted quote response contract

`POST /quote` and `GET /quote/:id` return the same customer-owned quote shape inside the standard success envelope:

```text
id
currency
shippingAddressId
billingAddressId
couponCode nullable
subtotal
discountTotal
taxTotal
shippingTotal
grandTotal
expiresAt
stateHash
lines[]
shippingSelections[]
```

Each line contains:

```text
variantId
sellerId
storeId
quantity
unitPrice
discount
tax
lineTotal
```

Each shipping selection contains:

```text
sellerId
storeId
shippingMethodId
shippingMethodCode
shippingMethodName
amount
currency
```

`GET /api/v1/checkout/:attemptId/status` returns only the customer-owned Checkout attempt summary (`id`, `quoteId`, `orderId`, `status`, `expiresAt`). Payment and Order status remain owned by Modules 12 and 11.

## 16. Implementation sequencing after this Pass 0

This patch is a contract freeze, not permission to skip dependency order.

Next implementation must proceed in this order:

1. finish approved Shipping Core Patch 0003;
2. add the narrow prerequisite service methods Checkout needs;
3. add append-only Checkout persistence changes required by this patch;
4. implement Checkout service;
5. implement controller/routes/OpenAPI;
6. add service/Supertest tests;
7. add React Checkout feature;
8. add Playwright/release verification.

Do not edit old migrations in place. Do not add generic CRUD. Do not duplicate cross-module business logic.
