# Requirements Patch 0003 — Shipping Configuration Core Contract

**Status: APPROVED additive contract patch for the current implementation.**

This patch supplements the 99-page marketplace requirements guide. It does not change the selected stack, independent frontend/backend repository topology, seller-isolation rules, generation order, or the later Module 13 fulfillment lifecycle.

## Why this clarification is needed

The base guide intentionally generates Module 13 in two stages:

1. Stage 11 — **Shipping Configuration Core**, required by Checkout.
2. Stage 16 — **Shipping & Fulfillment Completion**, after Orders and Payments.

The base Module 13 section names `shipping_methods` and `GET /api/v1/checkout/shipping-options`, but it does not freeze the executable Stage 11 pricing, currency, status, request, response, or eligibility rules. This patch freezes only the minimum contract needed by Checkout.

## Stage 11 boundary

Until Stage 16, Module 13 owns only:

```text
shipping_methods
GET /api/v1/checkout/shipping-options
```

Do not generate `shipments`, `shipment_items`, `shipment_status_history`, shipment lifecycle commands, tracking, Inventory issue, or customer tracking reads during Stage 11.

## Shipping method contract

Stage 11 supports one pricing model:

```text
pricing_type = "flat"
```

`base_rate` is the complete shipping charge for one seller/store shipment group. Stage 11 does not implement weight bands, distance pricing, zones, free-shipping thresholds, carrier quotes, or a generic rule engine.

Stage 11 uses these method statuses:

```text
active
inactive
```

Only `active` methods are eligible for Checkout.

## Currency rule

Add a required three-letter `currency` field to `shipping_methods` in a new append-only migration. Do not edit the already-created `0019_shipping_configuration_core.sql` migration.

Rules:

- normalize currency to uppercase `^[A-Z]{3}$`;
- currency must be supported by Administration;
- a shipping method is eligible only when its currency equals the authoritative Cart/Checkout currency;
- seller-owned methods apply only to shipment groups belonging to that seller;
- platform-owned methods may apply to every shipment group with matching currency;
- money uses PostgreSQL `NUMERIC(18,4)` and JSON decimal strings, never JavaScript floating-point money.

## Shipping-options request contract

Use exactly:

```http
GET /api/v1/checkout/shipping-options?addressId=<uuid>
```

The query is strict and contains only `addressId`.

Server behavior:

- authentication is required;
- the actor must resolve to an active customer profile;
- `addressId` must resolve to one active address owned by that customer;
- Cart contents come from Module 8 through its service boundary;
- Product/Variant/Store/Seller ownership is resolved server-side through prerequisite service boundaries;
- the server derives shipment groups from the current Cart;
- the client does not submit customer ID, Cart ID, seller ID, store ID, Cart totals, shipping prices, or authoritative currency.

The address is validated for ownership and active status only in Stage 11. Geographic zones/rules are not part of the current flat-rate contract.

## Shipment-group rule

One Checkout shipment group is identified by the authoritative `storeId` and also returns its owning `sellerId`.

A mixed Cart may therefore contain multiple groups. Every Cart line must belong to exactly one derived group.

## Shipping-options response contract

The standard API envelope contains this `data` shape:

```json
{
  "addressId": "uuid",
  "currency": "USD",
  "groups": [
    {
      "sellerId": "uuid",
      "storeId": "uuid",
      "options": [
        {
          "id": "uuid",
          "code": "standard",
          "name": "Standard Shipping",
          "pricingType": "flat",
          "rate": "12.0000",
          "currency": "USD"
        }
      ]
    }
  ]
}
```

Rules:

- groups are sorted by `storeId`;
- options are sorted by `code`, then `id`;
- each option is an active eligible method for that group;
- no seller-private method may appear in another seller's group;
- the response contains no authoritative Cart subtotal or Checkout grand total.

## Ownership rule

- `owner_type = platform` requires `seller_id IS NULL`.
- `owner_type = seller` requires `seller_id IS NOT NULL`.
- seller-owned methods are returned only for groups owned by that seller.
- platform methods can be returned for all groups when active and currency-compatible.

## Route authorization

The route uses authentication plus a customer-resource policy. It does **not** invent a new Shipping permission code. The service must verify the authenticated actor has an active customer profile and owns the supplied address.

## Shipping-method management remains deferred

The base Module 13 React requirements later list "Shipping method setup", but the base route table does not define management endpoints. This patch does not invent Admin/Seller CRUD routes.

Stage 11 may use migration/test seed data for automated verification. A production setup UI and its write API remain deferred until a later approved additive contract before Module 13 full completion.

## Implementation effect

This approval unblocks the Shipping Configuration Core implementation required before Checkout. Subsequent passes must implement this contract with:

- an append-only currency/status/pricing migration if needed;
- Zod request/response contracts;
- a small Shipping service;
- a thin controller/router and OpenAPI operation;
- service/API tests;
- the minimum Checkout-facing frontend integration needed by Module 10.
