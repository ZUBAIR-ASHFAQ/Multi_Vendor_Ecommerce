# Drizzle migrations

The SQL migration history is append-only and must be applied in order.

Current sequence:

```text
0000_foundation.sql
0001_administration_auth_rbac.sql
0002_module2_remediation_persistence.sql
0003_module2_role_assignment_identity.sql
0004_documents_audit_core.sql
0005_documents_audit_integrity.sql
0006_customer_management.sql
0007_seller_store_management.sql
0008_catalog_taxonomy.sql
0009_product_management.sql
0010_product_management_integrity.sql
0011_inventory_stock.sql
0012_search_discovery.sql
0013_search_reindex_error_code.sql
0014_inventory_partial_shipment_accounting.sql
0015_remove_unused_password_reset_tokens.sql
0016_refresh_session_contract_alignment.sql
0017_cart_wishlist.sql
0018_promotions_coupons.sql
0019_shipping_configuration_core.sql
0020_checkout.sql
0021_shipping_configuration_contract.sql
0022_checkout_contract_persistence.sql
0023_orders_persistence.sql
0024_payments_persistence.sql
0025_commissions_marketplace_fees.sql
0026_commissions_contract_integrity.sql
0027_shipping_fulfillment.sql
0028_returns_refunds_disputes.sql
0029_seller_wallet_payouts.sql
0030_audit_remediation_expiry_lookup.sql
0031_reviews_ratings.sql
0032_notifications.sql
0033_reports_analytics.sql
```

Module 2 migration compatibility remains independently verifiable with:

```bash
npm run test:module2:migrations
```

Module 21 migration verification covers a clean database, upgrade from the final Module 2 schema, and upgrade from the previously supported `0004` Module 21 schema with:

```bash
npm run test:module21:migrations
```

Module 3 migration verification covers a clean database and upgrade from the final `0005` Module 21 schema, including existing-customer profile backfill and customer-address integrity guards:

```bash
npm run test:module3:migrations
```

Module 4 uses `0007_seller_store_management.sql` and remains independently verifiable with `npm run test:module4:migrations`.

Module 5 adds `0008_catalog_taxonomy.sql` for categories, brands, attributes, attribute values, and category-to-attribute mappings. Its dedicated verifier checks both a clean Module 5 schema and upgrade from the supported Module 4 schema with `npm run test:module5:migrations`.

Module 6 uses `0009_product_management.sql` for the five Product tables and `0010_product_management_integrity.sql` as an append-only integrity remediation. The remediation makes public Product slugs globally unique for `/api/v1/products/:slug`, enforces product seller/store ownership with a composite foreign key, validates attribute-value ownership with a composite foreign key, normalizes stored SKUs, and protects seller/store-scoped SKU uniqueness with a transaction-safe database trigger. Run `npm run test:module6:migrations` to verify clean, Module 5 upgrade, and original `0009` upgrade paths.

Module 7 adds `0011_inventory_stock.sql` for inventory balances, immutable stock movements, and checkout-ready stock reservations. It enforces non-negative on-hand/reserved quantities, `reserved <= on_hand`, seller/store ownership, Product-variant seller/store scope, unique movement/reservation source keys, and append-only movement history. `order_attempt_id` is intentionally stored as an opaque UUID until Module 10 creates `checkout_attempts`; a later append-only migration may add that foreign key. Run `npm run test:module7:migrations` to verify both a clean database and the supported Module 6 -> Module 7 upgrade path.

Module 19 adds `0012_search_discovery.sql` for the PostgreSQL-backed Search read model. It enables `pg_trgm`, creates `product_search_documents`, `search_synonyms`, and `search_reindex_runs`, and adds full-text, trigram, facet, price/rating, stock, and reindex-control indexes. Search documents remain derived data: Product, Catalog, Inventory, and later Ratings stay authoritative. Run `npm run test:module19:migrations` to verify both a clean database and the supported Module 7 -> Module 19 upgrade path.

The Search repository audit adds append-only `0013_search_reindex_error_code.sql` after the repository audit found that the original reindex table used `error_message` while the controlling Module 19 contract requires a stable `error_code`. The migration renames the column and bounds it to `varchar(120)` without rewriting `0012`. The same `npm run test:module19:migrations` command now verifies the complete Module 19 migration chain.

