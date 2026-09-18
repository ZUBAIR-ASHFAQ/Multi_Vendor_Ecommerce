import { and, asc, eq } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  checkoutAttempts,
  checkoutQuoteLines,
  checkoutQuotes,
  checkoutQuoteShippingSelections,
  type CheckoutAttemptRow,
  type CheckoutQuoteLineRow,
  type CheckoutQuoteRow,
  type CheckoutQuoteShippingSelectionRow,
  type NewCheckoutAttemptRow,
  type NewCheckoutQuoteLineRow,
  type NewCheckoutQuoteRow,
  type NewCheckoutQuoteShippingSelectionRow,
} from "../../database/schema/checkout.js";
import type { DatabaseExecutor } from "../../database/types.js";

/** Authoritative quote values already calculated and validated by the Checkout service. */
export interface CreateCheckoutQuoteRecordInput {
  customerUserId: string;
  shippingAddressId: string;
  billingAddressId: string;
  couponCode: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  expiresAt: Date;
  stateHash: string;
}

/** One immutable priced line already calculated and validated by the Checkout service. */
export interface CreateCheckoutQuoteLineRecordInput {
  variantId: string;
  sellerId: string;
  storeId: string;
  qty: number;
  unitPrice: string;
  discount: string;
  tax: string;
  lineTotal: string;
}

/** One persisted Shipping Core selection already validated by the Checkout service. */
export interface CreateCheckoutQuoteShippingSelectionRecordInput {
  sellerId: string;
  storeId: string;
  shippingMethodId: string;
  shippingMethodCodeSnapshot: string;
  shippingMethodNameSnapshot: string;
  amount: string;
  currency: string;
}

/** One idempotent Checkout-attempt record already authorized by the Checkout service. */
export interface CreateCheckoutAttemptRecordInput {
  quoteId: string;
  customerUserId: string;
  orderId?: string | null;
  status: string;
  idempotencyKey: string;
  expiresAt: Date;
}

/**
 * Persistence-only Module 10 repository.
 * Customer ownership is part of every private read/update query, while pricing,
 * expiry, state-hash, Inventory, Promotion, Shipping, tax, and idempotency decisions stay in the service.
 */
