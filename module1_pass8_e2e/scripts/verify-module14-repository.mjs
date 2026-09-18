import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required project file and reports a useful error when it is missing. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Module 14 repository file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

/** Fails when a required repository contract fragment is missing. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms Pass 3 adds scoped Drizzle persistence without moving business decisions into the repository. */
function verifyRepository() {
  const repository = read(
    "marketplace-backend/src/modules/returns-refunds/returns-refunds.repository.ts",
  );

  for (const expected of [
    "export class ReturnsRefundsRepository",
    "using(executor: DatabaseExecutor)",
    "listCustomerReturns",
    "listSellerReturns",
    "listAdminReturns",
    "lockReturnById",
    "lockReturnInSellerScope",
    "lockReturnAllocations",
    "sumNonRejectedReturnQuantities",
    "createReturnRequest",
    "createReturnItems",
    "listReturnItems",
    "lockReturnItems",
    "listReturnItemFinancialHistory",
    "updateReturnStatus",
    "updateReturnItemResolution",
    "updateReturnItemRefund",
    "appendStatusHistory",
    "listStatusHistory",
    "findRefundByIdempotencyKey",
    "listRefundsForReturn",
    "createRefundIfMissing",
    "updateRefundResult",
    "pg_advisory_xact_lock",
    "sellerScopeCondition(scope)",
    "RETURN_REQUEST_STATUS.REJECTED",
  ]) {
    requireText(repository, expected, "Module 14 repository");
  }

  for (const forbidden of [
    "PaymentsService",
    "InventoryService",
    "CommissionsService",
    "ShippingService",
    "refundPayment(",
    "restockStock(",
    "adjustCommission",
    "Math.round(",
    "parseFloat(",
    "Number(input.amount",
    "appendDisputeNote",
    "listDisputeNotes",
  ]) {
    if (repository.includes(forbidden)) {
      throw new Error(`Module 14 repository contains service/business behavior: ${forbidden}`);
    }
  }
}

verifyRepository();
console.log("Module 14 cumulative repository verification passed.");
