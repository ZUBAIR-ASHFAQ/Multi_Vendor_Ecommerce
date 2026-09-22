import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendSource = path.join(root, "frontend", "src");

/** Recursively returns frontend TypeScript source files. */
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const filePath = path.join(directory, name);
    if (statSync(filePath).isDirectory()) return sourceFiles(filePath);
    return /\.(?:ts|tsx)$/u.test(name) ? [filePath] : [];
  });
}

/** Prevents event handlers from discarding rejecting mutation promises. */
function verifyNoDiscardedMutationPromises() {
  const forbidden = [
    /void\s+[\w.$]+\.mutateAsync\s*\(/gu,
    /void\s+[\w.$]+\s*\n\s*\.mutateAsync\s*\(/gu,
  ];

  const failures = [];
  for (const filePath of sourceFiles(frontendSource)) {
    const source = readFileSync(filePath, "utf8");
    if (forbidden.some((pattern) => pattern.test(source))) {
      failures.push(path.relative(root, filePath));
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Frontend event handlers must use mutate callbacks instead of discarding mutateAsync promises: ${failures.join(", ")}`,
    );
  }
}

/** Confirms the known interactive flows use mutation callbacks for success-only navigation/local updates. */
function verifyKnownFlows() {
  const expected = [
    [
      "frontend/src/features/auth/pages/account.page.tsx",
      "logout.mutate(undefined, {",
    ],
    [
      "frontend/src/features/administration/components/admin-layout.tsx",
      "logout.mutate(undefined, {",
    ],
    [
      "frontend/src/features/orders/pages/seller-order-detail.page.tsx",
      "onClick={() => accept.mutate()}",
    ],
    [
      "frontend/src/features/documents-audit/components/linked-file-list.tsx",
      "unlink.mutate(",
    ],
    [
      "frontend/src/features/reports/components/report-export-controls.tsx",
      "createRun.mutate(",
    ],
  ];

  for (const [relativePath, snippet] of expected) {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    if (!source.includes(snippet)) {
      throw new Error(`${relativePath} is missing safe mutation callback pattern: ${snippet}`);
    }
  }
}

verifyNoDiscardedMutationPromises();
verifyKnownFlows();
console.log("Frontend mutation-safety verification passed.");
