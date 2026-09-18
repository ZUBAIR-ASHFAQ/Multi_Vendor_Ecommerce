import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type {
  CustomerAddressRow,
  CustomerProfileRow,
} from "../../database/schema/index.js";
import { withTransaction } from "../../database/transaction.js";
import type { DatabaseTransaction } from "../../database/types.js";
import {
  ACCOUNT_TYPE,
  type AccountType,
} from "../administration/administration.constants.js";
import {
  CUSTOMER_ADDRESS_STATUS,
  CUSTOMER_AUDIT_ACTION,
  CUSTOMER_ERROR_CODE,
  CUSTOMER_OUTBOX_EVENT,
  CUSTOMER_PERMISSION,
  CUSTOMER_PROFILE_STATUS,
} from "./customers.constants.js";
import {
  CustomersRepository,
  type AdminCustomerRecord,
  type UpdateCustomerAddressRecordInput,
  type UpdateCustomerProfileRecordInput,
} from "./customers.repository.js";
import type {
  AdminCustomerDetail,
  AdminCustomerListItem,
  AdminCustomerListQuery,
  CreateCustomerAddressInput,
  CustomerAddressResponse,
  CustomerProfileResponse,
  UpdateCustomerAddressInput,
  UpdateCustomerProfileInput,
} from "./customers.schema.js";

/** Transaction runner injected so service tests can verify orchestration without the root database. */
export type CustomersTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Dependencies required by the Module 3 customer application service. */
export interface CustomersServiceDependencies {
  repository?: CustomersRepository;
  transactionRunner?: CustomersTransactionRunner;
}

/** Trusted customer identity supplied by Module 2 during registration composition. */
export interface RegisteredCustomerProvisionInput {
  userId: string;
  displayName: string;
  accountType: AccountType;
  requestId?: string;
}

/** Paginated result returned to the future admin customer-list controller. */
export interface PaginatedAdminCustomersResult {
  items: AdminCustomerListItem[];
  meta: PaginationMeta;
}

interface ClearedAddressDefaults {
  shippingAddressIds: string[];
  billingAddressIds: string[];
}

/** Builds one stable Module 3 application error. */
function customerError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through wrapped causes when Drizzle preserves one. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Returns true only when an optional property was supplied by the validated caller. */
function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Module 3 service. It owns customer authorization, profile/address invariants,
 * transaction boundaries, audit writes and durable customer events.
 */
export class CustomersService {
  private readonly repository: CustomersRepository;
  private readonly transactionRunner: CustomersTransactionRunner;

  /** Stores explicit dependencies and uses production defaults only when none are supplied. */
  constructor(dependencies: CustomersServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new CustomersRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
  }

  /** Creates a service bound to an existing transaction for safe cross-module registration integration. */
  static using(transaction: DatabaseTransaction): CustomersService {
    return new CustomersService({
      repository: new CustomersRepository(transaction),
      transactionRunner: async (work) => work(transaction),
    });
  }

  /**
   * Provisions exactly one commerce profile for a server-verified Module 2 customer identity.
   * Exact repeats are safe and do not duplicate audit or outbox rows.
   */
  async provisionRegisteredCustomer(
    input: RegisteredCustomerProvisionInput,
  ): Promise<CustomerProfileResponse> {
    if (input.accountType !== ACCOUNT_TYPE.CUSTOMER) {
      throw this.customerNotFound();
    }

    return this.transactionRunner(async (tx) => {
      const repository = new CustomersRepository(tx);
      const created = await repository.createProfileIfMissing({
        userId: input.userId,
        displayName: input.displayName,
        marketingOptIn: false,
      });

      if (!created) {
        const existing = await repository.findProfileByUserId(input.userId);
        if (!existing) {
          throw new Error("Customer profile provisioning completed without a readable profile.");
        }
        return this.toProfileResponse(existing);
      }

      const safeProfile = this.toProfileResponse(created);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      await audit.record({
        actorType: ACTOR_TYPE.SYSTEM,
        action: CUSTOMER_AUDIT_ACTION.PROFILE_CREATED,
        entityType: "customer",
        entityId: created.userId,
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        after: safeProfile,
      });
      await outbox.enqueue({
        eventType: CUSTOMER_OUTBOX_EVENT.CUSTOMER_CREATED,
        aggregateType: "customer",
        aggregateId: created.userId,
        payload: {
          customerUserId: created.userId,
          createdAt: created.createdAt.toISOString(),
        },
      });

      return safeProfile;
    });
  }

