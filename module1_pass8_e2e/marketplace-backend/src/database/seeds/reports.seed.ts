import { pathToFileURL } from "node:url";
import { closeDatabase, db } from "../db.js";
import { reportDefinitions } from "../schema/reports.js";
import { REPORT_DEFINITION_CATALOG } from "../../modules/reports/reports.constants.js";

/** Seeds the server-controlled Module 20 report definition catalog idempotently. */
export async function seedReportsCatalog(): Promise<void> {
  await db.transaction(async (tx) => {
    for (const definition of REPORT_DEFINITION_CATALOG) {
      await tx
        .insert(reportDefinitions)
        .values({
          code: definition.code,
          domain: definition.domain,
          requiredPermissions: [...definition.requiredPermissions],
          filterSchemaJson: definition.filterSchemaJson,
          outputFormats: [...definition.outputFormats],
          status: definition.status,
        })
        .onConflictDoUpdate({
          target: reportDefinitions.code,
          set: {
            domain: definition.domain,
            requiredPermissions: [...definition.requiredPermissions],
            filterSchemaJson: definition.filterSchemaJson,
            outputFormats: [...definition.outputFormats],
            status: definition.status,
            updatedAt: new Date(),
          },
        });
    }
  });
}

/** Runs the Module 20 report catalog seed from the command line. */
async function main(): Promise<void> {
  try {
    await seedReportsCatalog();
    console.log("Module 20 report definition seed completed.");
  } finally {
    await closeDatabase();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
