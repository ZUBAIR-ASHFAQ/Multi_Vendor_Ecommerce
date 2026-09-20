import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

/** Generates opaque refresh-token material. Persistence and rotation are Module 2 concerns. */
export class RefreshTokenService {
  /** Creates a cryptographically random opaque refresh token. */
  generate(): string {
    return randomBytes(env.REFRESH_TOKEN_BYTES).toString("base64url");
  }

  /** Converts a raw refresh token into the SHA-256 representation stored in PostgreSQL. */
  hash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  /** Creates a non-secret SHA-256 family identifier used to revoke every rotated token in one family. */
  generateFamilyHash(): string {
    return createHash("sha256").update(randomBytes(32)).digest("hex");
  }
}
