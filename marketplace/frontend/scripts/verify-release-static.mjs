import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFeatures = [
  "administration",
  "auth",
  "documents-audit",
  "customers",
  "sellers",
  "catalog-taxonomy",
  "products",
  "inventory",
  "search-discovery",
  "cart-wishlist",
  "promotions",
  "shipping",
  "checkout",
  "orders",
  "payments",
  "commissions",
  "returns-refunds",
  "seller-wallet-payouts",
  "reviews",
  "notifications",
  "reports",
  "dashboard",
];

const requiredDependencies = [
  "react",
  "react-dom",
  "@tanstack/react-router",
  "@tanstack/react-query",
  "@tanstack/react-form",
  "zod",
  "axios",
  "socket.io-client",
  "tailwindcss",
  "@radix-ui/react-slot",
  "vitest",
  "@testing-library/react",
  "msw",
  "@playwright/test",
];

const requiredE2eSpecs = [
  "foundation.spec.ts",
  "module2.spec.ts",
  "module21.spec.ts",
  "module3.spec.ts",
  "module4.spec.ts",
  "module5.spec.ts",
  "module6.spec.ts",
  "module7.spec.ts",
  "module19.spec.ts",
  "module8.spec.ts",
  "module9.spec.ts",
  "module13.spec.ts",
  "module10.spec.ts",
  "module11.spec.ts",
  "module12.spec.ts",
  "module16.spec.ts",
  "module14.spec.ts",
  "module17.spec.ts",
  "module15.spec.ts",
  "module18.spec.ts",
  "module20.spec.ts",
  "module1.spec.ts",
];

/** Reads one UTF-8 project file and fails with a focused path when it is missing. */
function read(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required frontend release file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Confirms every implemented frontend feature owns its API, hooks, components, forms, schemas, and pages. */
function verifyFeatureStructure() {
  for (const featureName of requiredFeatures) {
    for (const folderName of ["api", "hooks", "components", "forms", "schemas", "pages"]) {
      const folder = path.join(projectRoot, "src", "features", featureName, folderName);
      if (!existsSync(folder)) {
        throw new Error(`Frontend feature ${featureName} is missing ${folderName}/.`);
      }
    }
  }
}

/** Confirms the frontend keeps the required technology stack and independent npm policy. */
function verifyPackageContract() {
  const packageJson = JSON.parse(read("package.json"));
  const allDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  for (const dependency of requiredDependencies) {
    if (!allDependencies[dependency]) {
      throw new Error(`Required frontend dependency is missing: ${dependency}`);
    }
  }

  if (packageJson.packageManager !== "npm@10.9.2") {
    throw new Error("Frontend packageManager must remain npm@10.9.2.");
  }

  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (String(command).includes("../scripts")) {
      throw new Error(`Frontend script ${name} depends on a parent/root scripts folder.`);
    }
  }

  const npmrc = read(".npmrc");
  if (!npmrc.includes("package-lock=true") || !npmrc.includes("engine-strict=true")) {
    throw new Error("Frontend .npmrc must keep package-lock and engine enforcement enabled.");
  }
}

/** Confirms the central API client owns credential handling rather than feature code duplicating it. */
function verifyApiClientContract() {
  const apiClient = read("src/lib/api-client.ts");
  if (!apiClient.includes("withCredentials: true")) {
    throw new Error("Frontend API client must keep credentialed requests enabled centrally.");
  }
  if (!apiClient.includes("axios.create")) {
    throw new Error("Frontend API client must remain the centralized Axios wrapper.");
  }
}


/** Confirms authenticated Socket.IO push only invalidates canonical Notification queries. */
function verifyRealtimeContract() {
  const realtime = read("src/features/notifications/hooks/use-notification-realtime.ts");
  const authSession = read("src/lib/auth-session.ts");
  for (const proof of [
    'from "socket.io-client"',
    'auth: { accessToken }',
    'NOTIFICATION_CREATED_EVENT = "notification.created"',
    'queryKey: notificationsQueryKeys.all',
    'subscribeAccessToken',
  ]) {
    if (!realtime.includes(proof) && !authSession.includes(proof)) {
      throw new Error(`Frontend realtime contract is missing ${proof}.`);
    }
  }
}

/** Confirms every implemented generation stage keeps a browser regression specification. */
function verifyE2eCoverage() {
  for (const fileName of requiredE2eSpecs) {
    read(path.join("e2e", fileName));
  }
  const runner = read("e2e/run-e2e-ci.mjs");
  if (!runner.includes("e2e/module1.spec.ts")) {
    throw new Error("The cumulative browser release gate must execute Module 1 Dashboard E2E coverage.");
  }
}

/** Confirms frontend source does not import or depend on backend source files. */
function verifyRepositoryIndependence() {
  for (const relativePath of ["src/main.tsx", "src/lib/api-client.ts", "e2e/run-e2e-ci.mjs"]) {
    const source = read(relativePath);
    if (source.includes("marketplace-backend/src") || source.includes("../marketplace-backend/src")) {
      throw new Error(`${relativePath} must not import backend source files.`);
    }
  }
}

/** Confirms the independent frontend keeps its own runtime, test, build, and CI entry points. */
function verifyCoreReleaseFiles() {
  for (const relativePath of [
    "src/main.tsx",
    "src/lib/api-client.ts",
    "vite.config.ts",
    "playwright.config.ts",
    "Dockerfile",
    ".github/workflows/ci.yml",
    ".github/workflows/e2e.yml",
  ]) {
    read(relativePath);
  }
}

/** Runs the dependency-free frontend release structure gate. */
function main() {
  verifyFeatureStructure();
  verifyPackageContract();
  verifyApiClientContract();
  verifyRealtimeContract();
  verifyE2eCoverage();
  verifyRepositoryIndependence();
  verifyCoreReleaseFiles();
  console.log("Frontend independent-repository static release gate passed.");
}

main();
