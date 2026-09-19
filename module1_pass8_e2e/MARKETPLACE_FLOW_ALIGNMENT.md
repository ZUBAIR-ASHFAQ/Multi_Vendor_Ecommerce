# Marketplace / Daraz-Type Flow Alignment

This document maps the requested business flow to the implementation. It distinguishes an implemented business transition from a similarly named screen so release decisions do not rely on UI labels alone.

## Result

The project is substantially aligned, but it is not yet an exact implementation of the requested flow.

- Implemented: administration, seller registration and review, approved seller stores, seller products, admin taxonomy, discounts/promotions, cart, checkout, online payment, multi-seller orders, fulfillment, shipment delivery, returns/refunds, commissions, seller wallet settlement, and payouts.
- Partially implemented: product moderation and order completion.
- Missing: cash on delivery (COD).

## Flow traceability

| Requested step | Implementation owner | Alignment | Notes |
| --- | --- | --- | --- |
| Admin categories and subcategories | Module 5 Catalog Taxonomy | Implemented | Categories use a parent category relationship for subcategories. |
| Admin brands and attributes | Module 5 Catalog Taxonomy | Implemented | Category-to-attribute mappings constrain seller product data. |
| Admin promotions and campaigns | Module 9 Promotions & Coupons | Implemented | Platform promotions can be scheduled and scoped to seller, store, category, or product. A campaign is represented by a scheduled/active scoped promotion. |
| Seller registration | Module 4 Seller & Store Management | Implemented | A customer submits a seller application. |
| Seller verification: approve/reject | Module 4 Seller & Store Management | Implemented | Only approval creates the seller master and owner membership. Rejection records a reason. |
| Seller store | Module 4 Seller & Store Management | Implemented | Store creation is gated by an active approved seller. |
| Add product using admin taxonomy | Modules 5 and 6 | Implemented | Product creation requires a platform category and validates mapped attributes. |
| Product details, images, and price | Modules 6 and 21 | Implemented | Product media uses confirmed file records; SKU variants own price. |
| Product validation | Module 6 Product Management | Partial | Moderation exists but is optional (`PRODUCT_MODERATION_REQUIRED=false` by default). |
| Product approved and live | Module 6 Product Management | Implemented when moderation is enabled | Admin approval moves a pending product to published. Public reads expose only published products from active approved seller/store sources. |
| Product review/reject | Module 6 Product Management | Partial | Pending review and approval exist, but there is no explicit admin reject command/reason or admin review-queue screen. |
| Product discount | Module 9 Promotions & Coupons | Implemented | Product-scoped seller-funded or platform-funded discounts are supported. |
| Campaign | Module 9 Promotions & Coupons | Implemented | Scheduled scoped promotions provide campaign behavior; no separate duplicate campaign aggregate is needed. |
| Customer cart | Module 8 Cart & Wishlist | Implemented | Customer-owned carts are repriced authoritatively during checkout. |
| Checkout | Module 10 Checkout | Implemented | Price, discount, tax, shipping, stock, and ownership are revalidated server-side. |
| Online payment | Module 12 Payments | Implemented | Stripe PaymentIntent and signed webhook capture drive paid order state. |
| COD payment | Not implemented | Missing | There is no COD selection, COD payment state, collection confirmation, reconciliation, or COD refund path. |
| Order and seller order split | Module 11 Orders | Implemented | One customer order is split into seller/store-specific seller orders. |
| Seller receives and prepares order | Module 11 Orders | Implemented | The seller queue and explicit acceptance command move an eligible seller order to processing. |
| Courier/logistics | Module 13 Shipping & Fulfillment | Implemented | Shipment creation, tracking, shipped, and delivered transitions exist. |
| Delivered | Module 13 Shipping & Fulfillment | Implemented | Delivery evidence is persisted per shipment and item quantity. |
| Order completed | Modules 11 and 13 | Partial | Full issued quantity becomes `fulfillmentStatus=fulfilled`, but the parent business status remains `processing`; there is no explicit delivered-to-completed transition. |
| Return and refund | Modules 14 and 12 | Implemented for online payment | Return request, approve/reject, receive, inspect, provider refund, close, and inventory/commission adjustments exist. |
| Settlement | Modules 16 and 17 | Implemented | Commission and seller earning are separate immutable financial concepts. |
| Marketplace commission | Module 16 Commissions | Implemented | Rules can be default, seller, category, or product scoped. |
| Seller earning | Module 17 Seller Wallet | Implemented | Earnings first enter pending and become available only after delivery plus the return-window hold. |
| Seller payout | Module 17 Seller Wallet & Payouts | Implemented | Seller request, finance approval, provider send, reconciliation, and paid/failed states exist. |

