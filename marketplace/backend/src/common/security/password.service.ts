import argon2 from "argon2";
import { env } from "../../config/env.js";

/** Argon2id password primitive. User lifecycle/login ownership arrives in the Administration module. */
export class PasswordService {
  /** Hashes one plaintext password with the configured Argon2id cost settings. */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });
  }

  /** Verifies one candidate password against an Argon2id hash. */
  async verify(passwordHash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, candidate);
    } catch {
      return false;
    }
  }
}
