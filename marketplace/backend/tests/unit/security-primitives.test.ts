import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PasswordService } from "../../src/common/security/password.service.js";
import { RefreshTokenService } from "../../src/common/security/refresh-token.service.js";
import { ACTOR_TYPE, type AccessTokenClaims } from "../../src/common/security/security.contract.js";
import { AccessTokenService } from "../../src/common/security/token.service.js";

describe("security primitives", () => {
  it("hashes and verifies passwords with Argon2id", async () => {
    const service = new PasswordService();
    const hash = await service.hash("correct horse battery staple");

    expect(hash).toContain("$argon2id$");
    await expect(service.verify(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(service.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("signs and verifies access-token claims", async () => {
    const service = new AccessTokenService();
    const claims: AccessTokenClaims = {
      sub: randomUUID(),
      sessionId: randomUUID(),
      actorType: ACTOR_TYPE.PLATFORM_ADMIN,
      sellerId: null,
      permissions: ["admin.users.read"],
    };

    const token = await service.sign(claims);
    const verified = await service.verify(token);
    expect(verified).toEqual({ ...claims, permissions: ["admin.users.read"] });
  });

  it("generates opaque refresh tokens and stores only their hashes", () => {
    const service = new RefreshTokenService();
    const token = service.generate();
    const hash = service.hash(token);

    expect(token).not.toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
