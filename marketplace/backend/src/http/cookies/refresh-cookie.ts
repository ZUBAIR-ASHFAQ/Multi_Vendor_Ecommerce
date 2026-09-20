import type { CookieOptions } from "express";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "marketplace_refresh" as const;

/** Central refresh-cookie policy consumed by Module 2 when session endpoints are implemented. */
export function refreshCookieOptions(maxAgeMs?: number): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: "/api/v1/auth",
  };

  if (env.COOKIE_DOMAIN) options.domain = env.COOKIE_DOMAIN;
  if (maxAgeMs !== undefined) options.maxAge = maxAgeMs;
  return options;
}
