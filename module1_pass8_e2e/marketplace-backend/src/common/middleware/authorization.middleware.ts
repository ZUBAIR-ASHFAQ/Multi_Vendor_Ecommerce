import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import { assertPermission } from "../policies/policy.js";
import type { PermissionCode } from "../security/security.contract.js";
import { getRequestContext } from "./authentication.middleware.js";

/** Creates a route-level permission precheck. Sensitive services recheck authorization as well. */
export function requirePermission(permission: PermissionCode): RequestHandler {
  return (_request: Request, response: Response, next: NextFunction) => {
    try {
      assertPermission(getRequestContext(response), permission);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Allows a route when the actor holds at least one listed server-derived permission. */
export function requireAnyPermission(
  ...permissions: PermissionCode[]
): RequestHandler {
  return (_request: Request, response: Response, next: NextFunction) => {
    try {
      const context = getRequestContext(response);
      if (!permissions.some((permission) => context.permissions.has(permission))) {
        throw new AppError({
          code: ERROR_CODE.FORBIDDEN,
          message: "You do not have permission to perform this action.",
          statusCode: 403,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
