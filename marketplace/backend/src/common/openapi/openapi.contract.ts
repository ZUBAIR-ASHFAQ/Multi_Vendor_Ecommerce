/** API identity shared by future Swagger/OpenAPI registration. */
export const OPENAPI_INFO = {
  title: "Multi-Vendor Marketplace API",
  version: "1.0.0",
  description: "HTTP API for the Multi-Vendor E-Commerce Marketplace.",
} as const;

/** Versioned business API prefix. Health/readiness may remain outside this prefix. */
export const API_V1_PREFIX = "/api/v1" as const;
