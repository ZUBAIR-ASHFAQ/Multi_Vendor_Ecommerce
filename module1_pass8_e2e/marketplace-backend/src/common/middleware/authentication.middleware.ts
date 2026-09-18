import type { NextFunction, Request, Response, RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import { ACTOR_TYPE } from "../security/security.contract.js";
import type { RequestContext } from "../types/request-context.js";
import { AuthService } from "../../modules/administration/auth.service.js";
import { getRequestId } from "../../http/request-id.js";

const REQUEST_CONTEXT_LOCAL = "requestContext" as const;

let runtimeAuthService = new AuthService();

/** Creates the stable 401 error used by protected routes. */
function unauthenticated(): AppError {
  return new AppError({
    code: ERROR_CODE.UNAUTHENTICATED,
    message: "Authentication is required.",
    statusCode: 401,
  });
}

/** Extracts one optional well-formed bearer token and rejects malformed authorization headers. */
function optionalBearerToken(request: Request): string | null {
  const authorization = request.header("authorization");
  if (!authorization) return null;

  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length > 0) {
    throw unauthenticated();
  }
  return token;
}

/** Extracts one required well-formed bearer token from the Authorization header. */
function bearerToken(request: Request): string {
  const token = optionalBearerToken(request);
  if (!token) throw unauthenticated();
  return token;
}

/** Stores the server-derived request context in Express response locals. */
function setRequestContext(response: Response, context: RequestContext): void {
  response.locals[REQUEST_CONTEXT_LOCAL] = context;
}

/** Reads the optional authenticated request context established by optional authentication. */
export function getOptionalRequestContext(response: Response): RequestContext | null {
  const value = response.locals[REQUEST_CONTEXT_LOCAL] as RequestContext | undefined;
  return value ?? null;
}

/** Reads the authenticated request context established by authenticationMiddleware. */
export function getRequestContext(response: Response): RequestContext {
  const value = getOptionalRequestContext(response);
  if (!value) throw unauthenticated();
  return value;
}

/** Stores a trusted system request context after internal-service authentication succeeds. */
export function setSystemRequestContext(
  response: Response,
  requestId: string,
): void {
  setRequestContext(response, {
    requestId,
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  });
}

/** Creates access-token middleware with an injectable AuthService for isolated tests. */
export function createAuthenticationMiddleware(
  authService: AuthService = new AuthService(),
): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = bearerToken(request);
      const authenticated = await authService.authenticateAccessToken(
        token,
        getRequestId(response),
      );
      setRequestContext(response, authenticated.context);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Configures the composed authentication service used by all default protected routers. */
export function configureAuthenticationService(authService: AuthService): void {
  runtimeAuthService = authService;
}

/** Uses the currently composed authentication service so downstream scope resolvers apply everywhere. */
export const authenticationMiddleware: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const token = bearerToken(request);
    const authenticated = await runtimeAuthService.authenticateAccessToken(
      token,
      getRequestId(response),
    );
    setRequestContext(response, authenticated.context);
    next();
  } catch (error) {
    next(error);
  }
};

/** Optionally authenticates a bearer token while allowing requests with no Authorization header. */
export const optionalAuthenticationMiddleware: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const token = optionalBearerToken(request);
    if (!token) {
      next();
      return;
    }

    const authenticated = await runtimeAuthService.authenticateAccessToken(
      token,
      getRequestId(response),
    );
    setRequestContext(response, authenticated.context);
    next();
  } catch (error) {
    next(error);
  }
};
