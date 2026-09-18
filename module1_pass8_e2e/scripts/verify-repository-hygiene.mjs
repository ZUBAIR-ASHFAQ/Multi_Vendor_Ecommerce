import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendSrc = path.join(root, "marketplace-backend", "src");

const expectedRepositories = [
  "common/audit/audit.repository.ts",
  "common/idempotency/idempotency.repository.ts",
  "common/outbox/outbox.repository.ts",
  "modules/administration/administration.repository.ts",
  "modules/administration/auth.repository.ts",
  "modules/customers/customers.repository.ts",
  "modules/sellers/sellers.repository.ts",
  "modules/catalog-taxonomy/catalog-taxonomy.repository.ts",
  "modules/products/products.repository.ts",
  "modules/inventory/inventory.repository.ts",
  "modules/cart-wishlist/cart-wishlist.repository.ts",
  "modules/promotions/promotions.repository.ts",
  "modules/checkout/checkout.repository.ts",
  "modules/orders/orders.repository.ts",
  "modules/payments/payments.repository.ts",
  "modules/shipping/shipping.repository.ts",
  "modules/returns-refunds/returns-refunds.repository.ts",
  "modules/reviews/reviews.repository.ts",
  "modules/commissions/commissions.repository.ts",
  "modules/seller-wallet-payouts/seller-wallet-payouts.repository.ts",
  "modules/notifications/notifications.repository.ts",
  "modules/search-discovery/search-discovery.repository.ts",
  "modules/reports/reports.repository.ts",
  "modules/dashboard/dashboard.repository.ts",
  "modules/documents-audit/documents-audit.repository.ts",
];

/** Returns every file below one directory in deterministic path order. */
function listFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

/** Reads one UTF-8 source file. */
function read(absolutePath) {
  return fs.readFileSync(absolutePath, "utf8");
}

/** Returns the previous non-empty source line before one character offset. */
function previousNonEmptyLine(source, offset) {
  const lines = source.slice(0, offset).split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return "";
}

/** Extracts normal class methods from the project's repository formatting convention. */
function repositoryMethods(source) {
  const methods = [];
  const pattern = /^  (?:(?:public|private|protected)\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)(?:<[^>\n]+>)?\s*\(/gmu;

  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!name || ["if", "for", "while", "switch", "catch"].includes(name)) continue;
    methods.push({ name, offset: match.index ?? 0 });
  }

  return methods;
}

/** Extracts named free functions from one repository source file. */
function repositoryFunctions(source) {
  const functions = [];
  const pattern = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)(?:<[^>\n]+>)?\s*\(/gmu;

  for (const match of source.matchAll(pattern)) {
    if (match[1]) functions.push({ name: match[1], offset: match.index ?? 0 });
  }

  return functions;
}

/** Confirms every expected repository file exists and no unexpected repository file is hidden elsewhere. */
function verifyRepositoryInventory(repositoryFiles) {
  const relativeFiles = repositoryFiles.map((file) => path.relative(backendSrc, file).replaceAll("\\", "/"));

  for (const expected of expectedRepositories) {
    if (!relativeFiles.includes(expected)) {
      throw new Error(`Required repository file is missing: ${expected}`);
    }
  }

  if (relativeFiles.length !== expectedRepositories.length) {
    const extras = relativeFiles.filter((file) => !expectedRepositories.includes(file));
    throw new Error(`Unexpected repository files found: ${extras.join(", ") || relativeFiles.length}`);
  }
}

/** Prevents repositories from importing HTTP or service layers and prevents controllers from bypassing services. */
function verifyLayerBoundaries(repositoryFiles, controllerFiles) {
  for (const file of repositoryFiles) {
    const source = read(file);
    const importSources = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1] ?? "");
    const forbidden = importSources.filter((value) =>
      value.includes(".service") ||
      value.includes(".controller") ||
      value.includes(".routes") ||
      value.includes(".repository") ||
      value === "express" ||
      value.startsWith("express/"),
    );

    if (forbidden.length > 0) {
      throw new Error(`${path.relative(root, file)} imports a higher HTTP/service layer: ${forbidden.join(", ")}`);
    }
  }

  for (const file of controllerFiles) {
    const source = read(file);
    const importSources = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1] ?? "");
    const forbidden = importSources.filter((value) => value.includes(".repository") || value.includes("/database/"));

    if (forbidden.length > 0) {
      throw new Error(`${path.relative(root, file)} bypasses its service boundary: ${forbidden.join(", ")}`);
    }
  }
}

/** Requires a purpose comment immediately before every repository method and named helper function. */
function verifyRepositoryComments(repositoryFiles) {
  for (const file of repositoryFiles) {
    const source = read(file);
    const declarations = [...repositoryMethods(source), ...repositoryFunctions(source)];

    for (const declaration of declarations) {
      const previousLine = previousNonEmptyLine(source, declaration.offset);
      if (!previousLine.endsWith("*/") && !previousLine.startsWith("//")) {
        throw new Error(`${path.relative(root, file)}:${declaration.name} is missing a purpose comment.`);
      }
    }
  }
}

/** Fails when a named repository helper function is declared but never called in its own repository file. */
function verifyNoDeadRepositoryHelpers(repositoryFiles) {
  for (const file of repositoryFiles) {
    const source = read(file);
    for (const helper of repositoryFunctions(source)) {
      const callPattern = new RegExp(`\\b${helper.name}\\s*\\(`, "gu");
      const usageCount = [...source.matchAll(callPattern)].length;
      if (usageCount <= 1) {
        throw new Error(`${path.relative(root, file)}:${helper.name} is an unused repository helper and should be removed.`);
      }
    }
  }
}

/** Fails when a public repository method has no production caller in backend source code. */
function verifyNoDeadRepositoryMethods(repositoryFiles, backendSourceFiles) {
  const productionSources = backendSourceFiles.map((file) => read(file));

  for (const file of repositoryFiles) {
    const repositorySource = read(file);
    for (const method of repositoryMethods(repositorySource)) {
      if (["constructor", "using"].includes(method.name)) continue;

      const callPattern = new RegExp(`\\.${method.name}\\s*\\(`, "gu");
      const usageCount = productionSources.reduce(
        (count, source) => count + [...source.matchAll(callPattern)].length,
        0,
      );

      if (usageCount === 0) {
        throw new Error(`${path.relative(root, file)}:${method.name} has no production caller and should be removed or justified.`);
      }
    }
  }
}

/** Runs the permanent repository-layer hygiene contract for the complete marketplace backend. */
function main() {
  const allBackendSourceFiles = listFiles(backendSrc).filter((file) => file.endsWith(".ts"));
  const repositoryFiles = allBackendSourceFiles.filter((file) => file.endsWith(".repository.ts"));
  const controllerFiles = allBackendSourceFiles.filter((file) => file.endsWith(".controller.ts"));

  verifyRepositoryInventory(repositoryFiles);
  verifyLayerBoundaries(repositoryFiles, controllerFiles);
  verifyRepositoryComments(repositoryFiles);
  verifyNoDeadRepositoryHelpers(repositoryFiles);
  verifyNoDeadRepositoryMethods(repositoryFiles, allBackendSourceFiles);

  console.log(`Repository hygiene verification passed for ${repositoryFiles.length} repository files.`);
}

main();
