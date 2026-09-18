import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  customerAddresses,
  customerProfiles,
  users,
  type CustomerAddressRow,
  type CustomerProfileRow,
} from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { ACCOUNT_TYPE } from "../administration/administration.constants.js";
import {
  CUSTOMER_ADDRESS_STATUS,
  CUSTOMER_SORT,
} from "./customers.constants.js";
import type { AdminCustomerListQuery } from "./customers.schema.js";

/** Fields the service may persist when provisioning a customer profile. */
interface CreateCustomerProfileRecordInput {
  userId: string;
  displayName: string;
  phone?: string | null;
  marketingOptIn?: boolean;
}

/** Self-service profile fields that may be persisted after service authorization. */
export interface UpdateCustomerProfileRecordInput {
  displayName?: string;
  phone?: string | null;
  marketingOptIn?: boolean;
}

/** Fields required to persist one new customer-owned saved address. */
interface CreateCustomerAddressRecordInput {
  customerUserId: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode?: string | null;
  countryCode: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

/** Editable saved-address fields after ownership and lifecycle checks are complete. */
export interface UpdateCustomerAddressRecordInput {
  label?: string;
  recipientName?: string;
  phone?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string;
  postalCode?: string | null;
  countryCode?: string;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

/** Database-shaped customer row used by the future admin list/detail service response mapper. */
export interface AdminCustomerRecord {
  userId: string;
  email: string;
  accountStatus: string;
  profileStatus: string;
  displayName: string;
  phone: string | null;
  marketingOptIn: boolean;
  addressCount: number;
  createdAt: Date;
}

/** Paginated persistence result for privileged customer search. */
interface PaginatedAdminCustomerRecords {
  items: AdminCustomerRecord[];
  totalItems: number;
}

/** Combines only SQL predicates that were actually supplied. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Maps the validated customer sort key to deterministic SQL ordering. */
function adminCustomerOrder(sort: AdminCustomerListQuery["sort"]): SQL[] {
  switch (sort) {
    case CUSTOMER_SORT.CREATED_ASC:
      return [asc(customerProfiles.createdAt), asc(customerProfiles.userId)];
    case CUSTOMER_SORT.NAME_ASC:
      return [asc(customerProfiles.displayName), asc(customerProfiles.userId)];
    case CUSTOMER_SORT.NAME_DESC:
      return [desc(customerProfiles.displayName), asc(customerProfiles.userId)];
    case CUSTOMER_SORT.CREATED_DESC:
    default:
      return [desc(customerProfiles.createdAt), asc(customerProfiles.userId)];
  }
}

/** Builds the SQL predicates shared by admin customer list and count queries. */
function adminCustomerWhere(query: AdminCustomerListQuery): SQL | undefined {
  const search = query.search?.trim();
  const searchPattern = search ? `%${search}%` : undefined;

  return combineConditions([
    eq(users.accountType, ACCOUNT_TYPE.CUSTOMER),
    searchPattern
      ? or(
          ilike(users.email, searchPattern),
          ilike(customerProfiles.displayName, searchPattern),
        )
      : undefined,
    query.profileStatus
      ? eq(customerProfiles.status, query.profileStatus)
      : undefined,
    query.accountStatus ? eq(users.status, query.accountStatus) : undefined,
  ]);
}

/** Counts active saved addresses for one customer without exposing address data in the list query. */
const activeAddressCount = sql<number>`(
  select count(*)::int
    from ${customerAddresses}
   where ${customerAddresses.customerUserId} = ${customerProfiles.userId}
     and ${customerAddresses.status} = ${CUSTOMER_ADDRESS_STATUS.ACTIVE}
)`;

/**
 * Persistence-only Module 3 repository.
 * Ownership-sensitive customer operations always include the customer user ID in their SQL predicate.
 */
export class CustomersRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Creates a customer profile once and returns null when the one-to-one profile already exists. */
  async createProfileIfMissing(
    input: CreateCustomerProfileRecordInput,
  ): Promise<CustomerProfileRow | null> {
    const [row] = await this.executor
      .insert(customerProfiles)
      .values(input)
      .onConflictDoNothing({ target: customerProfiles.userId })
      .returning();

    return row ?? null;
  }

  /** Reads the commerce profile owned by one exact Module 2 customer user ID. */
  async findProfileByUserId(userId: string): Promise<CustomerProfileRow | null> {
    const [row] = await this.executor
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, userId))
      .limit(1);