## Correct target flow for this codebase

```text
ADMIN
  -> taxonomy (categories/subcategories, brands, attributes)
  -> promotions/campaigns
  -> seller application review

SELLER APPLICATION
  -> submitted
  -> approved -> seller master -> active store
  -> rejected -> terminal reviewed application

SELLER PRODUCT
  -> draft with platform taxonomy, details, media, variants, and price
  -> pending approval
  -> approved -> published/live
  -> rejected with reason -> editable seller draft -> resubmit

CUSTOMER
  -> published product
  -> cart
  -> authoritative checkout quote
  -> choose online payment or COD
  -> customer order
  -> seller/store order split

ONLINE PAYMENT
  -> provider capture
  -> seller acceptance

COD
  -> seller acceptance without pre-capture
  -> courier collection confirmation
  -> payment captured/reconciled

FULFILLMENT
  -> seller prepares
  -> shipment created
  -> shipped with tracking
  -> delivered
  -> return requested -> refund/adjustments -> closed
  -> otherwise return window expires
  -> order completed

FINANCE
  -> commission posted
  -> seller earning pending
  -> delivery plus return-window hold
  -> earning available
  -> payout requested
  -> finance approved
  -> provider paid
```

## Required changes for exact alignment

### 1. Make product moderation mandatory

- Enable product moderation in deployment configuration.
- Add an admin pending-product queue.
- Add an explicit admin reject command with a mandatory reason.
- Return a rejected product to an editable state and preserve its moderation history.

### 2. Add COD as a real payment method

COD must not be implemented by marking an unpaid order as captured. The implementation needs:

- an immutable order payment-method snapshot (`online` or `cod`);
- checkout selection and eligibility validation;
- seller acceptance and shipping rules that allow eligible COD orders before capture;
- a trusted courier/logistics collection-confirmation boundary;
- COD collected, failed-delivery, refused-delivery, and reconciliation states;
- commission posting only from trusted collected funds;
- COD-aware cancellation, return, refund, and seller-wallet adjustments;
- audit, outbox, notification, report, OpenAPI, unit, integration, and browser coverage.

The collection authority must be selected before implementation: a signed courier webhook is recommended; an admin finance command is an acceptable operational fallback. A seller-controlled “mark paid” action is not safe.

### 3. Add explicit order completion

- Keep shipment `delivered` and order `completed` as separate states.
- Complete only after every non-cancelled item is delivered and the configured return/dispute condition is satisfied.
- Ensure return/refund activity can hold or adjust settlement without rewriting order/payment history.

## Release acceptance criteria

The requested flow is exactly aligned only when all of the following are true:

1. Product moderation is mandatory and supports both approval and rejection with a reason.
2. Checkout visibly offers online payment and COD only when each is eligible.
3. COD collection is confirmed by a trusted logistics/finance boundary, not by the seller or browser.
4. Sellers can accept and fulfill eligible COD orders without a fake online capture.
5. Customer orders reach an explicit completed state after delivery and the completion policy.
6. Online and COD returns/refunds both reconcile commission and seller wallet entries.
7. End-to-end tests cover approval, rejection/resubmission, online payment, COD delivery/collection, failed COD delivery, return/refund, settlement, and payout.
