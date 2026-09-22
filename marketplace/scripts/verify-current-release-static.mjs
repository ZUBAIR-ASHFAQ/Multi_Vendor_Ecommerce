import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Runs one dependency-free release verifier and surfaces its complete failure output. */
function runGate(scriptName) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }

  if (result.stdout) process.stdout.write(result.stdout);
}


/** Runs one independent project's dependency-free release verifier from the delivery root. */
function runProjectGate(projectName) {
  const verifier = path.join(root, projectName, "scripts", "verify-release-static.mjs");
  const result = spawnSync(process.execPath, [verifier], {
    cwd: path.join(root, projectName),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`${projectName} release verifier failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }

  if (result.stdout) process.stdout.write(result.stdout);
}

/** Confirms historical audit-pass artifacts and obsolete pass-specific package scripts stay removed. */
function verifyCleanup() {
  for (const name of [
    "PASS_0_BASELINE",
    "PASS_1_CONTRACT_RESOLUTION",
    "PASS_2_FUNCTIONAL_REMEDIATION",
    "PASS_3_STRUCTURE_CLEANUP",
    "PASS_4_READABILITY",
    "AUDIT_REMEDIATION_FINAL.md",
    "MODULE15_FINAL.md",
  ]) {
    if (existsSync(path.join(root, name))) {
      throw new Error(`Historical audit artifact must stay removed: ${name}`);
    }
  }

  const obsoleteVerifiers = readdirSync(path.join(root, "scripts")).filter((name) =>
    /^verify-audit-remediation-pass\d+-static\.mjs$/u.test(name),
  );
  if (obsoleteVerifiers.length > 0) {
    throw new Error(`Obsolete audit-pass verifiers remain: ${obsoleteVerifiers.join(", ")}`);
  }

  if (!existsSync(path.join(root, "scripts", "run-current-release-gate.mjs"))) {
    throw new Error("The permanent current-stage release runner is missing.");
  }

  const e2eWorkflow = readFileSync(
    path.join(root, "frontend", ".github", "workflows", "e2e.yml"),
    "utf8",
  );
  if (!e2eWorkflow.includes("npm run deps:verify-lock") || !e2eWorkflow.includes("run: npm ci")) {
    throw new Error("The E2E release workflow must verify both lockfiles and install with npm ci.");
  }
  if (e2eWorkflow.includes("npm install")) {
    throw new Error("The E2E release workflow must not fall back to npm install.");
  }

  for (const project of ["backend", "frontend"]) {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, project, "package.json"), "utf8").replace(/^\uFEFF/, ""),
    );
    const scripts = packageJson.scripts ?? {};
    const obsoleteScripts = Object.keys(scripts).filter((name) =>
      name.startsWith("test:audit-remediation:"),
    );
    if (obsoleteScripts.length > 0) {
      throw new Error(`${project} still exposes obsolete audit-pass scripts: ${obsoleteScripts.join(", ")}`);
    }
    if (scripts["test:release:static"] !== "node scripts/verify-release-static.mjs") {
      throw new Error(`${project} must expose its repository-local test:release:static command.`);
    }
    if (!existsSync(path.join(root, project, "scripts", "verify-release-static.mjs"))) {
      throw new Error(`${project} is missing scripts/verify-release-static.mjs.`);
    }
    for (const [scriptName, command] of Object.entries(scripts)) {
      if (String(command).includes("../scripts")) {
        throw new Error(`${project} script ${scriptName} must not depend on the delivery-root scripts folder.`);
      }
    }
  }
}


/** Confirms both repositories keep an independent npm install policy without creating a monorepo. */
function verifyDependencyInstallPolicy() {
  for (const forbidden of ["package.json", "package-lock.json", "pnpm-workspace.yaml", "yarn.lock"]) {
    if (existsSync(path.join(root, forbidden))) {
      throw new Error(`The delivery root must not contain monorepo package metadata: ${forbidden}`);
    }
  }

  for (const project of ["backend", "frontend"]) {
    const projectRoot = path.join(root, project);
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8").replace(/^\uFEFF/, ""),
    );
    const npmrc = readFileSync(path.join(projectRoot, ".npmrc"), "utf8");

    if (packageJson.packageManager !== "npm@10.9.2") {
      throw new Error(`${project} must declare packageManager npm@10.9.2.`);
    }
    if (packageJson.engines?.npm !== ">=10.9.0 <11") {
      throw new Error(`${project} must bound npm to the supported v10 release line.`);
    }
    if (!npmrc.includes("package-lock=true") || !npmrc.includes("engine-strict=true")) {
      throw new Error(`${project}/.npmrc must enable lockfiles and enforce the declared engine.`);
    }
    if (packageJson.scripts?.["deps:lock"] !== "npm install --package-lock-only --ignore-scripts --no-audit --no-fund") {
      throw new Error(`${project} must expose the safe deps:lock bootstrap command.`);
    }
    if (packageJson.scripts?.["deps:verify-lock"] !== "node verify-package-lock.mjs") {
      throw new Error(`${project} must expose deps:verify-lock.`);
    }
    if (!existsSync(path.join(projectRoot, "verify-package-lock.mjs"))) {
      throw new Error(`${project} is missing verify-package-lock.mjs.`);
    }

    const lockPath = path.join(projectRoot, "package-lock.json");
    if (!existsSync(lockPath)) {
      console.warn(`${project}: package-lock.json is not bootstrapped yet; run npm run deps:lock on a networked machine.`);
    }
  }
}

/** Runs the stable source-only release gate for every implemented module and shared contract. */
function main() {
  verifyCleanup();
  verifyDependencyInstallPolicy();
  runProjectGate("backend");
  runProjectGate("frontend");

  const gates = [
    "verify-module2-static.mjs",
    "verify-module21-static.mjs",
    "verify-module3-static.mjs",
    "verify-module4-static.mjs",
    "verify-module5-static.mjs",
    "verify-module6-static.mjs",
    "verify-module7-static.mjs",
    "verify-module19-static.mjs",
    "verify-module8-static.mjs",
    "verify-module9-static.mjs",
    "verify-module13-static.mjs",
    "verify-module10-static.mjs",
    "verify-module11-static.mjs",
    "verify-module12-static.mjs",
    "verify-module16-static.mjs",
    "verify-module14.mjs",
    "verify-module17-release.mjs",
    "verify-module15-static.mjs",
    "verify-module18-static.mjs",
    "verify-module20-static.mjs",
    "verify-module1-static.mjs",
    "verify-commerce-cache-coordination.mjs",
    "verify-frontend-mutation-safety.mjs",
    "verify-local-development-providers.mjs",
    "verify-repository-hygiene.mjs",
    "verify-source-hygiene.mjs",
    "verify-http-contracts.mjs",
    "verify-frontend-feature-contracts.mjs",
    "verify-backend-test-contracts.mjs",
    "verify-e2e-release-contracts.mjs",
  ];

  for (const gate of gates) runGate(gate);
  console.log("Current marketplace source release verification passed.");
}

main();
