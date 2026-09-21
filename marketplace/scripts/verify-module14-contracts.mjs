import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one repository file as UTF-8 text for dependency-free structural assertions. */
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

/** Fails when required contract text is missing from a source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Verifies that Pass 2 freezes only the approved Module 14 boundary constants and schemas. */
function verifyContracts() {
  const constants = read(
    "backend/src/modules/returns-refunds/returns-refunds.constants.ts",
  );
  const schemas = read(
    "backend/src/modules/returns-refunds/returns-refunds.schema.ts",
  );

  for (const value of [
    'REQUESTED: "requested"',
    'APPROVED: "approved"',
    'REJECTED: "rejected"',
    'RECEIVED: "received"',
    'CLOSED: "closed"',
    'CREATE_OWN: "returns.create_own"',
    'READ_OWN: "returns.read_own"',
    'SELLER_MANAGE: "seller.returns.manage"',
    'ADMIN_MANAGE: "admin.returns.manage"',
    'ADMIN_REFUNDS_ISSUE: "admin.refunds.issue"',
    'NOT_ELIGIBLE: "RETURN_NOT_ELIGIBLE"',
    'WINDOW_EXPIRED: "RETURN_WINDOW_EXPIRED"',
    'STATUS_INVALID: "RETURN_STATUS_INVALID"',
    'REFUND_DUPLICATE: "REFUND_DUPLICATE"',
    'SCOPE_FORBIDDEN: "RETURN_SCOPE_FORBIDDEN"',
  ]) {
    requireText(constants, value, "Module 14 constants");
  }

  for (const contract of [
    "createReturnRequestBodySchema",
    "customerReturnListQuerySchema",
    "sellerReturnListQuerySchema",
    "adminReturnListQuerySchema",
    "approveReturnBodySchema",
    "rejectReturnBodySchema",
    "receiveReturnBodySchema",
    "issueReturnRefundBodySchema",
    "returnRequestResponseSchema",
    "returnStatusHistoryResponseSchema",
    "returnRefundResultSchema",
  ]) {
    requireText(schemas, contract, "Module 14 Zod contracts");
  }

  requireText(schemas, ".strict()", "Module 14 Zod contracts");
  requireText(
    schemas,
    "restock quantity and refund money remain server-derived",
    "Module 14 receive boundary",
  );
  requireText(
    schemas,
    "excludes amount, currency, payment ID, and seller ownership",
    "Module 14 refund boundary",
  );
  requireText(
    schemas,
    "history: z.array(returnStatusHistoryResponseSchema).optional()",
    "Module 14 additive Return history response contract",
  );
}

verifyContracts();
console.log("Module 14 contract verification passed.");
