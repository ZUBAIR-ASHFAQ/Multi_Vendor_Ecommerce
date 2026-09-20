# REQUIREMENTS PATCH 0011 — APPROVED

## Module 15 Reviews & Ratings — moderation queue read + immutable Store identity

Status: **APPROVED additive contract patch — approved during Audit Pass 1 contract resolution**

This approved patch resolves two concrete inconsistencies discovered during Module 15 Pass 0 inspection. It does not replace any unrelated rule in the controlling marketplace guide.

## 1. Admin moderation queue read

The Module 15 React requirements include an **Admin moderation queue**, while the source-defined API list contains only create/edit, two public list reads, helpful, hide, and publish. Public reads must expose published reviews only, so they cannot safely return pending/hidden moderation work.

Approved additive operation:

```text
GET /api/v1/admin/reviews
```

Purpose: permission-scoped moderation queue/read list only.

Approved query contract:

```text
status=pending|published|hidden      # optional; moderation UI normally requests pending
productId=<uuid>                    # optional
sellerId=<uuid>                     # optional
storeId=<uuid>                      # optional
page=<bounded positive integer>
pageSize=<bounded positive integer>
sort=created_desc|created_asc       # allow-list only
```

Authorization:

```text
admin.reviews.moderate
```

The response may contain review content and server-derived Product/Seller/Store IDs required by moderators, but must not expose customer email, token/session data, addresses, payment data, or unrelated private profile fields.

This is a read only. It does not add generic Review CRUD or an arbitrary status-write route.

## 2. Immutable Store identity on Review

The controlling Module 15 API requires:

```text
GET /api/v1/stores/:storeId/reviews
```

The listed Review critical fields include `seller_id` but not `store_id`. The implemented Seller model permits one Seller to own multiple Stores, so Seller ID alone cannot reconstruct the historical Store that sold the reviewed Order Item.

Approved persistence clarification:

```text
reviews.store_id uuid NOT NULL -> stores.id
```

`store_id` is server-derived from the immutable purchased Seller Order. Clients never supply or override it.

This field is used for exact Store review listing and historical ownership. It does **not** change the controlling `rating_aggregates.entity_type` contract, which remains `product | seller` unless a later approved patch explicitly changes it.

## 3. Existing seven operations remain unchanged

The patch does not rename or remove:

```text
POST  /api/v1/reviews
PATCH /api/v1/reviews/:id
GET   /api/v1/products/:productId/reviews
GET   /api/v1/stores/:storeId/reviews
POST  /api/v1/reviews/:id/helpful
POST  /api/v1/admin/reviews/:id/hide
POST  /api/v1/admin/reviews/:id/publish
```

Module 15 has exactly **eight** business operations: the seven controlling operations plus the one necessary admin moderation read above.

## 4. Approval and implementation transition

Approved in Audit Remediation Pass 1. The contract now requires:

- `GET /api/v1/admin/reviews` for the permission-scoped moderation queue;
- immutable, server-derived Review `store_id` for the already-defined Store review route.

The runtime entering Pass 1 already persisted `reviews.store_id`, so no replacement migration was authorized. Audit Pass 2 implements the approved moderation read through Zod contract → scoped repository → permission-enforced service → thin controller → Express/OpenAPI → backend/frontend tests → React moderation queue, without adding generic Review CRUD. The implemented business HTTP surface therefore contains exactly eight Module 15 operations.
