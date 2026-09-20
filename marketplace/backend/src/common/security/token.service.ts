import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import {
  accessTokenClaimsSchema,
  type AccessTokenClaims,
} from "./security.contract.js";

const encoder = new TextEncoder();

/** JWT access-token signing/verification primitive; sessions/rotation are owned by Module 2. */
export class AccessTokenService {
  private readonly secret = encoder.encode(env.JWT_ACCESS_SECRET);

  /** Signs validated access-token claims with the configured issuer and audience. */
  async sign(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      sessionId: claims.sessionId,
      actorType: claims.actorType,
      sellerId: claims.sellerId,
      permissions: claims.permissions,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.sub)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  /** Verifies and parses one signed access token into validated claims. */
  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    });

    return accessTokenClaimsSchema.parse({
      sub: payload.sub,
      sessionId: payload.sessionId,
      actorType: payload.actorType,
      sellerId: payload.sellerId ?? null,
      permissions: payload.permissions ?? [],
    });
  }
}
