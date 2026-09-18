import { ApiClientError } from "@/lib/api-error";
import { createQueryClient } from "@/lib/query-client";

describe("QueryClient foundation", () => {
  it("does not retry ordinary 4xx API failures", () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;

    expect(typeof retry).toBe("function");
    if (typeof retry === "function") {
      expect(retry(0, new ApiClientError({ code: "BAD_REQUEST", message: "bad", status: 400 }))).toBe(false);
      expect(retry(0, new ApiClientError({ code: "SERVER_ERROR", message: "bad", status: 500 }))).toBe(true);
    }
  });
});
