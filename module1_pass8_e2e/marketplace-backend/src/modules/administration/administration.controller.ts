import type { NextFunction, Request, Response } from "express";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { getRequestId } from "../../http/request-id.js";
import {
  changeUserStatusBodySchema,
  createRoleBodySchema,
  replaceRolePermissionsBodySchema,
  replaceUserRoleAssignmentsBodySchema,
  roleIdParamsSchema,
  roleListQuerySchema,
  updatePlatformSettingsBodySchema,
  userIdParamsSchema,
  userListQuerySchema,
} from "./administration.schema.js";
import { AdministrationService } from "./administration.service.js";

/** HTTP controller for the exact Module 2 Administration/RBAC API surface. */
export class AdministrationController {
  /** Stores the Administration service used by this thin HTTP adapter. */
  constructor(private readonly service: AdministrationService) {}

  /** Returns a permission-scoped paginated user list. */
  listUsers = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const query = userListQuerySchema.parse(request.query);
      const requestId = getRequestId(response);
      const result = await this.service.listUsers(
        getRequestContext(response),
        query,
      );
      response.status(200).json(
        successResponse(result.items, { meta: result.meta, requestId }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Applies a controlled user lifecycle transition. */
  changeUserStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = userIdParamsSchema.parse(request.params);
      const input = changeUserStatusBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const user = await this.service.changeUserStatus(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(successResponse(user, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Atomically replaces platform or seller-scoped role memberships for one user. */
  replaceUserRoleAssignments = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = userIdParamsSchema.parse(request.params);
      const input = replaceUserRoleAssignmentsBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const user = await this.service.replaceUserRoleAssignments(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(successResponse(user, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Returns a permission-scoped paginated role list with current permissions. */
  listRoles = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const query = roleListQuerySchema.parse(request.query);
      const requestId = getRequestId(response);
      const result = await this.service.listRoles(
        getRequestContext(response),
        query,
      );
      response.status(200).json(
        successResponse(result.items, { meta: result.meta, requestId }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates a non-system custom role. */
  createRole = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const input = createRoleBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const role = await this.service.createRole(
        getRequestContext(response),
        input,
      );
      response.status(201).json(successResponse(role, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Atomically replaces permission assignments for a mutable role. */
  replaceRolePermissions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = roleIdParamsSchema.parse(request.params);
      const input = replaceRolePermissionsBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const role = await this.service.replaceRolePermissions(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(successResponse(role, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Returns allow-listed non-secret platform settings. */
  getPlatformSettings = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const requestId = getRequestId(response);
      const settings = await this.service.getPlatformSettings(
        getRequestContext(response),
      );
      response.status(200).json(successResponse(settings, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Validates and updates allow-listed non-secret platform settings. */
  updatePlatformSettings = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const input = updatePlatformSettingsBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const settings = await this.service.updatePlatformSettings(
        getRequestContext(response),
        input,
      );
      response.status(200).json(successResponse(settings, { requestId }));
    } catch (error) {
      next(error);
    }
  };
}