  /** Reads the authenticated customer's own commerce profile. */
  async getMyProfile(context: RequestContext): Promise<CustomerProfileResponse> {
    assertPermission(context, CUSTOMER_PERMISSION.PROFILE_READ_OWN);
    const customerUserId = this.requireCustomerActor(context);
    const profile = await this.repository.findProfileByUserId(customerUserId);
    if (!profile) throw this.customerNotFound();
    return this.toProfileResponse(profile);
  }

  /** Updates only supplied self-service profile fields and emits side effects only for a real change. */
  async updateMyProfile(
    context: RequestContext,
    input: UpdateCustomerProfileInput,
  ): Promise<CustomerProfileResponse> {
    assertPermission(context, CUSTOMER_PERMISSION.PROFILE_UPDATE_OWN);
    const customerUserId = this.requireCustomerActor(context);

    return this.transactionRunner(async (tx) => {
      const repository = new CustomersRepository(tx);
      const current = await repository.findProfileByUserId(customerUserId);
      if (!current) throw this.customerNotFound();

      const changes = this.profileChanges(current, input);
      if (Object.keys(changes).length === 0) {
        return this.toProfileResponse(current);
      }

      const updated = await repository.updateProfileByUserId(customerUserId, changes);
      if (!updated) throw this.customerNotFound();

      const before = this.toProfileResponse(current);
      const after = this.toProfileResponse(updated);
      const changedFields = Object.keys(changes);
      const audit = AuditService.using(tx);
      const outbox = OutboxService.using(tx);

      await audit.record({
        actorId: customerUserId,
        actorType: context.actorType,
        action: CUSTOMER_AUDIT_ACTION.PROFILE_UPDATED,
        entityType: "customer",
        entityId: customerUserId,
        requestId: context.requestId,
        before,
        after,
        metadata: { changedFields },
      });
      await outbox.enqueue({
        eventType: CUSTOMER_OUTBOX_EVENT.CUSTOMER_UPDATED,
        aggregateType: "customer",
        aggregateId: customerUserId,
        payload: {
          customerUserId,
          changedFields,
          updatedAt: updated.updatedAt.toISOString(),
        },
      });

      return after;
    });
  }

  /** Returns one active address owned by the authenticated customer for trusted commerce integrations. */
  async resolveActiveOwnedAddress(
    context: RequestContext,
    addressId: string,
  ): Promise<CustomerAddressResponse> {
    const customerUserId = this.requireCustomerActor(context);
    const profile = await this.repository.findProfileByUserId(customerUserId);
    if (!profile || profile.status !== CUSTOMER_PROFILE_STATUS.ACTIVE) {
      throw this.customerNotFound();
    }

    const address = await this.repository.findAddressByIdForCustomer(
      addressId,
      customerUserId,
    );
    if (!address || address.status !== CUSTOMER_ADDRESS_STATUS.ACTIVE) {
      throw this.addressNotFound();
    }

    return this.toAddressResponse(address);
  }

  /** Verifies an authenticated active customer owns one active saved address without exposing address data. */
  async assertActiveOwnedAddress(
    context: RequestContext,
    addressId: string,
  ): Promise<void> {
    await this.resolveActiveOwnedAddress(context, addressId);
  }

  /** Lists active saved addresses owned by the authenticated customer. */
  async listMyAddresses(context: RequestContext): Promise<CustomerAddressResponse[]> {
    assertPermission(context, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN);
    const customerUserId = this.requireCustomerActor(context);
    await this.requireProfile(customerUserId);
    const addresses = await this.repository.listAddressesByCustomerUserId(customerUserId);
    return addresses.map((address) => this.toAddressResponse(address));
  }

