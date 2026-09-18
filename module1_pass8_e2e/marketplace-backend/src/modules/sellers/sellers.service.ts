import type {
  SellerApplicationRow,
  SellerRow,
  StoreRow,
} from "../../database/schema/sellers.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import {
  assertPermission,
  assertSellerPermission,
} from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import {
  ACTOR_TYPE,
  type PermissionCode,
} from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import {
  DOCUMENT_PURPOSE,
  type DocumentPurpose,
} from "../documents-audit/documents-audit.constants.js";
import type {
  AuthorizedDocumentResource,
  DocumentResourceAction,
} from "../documents-audit/documents-audit.resource-policy.js";
import {
  SELLER_APPLICATION_STATUS,
  SELLER_APPROVAL_STATUS,
  SELLER_AUDIT_ACTION,
  SELLER_DOCUMENT_RESOURCE_TYPE,
  SELLER_ERROR_CODE,
  SELLER_OUTBOX_EVENT,
  SELLER_PERMISSION,
  SELLER_STATUS,
  STORE_STATUS,
} from "./sellers.constants.js";
import {
  sellerApplicationBusinessProfileSchema,
  type AdminSellerApplicationListQuery,
  type ApproveSellerApplicationResponse,
  type CreateStoreInput,
  type MySellerResponse,
  type PublicStoreResponse,
  type RejectSellerApplicationInput,
  type SellerApplicationResponse,
  type SellerResponse,
  type SellerStaffSummaryResponse,
  type SellerStoreResponse,
  type SubmitSellerApplicationInput,
  type SuspendSellerInput,
  type UpdateSellerProfileInput,
  type UpdateStoreInput,
} from "./sellers.schema.js";
import { SellersRepository } from "./sellers.repository.js";

/** Runs one Module 4 transaction and allows service tests to replace the real database boundary. */
export type SellersTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Upstream Module 2 operations needed by seller onboarding without importing Administration repositories. */
export interface SellerAdministrationIntegration {
  /** Converts the approved applicant into a seller account with the protected owner role in the same transaction. */
  provisionApprovedSellerOwner(input: {
    transaction: DatabaseTransaction;
    userId: string;
    sellerId: string;
    actorId: string | null;
    actorType: RequestContext["actorType"];
    requestId: string;
  }): Promise<void>;

  /** Returns whether one normalized store currency is currently enabled by Administration settings. */
  isSupportedCurrency(currency: string): Promise<boolean>;
}

/** Validates one proposed store logo through Module 21 instead of reading file tables directly. */
export type StoreAssetValidator = (
  context: RequestContext,
  fileId: string,
  purpose: DocumentPurpose,
) => Promise<void>;

/** Explicit service dependencies keep cross-module behavior visible and easy to replace in tests. */
export interface SellersServiceDependencies {
  repository?: SellersRepository;
  transactionRunner?: SellersTransactionRunner;
  administration?: SellerAdministrationIntegration | null;
  storeAssetValidator?: StoreAssetValidator | null;
}

/** Paginated seller-application queue returned to the later Administration HTTP controller. */
export interface PaginatedSellerApplicationsResult {
  items: SellerApplicationResponse[];
  meta: PaginationMeta;
}

/** Active seller/store scope resolved for one authenticated seller-role membership set. */
export interface SellerAccessScopeResult {
  sellerIds: string[];
  storeIds: string[];
}

/** Staff membership change input supplied by the Module 2 role-assignment callback. */
export interface SynchronizeSellerStaffInput {
  userId: string;
  addedSellerIds: string[];
  removedSellerIds: string[];
  actorId: string | null;
  actorType: RequestContext["actorType"];
  requestId: string;
}

/** Creates one stable Module 4 business error. */
function sellerError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Module 4 application service for seller onboarding, seller/store lifecycle and cross-module scope composition. */
export class SellersService {
  private readonly repository: SellersRepository;
  private readonly transactionRunner: SellersTransactionRunner;
  private readonly administration: SellerAdministrationIntegration | null;
  private readonly storeAssetValidator: StoreAssetValidator | null;

  /** Stores explicit dependencies so business logic stays testable and dependency direction remains visible. */
  constructor(dependencies: SellersServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new SellersRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.administration = dependencies.administration ?? null;
    this.storeAssetValidator = dependencies.storeAssetValidator ?? null;
  }