Append-only `0014_inventory_partial_shipment_accounting.sql` extends Module 7 with `stock_reservations.consumed_qty`, defaulting to `0` and constrained to `0 <= consumed_qty <= qty`. Existing `status = 'consumed'` rows are backfilled to `consumed_qty = qty` because the earlier Inventory service only allowed full reservation consumption. This prepares the database for multiple shipments against one committed reservation without rewriting `0011`. The permanent `npm run test:module7:migrations` command verifies the complete Module 7 migration history, including the partial-shipment upgrade/backfill path.

`0015_remove_unused_password_reset_tokens.sql` removes the unused `password_reset_tokens` table. Password-reset HTTP commands are not part of the approved Module 2 route table, so the current release does not keep an orphaned table, relation, service, environment setting, or API placeholder for an incomplete feature. The historical `0001` migration is not rewritten; the cleanup remains append-only.

`0016_refresh_session_contract_alignment.sql` aligns the current Module 2 persistence contract with the controlling guide without rewriting historical migrations. It renames `auth_sessions` to `refresh_sessions`, replaces the legacy `family_id` UUID with a 64-hex `token_family_hash`, preserves existing rotation-family grouping during upgrade, renames related indexes/constraints, and adds a family-hash integrity check. New sessions use SHA-256 family hashes generated by `RefreshTokenService`.

Module 8 adds `0017_cart_wishlist.sql` for one customer Cart, Cart lines, named/default Wishlists, and Wishlist items. The database enforces one Cart per customer, positive Cart quantities, one logical Cart line per variant, normalized three-letter Cart currency, at most one default Wishlist per customer, duplicate-safe Product/variant Wishlist entries, and Product/variant ownership for variant-specific Wishlist rows. Cart persistence contains no stock reservation or authoritative checkout totals. Run `npm run test:module8:migrations` to verify both a clean database and the supported pre-Module-8 -> Module 8 upgrade path.

Module 9 adds `0018_promotions_coupons.sql` for marketplace/seller promotions, promotion eligibility scopes, coupon codes, and coupon redemption records. The database enforces platform-versus-seller ownership shape, valid date ranges, positive rule values, bounded percentage values, lifecycle/status allow-lists, normalized unique coupon codes, positive optional usage limits, duplicate-safe promotion scopes, and duplicate-safe coupon/order redemption identity. `coupon_redemptions.order_id` was intentionally opaque before Module 11. Append-only migration `0023_orders_persistence.sql` now adds the Order foreign key as `NOT VALID`: new redemption rows must reference real Orders while any unexpected historical placeholder data is not silently rewritten. Polymorphic `promotion_scopes.scope_id` remains service-validated against the allow-listed Seller/Catalog/Product scope type rather than using an unsafe cross-table foreign key. Run `npm run test:module9:migrations` to verify both a clean database and the supported pre-Module-9 -> Module 9 upgrade path.

Shipping Configuration Core starts with historical `0019_shipping_configuration_core.sql`, then approved Patch 0003 is applied append-only through `0021_shipping_configuration_contract.sql`. That migration adds required normalized three-letter currency, narrows `pricing_type` to `flat`, narrows status to `active | inactive`, and adds the currency/status lookup index used by Checkout. Existing compliant Stage 11 rows are preserved: currency is backfilled only from Administration's configured `commerce.default_currency`; ambiguous or non-compliant legacy rows fail loudly instead of being silently reclassified.

Module 13 Shipping & Fulfillment Completion adds `0027_shipping_fulfillment.sql` after Orders, Payments, and Commissions are present. It creates `shipments`, immutable `shipment_items`, and append-only `shipment_status_history`; constrains Shipment lifecycle values to `created | shipped | delivered`; enforces server-generated `SHP-<UUID>` numbers, positive item allocations, tracking/timestamp row-shape guards, and restrict-delete foreign keys to Seller Orders and Order Items. The same migration narrows `orders.fulfillment_status` to the approved `unfulfilled | partially_fulfilled | fulfilled` values and fails loudly if unsupported historical values exist instead of rewriting Order history. Run `npm run test:module13:migrations` to verify the full clean history plus the supported pre-`0027` upgrade path.

Do not edit an already-supported migration merely to make the current schema look cleaner. Add a new migration when a future approved stage changes the schema.

`0005_documents_audit_integrity.sql` persists the signed upload purpose on `files`, constrains file/link purposes to the then-current allow-list, and adds basic audit identity checks. Existing `0004` file rows are backfilled only when their server-generated object key contains a recognized purpose prefix; unexpected historical keys fail the migration instead of being silently misclassified.

