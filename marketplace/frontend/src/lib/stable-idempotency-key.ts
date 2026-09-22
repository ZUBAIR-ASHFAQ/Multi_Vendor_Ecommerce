/**
 * Keeps one retry key attached to one logical browser command until the server
 * confirms success. A changed command fingerprint receives a new key.
 */
export class StableIdempotencyKey {
  private pending: { fingerprint: string; key: string } | null = null;
  private readonly createKey: () => string;

  /** Creates a retry-key controller with an injectable UUID source for deterministic tests. */
  constructor(createKey: () => string = () => crypto.randomUUID()) {
    this.createKey = createKey;
  }

  /** Returns the existing key for the same logical command, or creates one for a changed command. */
  keyFor(fingerprint: string): string {
    if (this.pending?.fingerprint === fingerprint) return this.pending.key;

    const key = this.createKey();
    this.pending = { fingerprint, key };
    return key;
  }

  /** Clears a command only after the matching command has been confirmed successful. */
  complete(fingerprint: string): void {
    if (this.pending?.fingerprint === fingerprint) this.pending = null;
  }
}
