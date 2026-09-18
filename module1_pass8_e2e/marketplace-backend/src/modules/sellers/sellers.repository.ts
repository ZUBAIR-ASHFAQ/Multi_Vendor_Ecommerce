import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import {
  sellerApplications,
  sellers,
  sellerStaff,
  stores,
  type NewSellerApplicationRow,
  type NewSellerRow,
  type NewStoreRow,
  type SellerApplicationRow,
  type SellerRow,
  type SellerStaffRow,
  type StoreRow,
} from "../../database/schema/sellers.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  SELLER_APPLICATION_SORT,
  SELLER_APPLICATION_STATUS,
  SELLER_APPROVAL_STATUS,
  SELLER_STAFF_STATUS,
  SELLER_STATUS,
  STORE_STATUS,
} from "./sellers.constants.js";
import type {
  AdminSellerApplicationListQuery,
  SellerApplicationBusinessProfile,
} from "./sellers.schema.js";

/** Values persisted when a user submits a new seller application. */
interface CreateSellerApplicationRecordInput {
  applicantUserId: string;
  businessProfile: SellerApplicationBusinessProfile;
}

/** Values persisted by a service-approved seller application review transition. */
interface ReviewSellerApplicationRecordInput {
  status:
    | typeof SELLER_APPLICATION_STATUS.APPROVED
    | typeof SELLER_APPLICATION_STATUS.REJECTED;
  reviewedBy: string;
  reviewedAt: Date;
  reason: string | null;
}

/** Values required to create the approved seller master. */
interface CreateSellerRecordInput {
  ownerUserId: string;
  legalName: string;
  displayName: string;
  taxId: string | null;
  approvedAt: Date;
}

/** Seller fields that remain editable after approval. */
interface UpdateSellerProfileRecordInput {
  legalName?: string | undefined;
  displayName?: string | undefined;
  taxId?: string | null | undefined;
}

/** Values required to persist one seller-owned store. */
interface CreateStoreRecordInput {
  sellerId: string;
  slug: string;
  name: string;
  description: string | null;
  logoFileId: string | null;
  defaultCurrency: string;
  supportEmail: string | null;
}

/** Store fields that remain editable after seller ownership is established. */
interface UpdateStoreRecordInput {
  slug?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  logoFileId?: string | null | undefined;
  defaultCurrency?: string | undefined;
  supportEmail?: string | null | undefined;
  status?:
    | typeof STORE_STATUS.ACTIVE
    | typeof STORE_STATUS.INACTIVE
    | undefined;
}

/** Persistence result used by the privileged seller-application review queue. */
interface PaginatedSellerApplicationRecords {
  items: SellerApplicationRow[];
  totalItems: number;
}

/** Reconciled active/inactive seller staff counts for /sellers/me. */
interface SellerStaffSummaryRecord {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
}

/** Public-safe store projection plus lifecycle fields needed by the service visibility check. */
interface PublicStoreRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoFileId: string | null;
  defaultCurrency: string;
  supportEmail: string | null;
  storeStatus: string;
  sellerId: string;
  sellerDisplayName: string;
  sellerStatus: string;
  sellerApprovalStatus: string;
}

/** Minimal application ownership data consumed by the composed document-resource policy. */
interface SellerApplicationDocumentScopeRecord {
  applicationId: string;
  applicantUserId: string;
  status: string;
}

/** Minimal seller ownership data consumed by authentication/document resource composition. */
interface SellerDocumentScopeRecord {
  sellerId: string;
  ownerUserId: string;
  status: string;
  approvalStatus: string;
}

/** Minimal store ownership data consumed by authentication/document resource composition. */
interface StoreDocumentScopeRecord {
  storeId: string;
  sellerId: string;
  storeStatus: string;
  sellerStatus: string;
  sellerApprovalStatus: string;
}

/** Combines only SQL predicates that were actually supplied. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Maps the allow-listed seller-application sort key to deterministic SQL ordering. */
function sellerApplicationOrder(
  sort: AdminSellerApplicationListQuery["sort"],
): SQL[] {
  switch (sort) {
    case SELLER_APPLICATION_SORT.CREATED_ASC:
      return [asc(sellerApplications.createdAt), asc(sellerApplications.id)];
    case SELLER_APPLICATION_SORT.CREATED_DESC:
    default:
      return [desc(sellerApplications.createdAt), asc(sellerApplications.id)];
  }
}

/**
 * Persistence-only Module 4 repository.
 * Seller ownership and lifecycle decisions stay in services; scoped reads keep the ownership predicate in SQL.
 */
