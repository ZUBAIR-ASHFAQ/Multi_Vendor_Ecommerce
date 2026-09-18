import { http, HttpResponse } from "msw";
import { apiClient } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

describe("API client", () => {
  it("normalizes the backend failure envelope", async () => {
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/test-failure`, () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: "TEST_FAILURE", message: "Expected failure" },
            requestId: "req-test",
          },
          { status: 422 },
        ),
      ),
    );

    const request = apiClient.get("/test-failure");
    await expect(request).rejects.toMatchObject<ApiClientError>({
      name: "ApiClientError",
      code: "TEST_FAILURE",
      message: "Expected failure",
      status: 422,
      requestId: "req-test",
    });
  });
});