`0006_customer_management.sql` adds the Module 3 `customer_profiles` and `customer_addresses` tables. Existing `users.account_type = 'customer'` identities receive one profile without changing authentication authority. Saved addresses use archive status, restrict-delete foreign keys, normalized uppercase country codes, and partial unique indexes that allow at most one active default shipping address and one active default billing address per customer.

`0007_seller_store_management.sql` adds Module 4 `seller_applications`, `sellers`, `stores`, and `seller_staff`. It also attaches the real `user_roles.seller_id -> sellers.id` foreign key now that the seller master exists, links store logos to Module 21 files, and expands the file/link purpose checks with `store_asset`.

`0008_catalog_taxonomy.sql` adds the Module 5 `categories`, `brands`, `attributes`, `attribute_values`, and `category_attributes` tables. Category parent links and taxonomy references use restrict-delete foreign keys because the business contract deactivates referenced taxonomy instead of hard-deleting it. The database enforces row-local integrity such as active/inactive status, unique normalized slugs/codes, non-blank names/values, direct self-parent rejection, non-negative sort order, and one category/attribute mapping per pair. Full ancestor-cycle detection and variant-axis data-type compatibility remain service-layer rules because the requirements do not define them as row-local database constraints.

Pre-Module-4 non-null `user_roles.seller_id` values were placeholder scope data because no seller master existed. `0007` deliberately refuses to add the new foreign key while such values exist so an operator must map or remove them explicitly rather than silently creating incorrect seller ownership.

`audit_logs.seller_id` remains an append-only historical context field rather than a hard foreign key. This preserves audit history even when older audit rows contain pre-Module-4 seller-scope identifiers; application policy still validates new seller-scoped writes.

Module 10 Checkout starts with `0020_checkout.sql` for authoritative quote snapshots, priced quote lines, and idempotent Checkout attempts. Approved Patch 0004 is applied append-only through `0022_checkout_contract_persistence.sql`: customer-owned shipping/billing address references and normalized coupon persistence are added to quotes; quote lines gain server-derived store identity; `checkout_quote_shipping_selections` stores one selected Shipping Core method per quote/store group; new rows require SHA-256-shaped state hashes; and `checkout_attempts.quote_id` becomes unique so a different idempotency key cannot duplicate the business attempt. The redundant attempt `(id, customer_user_id)` unique index is removed because `id` is already the primary key. Upgrade compatibility is preserved with `NOT VALID` checks for fields that did not exist on historical quote rows, so no old address/store choice is fabricated. The migration still does not add a foreign key from `stock_reservations.order_attempt_id` because supported pre-Checkout databases may contain opaque legacy UUIDs. `npm run test:module10:migrations` verifies both a clean database and upgrade from the accepted `0021` schema while proving legacy Checkout rows and reservation attempt IDs remain unchanged.

Module 11 Order Management Pass 1 is applied append-only through `0023_orders_persistence.sql`. It creates `orders`, `seller_orders`, `order_items`, `order_addresses`, and `order_status_history`; enforces one Order per Checkout attempt; stores deterministic `ORD-...` / `SOR-...` identifiers and immutable Product/address/Shipping snapshots; adds the completed `checkout_attempts.order_id -> orders.id` foreign key; and adds `stock_reservations.released_qty` with `consumed_qty + released_qty <= qty` so later partial cancellation can be implemented without rewriting reservation history. The status columns intentionally enforce normalization rather than a closed enum because approved downstream Payment/Fulfillment/Refund modules may add lifecycle values later. Run `npm run test:module11:migrations` to verify both a clean database and the supported `0022` -> `0023` upgrade path.

Module 12 Payments Pass 1 is applied append-only through `0024_payments_persistence.sql`. It creates exactly the three approved core tables: `payments`, `payment_transactions`, and `payment_webhook_events`. The database enforces one Payment aggregate per Customer Order, unique non-null provider PaymentIntent and transaction identities, unique non-null transaction source keys, provider/event replay safety, normalized currency/provider/status values, NUMERIC(18,4) money, and `amount_refunded <= amount_captured`. Verified webhook persistence stores only approved identifiers, event type, SHA-256 payload hash, status/error code, and timestamps; raw webhook bytes, client secrets, card data, Stripe secrets, and webhook secrets are not columns. Run `npm run test:module12:migrations` to verify both a clean database and the supported released Module 11 `0023` -> Module 12 `0024` upgrade path.