export class SellersRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Creates one historical seller application using the authenticated applicant identity supplied by the service. */
  async createSellerApplication(
    input: CreateSellerApplicationRecordInput,
  ): Promise<SellerApplicationRow> {
    const values: NewSellerApplicationRow = {
      applicantUserId: input.applicantUserId,
      payloadJson: input.businessProfile,
      status: SELLER_APPLICATION_STATUS.SUBMITTED,
    };

    const [row] = await this.executor
      .insert(sellerApplications)
      .values(values)
      .returning();

    if (!row) {
      throw new Error("Seller application insert completed without returning a row.");
    }

    return row;
  }

  /** Finds the applicant's currently submitted application without touching historical decisions. */
  async findOpenSellerApplicationByApplicantUserId(
    applicantUserId: string,
  ): Promise<SellerApplicationRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellerApplications)
      .where(
        and(
          eq(sellerApplications.applicantUserId, applicantUserId),
          eq(sellerApplications.status, SELLER_APPLICATION_STATUS.SUBMITTED),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Locks one application row inside the caller's transaction before an approval/rejection decision. */
  async findSellerApplicationByIdForReview(
    applicationId: string,
  ): Promise<SellerApplicationRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellerApplications)
      .where(eq(sellerApplications.id, applicationId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Lists seller applications with bounded pagination and allow-listed review filters only. */
  async listSellerApplications(
    query: AdminSellerApplicationListQuery,
  ): Promise<PaginatedSellerApplicationRecords> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.status ? eq(sellerApplications.status, query.status) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(sellerApplications)
      .where(where)
      .orderBy(...sellerApplicationOrder(query.sort))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(sellerApplications)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Applies one review result only while the application is still in the submitted state. */
  async reviewSubmittedSellerApplication(
    applicationId: string,
    input: ReviewSellerApplicationRecordInput,
  ): Promise<SellerApplicationRow | null> {
    const [row] = await this.executor
      .update(sellerApplications)
      .set({
        status: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        reason: input.reason,
        updatedAt: input.reviewedAt,
      })
      .where(
        and(
          eq(sellerApplications.id, applicationId),
          eq(sellerApplications.status, SELLER_APPLICATION_STATUS.SUBMITTED),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Creates the seller ownership master after the service has approved the source application. */
  async createSeller(input: CreateSellerRecordInput): Promise<SellerRow> {
    const values: NewSellerRow = {
      ownerUserId: input.ownerUserId,
      legalName: input.legalName,
      displayName: input.displayName,
      taxId: input.taxId,
      status: SELLER_STATUS.ACTIVE,
      approvalStatus: SELLER_APPROVAL_STATUS.APPROVED,
      approvedAt: input.approvedAt,
    };

    const [row] = await this.executor.insert(sellers).values(values).returning();

    if (!row) {
      throw new Error("Seller insert completed without returning a row.");
    }

    return row;
  }

  /** Reads the singular seller master owned by one exact user ID. */
  async findSellerByOwnerUserId(ownerUserId: string): Promise<SellerRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellers)
      .where(eq(sellers.ownerUserId, ownerUserId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one seller by ID for explicit privileged/internal commands. */
  async findSellerById(sellerId: string): Promise<SellerRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellers)
      .where(eq(sellers.id, sellerId))
      .limit(1);

    return row ?? null;
  }

  /** Locks one seller row inside the caller's transaction before a lifecycle-sensitive write. */
  async findSellerByIdForUpdate(sellerId: string): Promise<SellerRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellers)
      .where(eq(sellers.id, sellerId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Reads one seller only when the user has an active seller_staff membership for that seller. */
  async findSellerByIdForStaffUser(
    sellerId: string,
    userId: string,
  ): Promise<SellerRow | null> {
    const [row] = await this.executor
      .select({ seller: sellers })
      .from(sellers)
      .innerJoin(
        sellerStaff,
        and(
          eq(sellerStaff.sellerId, sellers.id),
          eq(sellerStaff.userId, userId),
          eq(sellerStaff.status, SELLER_STAFF_STATUS.ACTIVE),
        ),
      )
      .where(eq(sellers.id, sellerId))
      .limit(1);

    return row?.seller ?? null;
  }

  /** Updates editable seller fields after the service has already enforced exact seller scope and permission. */
  async updateSellerProfile(
    sellerId: string,
    input: UpdateSellerProfileRecordInput,
  ): Promise<SellerRow | null> {
    const [row] = await this.executor
      .update(sellers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(sellers.id, sellerId))
      .returning();

    return row ?? null;
  }

  /** Persists a service-approved seller lifecycle state without deleting seller history. */
  async updateSellerStatus(
    sellerId: string,
    status: SellerRow["status"],
    updatedAt: Date = new Date(),
  ): Promise<SellerRow | null> {
    const [row] = await this.executor
      .update(sellers)
      .set({ status, updatedAt })
      .where(eq(sellers.id, sellerId))
      .returning();

    return row ?? null;
  }

  /** Creates one store whose seller ownership was already derived by the service. */
  async createStore(input: CreateStoreRecordInput): Promise<StoreRow> {
    const values: NewStoreRow = {
      sellerId: input.sellerId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      logoFileId: input.logoFileId,
      status: STORE_STATUS.ACTIVE,
      defaultCurrency: input.defaultCurrency,
      supportEmail: input.supportEmail,
    };

    const [row] = await this.executor.insert(stores).values(values).returning();

    if (!row) {
      throw new Error("Store insert completed without returning a row.");
    }

    return row;
  }

  /** Lists all stores owned by one seller for the authenticated seller aggregate. */
  async listStoresBySellerId(sellerId: string): Promise<StoreRow[]> {
    return this.executor
      .select()
      .from(stores)
      .where(eq(stores.sellerId, sellerId))
      .orderBy(desc(stores.createdAt), asc(stores.id));
  }

  /** Reads one store only when it belongs to the supplied seller ownership scope. */
  async findStoreByIdForSeller(
    storeId: string,
    sellerId: string,
  ): Promise<StoreRow | null> {
    const [row] = await this.executor
      .select()
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.sellerId, sellerId)))
      .limit(1);

    return row ?? null;
  }

  /** Locks one seller-owned store inside the caller's transaction before a state-changing update. */
  async findStoreByIdForSellerForUpdate(
    storeId: string,
    sellerId: string,
  ): Promise<StoreRow | null> {
    const [row] = await this.executor
      .select()
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.sellerId, sellerId)))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Reads only the store ID needed for a global slug-conflict check. */
  async findStoreIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.executor
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.slug, slug))
      .limit(1);

    return row?.id ?? null;
  }

  /** Returns only a public-safe active store owned by an active approved seller. */
  async findPublicStoreBySlug(slug: string): Promise<PublicStoreRecord | null> {
    const [row] = await this.executor
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        description: stores.description,
        logoFileId: stores.logoFileId,
        defaultCurrency: stores.defaultCurrency,
        supportEmail: stores.supportEmail,
        storeStatus: stores.status,
        sellerId: sellers.id,
        sellerDisplayName: sellers.displayName,
        sellerStatus: sellers.status,
        sellerApprovalStatus: sellers.approvalStatus,
      })
      .from(stores)
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .where(
        and(
          eq(stores.slug, slug),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Updates one store only inside the supplied seller scope. */
  async updateStoreForSeller(
    storeId: string,
    sellerId: string,
    input: UpdateStoreRecordInput,
  ): Promise<StoreRow | null> {
    const [row] = await this.executor
      .update(stores)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(stores.id, storeId), eq(stores.sellerId, sellerId)))
      .returning();

    return row ?? null;
  }

  /** Updates every store state for one seller; the service decides which transition is allowed. */
  async updateStoreStatusesForSeller(
    sellerId: string,
    status: StoreRow["status"],
    updatedAt: Date = new Date(),
  ): Promise<StoreRow[]> {
    return this.executor
      .update(stores)
      .set({ status, updatedAt })
      .where(eq(stores.sellerId, sellerId))
      .returning();
  }

  /** Creates or reactivates one seller staff membership without rewriting its original joinedAt timestamp. */
  async upsertSellerStaffMembership(
    sellerId: string,
    userId: string,
    joinedAt: Date = new Date(),
  ): Promise<SellerStaffRow> {
    const [row] = await this.executor
      .insert(sellerStaff)
      .values({
        sellerId,
        userId,
        status: SELLER_STAFF_STATUS.ACTIVE,
        joinedAt,
        updatedAt: joinedAt,
      })
      .onConflictDoUpdate({
        target: [sellerStaff.sellerId, sellerStaff.userId],
        set: {
          status: SELLER_STAFF_STATUS.ACTIVE,
          updatedAt: joinedAt,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Seller staff upsert completed without returning a row.");
    }

    return row;
  }

  /** Deactivates one active seller staff membership while preserving historical membership data. */
  async deactivateSellerStaffMembership(
    sellerId: string,
    userId: string,
    updatedAt: Date = new Date(),
  ): Promise<SellerStaffRow | null> {
    const [row] = await this.executor
      .update(sellerStaff)
      .set({ status: SELLER_STAFF_STATUS.INACTIVE, updatedAt })
      .where(
        and(
          eq(sellerStaff.sellerId, sellerId),
          eq(sellerStaff.userId, userId),
          eq(sellerStaff.status, SELLER_STAFF_STATUS.ACTIVE),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Returns reconciled active/inactive seller staff counts without exposing staff identities. */
  async getSellerStaffSummary(sellerId: string): Promise<SellerStaffSummaryRecord> {
    const [row] = await this.executor
      .select({
        totalCount: count(),
        activeCount: sql<number>`count(*) filter (where ${sellerStaff.status} = ${SELLER_STAFF_STATUS.ACTIVE})`,
        inactiveCount: sql<number>`count(*) filter (where ${sellerStaff.status} = ${SELLER_STAFF_STATUS.INACTIVE})`,
      })
      .from(sellerStaff)
      .where(eq(sellerStaff.sellerId, sellerId));

    return {
      totalCount: Number(row?.totalCount ?? 0),
      activeCount: Number(row?.activeCount ?? 0),
      inactiveCount: Number(row?.inactiveCount ?? 0),
    };
  }

  /** Resolves which role-authorized seller IDs still have active staff membership and an active approved seller master. */
  async listActiveSellerIdsForUser(
    userId: string,
    authorizedSellerIds: string[],
  ): Promise<string[]> {
    if (authorizedSellerIds.length === 0) {
      return [];
    }

    const rows = await this.executor
      .select({ sellerId: sellerStaff.sellerId })
      .from(sellerStaff)
      .innerJoin(sellers, eq(sellers.id, sellerStaff.sellerId))
      .where(
        and(
          eq(sellerStaff.userId, userId),
          inArray(sellerStaff.sellerId, authorizedSellerIds),
          eq(sellerStaff.status, SELLER_STAFF_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      )
      .orderBy(asc(sellerStaff.sellerId));

    return rows.map((row) => row.sellerId);
  }

  /** Resolves active store IDs only inside seller memberships already authorized for the user. */
  async listActiveStoreIdsForUser(
    userId: string,
    sellerIds: string[],
  ): Promise<string[]> {
    if (sellerIds.length === 0) {
      return [];
    }

    const rows = await this.executor
      .select({ storeId: stores.id })
      .from(stores)
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .innerJoin(
        sellerStaff,
        and(
          eq(sellerStaff.sellerId, stores.sellerId),
          eq(sellerStaff.userId, userId),
        ),
      )
      .where(
        and(
          inArray(stores.sellerId, sellerIds),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
          eq(sellerStaff.status, SELLER_STAFF_STATUS.ACTIVE),
        ),
      )
      .orderBy(asc(stores.id));

    return rows.map((row) => row.storeId);
  }

  /** Reads seller-application ownership metadata for the composed Module 21 resource policy. */
  async findSellerApplicationDocumentScope(
    applicationId: string,
  ): Promise<SellerApplicationDocumentScopeRecord | null> {
    const [row] = await this.executor
      .select({
        applicationId: sellerApplications.id,
        applicantUserId: sellerApplications.applicantUserId,
        status: sellerApplications.status,
      })
      .from(sellerApplications)
      .where(eq(sellerApplications.id, applicationId))
      .limit(1);

    return row ?? null;
  }

  /** Reads seller ownership/lifecycle metadata for authentication and document policy checks. */
  async findSellerDocumentScope(
    sellerId: string,
  ): Promise<SellerDocumentScopeRecord | null> {
    const [row] = await this.executor
      .select({
        sellerId: sellers.id,
        ownerUserId: sellers.ownerUserId,
        status: sellers.status,
        approvalStatus: sellers.approvalStatus,
      })
      .from(sellers)
      .where(eq(sellers.id, sellerId))
      .limit(1);

    return row ?? null;
  }

  /** Reads store-to-seller lifecycle metadata for the composed Module 21 resource policy. */
  async findStoreDocumentScope(
    storeId: string,
  ): Promise<StoreDocumentScopeRecord | null> {
    const [row] = await this.executor
      .select({
        storeId: stores.id,
        sellerId: stores.sellerId,
        storeStatus: stores.status,
        sellerStatus: sellers.status,
        sellerApprovalStatus: sellers.approvalStatus,
      })
      .from(stores)
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .where(eq(stores.id, storeId))
      .limit(1);

    return row ?? null;
  }
}
