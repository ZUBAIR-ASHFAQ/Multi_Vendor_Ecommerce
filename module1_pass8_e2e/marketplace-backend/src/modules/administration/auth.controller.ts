import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { successResponse } from "../../common/utils/api-response.js";
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "../../http/cookies/refresh-cookie.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { getRequestId } from "../../http/request-id.js";
import { AUTH_ERROR_CODE } from "./auth.constants.js";
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
} from "./auth.schema.js";
import { AuthService } from "./auth.service.js";
import type { AuthClientMetadata } from "./auth.types.js";

/** Reads request metadata used for session security and audit records. */
function clientMetadata(request: Request): AuthClientMetadata {
  return {
    ipAddress: request.ip || request.socket.remoteAddress || null,
    userAgent: request.get("user-agent") ?? null,
  };
}

/** Reads the opaque refresh token from the hardened HttpOnly cookie. */
function readRefreshCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Builds the stable authentication error used when a refresh cookie is missing. */
function missingRefreshSession(): AppError {
  return new AppError({
    code: AUTH_ERROR_CODE.SESSION_NOT_FOUND,
    message: "The refresh session is invalid.",
    statusCode: 401,
  });
}

/** HTTP controller for the exact Module 2 authentication API surface. */
export class AuthController {
  /** Stores the authentication service used by this thin HTTP adapter. */
  constructor(private readonly authService: AuthService) {}

  /** Registers a customer account without accepting client-owned roles or account type. */
  register = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const input = registerBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const user = await this.authService.registerCustomer(input, requestId);
      response.status(201).json(successResponse(user, { requestId }));
    } catch (error) {
      next(error);
    }
  };

  /** Creates an access token plus HttpOnly refresh-cookie session. */
  login = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = loginBodySchema.parse(request.body);
      const requestId = getRequestId(response);
      const issued = await this.authService.login(
        input,
        clientMetadata(request),
        requestId,
      );

      response.cookie(
        REFRESH_COOKIE_NAME,
        issued.refreshToken,
        refreshCookieOptions(
          Math.max(0, issued.refreshExpiresAt.getTime() - Date.now()),
        ),
      );
      response.status(200).json(
        successResponse(
          {
            accessToken: issued.accessToken,
            expiresInSeconds: issued.expiresInSeconds,
            user: issued.user,
          },
          { requestId },
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Rotates the HttpOnly refresh cookie and returns a replacement access token. */
  refresh = async (request: Request, response: Response, next: NextFunction) => {
    try {
      refreshBodySchema.parse(request.body ?? {});
      const rawRefreshToken = readRefreshCookie(request);
      if (!rawRefreshToken) throw missingRefreshSession();

      const requestId = getRequestId(response);
      const issued = await this.authService.refresh(
        rawRefreshToken,
        clientMetadata(request),
        requestId,
      );
      response.cookie(
        REFRESH_COOKIE_NAME,
        issued.refreshToken,
        refreshCookieOptions(
          Math.max(0, issued.refreshExpiresAt.getTime() - Date.now()),
        ),
      );
      response.status(200).json(
        successResponse(
          {
            accessToken: issued.accessToken,
            expiresInSeconds: issued.expiresInSeconds,
            user: issued.user,
          },
          { requestId },
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Revokes the refresh session represented by the current cookie and clears that cookie. */
  logout = async (request: Request, response: Response, next: NextFunction) => {
    try {
      logoutBodySchema.parse(request.body ?? {});
      const requestId = getRequestId(response);
      await this.authService.logout(readRefreshCookie(request), requestId);
      response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      response.status(200).json(
        successResponse({ loggedOut: true }, { requestId }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns the current authenticated identity and effective DB-derived RBAC grants. */
  me = async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(response);
      const user = await this.authService.me(getRequestContext(response));
      response.status(200).json(successResponse(user, { requestId }));
    } catch (error) {
      next(error);
    }
  };
}