export class CheckoutRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Inserts one server-authoritative Checkout quote with its selected customer-owned addresses. */
  async createQuote(input: CreateCheckoutQuoteRecordInput): Promise<CheckoutQuoteRow> {
    const values: NewCheckoutQuoteRow = input;
    const [row] = await this.executor.insert(checkoutQuotes).values(values).returning();

    if (!row) {
      throw new Error("Checkout quote insert completed without returning a row.");
    }

    return row;
  }

  /** Inserts the immutable priced lines that belong to one Checkout quote. */
  async createQuoteLines(
    quoteId: string,
    lines: CreateCheckoutQuoteLineRecordInput[],
  ): Promise<CheckoutQuoteLineRow[]> {
    if (lines.length === 0) return [];

    const values: NewCheckoutQuoteLineRow[] = lines.map((line) => ({
      quoteId,
      ...line,
    }));

    return this.executor.insert(checkoutQuoteLines).values(values).returning();
  }

  /** Inserts one selected Shipping Core method for every store group in a Checkout quote. */
  async createQuoteShippingSelections(
    quoteId: string,
    selections: CreateCheckoutQuoteShippingSelectionRecordInput[],
  ): Promise<CheckoutQuoteShippingSelectionRow[]> {
    if (selections.length === 0) return [];

    const values: NewCheckoutQuoteShippingSelectionRow[] = selections.map((selection) => ({
      quoteId,
      ...selection,
    }));

    return this.executor
      .insert(checkoutQuoteShippingSelections)
      .values(values)
      .returning();
  }

  /** Reads one quote only when it belongs to the supplied authenticated customer. */
  async findQuoteForCustomer(
    quoteId: string,
    customerUserId: string,
  ): Promise<CheckoutQuoteRow | null> {
    const [row] = await this.executor
      .select()
      .from(checkoutQuotes)
      .where(
        and(
          eq(checkoutQuotes.id, quoteId),
          eq(checkoutQuotes.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Locks one customer-owned quote so confirmation can serialize safely inside a transaction. */
  async lockQuoteForCustomer(
    quoteId: string,
    customerUserId: string,
  ): Promise<CheckoutQuoteRow | null> {
    const [row] = await this.executor
      .select()
      .from(checkoutQuotes)
      .where(
        and(
          eq(checkoutQuotes.id, quoteId),
          eq(checkoutQuotes.customerUserId, customerUserId),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Lists immutable quote lines only through the quote owned by the supplied customer. */
  async listQuoteLinesForCustomer(
    quoteId: string,
    customerUserId: string,
  ): Promise<CheckoutQuoteLineRow[]> {
    const rows = await this.executor
      .select({ line: checkoutQuoteLines })
      .from(checkoutQuoteLines)
      .innerJoin(checkoutQuotes, eq(checkoutQuotes.id, checkoutQuoteLines.quoteId))
      .where(
        and(
          eq(checkoutQuoteLines.quoteId, quoteId),
          eq(checkoutQuotes.customerUserId, customerUserId),
        ),
      )
      .orderBy(asc(checkoutQuoteLines.sellerId), asc(checkoutQuoteLines.variantId));

    return rows.map((row) => row.line);
  }

  /** Lists persisted shipping selections only through the quote owned by the supplied customer. */
  async listQuoteShippingSelectionsForCustomer(
    quoteId: string,
    customerUserId: string,
  ): Promise<CheckoutQuoteShippingSelectionRow[]> {
    const rows = await this.executor
      .select({ selection: checkoutQuoteShippingSelections })
      .from(checkoutQuoteShippingSelections)
      .innerJoin(
        checkoutQuotes,
        eq(checkoutQuotes.id, checkoutQuoteShippingSelections.quoteId),
      )
      .where(
        and(
          eq(checkoutQuoteShippingSelections.quoteId, quoteId),
          eq(checkoutQuotes.customerUserId, customerUserId),
        ),
      )
      .orderBy(asc(checkoutQuoteShippingSelections.storeId));

    return rows.map((row) => row.selection);
  }

  /** Reads the single attempt already created for one customer-owned quote. */
  async findAttemptByQuoteForCustomer(
    quoteId: string,
    customerUserId: string,
  ): Promise<CheckoutAttemptRow | null> {
    const [row] = await this.executor
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.quoteId, quoteId),
          eq(checkoutAttempts.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Inserts one Checkout attempt after the service has approved confirmation and idempotency. */
  async createAttempt(
    input: CreateCheckoutAttemptRecordInput,
  ): Promise<CheckoutAttemptRow> {
    const values: NewCheckoutAttemptRow = {
      ...input,
      orderId: input.orderId ?? null,
    };
    const [row] = await this.executor.insert(checkoutAttempts).values(values).returning();

    if (!row) {
      throw new Error("Checkout attempt insert completed without returning a row.");
    }

    return row;
  }

  /** Links one customer-owned Checkout attempt to the Order created in the same transaction. */
  async attachOrderToAttempt(
    attemptId: string,
    customerUserId: string,
    orderId: string,
  ): Promise<CheckoutAttemptRow | null> {
    const [row] = await this.executor
      .update(checkoutAttempts)
      .set({ orderId, updatedAt: new Date() })
      .where(
        and(
          eq(checkoutAttempts.id, attemptId),
          eq(checkoutAttempts.customerUserId, customerUserId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Reads one Checkout attempt only when it belongs to the supplied customer. */
  async findAttemptForCustomer(
    attemptId: string,
    customerUserId: string,
  ): Promise<CheckoutAttemptRow | null> {
    const [row] = await this.executor
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.id, attemptId),
          eq(checkoutAttempts.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row ?? null;
  }


}