  /** Creates a customer-owned address and applies requested default flags atomically. */
  async createMyAddress(
    context: RequestContext,
    input: CreateCustomerAddressInput,
  ): Promise<CustomerAddressResponse> {
    assertPermission(context, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN);
    const customerUserId = this.requireCustomerActor(context);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CustomersRepository(tx);
        const profile = await repository.findProfileByUserId(customerUserId);
        if (!profile) throw this.customerNotFound();

        const clearedDefaults = await this.clearRequestedDefaults(
          repository,
          customerUserId,
          input,
        );
        const created = await repository.createAddress({
          customerUserId,
          label: input.label,
          recipientName: input.recipientName,
          phone: input.phone,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode ?? null,
          countryCode: input.countryCode,
          isDefaultShipping: input.isDefaultShipping,
          isDefaultBilling: input.isDefaultBilling,
        });

        const safeAddress = this.toAddressResponse(created);
        await this.recordAddressChange(
          tx,
          context,
          safeAddress,
          "created",
          null,
          clearedDefaults,
        );
        return safeAddress;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.defaultAddressConflict();
      throw error;
    }
  }

  /** Updates an active customer-owned address and switches requested defaults in one transaction. */
  async updateMyAddress(
    context: RequestContext,
    addressId: string,
    input: UpdateCustomerAddressInput,
  ): Promise<CustomerAddressResponse> {
    assertPermission(context, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN);
    const customerUserId = this.requireCustomerActor(context);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new CustomersRepository(tx);
        const current = await repository.findAddressByIdForCustomer(
          addressId,
          customerUserId,
        );
        if (!current) throw this.addressNotFound();
        if (current.status !== CUSTOMER_ADDRESS_STATUS.ACTIVE) {
          throw this.addressNotFound();
        }

        const changes = this.addressChanges(current, input);
        if (Object.keys(changes).length === 0) {
          return this.toAddressResponse(current);
        }

        const clearedDefaults = await this.clearRequestedDefaults(
          repository,
          customerUserId,
          input,
        );
        // Clearing defaults also touches the current row, so explicitly restore a requested true flag.
        if (input.isDefaultShipping === true) changes.isDefaultShipping = true;
        if (input.isDefaultBilling === true) changes.isDefaultBilling = true;

        const updated = await repository.updateAddressForCustomer(
          addressId,
          customerUserId,
          changes,
        );
        if (!updated) throw this.addressNotFound();

        const before = this.toAddressResponse(current);
        const after = this.toAddressResponse(updated);
        await this.recordAddressChange(
          tx,
          context,
          after,
          "updated",
          before,
          clearedDefaults,
        );
        return after;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.defaultAddressConflict();
      throw error;
    }
  }

  /** Archives a customer-owned saved address without hard-deleting historical data. */
  async archiveMyAddress(
    context: RequestContext,
    addressId: string,
  ): Promise<{ archived: true }> {
    assertPermission(context, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN);
    const customerUserId = this.requireCustomerActor(context);

    return this.transactionRunner(async (tx) => {
      const repository = new CustomersRepository(tx);
      const current = await repository.findAddressByIdForCustomer(
        addressId,
        customerUserId,
      );
      if (!current) throw this.addressNotFound();
      if (current.status === CUSTOMER_ADDRESS_STATUS.ARCHIVED) {
        return { archived: true };
      }

      const archived = await repository.archiveAddressForCustomer(
        addressId,
        customerUserId,
      );
      if (!archived) throw this.addressNotFound();

      await this.recordAddressChange(
        tx,
        context,
        this.toAddressResponse(archived),
        "archived",
        this.toAddressResponse(current),
      );
      return { archived: true };
    });
  }

  /** Searches customers through the privileged Module 2 + Module 3 read model. */
  async searchCustomersForAdmin(
    context: RequestContext,
    query: AdminCustomerListQuery,
  ): Promise<PaginatedAdminCustomersResult> {
    assertPermission(context, CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ);
    const result = await this.repository.listCustomersForAdmin(query);
    return {
      items: result.items.map((item) => this.toAdminCustomerListItem(item)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Reads one privileged customer summary without inventing downstream order data. */
  async getCustomerSummaryForAdmin(
    context: RequestContext,
    userId: string,
  ): Promise<AdminCustomerDetail> {
    assertPermission(context, CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ);
    const customer = await this.repository.findCustomerSummaryForAdmin(userId);
    if (!customer) throw this.customerNotFound();

    const addresses = await this.repository.listAllAddressesByCustomerUserId(userId);
    return {
      customer: this.toAdminCustomerListItem(customer),
      addresses: addresses.map((address) => this.toAddressResponse(address)),
    };
  }

  /** Requires an authenticated customer actor for self-service operations. */
  private requireCustomerActor(context: RequestContext): string {
    if (!context.actorId) {
      throw customerError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) {
      throw customerError(
        ERROR_CODE.FORBIDDEN,
        "Customer self-service is not available to this actor.",
        403,
      );
    }
    return context.actorId;
  }

  /** Requires an existing customer profile without creating side effects during a read. */
  private async requireProfile(customerUserId: string): Promise<CustomerProfileRow> {
    const profile = await this.repository.findProfileByUserId(customerUserId);
    if (!profile) throw this.customerNotFound();
    return profile;
  }

  /** Clears requested defaults and returns the address IDs changed by those implicit updates. */
  private async clearRequestedDefaults(
    repository: CustomersRepository,
    customerUserId: string,
    input: {
      isDefaultShipping?: boolean | undefined;
      isDefaultBilling?: boolean | undefined;
    },
  ): Promise<ClearedAddressDefaults> {
    const shippingAddressIds =
      input.isDefaultShipping === true
        ? await repository.clearDefaultShippingForCustomer(customerUserId)
        : [];
    const billingAddressIds =
      input.isDefaultBilling === true
        ? await repository.clearDefaultBillingForCustomer(customerUserId)
        : [];

    return { shippingAddressIds, billingAddressIds };
  }

  /** Returns only profile fields that actually differ from the persisted row. */
  private profileChanges(
    current: CustomerProfileRow,
    input: UpdateCustomerProfileInput,
  ): UpdateCustomerProfileRecordInput {
    const changes: UpdateCustomerProfileRecordInput = {};
    if (input.displayName !== undefined && input.displayName !== current.displayName) {
      changes.displayName = input.displayName;
    }
    if (hasOwn(input, "phone") && input.phone !== current.phone) {
      changes.phone = input.phone ?? null;
    }
    if (
      input.marketingOptIn !== undefined &&
      input.marketingOptIn !== current.marketingOptIn
    ) {
      changes.marketingOptIn = input.marketingOptIn;
    }
    return changes;
  }

  /** Returns only address fields that actually differ from the persisted active row. */
  private addressChanges(
    current: CustomerAddressRow,
    input: UpdateCustomerAddressInput,
  ): UpdateCustomerAddressRecordInput {
    const changes: UpdateCustomerAddressRecordInput = {};
    if (input.label !== undefined && input.label !== current.label) changes.label = input.label;
    if (
      input.recipientName !== undefined &&
      input.recipientName !== current.recipientName
    ) {
      changes.recipientName = input.recipientName;
    }
    if (input.phone !== undefined && input.phone !== current.phone) changes.phone = input.phone;
    if (input.line1 !== undefined && input.line1 !== current.line1) changes.line1 = input.line1;
    if (hasOwn(input, "line2") && input.line2 !== current.line2) {
      changes.line2 = input.line2 ?? null;
    }
    if (input.city !== undefined && input.city !== current.city) changes.city = input.city;
    if (input.region !== undefined && input.region !== current.region) changes.region = input.region;
    if (hasOwn(input, "postalCode") && input.postalCode !== current.postalCode) {
      changes.postalCode = input.postalCode ?? null;
    }
    if (input.countryCode !== undefined && input.countryCode !== current.countryCode) {
      changes.countryCode = input.countryCode;
    }
    if (
      input.isDefaultShipping !== undefined &&
      input.isDefaultShipping !== current.isDefaultShipping
    ) {
      changes.isDefaultShipping = input.isDefaultShipping;
    }
    if (
      input.isDefaultBilling !== undefined &&
      input.isDefaultBilling !== current.isDefaultBilling
    ) {
      changes.isDefaultBilling = input.isDefaultBilling;
    }
    return changes;
  }

  /** Records one address write and the default rows changed implicitly by the same command. */
  private async recordAddressChange(
    tx: DatabaseTransaction,
    context: RequestContext,
    after: CustomerAddressResponse,
    change: "created" | "updated" | "archived",
    before: CustomerAddressResponse | null,
    clearedDefaults: ClearedAddressDefaults = {
      shippingAddressIds: [],
      billingAddressIds: [],
    },
  ): Promise<void> {
    const audit = AuditService.using(tx);
    const outbox = OutboxService.using(tx);
    const action =
      change === "created"
        ? CUSTOMER_AUDIT_ACTION.ADDRESS_CREATED
        : change === "archived"
          ? CUSTOMER_AUDIT_ACTION.ADDRESS_ARCHIVED
          : CUSTOMER_AUDIT_ACTION.ADDRESS_UPDATED;

    await audit.record({
      actorId: context.actorId,
      actorType: context.actorType,
      action,
      entityType: "customer_address",
      entityId: after.id,
      requestId: context.requestId,
      ...(before ? { before } : {}),
      after,
      metadata: {
        change,
        customerUserId: after.customerUserId,
        clearedDefaultShippingAddressIds: clearedDefaults.shippingAddressIds,
        clearedDefaultBillingAddressIds: clearedDefaults.billingAddressIds,
      },
    });
    await outbox.enqueue({
      eventType: CUSTOMER_OUTBOX_EVENT.CUSTOMER_ADDRESS_CHANGED,
      aggregateType: "customer",
      aggregateId: after.customerUserId,
      payload: {
        customerUserId: after.customerUserId,
        addressId: after.id,
        change,
        isDefaultShipping: after.isDefaultShipping,
        isDefaultBilling: after.isDefaultBilling,
        updatedAt: after.updatedAt,
      },
    });
  }

  /** Maps one persisted profile to the stable public Module 3 response contract. */
  private toProfileResponse(profile: CustomerProfileRow): CustomerProfileResponse {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      phone: profile.phone,
      status: profile.status as CustomerProfileResponse["status"],
      marketingOptIn: profile.marketingOptIn,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  /** Maps one persisted address to the stable public Module 3 response contract. */
  private toAddressResponse(address: CustomerAddressRow): CustomerAddressResponse {
    return {
      id: address.id,
      customerUserId: address.customerUserId,
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      isDefaultShipping: address.isDefaultShipping,
      isDefaultBilling: address.isDefaultBilling,
      status: address.status as CustomerAddressResponse["status"],
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    };
  }

  /** Maps one privileged persistence projection to the stable admin customer list shape. */
  private toAdminCustomerListItem(customer: AdminCustomerRecord): AdminCustomerListItem {
    return {
      userId: customer.userId,
      email: customer.email,
      accountStatus: customer.accountStatus as AdminCustomerListItem["accountStatus"],
      profileStatus: customer.profileStatus as AdminCustomerListItem["profileStatus"],
      displayName: customer.displayName,
      phone: customer.phone,
      marketingOptIn: customer.marketingOptIn,
      addressCount: customer.addressCount,
      createdAt: customer.createdAt.toISOString(),
    };
  }

  /** Creates the stable customer-profile not-found error. */
  private customerNotFound(): AppError {
    return customerError(
      CUSTOMER_ERROR_CODE.CUSTOMER_NOT_FOUND,
      "Customer profile was not found.",
      404,
    );
  }

  /** Uses one non-enumerating address error for missing, archived or out-of-scope self-service IDs. */
  private addressNotFound(): AppError {
    return customerError(
      CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND,
      "Customer address was not found.",
      404,
    );
  }

  /** Maps the database default-address uniqueness guard to a safe retryable conflict. */
  private defaultAddressConflict(): AppError {
    return customerError(
      ERROR_CODE.CONFLICT,
      "The default address changed concurrently. Retry the request.",
      409,
    );
  }
}
