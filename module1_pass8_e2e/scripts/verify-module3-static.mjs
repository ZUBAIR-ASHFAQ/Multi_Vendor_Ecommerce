import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");

/** Throws one focused Module 3 static-verification error. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Resolves one repository-root relative path. */
function resolve(relativePath) {
  return path.join(rootDirectory, relativePath);
}

/** Reads one UTF-8 project file. */
function read(relativePath) {
  return readFileSync(resolve(relativePath), "utf8");
}

/** Requires one file to exist in the current Module 3 delivery. */
function requireFile(relativePath) {
  assertCondition(existsSync(resolve(relativePath)), `Required Module 3 file is missing: ${relativePath}`);
}

/** Requires one source file to contain every listed verification marker. */
function requireText(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    assertCondition(source.includes(marker), `${relativePath} is missing Module 3 marker: ${marker}`);
  }
}

/** Recursively lists files below one delivery-relative directory. */
function walk(relativeDirectory) {
  const absoluteDirectory = resolve(relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDirectory)) {
    const absolute = path.join(absoluteDirectory, entry);
    const relative = path.relative(rootDirectory, absolute).replaceAll("\\", "/");
    if (statSync(absolute).isDirectory()) files.push(...walk(relative));
    else files.push(relative);
  }
  return files;
}

/** Rejects generated evidence/build artifacts and placeholder markers from the final Module 3 delivery. */
function verifyFinalCleanup() {
  const forbiddenDirectories = [
    "marketplace-backend/node_modules",
    "marketplace-backend/dist",
    "marketplace-backend/coverage",
    "marketplace-frontend/node_modules",
    "marketplace-frontend/dist",
    "marketplace-frontend/coverage",
    "marketplace-frontend/test-results",
    "marketplace-frontend/playwright-report",
  ];
  for (const directory of forbiddenDirectories) {
    assertCondition(!existsSync(resolve(directory)), `Final archive must not contain generated directory: ${directory}`);
  }

  const allFiles = [
    ...walk("marketplace-backend/src/modules/customers"),
    ...walk("marketplace-backend/tests/module3"),
    ...walk("marketplace-frontend/src/features/customers"),
    "marketplace-frontend/e2e/module3.spec.ts",
  ];
  const placeholderPattern = /\b(TODO|FIXME|HACK|XXX)\b/;
  for (const file of allFiles) {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue;
    assertCondition(!placeholderPattern.test(read(file)), `Final Module 3 source contains a placeholder marker: ${file}`);
  }

  assertCondition(
    !existsSync(resolve("docs/REMEDIATION_CONTRACT.md")),
    "Historical remediation/pass evidence must not remain in the release archive.",
  );

  for (const file of walk(".")) {
    const base = path.basename(file).toLowerCase();
    const looksLikeEvidence =
      /module[_-]?3.*(?:status|evidence|pass[_-]?evidence)/i.test(base) ||
      /pass[_-]?evidence/i.test(base);
    assertCondition(!looksLikeEvidence, `Historical pass/status evidence file should not remain: ${file}`);
  }
}

