import { expect, test } from "@playwright/test";

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";

test.describe("Foundation end-to-end gate", () => {
  test("React application boots through the real browser router", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Marketplace", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Marketplace frontend foundation is ready." }),
    ).toBeVisible();
    await expect(page.getByText("Foundation", { exact: true })).toBeVisible();
  });

  test("client-side unknown routes render the controlled not-found screen", async ({ page }) => {
    await page.goto("/route-that-does-not-exist");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.getByRole("link", { name: "Return home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("backend liveness and readiness are reachable with canonical envelopes", async ({ request }) => {
    const health = await request.get(`${apiOrigin}/health`);
    expect(health.status()).toBe(200);
    expect(health.headers()["x-request-id"]).toBeTruthy();
    const healthBody = await health.json();
    expect(healthBody).toMatchObject({
      success: true,
      data: { status: "ok" },
    });

    const ready = await request.get(`${apiOrigin}/ready`);
    expect(ready.status()).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody).toMatchObject({
      success: true,
      data: {
        status: "ready",
        dependencies: { database: "ready", redis: "ready" },
      },
    });
  });

  test("backend unknown routes return a safe JSON error rather than HTML or internals", async ({ request }) => {
    const response = await request.get(`${apiOrigin}/api/v1/does-not-exist`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");

    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: "RESOURCE_NOT_FOUND" },
    });
    expect(body.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/stack|sql|password|token/i);
  });

  test("Foundation OpenAPI document remains available and documents health gates", async ({ request }) => {
    const response = await request.get(`${apiOrigin}/openapi.json`);
    expect(response.status()).toBe(200);

    const document = await response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/health");
    expect(document.paths).toHaveProperty("/ready");
  });
});
