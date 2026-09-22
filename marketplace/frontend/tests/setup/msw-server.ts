import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { env } from "@/lib/env";

/** Default anonymous-session handlers keep public shell tests explicit while feature tests may override /auth/me. */
const anonymousSessionHandlers = [
  http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
    HttpResponse.json(
      {
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication is required." },
        requestId: "req-test-anonymous-me",
      },
      { status: 401 },
    ),
  ),
  http.post(`${env.VITE_API_BASE_URL}/auth/refresh`, () =>
    HttpResponse.json(
      {
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication is required." },
        requestId: "req-test-anonymous-refresh",
      },
      { status: 401 },
    ),
  ),
];

export const server = setupServer(...anonymousSessionHandlers);
