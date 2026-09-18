import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Runs the permanent dependency-free Module 13 structural verifier and surfaces its output on failure. */
function runStructuralGate() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module13-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Module 13 structural verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }

  if (result.stdout) process.stdout.write(result.stdout);
}

/** Runs the permanent completed-module source gate used before dependency-backed test execution. */
function main() {
  runStructuralGate();
  console.log("Module 13 Shipping & Fulfillment final source gate passed.");
}

main();