  /** Creates a transaction-bound seller service for Module 2 staff synchronization callbacks. */
  static using(transaction: DatabaseTransaction): SellersService {
    return new SellersService({
      repository: new SellersRepository(transaction),
      /** Reuses the caller's transaction instead of opening a nested transaction. */
      transactionRunner: async (work) => work(transaction),
    });
  }

  /** Submits one seller application for the authenticated user while preserving historical decisions. */
  async submitApplication(
    context: RequestContext,
    input: SubmitSellerApplicationInput,
  ): Promise<SellerApplicationResponse> {
    const actorId = this.requireApplicantActor(context);
    if (await this.repository.findSellerByOwnerUserId(actorId)) {
      throw sellerError(
        ERROR_CODE.CONFLICT,
        "This account already owns an approved seller.",
        409,
      );
    }
    if (await this.repository.findOpenSellerApplicationByApplicantUserId(actorId)) {
      throw sellerError(
        ERROR_CODE.CONFLICT,
        "A seller application is already awaiting review.",
        409,
      );
    }

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new SellersRepository(tx);
        const created = await repository.createSellerApplication({
          applicantUserId: actorId,
          businessProfile: input,
        });
        const safe = this.toApplicationResponse(created);
        await AuditService.using(tx).record({
          actorId,
          actorType: context.actorType,
          action: SELLER_AUDIT_ACTION.APPLICATION_SUBMITTED,
          entityType: SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION,
          entityId: created.id,
          requestId: context.requestId,
          after: {
            status: safe.status,
            businessProfile: safe.businessProfile,
          },
        });
        await OutboxService.using(tx).enqueue({
          eventType: SELLER_OUTBOX_EVENT.APPLICATION_SUBMITTED,
          aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION,
          aggregateId: created.id,
          payload: {
            applicationId: created.id,
            applicantUserId: actorId,
            submittedAt: created.createdAt.toISOString(),
          },
        });
        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw sellerError(
          ERROR_CODE.CONFLICT,
          "A seller application is already awaiting review.",
          409,
        );
      }
      throw error;
    }
  }

  /** Lists the bounded privileged seller-application review queue. */
  async listApplications(
    context: RequestContext,
    query: AdminSellerApplicationListQuery,
  ): Promise<PaginatedSellerApplicationsResult> {
    assertPermission(context, SELLER_PERMISSION.ADMIN_REVIEW);
    const result = await this.repository.listSellerApplications(query);
    return {
      items: result.items.map((row) => this.toApplicationResponse(row)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Approves one submitted application and atomically creates the seller owner identity, role and staff membership. */
  async approveApplication(
    context: RequestContext,
    applicationId: string,
  ): Promise<ApproveSellerApplicationResponse> {
    assertPermission(context, SELLER_PERMISSION.ADMIN_REVIEW);
    const administration = this.requireAdministrationIntegration();

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new SellersRepository(tx);
        const application = await repository.findSellerApplicationByIdForReview(
          applicationId,
        );
        if (!application) throw this.applicationNotFound();
        if (application.status !== SELLER_APPLICATION_STATUS.SUBMITTED) {
          throw sellerError(
            ERROR_CODE.CONFLICT,
            "This seller application has already been reviewed.",
            409,
          );
        }
        if (await repository.findSellerByOwnerUserId(application.applicantUserId)) {
          throw sellerError(
            ERROR_CODE.CONFLICT,
            "The applicant already owns an approved seller.",
            409,
          );
        }

        const businessProfile = sellerApplicationBusinessProfileSchema.parse(
          application.payloadJson,
        );
        const reviewedAt = new Date();
        const seller = await repository.createSeller({
          ownerUserId: application.applicantUserId,
          legalName: businessProfile.legalName,
          displayName: businessProfile.displayName,
          taxId: businessProfile.taxId ?? null,
          approvedAt: reviewedAt,
        });

        await administration.provisionApprovedSellerOwner({
          transaction: tx,
          userId: application.applicantUserId,
          sellerId: seller.id,
          actorId: context.actorId,
          actorType: context.actorType,
          requestId: context.requestId,
        });
        await repository.upsertSellerStaffMembership(
          seller.id,
          application.applicantUserId,
          reviewedAt,
        );
        const reviewed = await repository.reviewSubmittedSellerApplication(
          application.id,
          {
            status: SELLER_APPLICATION_STATUS.APPROVED,
            reviewedBy: this.requireActorId(context),
            reviewedAt,
            reason: null,
          },
        );
        if (!reviewed) {
          throw sellerError(
            ERROR_CODE.CONFLICT,
            "This seller application has already been reviewed.",
            409,
          );
        }

        const safeApplication = this.toApplicationResponse(reviewed);
        const safeSeller = this.toSellerResponse(seller);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: SELLER_AUDIT_ACTION.APPLICATION_APPROVED,
          entityType: SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION,
          entityId: reviewed.id,
          sellerId: seller.id,
          requestId: context.requestId,
          before: { status: application.status },
          after: {
            status: safeApplication.status,
            sellerId: seller.id,
          },
        });
        await OutboxService.using(tx).enqueue({
          eventType: SELLER_OUTBOX_EVENT.SELLER_APPROVED,
          aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.SELLER,
          aggregateId: seller.id,
          payload: {
            sellerId: seller.id,
            applicationId: reviewed.id,
            ownerUserId: seller.ownerUserId,
            approvedAt: reviewedAt.toISOString(),
          },
        });

        return { application: safeApplication, seller: safeSeller };
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw sellerError(
          ERROR_CODE.CONFLICT,
          "The applicant already owns an approved seller or the application was already processed.",
          409,
        );
      }
      throw error;
    }
  }

  /** Rejects one submitted application with an immutable review reason and durable seller.rejected event. */
  async rejectApplication(
    context: RequestContext,
    applicationId: string,
    input: RejectSellerApplicationInput,
  ): Promise<SellerApplicationResponse> {
    assertPermission(context, SELLER_PERMISSION.ADMIN_REVIEW);

    return this.transactionRunner(async (tx) => {
      const repository = new SellersRepository(tx);
      const application = await repository.findSellerApplicationByIdForReview(
        applicationId,
      );
      if (!application) throw this.applicationNotFound();
      if (application.status !== SELLER_APPLICATION_STATUS.SUBMITTED) {
        throw sellerError(
          ERROR_CODE.CONFLICT,
          "This seller application has already been reviewed.",
          409,
        );
      }

      const reviewedAt = new Date();
      const reviewed = await repository.reviewSubmittedSellerApplication(
        application.id,
        {
          status: SELLER_APPLICATION_STATUS.REJECTED,
          reviewedBy: this.requireActorId(context),
          reviewedAt,
          reason: input.reason.trim(),
        },
      );
      if (!reviewed) {
        throw sellerError(
          ERROR_CODE.CONFLICT,
          "This seller application has already been reviewed.",
          409,
        );
      }

      const safe = this.toApplicationResponse(reviewed);
      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: SELLER_AUDIT_ACTION.APPLICATION_REJECTED,
        entityType: SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION,
        entityId: reviewed.id,
        requestId: context.requestId,
        before: { status: application.status },
        after: { status: safe.status, reason: safe.reason },
      });
      await OutboxService.using(tx).enqueue({
        eventType: SELLER_OUTBOX_EVENT.SELLER_REJECTED,
        aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION,
        aggregateId: reviewed.id,
        payload: {
          applicationId: reviewed.id,
          applicantUserId: reviewed.applicantUserId,
          rejectedAt: reviewedAt.toISOString(),
        },
      });
      return safe;
    });
  }

  /** Returns the current authorized seller aggregate for an owner or an unambiguous single-seller staff member. */
  async getMySeller(context: RequestContext): Promise<MySellerResponse> {
    const seller = await this.resolveCurrentSeller(
      context,
      SELLER_PERMISSION.PROFILE_READ,
    );
    const [stores, staffSummary] = await Promise.all([
      this.repository.listStoresBySellerId(seller.id),
      this.repository.getSellerStaffSummary(seller.id),
    ]);
    return {
      seller: this.toSellerResponse(seller),
      stores: stores.map((store) => this.toStoreResponse(store)),
      staffSummary: this.toStaffSummaryResponse(staffSummary),
    };
  }

  /** Updates permitted seller profile fields while locking the seller against concurrent suspension. */
  async updateMySeller(
    context: RequestContext,
    input: UpdateSellerProfileInput,
  ): Promise<SellerResponse> {
    const seller = await this.resolveCurrentSeller(
      context,
      SELLER_PERMISSION.PROFILE_MANAGE,
    );

    return this.transactionRunner(async (tx) => {
      const repository = new SellersRepository(tx);
      const currentSeller = await repository.findSellerByIdForUpdate(seller.id);
      if (!currentSeller) throw this.sellerNotFound();
      this.assertSellerActive(currentSeller);

      const updated = await repository.updateSellerProfile(currentSeller.id, input);
      if (!updated) throw this.sellerNotFound();
      const safe = this.toSellerResponse(updated);
      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: SELLER_AUDIT_ACTION.PROFILE_UPDATED,
        entityType: SELLER_DOCUMENT_RESOURCE_TYPE.SELLER,
        entityId: currentSeller.id,
        sellerId: currentSeller.id,
        requestId: context.requestId,
        before: {
          legalName: currentSeller.legalName,
          displayName: currentSeller.displayName,
          taxId: currentSeller.taxId,
        },
        after: {
          legalName: safe.legalName,
          displayName: safe.displayName,
          taxId: safe.taxId,
        },
      });
      return safe;
    });
  }

  /** Creates one active store for the current approved seller using server-validated currency and optional store asset. */
  async createStore(
    context: RequestContext,
    input: CreateStoreInput,
  ): Promise<SellerStoreResponse> {
    const seller = await this.resolveCurrentSeller(
      context,
      SELLER_PERMISSION.STORE_MANAGE,
    );
    this.assertSellerActive(seller);
    await this.assertSupportedCurrency(input.defaultCurrency);
    await this.assertStoreAsset(context, input.logoFileId ?? null);

    const existingStoreId = await this.repository.findStoreIdBySlug(input.slug);
    if (existingStoreId) throw this.storeSlugTaken();

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new SellersRepository(tx);
        const currentSeller = await repository.findSellerByIdForUpdate(seller.id);
        if (!currentSeller) throw this.sellerNotFound();
        this.assertSellerActive(currentSeller);

        const created = await repository.createStore({
          sellerId: currentSeller.id,
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          logoFileId: input.logoFileId ?? null,
          defaultCurrency: input.defaultCurrency,
          supportEmail: input.supportEmail ?? null,
        });
        const safe = this.toStoreResponse(created);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: SELLER_AUDIT_ACTION.STORE_CREATED,
          entityType: SELLER_DOCUMENT_RESOURCE_TYPE.STORE,
          entityId: created.id,
          sellerId: currentSeller.id,
          requestId: context.requestId,
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          eventType: SELLER_OUTBOX_EVENT.STORE_CREATED,
          aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.STORE,
          aggregateId: created.id,
          payload: {
            storeId: created.id,
            sellerId: currentSeller.id,
            status: created.status,
            createdAt: created.createdAt.toISOString(),
          },
        });
        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.storeSlugTaken();
      throw error;
    }
  }

  /** Returns one public-safe active store and hides inactive/suspended seller resources as not found. */
  async getPublicStore(slug: string): Promise<PublicStoreResponse> {
    const store = await this.repository.findPublicStoreBySlug(slug);
    if (
      !store ||
      store.storeStatus !== STORE_STATUS.ACTIVE ||
      store.sellerStatus !== SELLER_STATUS.ACTIVE ||
      store.sellerApprovalStatus !== SELLER_APPROVAL_STATUS.APPROVED
    ) {
      throw this.storeNotFound();
    }

    return {
      id: store.id,
      slug: store.slug,
      name: store.name,
      description: store.description,
      logoFileId: store.logoFileId,
      defaultCurrency: store.defaultCurrency,
      supportEmail: store.supportEmail,
      seller: {
        id: store.sellerId,
        displayName: store.sellerDisplayName,
      },
    };
  }

  /** Updates one store inside the current seller scope; sellers may choose active/inactive but never suspended. */
  async updateStore(
    context: RequestContext,
    storeId: string,
    input: UpdateStoreInput,
  ): Promise<SellerStoreResponse> {
    const { seller, store: existing } = await this.resolveStoreSeller(
      context,
      storeId,
      SELLER_PERMISSION.STORE_MANAGE,
    );
    this.assertSellerActive(seller);

    if (input.defaultCurrency !== undefined) {
      await this.assertSupportedCurrency(input.defaultCurrency);
    }
    if (input.logoFileId !== undefined) {
      await this.assertStoreAsset(context, input.logoFileId);
    }
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const conflictingId = await this.repository.findStoreIdBySlug(input.slug);
      if (conflictingId && conflictingId !== existing.id) throw this.storeSlugTaken();
    }

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new SellersRepository(tx);

        // Lock seller first, then store. Suspension follows the same seller-first order,
        // so concurrent seller suspension cannot be overwritten by a normal store update.
        const currentSeller = await repository.findSellerByIdForUpdate(seller.id);
        if (!currentSeller) throw this.sellerNotFound();
        this.assertSellerActive(currentSeller);

        const currentStore = await repository.findStoreByIdForSellerForUpdate(
          storeId,
          currentSeller.id,
        );
        if (!currentStore) throw this.storeNotFound();
        this.assertSellerStoreEditable(currentStore);

        const updated = await repository.updateStoreForSeller(
          currentStore.id,
          currentSeller.id,
          input,
        );
        if (!updated) throw this.storeNotFound();

        const safe = this.toStoreResponse(updated);
        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: SELLER_AUDIT_ACTION.STORE_UPDATED,
          entityType: SELLER_DOCUMENT_RESOURCE_TYPE.STORE,
          entityId: updated.id,
          sellerId: currentSeller.id,
          requestId: context.requestId,
          before: this.toStoreResponse(currentStore),
          after: safe,
        });
        await OutboxService.using(tx).enqueue({
          eventType: SELLER_OUTBOX_EVENT.STORE_UPDATED,
          aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.STORE,
          aggregateId: updated.id,
          payload: {
            storeId: updated.id,
            sellerId: currentSeller.id,
            status: updated.status,
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
        return safe;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.storeSlugTaken();
      throw error;
    }
  }

  /** Suspends one approved seller and all stores without deleting seller, staff or historical rows. */
  async suspendSeller(
    context: RequestContext,
    sellerId: string,
    input: SuspendSellerInput,
  ): Promise<SellerResponse> {
    assertPermission(context, SELLER_PERMISSION.ADMIN_SUSPEND);

    return this.transactionRunner(async (tx) => {
      const repository = new SellersRepository(tx);
      const existing = await repository.findSellerByIdForUpdate(sellerId);
      if (!existing) throw this.sellerNotFound();
      if (existing.status === SELLER_STATUS.SUSPENDED) {
        return this.toSellerResponse(existing);
      }

      const now = new Date();
      const updated = await repository.updateSellerStatus(
        sellerId,
        SELLER_STATUS.SUSPENDED,
        now,
      );
      if (!updated) throw this.sellerNotFound();
      const changedStores = await repository.updateStoreStatusesForSeller(
        sellerId,
        STORE_STATUS.SUSPENDED,
        now,
      );
      const safe = this.toSellerResponse(updated);
      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: SELLER_AUDIT_ACTION.SELLER_SUSPENDED,
        entityType: SELLER_DOCUMENT_RESOURCE_TYPE.SELLER,
        entityId: sellerId,
        sellerId,
        requestId: context.requestId,
        before: { status: existing.status },
        after: { status: safe.status },
        metadata: {
          reason: input.reason ?? null,
          suspendedStoreIds: changedStores.map((store) => store.id),
        },
      });
      await OutboxService.using(tx).enqueue({
        eventType: SELLER_OUTBOX_EVENT.SELLER_SUSPENDED,
        aggregateType: SELLER_DOCUMENT_RESOURCE_TYPE.SELLER,
        aggregateId: sellerId,
        payload: {
          sellerId,
          suspendedAt: now.toISOString(),
        },
      });
      return safe;
    });
  }

  /** Locks and verifies newly assigned seller scopes before Module 2 changes role membership in the same transaction. */
  async validateAssignableSellerIds(sellerIds: string[]): Promise<void> {
    const uniqueSellerIds = Array.from(new Set(sellerIds)).sort();

    for (const sellerId of uniqueSellerIds) {
      const seller = await this.repository.findSellerByIdForUpdate(sellerId);
      if (!seller) throw this.sellerNotFound();
      this.assertSellerActive(seller);
    }
  }

  /** Synchronizes seller_staff membership with seller-scoped role additions/removals while preserving owner membership. */
  async synchronizeSellerStaff(
    input: SynchronizeSellerStaffInput,
  ): Promise<void> {
    await this.transactionRunner(async (tx) => {
      const repository = new SellersRepository(tx);
      const audit = AuditService.using(tx);

      const addedSellerIds = Array.from(new Set(input.addedSellerIds)).sort();
      const removedSellerIds = Array.from(new Set(input.removedSellerIds)).sort();

      for (const sellerId of addedSellerIds) {
        const seller = await repository.findSellerByIdForUpdate(sellerId);
        if (!seller) throw this.sellerNotFound();
        this.assertSellerActive(seller);
        const membership = await repository.upsertSellerStaffMembership(
          sellerId,
          input.userId,
        );
        await audit.record({
          actorId: input.actorId,
          actorType: input.actorType,
          action: SELLER_AUDIT_ACTION.STAFF_MEMBERSHIP_CHANGED,
          entityType: "seller_staff",
          entityId: membership.id,
          sellerId: membership.sellerId,
          requestId: input.requestId,
          after: {
            sellerId: membership.sellerId,
            userId: membership.userId,
            status: membership.status,
          },
        });
      }

      for (const sellerId of removedSellerIds) {
        const seller = await repository.findSellerById(sellerId);
        if (!seller) continue;
        if (seller.ownerUserId === input.userId) continue;
        const membership = await repository.deactivateSellerStaffMembership(
          sellerId,
          input.userId,
        );
        if (!membership) continue;
        await audit.record({
          actorId: input.actorId,
          actorType: input.actorType,
          action: SELLER_AUDIT_ACTION.STAFF_MEMBERSHIP_CHANGED,
          entityType: "seller_staff",
          entityId: membership.id,
          sellerId: membership.sellerId,
          requestId: input.requestId,
          after: {
            sellerId: membership.sellerId,
            userId: membership.userId,
            status: membership.status,
          },
        });
      }
    });
  }

  /** Resolves one active approved seller/store pair for a downstream seller-owned commerce command. */
  async resolveActiveStoreForSellerCommand(
    context: RequestContext,
    storeId: string,
    permission: PermissionCode,
  ): Promise<{ sellerId: string; storeId: string }> {
    const { seller, store } = await this.resolveStoreSeller(context, storeId, permission);

    if (
      seller.status !== SELLER_STATUS.ACTIVE ||
      seller.approvalStatus !== SELLER_APPROVAL_STATUS.APPROVED
    ) {
      throw sellerError(
        SELLER_ERROR_CODE.SELLER_NOT_APPROVED,
        "The seller is not eligible for new commerce actions.",
        409,
      );
    }
    if (store.status !== STORE_STATUS.ACTIVE) {
      throw sellerError(
        SELLER_ERROR_CODE.STORE_NOT_FOUND,
        "The store is not active for commerce.",
        409,
      );
    }

    return {
      sellerId: seller.id,
      storeId: store.id,
    };
  }

  /** Verifies an existing store still belongs to the expected active approved seller before publication. */
  async assertStoreCommerceEligible(storeId: string, sellerId: string): Promise<void> {
    const scope = await this.repository.findStoreDocumentScope(storeId);
    if (
      !scope ||
      scope.sellerId !== sellerId ||
      scope.storeStatus !== STORE_STATUS.ACTIVE ||
      scope.sellerStatus !== SELLER_STATUS.ACTIVE ||
      scope.sellerApprovalStatus !== SELLER_APPROVAL_STATUS.APPROVED
    ) {
      throw sellerError(
        SELLER_ERROR_CODE.SELLER_NOT_APPROVED,
        "The seller/store is not eligible for marketplace commerce.",
        409,
      );
    }
  }

  /** Resolves only active approved seller memberships and active stores for authentication request context. */
  async resolveAccessScopes(
    userId: string,
    authorizedSellerIds: string[],
  ): Promise<SellerAccessScopeResult> {
    const sellerIds = await this.repository.listActiveSellerIdsForUser(
      userId,
      authorizedSellerIds,
    );
    const storeIds = await this.repository.listActiveStoreIdsForUser(
      userId,
      sellerIds,
    );
    return { sellerIds, storeIds };
  }

  /** Authorizes Module 21 links for seller applications, sellers and stores without exposing seller repositories upstream. */
  async authorizeDocumentResource(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    _action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource | null> {
    if (resourceType === SELLER_DOCUMENT_RESOURCE_TYPE.APPLICATION) {
      const application = await this.repository.findSellerApplicationDocumentScope(
        resourceId,
      );
      if (!application) return null;
      if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
        return { sellerId: null };
      }
      return application.applicantUserId === context.actorId
        ? { sellerId: null }
        : null;
    }

    if (resourceType === SELLER_DOCUMENT_RESOURCE_TYPE.SELLER) {
      const seller = await this.repository.findSellerDocumentScope(resourceId);
      if (!seller) return null;
      if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
        return { sellerId: seller.sellerId };
      }
      return context.actorType === ACTOR_TYPE.SELLER &&
        context.sellerIds.has(seller.sellerId)
        ? { sellerId: seller.sellerId }
        : null;
    }

    if (resourceType === SELLER_DOCUMENT_RESOURCE_TYPE.STORE) {
      const store = await this.repository.findStoreDocumentScope(resourceId);
      if (!store) return null;
      if (context.actorType === ACTOR_TYPE.PLATFORM_ADMIN) {
        return { sellerId: store.sellerId };
      }
      return context.actorType === ACTOR_TYPE.SELLER &&
        context.sellerIds.has(store.sellerId)
        ? { sellerId: store.sellerId }
        : null;
    }

    return null;
  }

  /** Resolves the seller implied by /sellers/me and repeats seller-specific permission checks in the service. */
  private async resolveCurrentSeller(
    context: RequestContext,
    permission: PermissionCode,
  ): Promise<SellerRow> {
    const actorId = this.requireActorId(context);
    const ownedSeller = await this.repository.findSellerByOwnerUserId(actorId);
    if (ownedSeller && context.sellerIds.has(ownedSeller.id)) {
      assertSellerPermission(context, ownedSeller.id, permission);
      return ownedSeller;
    }

    if (context.sellerIds.size !== 1) {
      throw sellerError(
        SELLER_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
        "The current seller scope is unavailable or ambiguous.",
        403,
      );
    }
    const sellerId = context.sellerIds.values().next().value as string | undefined;
    if (!sellerId) throw this.sellerNotFound();
    assertSellerPermission(context, sellerId, permission);
    const staffSeller = await this.repository.findSellerByIdForStaffUser(
      sellerId,
      actorId,
    );
    if (!staffSeller) {
      throw sellerError(
        SELLER_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
        "The current seller scope is unavailable.",
        403,
      );
    }
    return staffSeller;
  }

  /** Resolves one store only through the actor's server-derived seller scopes, including multi-seller staff. */
  private async resolveStoreSeller(
    context: RequestContext,
    storeId: string,
    permission: PermissionCode,
  ): Promise<{ seller: SellerRow; store: StoreRow }> {
    const actorId = this.requireActorId(context);

    for (const sellerId of context.sellerIds) {
      const store = await this.repository.findStoreByIdForSeller(storeId, sellerId);
      if (!store) continue;

      assertSellerPermission(context, sellerId, permission);
      const seller = await this.repository.findSellerByIdForStaffUser(
        sellerId,
        actorId,
      );
      if (!seller) {
        throw sellerError(
          SELLER_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
          "The current seller scope is unavailable.",
          403,
        );
      }
      return { seller, store };
    }

    throw this.storeNotFound();
  }

  /** Resolves the stable seller owner identity used by Module 18 notification policy. */
  async resolveNotificationOwnerUserId(sellerId: string): Promise<string | null> {
    const seller = await this.repository.findSellerById(sellerId);
    return seller?.ownerUserId ?? null;
  }

  /** Verifies one seller is currently approved and active for downstream commerce rules. */
  async assertSellerCommerceEligible(sellerId: string): Promise<void> {
    const seller = await this.repository.findSellerById(sellerId);
    if (!seller) throw this.sellerNotFound();
    this.assertSellerActive(seller);
  }

  /** Resolves one active commerce store by ID without exposing seller persistence to downstream modules. */
  async resolveCommerceStoreById(
    storeId: string,
  ): Promise<{ sellerId: string; storeId: string }> {
    const scope = await this.repository.findStoreDocumentScope(storeId);
    if (
      !scope ||
      scope.storeStatus !== STORE_STATUS.ACTIVE ||
      scope.sellerStatus !== SELLER_STATUS.ACTIVE ||
      scope.sellerApprovalStatus !== SELLER_APPROVAL_STATUS.APPROVED
    ) {
      throw this.storeNotFound();
    }

    return { sellerId: scope.sellerId, storeId: scope.storeId };
  }

  /** Verifies one store currency against the current Administration-supported currency list. */
  private async assertSupportedCurrency(currency: string): Promise<void> {
    const administration = this.requireAdministrationIntegration();
    if (!(await administration.isSupportedCurrency(currency))) {
      throw sellerError(
        ERROR_CODE.INVALID_REQUEST,
        "The store currency is not supported by the marketplace.",
        400,
      );
    }
  }

  /** Validates an optional store logo through Module 21 and never queries file tables directly. */
  private async assertStoreAsset(
    context: RequestContext,
    fileId: string | null,
  ): Promise<void> {
    if (!fileId) return;
    if (!this.storeAssetValidator) {
      throw new Error("Store asset validation is not configured.");
    }
    await this.storeAssetValidator(context, fileId, DOCUMENT_PURPOSE.STORE_ASSET);
  }

  /** Rejects seller masters that are not currently approved and commercially active. */
  private assertSellerActive(seller: SellerRow): void {
    if (
      seller.approvalStatus !== SELLER_APPROVAL_STATUS.APPROVED ||
      seller.status !== SELLER_STATUS.ACTIVE
    ) {
      throw sellerError(
        SELLER_ERROR_CODE.SELLER_NOT_APPROVED,
        "The seller is not currently approved for this operation.",
        409,
      );
    }
  }

  /** Prevents normal seller commands from changing a store placed in the administrator-controlled suspended state. */
  private assertSellerStoreEditable(store: StoreRow): void {
    if (store.status === STORE_STATUS.SUSPENDED) {
      throw sellerError(
        ERROR_CODE.CONFLICT,
        "A suspended store cannot be changed through the seller store update command.",
        409,
      );
    }
  }

  /** Requires the cross-module Administration bridge only for operations that actually depend on it. */
  private requireAdministrationIntegration(): SellerAdministrationIntegration {
    if (!this.administration) {
      throw new Error("Seller Administration integration is not configured.");
    }
    return this.administration;
  }

  /** Requires a normal persisted user actor for seller-owned commands. */
  private requireApplicantActor(context: RequestContext): string {
    const actorId = this.requireActorId(context);
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) {
      throw sellerError(
        ERROR_CODE.FORBIDDEN,
        "Only a customer account can submit a seller application.",
        403,
      );
    }
    return actorId;
  }

  /** Requires a persisted actor identity for write/audit operations. */
  private requireActorId(context: RequestContext): string {
    if (!context.actorId) {
      throw sellerError(
        ERROR_CODE.UNAUTHENTICATED,
        "Authentication is required.",
        401,
      );
    }
    return context.actorId;
  }

  /** Returns the stable seller-not-found error without exposing unrelated private rows. */
  private sellerNotFound(): AppError {
    return sellerError(
      SELLER_ERROR_CODE.SELLER_NOT_FOUND,
      "The seller was not found.",
      404,
    );
  }

  /** Returns the stable store-not-found error for missing or hidden store resources. */
  private storeNotFound(): AppError {
    return sellerError(
      SELLER_ERROR_CODE.STORE_NOT_FOUND,
      "The store was not found.",
      404,
    );
  }

  /** Returns the stable store-slug conflict error. */
  private storeSlugTaken(): AppError {
    return sellerError(
      SELLER_ERROR_CODE.STORE_SLUG_TAKEN,
      "This store slug is already in use.",
      409,
    );
  }

  /** Returns a non-enumerating application lookup error for privileged review commands. */
  private applicationNotFound(): AppError {
    return sellerError(
      ERROR_CODE.RESOURCE_NOT_FOUND,
      "The seller application was not found.",
      404,
    );
  }

  /** Maps seller application persistence into the frozen safe response contract. */
  private toApplicationResponse(
    row: SellerApplicationRow,
  ): SellerApplicationResponse {
    return {
      id: row.id,
      applicantUserId: row.applicantUserId,
      businessProfile: sellerApplicationBusinessProfileSchema.parse(
        row.payloadJson,
      ),
      status: row.status as SellerApplicationResponse["status"],
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Maps a private seller row to the safe authenticated seller response. */
  private toSellerResponse(row: SellerRow): SellerResponse {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      legalName: row.legalName,
      displayName: row.displayName,
      taxId: row.taxId,
      status: row.status as SellerResponse["status"],
      approvalStatus: row.approvalStatus as SellerResponse["approvalStatus"],
      approvedAt: row.approvedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Maps one seller-owned store row to the safe authenticated store contract. */
  private toStoreResponse(row: StoreRow): SellerStoreResponse {
    return {
      id: row.id,
      sellerId: row.sellerId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      logoFileId: row.logoFileId,
      status: row.status as SellerStoreResponse["status"],
      defaultCurrency: row.defaultCurrency,
      supportEmail: row.supportEmail,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Maps reconciled staff counts to the safe /sellers/me aggregate shape. */
  private toStaffSummaryResponse(input: {
    totalCount: number;
    activeCount: number;
    inactiveCount: number;
  }): SellerStaffSummaryResponse {
    return {
      totalCount: input.totalCount,
      activeCount: input.activeCount,
      inactiveCount: input.inactiveCount,
    };
  }
}
