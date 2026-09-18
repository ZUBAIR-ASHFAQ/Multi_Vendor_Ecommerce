import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/common/logger/logger.js";

class StringSink extends Writable {
  output = "";

  /** Captures each logger write in memory so tests can assert redaction safely. */
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
}

describe("Pino secret redaction", () => {
  it("redacts authentication, storage, payment, and payout credentials", () => {
    const sink = new StringSink();
    const testLogger = createLogger(sink);
    testLogger.level = "info";

    testLogger.info({
      req: {
        headers: {
          authorization: "Bearer should-never-appear",
          cookie: "refresh=should-never-appear",
          "stripe-signature": "should-never-appear",
          "idempotency-key": "should-never-appear",
        },
      },
      password: "should-never-appear",
      accessToken: "should-never-appear",
      clientSecret: "should-never-appear",
      client_secret: "should-never-appear",
      STRIPE_SECRET_KEY: "should-never-appear",
      STRIPE_WEBHOOK_SECRET: "should-never-appear",
      credentials: {
        accessKeyId: "should-never-appear",
        secretAccessKey: "should-never-appear",
      },
      payment: {
        cardNumber: "should-never-appear",
        cvv: "should-never-appear",
      },
      payout: {
        bankAccount: "should-never-appear",
        routingNumber: "should-never-appear",
      },
    }, "redaction-test");

    expect(sink.output).toContain("[REDACTED]");
    expect(sink.output).not.toContain("should-never-appear");
  });
});