Module 16 Commissions & Marketplace Fees originally creates its three approved persistence tables through append-only migration `0025_commissions_marketplace_fees.sql`: `commission_rules`, `commission_rule_snapshots`, and `commission_entries`. Remediation Pass 1 adds `0026_commissions_contract_integrity.sql`, which enforces the approved `active | inactive` rule-status contract without rewriting `0025` or adding another table. The migration deliberately fails if a legacy `commission_rules` row has another status instead of silently changing finance configuration. One immutable rule snapshot remains allowed per Order Item, and the Commission ledger still uses unique `source_key` values for replay safety with append-only sale/refund/adjustment entries. Run `npm run test:module16:migrations` to verify a clean database, the supported `0025` -> `0026` upgrade path, data preservation, and fail-closed handling of unsupported legacy statuses.

Audit Remediation Pass 1 adds append-only migration `0030_audit_remediation_expiry_lookup.sql`. It does not add or change business columns, tables, money fields, lifecycle values, or route contracts. It adds `checkout_attempts_expiry_order_idx` on `(expires_at, id, order_id)` for linked Checkout attempts so the frozen Module 12 maintenance direction can later read overdue unpaid Order candidates in a bounded deterministic order without scanning the whole Checkout-attempt table. Coupon redemption replay/usage-limit persistence and Module 17 Wallet replay persistence already have the required unique/source indexes, so no additional schema change is introduced for those findings.

Module 15 Reviews & Ratings Pass 1 adds append-only migration `0031_reviews_ratings.sql`. It creates the four source-required tables: `reviews`, `review_helpful_votes`, `review_moderation_history`, and `rating_aggregates`. The database enforces one Review per purchased Order Item, server-verified purchase rows, rating `1..5`, `pending | published | hidden` lifecycle values, immutable server-derived Store/Seller ownership, replay-safe Helpful votes, append-only moderation history, and one Product/Seller aggregate row per entity. `rating_avg` uses `NUMERIC(4,2)` to match the Search read model. Run `npm run test:module15:migrations` to verify both the supported `0030` -> `0031` upgrade and a clean migration history through Module 15.

Module 18 Notifications Pass 1 adds append-only migration `0032_notifications.sql`. It creates the four source-required persistence tables: `notification_templates`, `notifications`, `notification_deliveries`, and `notification_preferences`. The database limits delivery/template channels to `in_app | email`, preserves versioned templates, stores per-user read state and event/channel preferences, and keeps masked delivery destinations. `notification_deliveries.source_event_id` references the Foundation outbox and is unique with `user_id + channel`, providing the persistence needed for the source-required event/recipient/channel retry idempotency rule. No template seed is added in Pass 1 because the controlling requirements do not define concrete event-to-template content; contracts and policy mapping are defined in later Module 18 passes. Run `npm run test:module18:migrations` to verify both the supported `0031` -> `0032` upgrade and a clean migration history through Module 18.


Module 20 Reports & Analytics Pass 1 adds append-only migration `0033_reports_analytics.sql`. It creates exactly the three source-required persistence tables: `report_definitions`, `report_runs`, and `saved_report_filters`. Definitions store stable report code/domain plus permission, filter-schema, output-format, and lifecycle metadata; asynchronous runs reference the requesting Module 2 user and optional Module 21 generated file; saved filters are owned by one user and one report definition. CSV/PDF output formats and the `queued | processing | completed | failed` run lifecycle are bounded in PostgreSQL. The migration does not seed report definitions because concrete report/filter contracts belong to later Module 20 passes and must not be invented during the database-only pass. Run `npm run test:module20:migrations` to verify both the supported `0032` -> `0033` upgrade and a clean migration history through Module 20 Pass 1.

Module 1 Dashboard Pass 1 adds append-only migration `0034_dashboard.sql`. It creates exactly the two Dashboard-owned persistence tables from the controlling guide: `dashboard_preferences` and `dashboard_saved_filters`. Preferences are one row per authenticated user, may reference an optional default Store, and store only Dashboard presentation/filter state. Saved filters are user-owned JSON filter presets. The migration does not add KPI, order, payment, inventory, refund, commission, wallet, payout, or reporting aggregate tables because Dashboard remains a read/orchestration layer over Module 20 Reports and approved source modules. Run `npm run test:module1:migrations` to verify both the supported `0033` -> `0034` upgrade and a clean migration history through Module 1 Pass 1.
