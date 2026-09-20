import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiFailureSchema, apiSuccessSchema } from "../../src/common/schemas/api-envelope.schema.js";
import { decimalStringSchema, uuidSchema } from "../../src/common/schemas/primitives.schema.js";
import { failureResponse, successResponse } from "../../src/common/utils/api-response.js";

const exampleUuid = "6f827237-d697-4d2a-a750-aa1aa4bf26ed";

describe("shared boundary contracts", () => {
  it("creates and validates canonical success envelopes", () => {
    const payload = successResponse({ id: exampleUuid }, { requestId: "req-1" });
    expect(apiSuccessSchema(z.object({ id: uuidSchema })).safeParse(payload).success).toBe(true);
  });

  it("creates and validates canonical failure envelopes", () => {
    const payload = failureResponse("CONFLICT", "Conflict", { requestId: "req-2" });
    expect(apiFailureSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects public envelopes that do not contain a request ID", () => {
    expect(
      apiSuccessSchema(z.object({ id: uuidSchema })).safeParse({
        success: true,
        data: { id: exampleUuid },
      }).success,
    ).toBe(false);

    expect(
      apiFailureSchema.safeParse({
        success: false,
        error: { code: "CONFLICT", message: "Conflict" },
      }).success,
    ).toBe(false);
  });

  it("accepts UUIDs and decimal strings while rejecting unsafe money numbers", () => {
    expect(uuidSchema.safeParse(exampleUuid).success).toBe(true);
    expect(decimalStringSchema.safeParse("1234567890.1250").success).toBe(true);
    expect(decimalStringSchema.safeParse(10.25).success).toBe(false);
  });
});
