# Requirements Patch 0001 — Read-Only Editing Support

Status: **Approved additive contract patch for the current implementation**

This patch supplements the 99-page marketplace requirements guide. It does not replace the selected technology stack, repository topology, module ownership, authorization model, state machines, or generation order.

## Why this patch exists

The required Module 5 and Module 6 React features include an editable category-to-attribute mapping screen and a seller product edit screen. Those screens need a safe read operation for the exact resource being edited. The base route tables contain the write commands but do not provide those two narrow read operations.

## Approved additive routes

### Module 5 — Catalog Taxonomy

```text
GET /api/v1/catalog/categories/:id/attributes
```

Purpose: return the current attribute mappings for one category so the category-to-attribute editor and seller taxonomy selector can load the existing state before an approved `PUT /api/v1/admin/catalog/categories/:id/attributes` command.

Rules:

- Read-only.
- Uses the same public/authorized taxonomy visibility rules as the other catalog reads.
- Does not create a generic category CRUD surface.
- Does not move business rules into the controller or repository.

### Module 6 — Product Management

```text
GET /api/v1/seller/products/:id
```

Purpose: return one seller-owned product detail so the required seller product edit screen can load drafts, variants, media, and current editable values.

Rules:

- Authenticated seller read only.
- Requires `seller.products.read`.
- Seller/store ownership is enforced again in the service/repository path.
- Does not expose another seller's private product data.
- Does not change publish/unpublish/approve state-machine ownership.

## Everything else remains unchanged

All other routes continue to follow the controlling guide exactly. This patch adds no new module, table, state transition, dependency, library, workspace, or cross-module repository access.
