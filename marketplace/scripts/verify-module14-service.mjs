import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required source file and reports a focused Module 14 Pass 4 error when it is missing. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Module 14 Pass 4 file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

/** Fails when one required service-contract fragment is absent. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Fails when a later-pass file appears before the current cumulative verification allows it. */
function requireAbsent(relativePath) {
  if (fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Module 14 later-pass file must remain absent at this stage: ${relativePath}`);
  }
}

/** Confirms the approved executable patch now freezes the previously blocked partial-Commission contract. */
function verifyApprovedPatch() {
  const patch = read("REQUIREMENTS_PATCH_0009.md");
  for (const expected of [
    "Status: APPROVED",
    "Approved partial Commission reversal contract",
    "currentRefundQuantity",
    "cumulativeRefundQuantity",
    "currentRefundAmount",
    "round_half_up",
    "The owner instruction to proceed with Module 14 Pass 4 approves",
  ]) {
    requireText(patch, expected, "Requirements Patch 0009");
  }

  if (fs.existsSync(path.join(root, "REQUIREMENTS_PATCH_0009_PROPOSED.md"))) {
    throw new Error("The obsolete proposed Patch 0009 copy must not remain after Pass 4 approval.");
  }
}

/** Confirms the Module 14 service owns business decisions while calling only narrow prerequisite service boundaries. */
function verifyReturnsService() {
  const service = read(
    "marketplace-backend/src/modules/returns-refunds/returns-refunds.service.ts",
  );

  for (const expected of [
    "export class ReturnsRefundsService",
    "createReturnRequest(",
    "listCustomerReturns(",
    "listSellerReturns(",
    "listAdminReturns(",
    "approveReturn(",
    "rejectReturn(",
    "receiveReturn(",
    "repository.listStatusHistory(",
    "history: history.map((entry)",
    "issueRefund(",
    "getReturnWindowDays()",
    "getReturnSnapshot(",
    "getReturnDeliverySnapshot(",
    "lockReturnAllocations(",
    "sumNonRejectedReturnQuantities(",
    "RETURN_REQUEST_STATUS.REQUESTED",
    "RETURN_REQUEST_STATUS.APPROVED",
    "RETURN_REQUEST_STATUS.REJECTED",
    "RETURN_REQUEST_STATUS.RECEIVED",
    "RETURN_REQUEST_STATUS.CLOSED",
    "RETURNS_ERROR_CODE.WINDOW_EXPIRED",
    "RETURNS_ERROR_CODE.NOT_ELIGIBLE",
    "RETURNS_ERROR_CODE.REFUND_DUPLICATE",
    "payments.refundPayment(",
    "commissions.adjustPartialRefund(",
    "inventory.restockStock(",
    "paymentRefundSourceKey(",
    "commissionRefundSourceKey(",
    "restockSourceKey(",
    "divideHalfUp(",
    "idempotencyUsingTransaction(transaction).complete(",
    "auditUsingTransaction(transaction).record(",
    "outboxUsingTransaction(transaction).enqueue(",
  ]) {
    requireText(service, expected, "Module 14 service");
  }

  for (const forbidden of [
    "OrdersRepository",
    "PaymentsRepository",
    "InventoryRepository",
    "CommissionsRepository",
    "ShippingRepository",
    "parseFloat(",
    "Math.round(",
  ]) {
    if (service.includes(forbidden)) {
      throw new Error(`Module 14 service bypasses an approved boundary or exact-money rule: ${forbidden}`);
    }
  }
}

/** Confirms each prerequisite exposes only the minimum system-only behavior needed by Return orchestration. */
function verifyPrerequisiteBoundaries() {
  const administrationConstants = read(
    "marketplace-backend/src/modules/administration/administration.constants.ts",
  );
  const administrationService = read(
    "marketplace-backend/src/modules/administration/administration.service.ts",
  );
  const orders = read("marketplace-backend/src/modules/orders/orders.service.ts");
  const shippingRepository = read(
    "marketplace-backend/src/modules/shipping/shipping.repository.ts",
  );
  const shipping = read("marketplace-backend/src/modules/shipping/shipping.service.ts");
  const payments = read("marketplace-backend/src/modules/payments/payments.service.ts");
  const inventoryConstants = read(
    "marketplace-backend/src/modules/inventory/inventory.constants.ts",
  );
  const inventoryRepository = read(
    "marketplace-backend/src/modules/inventory/inventory.repository.ts",
  );
  const inventory = read("marketplace-backend/src/modules/inventory/inventory.service.ts");
  const commissionSchema = read(
    "marketplace-backend/src/modules/commissions/commissions.schema.ts",
  );
  const commissions = read(
    "marketplace-backend/src/modules/commissions/commissions.service.ts",
  );

  requireText(administrationConstants, 'RETURNS_WINDOW_DAYS: "returns.window_days"', "Administration settings");
  requireText(administrationService, "async getReturnWindowDays()", "Administration service");
  requireText(orders, "async getReturnSnapshot(", "Orders service");
  requireText(orders, "Internal Return Order access is required.", "Orders service");
  requireText(shippingRepository, "listDeliveredItemsForOrder(", "Shipping repository");
  requireText(shipping, "async getReturnDeliverySnapshot(", "Shipping service");
  requireText(shipping, "Internal Return Shipping access is required.", "Shipping service");
  requireText(payments, "async getReturnRefundSnapshot(", "Payments service");
  requireText(payments, "Internal Return Payment access is required.", "Payments service");
  requireText(inventoryConstants, 'RESTOCKED: "inventory.restocked"', "Inventory constants");
  requireText(inventoryConstants, 'RETURN: "return"', "Inventory constants");
  requireText(inventoryRepository, "increaseOnHandQuantity(", "Inventory repository");
  requireText(inventory, "async restockStock(", "Inventory service");
  requireText(inventory, "STOCK_MOVEMENT_TYPE.RESTOCK", "Inventory service");
  requireText(inventory, "INVENTORY_SOURCE_TYPE.RETURN", "Inventory service");
  requireText(commissionSchema, "internalCommissionPartialRefundAdjustBodySchema", "Commission contracts");
  requireText(commissions, "async adjustPartialRefund(", "Commission service");
  requireText(commissions, "allocateSignedComponent(", "Commission service");
  requireText(commissions, "Partial Commission allocation does not reconcile to the provider refund amount.", "Commission service");
}

verifyApprovedPatch();
verifyReturnsService();
verifyPrerequisiteBoundaries();
console.log("Module 14 cumulative service verification passed.");
