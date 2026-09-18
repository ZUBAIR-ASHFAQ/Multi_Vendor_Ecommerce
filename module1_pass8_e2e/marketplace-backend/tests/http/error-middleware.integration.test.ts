import express from "express";
import request from "supertest";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { errorMiddleware } from "../../src/common/middleware/error.middleware.js";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware.js";

/** Creates a small Express app that exercises each global error-middleware branch. */
function createErrorFixture() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  app.get("/zod", (_request, _response) => {
    z.object({ id: z.string().uuid() }).parse({ id: "bad" });
  });

  app.get("/business", (_request, _response) => {
    throw new AppError({
      code: "TEST_CONFLICT",
      message: "A safe business conflict occurred.",
      statusCode: 409,
      details: { field: "test" },
    });
  });

  app.get("/unknown", (_request, _response) => {
    throw new Error("secret internal database detail");
  });

  app.use(errorMiddleware);
  return app;
}

describe("global error middleware", () => {
  it("maps Zod validation failures to field-safe 422 responses", async () => {
    const response = await request(createErrorFixture()).get("/zod").expect(422);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(response.body.error.fieldErrors[0].path).toBe("id");
  });

  it("preserves safe AppError codes/details", async () => {
    const response = await request(createErrorFixture()).get("/business").expect(409);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "TEST_CONFLICT",
        message: "A safe business conflict occurred.",
        details: { field: "test" },
      },
    });
  });

  it("does not leak unknown exception messages or stacks", async () => {
    const response = await request(createErrorFixture()).get("/unknown").expect(500);
    const publicBody = JSON.stringify(response.body);
    expect(publicBody).not.toContain("secret internal database detail");
    expect(publicBody).not.toContain("Error:");
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});
