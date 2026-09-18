import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { env } from "../../config/env.js";
import { openApiDocument } from "./openapi.document.js";

/** Registers machine-readable OpenAPI plus Swagger UI when enabled. */
export function registerOpenApi(app: Express): void {
  if (!env.SWAGGER_ENABLED) return;

  app.get("/openapi.json", (_request, response) => {
    response.status(200).json(openApiDocument);
  });

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Marketplace API Docs",
      swaggerOptions: { persistAuthorization: false },
    }),
  );
}