    return row ?? null;
  }

  /** Updates only editable commerce-profile fields for one exact customer user ID. */
  async updateProfileByUserId(
    userId: string,
    input: UpdateCustomerProfileRecordInput,
  ): Promise<CustomerProfileRow | null> {
    const [row] = await this.executor
      .update(customerProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(customerProfiles.userId, userId))
      .returning();

    return row ?? null;
  }

  /** Lists active saved addresses for one customer in deterministic default/newest order. */
  async listAddressesByCustomerUserId(
    customerUserId: string,
  ): Promise<CustomerAddressRow[]> {
    return this.executor
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.customerUserId, customerUserId),
          eq(customerAddresses.status, CUSTOMER_ADDRESS_STATUS.ACTIVE),
        ),
      )
      .orderBy(
        desc(customerAddresses.isDefaultShipping),
        desc(customerAddresses.isDefaultBilling),
        desc(customerAddresses.createdAt),
        asc(customerAddresses.id),
      );
  }

  /** Lists active and archived addresses for one customer for explicit privileged history/detail reads. */
  async listAllAddressesByCustomerUserId(
    customerUserId: string,
  ): Promise<CustomerAddressRow[]> {
    return this.executor
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerUserId, customerUserId))
      .orderBy(desc(customerAddresses.createdAt), asc(customerAddresses.id));
  }

  /** Reads one saved address only when the supplied customer user owns it. */
  async findAddressByIdForCustomer(
    addressId: string,
    customerUserId: string,
  ): Promise<CustomerAddressRow | null> {
    const [row] = await this.executor
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.id, addressId),
          eq(customerAddresses.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Creates one address whose customer ownership was derived by the service. */
  async createAddress(
    input: CreateCustomerAddressRecordInput,
  ): Promise<CustomerAddressRow> {
    const [row] = await this.executor
      .insert(customerAddresses)
      .values(input)
      .returning();

    if (!row) {
      throw new Error("Customer address insert completed without returning a row.");
    }

    return row;
  }

  /** Updates an active address only inside the supplied customer ownership scope. */
  async updateAddressForCustomer(
    addressId: string,
    customerUserId: string,
    input: UpdateCustomerAddressRecordInput,
  ): Promise<CustomerAddressRow | null> {
    const [row] = await this.executor
      .update(customerAddresses)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(customerAddresses.id, addressId),
          eq(customerAddresses.customerUserId, customerUserId),
          eq(customerAddresses.status, CUSTOMER_ADDRESS_STATUS.ACTIVE),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Archives an active customer-owned address and removes both default flags atomically. */
  async archiveAddressForCustomer(
    addressId: string,
    customerUserId: string,
  ): Promise<CustomerAddressRow | null> {
    const [row] = await this.executor
      .update(customerAddresses)
      .set({
        status: CUSTOMER_ADDRESS_STATUS.ARCHIVED,
        isDefaultShipping: false,
        isDefaultBilling: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerAddresses.id, addressId),
          eq(customerAddresses.customerUserId, customerUserId),
          eq(customerAddresses.status, CUSTOMER_ADDRESS_STATUS.ACTIVE),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Clears the active shipping default and returns the IDs whose flag actually changed. */
  async clearDefaultShippingForCustomer(customerUserId: string): Promise<string[]> {
    const rows = await this.executor
      .update(customerAddresses)
      .set({ isDefaultShipping: false, updatedAt: new Date() })
      .where(
        and(
          eq(customerAddresses.customerUserId, customerUserId),
          eq(customerAddresses.status, CUSTOMER_ADDRESS_STATUS.ACTIVE),
          eq(customerAddresses.isDefaultShipping, true),
        ),
      )
      .returning({ id: customerAddresses.id });

    return rows.map((row) => row.id);
  }

  /** Clears the active billing default and returns the IDs whose flag actually changed. */
  async clearDefaultBillingForCustomer(customerUserId: string): Promise<string[]> {
    const rows = await this.executor
      .update(customerAddresses)
      .set({ isDefaultBilling: false, updatedAt: new Date() })
      .where(
        and(
          eq(customerAddresses.customerUserId, customerUserId),
          eq(customerAddresses.status, CUSTOMER_ADDRESS_STATUS.ACTIVE),
          eq(customerAddresses.isDefaultBilling, true),
        ),
      )
      .returning({ id: customerAddresses.id });

    return rows.map((row) => row.id);
  }

  /** Searches customer identities through an explicit privileged read model with bounded pagination. */
  async listCustomersForAdmin(
    query: AdminCustomerListQuery,
  ): Promise<PaginatedAdminCustomerRecords> {
    const { limit, offset } = toLimitOffset(query);
    const where = adminCustomerWhere(query);

    const items = await this.executor
      .select({
        userId: customerProfiles.userId,
        email: users.email,
        accountStatus: users.status,
        profileStatus: customerProfiles.status,
        displayName: customerProfiles.displayName,
        phone: customerProfiles.phone,
        marketingOptIn: customerProfiles.marketingOptIn,
        addressCount: activeAddressCount,
        createdAt: customerProfiles.createdAt,
      })
      .from(customerProfiles)
      .innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(where)
      .orderBy(...adminCustomerOrder(query.sort))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(customerProfiles)
      .innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(where);

    return {
      items: items.map((row) => ({ ...row, addressCount: Number(row.addressCount) })),
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads one customer through the explicit privileged Module 2 + Module 3 summary projection. */
  async findCustomerSummaryForAdmin(
    userId: string,
  ): Promise<AdminCustomerRecord | null> {
    const [row] = await this.executor
      .select({
        userId: customerProfiles.userId,
        email: users.email,
        accountStatus: users.status,
        profileStatus: customerProfiles.status,
        displayName: customerProfiles.displayName,
        phone: customerProfiles.phone,
        marketingOptIn: customerProfiles.marketingOptIn,
        addressCount: activeAddressCount,
        createdAt: customerProfiles.createdAt,
      })
      .from(customerProfiles)
      .innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(
        and(
          eq(customerProfiles.userId, userId),
          eq(users.accountType, ACCOUNT_TYPE.CUSTOMER),
        ),
      )
      .limit(1);

    if (!row) return null;
    return { ...row, addressCount: Number(row.addressCount) };
  }
}
