import { AppError } from "../errors/app-error.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import type { RequestContext } from "../types/request-context.js";
import type { PermissionCode } from "../security/security.contract.js";

/** Throws a stable forbidden error without exposing private resource details. */
function forbidden(message: string): AppError {
  return new AppError({
    code: ERROR_CODE.FORBIDDEN,
    message,
    statusCode: 403,
  });
}

/** Enforces one server-derived effective permission. */
export function assertPermission(
  context: RequestContext,
  permission: PermissionCode,
): void {
  if (!context.permissions.has(permission)) {
    throw forbidden("You do not have permission to perform this action.");
  }
}

/** Enforces membership in one seller scope; platform administrators may cross seller scopes. */
function assertSellerScope(
  context: RequestContext,
  sellerId: string,
): void {
  if (context.actorType === "platform_admin") {
    return;
  }

  if (!context.sellerIds.has(sellerId)) {
    throw forbidden("The requested resource is outside your seller scope.");
  }
}

/**
 * Enforces a permission inside one seller scope.
 * This prevents a permission granted for Seller A from authorizing an action for Seller B.
 */
export function assertSellerPermission(
  context: RequestContext,
  sellerId: string,
  permission: PermissionCode,
): void {
  if (context.actorType === "platform_admin") {
    assertPermission(context, permission);
    return;
  }

  assertSellerScope(context, sellerId);
  const permissions = context.sellerPermissions.get(sellerId);
  if (!permissions?.has(permission)) {
    throw forbidden("You do not have permission to perform this seller action.");
  }
}