/** Verifies the completed Module 3 implementation and final E2E/release gate wiring. */
function main() {
  [
    "marketplace-backend/src/database/schema/customers.ts",
    "marketplace-backend/drizzle/0006_customer_management.sql",
    "marketplace-backend/src/modules/customers/customers.constants.ts",
    "marketplace-backend/src/modules/customers/customers.schema.ts",
    "marketplace-backend/src/modules/customers/customers.repository.ts",
    "marketplace-backend/src/modules/customers/customers.service.ts",
    "marketplace-backend/src/modules/customers/customers.controller.ts",
    "marketplace-backend/src/modules/customers/customers.routes.ts",
    "marketplace-backend/src/modules/customers/customers.routes.ts",
    "marketplace-backend/tests/module3/module3.schemas.test.ts",
    "marketplace-backend/tests/module3/module3.service.test.ts",
    "marketplace-backend/tests/module3/module3.integration.test.ts",
    "marketplace-backend/scripts/run-module3-tests.mjs",
    "marketplace-backend/scripts/verify-module3-migrations.mjs",
    "marketplace-frontend/src/features/customers/api/customers.api.ts",
    "marketplace-frontend/src/features/customers/hooks/use-customers.ts",
    "marketplace-frontend/src/features/customers/components/customer-layout.tsx",
    "marketplace-frontend/src/features/customers/components/address-card.tsx",
    "marketplace-frontend/src/features/customers/forms/customer-profile-form.tsx",
    "marketplace-frontend/src/features/customers/forms/customer-address-form.tsx",
    "marketplace-frontend/src/features/customers/forms/admin-customer-filter-form.tsx",
    "marketplace-frontend/src/features/customers/pages/customer-profile.page.tsx",
    "marketplace-frontend/src/features/customers/pages/customer-addresses.page.tsx",
    "marketplace-frontend/src/features/customers/pages/admin-customers.page.tsx",
    "marketplace-frontend/src/features/customers/pages/admin-customer-detail.page.tsx",
    "marketplace-frontend/tests/module3-customers.test.tsx",
    "marketplace-frontend/e2e/module3.spec.ts",
    "scripts/verify-module3.mjs",
  ].forEach(requireFile);

  requireText("marketplace-backend/src/modules/customers/customers.routes.ts", [
    'router.get(\n    "/me"',
    'router.patch(\n    "/me"',
    '"/me/addresses"',
    '"/me/addresses/:id"',
    "CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ",
  ]);

  const customerServiceSource = read("marketplace-backend/src/modules/customers/customers.service.ts");
  assertCondition(
    !customerServiceSource.includes("AdministrationRepository"),
    "Module 3 service must not reach directly into the Module 2 repository.",
  );
  assertCondition(
    !/from ["']\.\.\/[^"']+\/[^"']*repository\.js["']/.test(customerServiceSource),
    "Module 3 service must use service/composition contracts instead of cross-module repositories.",
  );
  requireText("marketplace-backend/src/modules/customers/customers.service.ts", [
    "RegisteredCustomerProvisionInput",
    "displayName: input.displayName",
    "input.accountType !== ACCOUNT_TYPE.CUSTOMER",
  ]);

  requireText("marketplace-backend/src/modules/customers/customers.routes.ts", [
    'operationId: "getCurrentCustomerProfile"',
    'operationId: "updateCurrentCustomerProfile"',
    'operationId: "listCurrentCustomerAddresses"',
    'operationId: "createCurrentCustomerAddress"',
    'operationId: "updateCurrentCustomerAddress"',
    'operationId: "archiveCurrentCustomerAddress"',
    'operationId: "listCustomersForAdmin"',
    'operationId: "getCustomerForAdmin"',
  ]);

  requireText("marketplace-backend/tests/module3/module3.integration.test.ts", [
    "registers a customer with one profile and the protected self-service role",
    "archives default addresses without hard deletion",
    "inside the authenticated customer scope",
    "privileged admin search/detail",
    "all eight approved customer operations in OpenAPI",
    "ADDRESS_NOT_FOUND",
  ]);

  requireText("marketplace-frontend/tests/module3-customers.test.tsx", [
    "updates the authenticated customer profile",
    "creates, changes defaults, and archives saved addresses",
    "safe conflict message",
    "permission-scoped admin detail",
    "clear permission state",
  ]);

  requireText("marketplace-frontend/e2e/module3.spec.ts", [
    "registration provisions customer self-service and profile updates survive reload",
    "address create, default switch, edit, archive, and reload preserve database state",
    "another customer's address is hidden exactly like a missing private address",
    "admin searches the customer and reads current plus archived address history",
    '"ADDRESS_NOT_FOUND"',
    '"customer_self_service"',
    "Module 11 owns customer orders",
  ]);

  requireText("marketplace-frontend/e2e/module2.spec.ts", [
    "customer registration creates a customer account with the protected self-service role",
    'page.getByText("Customer Self Service", { exact: true })',
    'page.getByRole("link", { name: "My profile" })',
    'page.getByRole("link", { name: "Address book" })',
  ]);
  assertCondition(
    !read("marketplace-frontend/e2e/module2.spec.ts").includes("No explicit role membership is assigned."),
    "Module 2 E2E still contains the stale pre-Module-3 customer-role expectation.",
  );

  requireText("marketplace-frontend/package.json", [
    '"test:module3": "vitest run tests/module3-customers.test.tsx"',
    '"test:e2e:module3": "playwright test e2e/module3.spec.ts"',
  ]);

  requireText("marketplace-backend/.github/workflows/ci.yml", [
    "Verify Module 3 clean and upgrade migrations",
    "npm run test:module3:migrations",
    "Prepare database for Module 3 tests",
    "npm run test:module3:specs",
  ]);

  requireText("scripts/verify-module3.mjs", [
    "Dependency-free Module 2 + Module 21 + Module 3 structure",
    '"test:module3:migrations"',
    '"test:module3:specs"',
    "verifyLiveImplementedOpenApi",
    '"e2e/module3.spec.ts"',
    "Post-E2E database integrity",
    "Container build regression",
    "Implemented-module full release verification completed successfully.",
  ]);

  verifyFinalCleanup();
  console.log("Module 3 static release verification passed.");
}

main();
