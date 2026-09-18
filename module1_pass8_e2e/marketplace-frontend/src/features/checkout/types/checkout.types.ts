/** One customer Shipping Core choice sent when an authoritative Checkout quote is requested. */
export interface CheckoutShippingSelectionInput {
  storeId: string;
  shippingMethodId: string;
}

/** Strict request body accepted by POST /checkout/quote. */
export interface CreateCheckoutQuoteInput {
  shippingAddressId: string;
  billingAddressId?: string;
  couponCode?: string;
  shippingSelections: CheckoutShippingSelectionInput[];
}

/** One current Shipping Core option available to one seller/store shipment group. */
export interface CheckoutShippingOption {
  id: string;
  code: string;
  name: string;
  pricingType: "flat";
  rate: string;
  currency: string;
}

/** One server-derived seller/store group that needs exactly one shipping choice. */
export interface CheckoutShippingGroup {
  sellerId: string;
  storeId: string;
  options: CheckoutShippingOption[];
}

/** Current Shipping Core options for the selected customer-owned address. */
export interface CheckoutShippingOptions {
  addressId: string;
  currency: string;
  groups: CheckoutShippingGroup[];
}

/** One immutable priced line inside an authoritative Checkout quote. */
export interface CheckoutQuoteLine {
  variantId: string;
  sellerId: string;
  storeId: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  tax: string;
  lineTotal: string;
}

/** One selected Shipping Core method copied into the short-lived Checkout quote. */
export interface CheckoutQuoteShippingSelection {
  sellerId: string;
  storeId: string;
  shippingMethodId: string;
  shippingMethodCode: string;
  shippingMethodName: string;
  amount: string;
  currency: string;
}

/** Customer-safe authoritative quote returned by Module 10. */
export interface CheckoutQuote {
  id: string;
  currency: string;
  shippingAddressId: string;
  billingAddressId: string;
  couponCode: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  expiresAt: string;
  stateHash: string;
  lines: CheckoutQuoteLine[];
  shippingSelections: CheckoutQuoteShippingSelection[];
}

/** Customer-owned Checkout attempt; Order and Payment state remain separate downstream concepts. */
export interface CheckoutAttempt {
  id: string;
  quoteId: string;
  orderId: string | null;
  status: string;
  expiresAt: string;
}
