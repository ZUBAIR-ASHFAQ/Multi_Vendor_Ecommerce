import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(root, "marketplace-backend");
const frontendRoot = path.join(root, "marketplace-frontend");

const ignoredDirectoryNames = new Set(["node_modules", "dist", "coverage", ".git"]);
const sourceExtensions = new Set([".ts", ".tsx"]);

/** Returns every file below a directory while skipping generated dependency/build folders. */
function listFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolutePath));
    else files.push(absolutePath);
  }

  return files;
}

/** Converts an absolute path to a stable delivery-root path for focused error messages. */
function relative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll(path.sep, "/");
}

/** Returns the previous non-empty source line, or an empty string when none exists. */
function previousCodeLine(lines, lineIndex) {
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const value = lines[index]?.trim() ?? "";
    if (value.length > 0) return value;
  }
  return "";
}

/** Confirms production named functions keep a short nearby purpose comment for junior-readable code. */
function verifyFunctionComments() {
  const productionFiles = [
    ...listFiles(path.join(backendRoot, "src")),
    ...listFiles(path.join(frontendRoot, "src")),
  ].filter((file) => sourceExtensions.has(path.extname(file)) && !file.endsWith(".d.ts"));

  const functionDeclaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*/u;
  const namedArrow = /^\s*(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/u;
  const methodDeclaration = /^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*(?:constructor|[A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^=]+)?\s*\{/u;
  const controlWords = /^(?:if|for|while|switch|catch|with)\b/u;
  const missing = [];

  for (const file of productionFiles) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/u);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isFunction = functionDeclaration.test(line) || namedArrow.test(line);
      const isMethod = methodDeclaration.test(line) && !controlWords.test(trimmed);
      if (!isFunction && !isMethod) return;

      const previous = previousCodeLine(lines, index);
      if (!previous.endsWith("*/") && !previous.startsWith("//")) {
        missing.push(`${relative(file)}:${index + 1}`);
      }
    });
  }

  if (missing.length > 0) {
    throw new Error(`Named production functions are missing purpose comments:\n${missing.join("\n")}`);
  }
}

/** Confirms production source has no unfinished markers, zero-byte files, or generated pass evidence. */
function verifySourceTreeCleanliness() {
  const inspectedFiles = [
    ...listFiles(path.join(backendRoot, "src")),
    ...listFiles(path.join(frontendRoot, "src")),
    ...listFiles(path.join(root, "scripts")),
  ];

  for (const file of inspectedFiles) {
    if (statSync(file).size === 0) {
      throw new Error(`Zero-byte source/support file must be removed: ${relative(file)}`);
    }
  }

  for (const file of inspectedFiles.filter((item) => sourceExtensions.has(path.extname(item)))) {
    const source = readFileSync(file, "utf8");
    if (/\b(?:TODO|FIXME|HACK|XXX)\b/u.test(source)) {
      throw new Error(`Unfinished source marker found in ${relative(file)}.`);
    }
  }

  for (const entry of readdirSync(root)) {
    if (/^(?:PASS_|AUDIT_|MODULE\d+_FINAL)/u.test(entry)) {
      throw new Error(`Historical pass/evidence artifact must stay outside the application root: ${entry}`);
    }
  }
}

/** Extracts relative/alias TypeScript module references without requiring installed npm packages. */
function sourceImports(source) {
  const imports = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) imports.push(match[1]);
    }
  }

  return imports;
}

/** Resolves one local source import to an existing TypeScript file. */
function resolveSourceImport(projectRoot, fromFile, specifier) {
  let basePath;
  if (specifier.startsWith("@/") && projectRoot === frontendRoot) {
    basePath = path.join(frontendRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/u, ""));
  } else {
    return null;
  }

  for (const candidate of [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/** Builds a local source graph and returns files reachable from the supplied entry points. */
function reachableSourceFiles(projectRoot, entryPoints) {
  const sourceRoot = path.join(projectRoot, "src");
  const sourceFiles = listFiles(sourceRoot).filter(
    (file) => sourceExtensions.has(path.extname(file)) && !file.endsWith(".d.ts"),
  );
  const graph = new Map();

  for (const file of sourceFiles) {
    const dependencies = sourceImports(readFileSync(file, "utf8"))
      .map((specifier) => resolveSourceImport(projectRoot, file, specifier))
      .filter(Boolean);
    graph.set(file, dependencies);
  }

  const reachable = new Set();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || reachable.has(file) || !graph.has(file)) continue;
    reachable.add(file);
    queue.push(...graph.get(file));
  }

  return { sourceFiles, reachable };
}

/** Confirms no production source file is orphaned from runtime/CLI/contract entry points. */
function verifySourceReachability() {
  const backendPackage = JSON.parse(readFileSync(path.join(backendRoot, "package.json"), "utf8"));
  const backendEntries = new Set([path.join(backendRoot, "src", "server.ts")]);

  for (const command of Object.values(backendPackage.scripts ?? {})) {
    for (const match of String(command).matchAll(/\b(?:tsx|node)\s+(src\/[A-Za-z0-9_./-]+\.ts)\b/gu)) {
      backendEntries.add(path.join(backendRoot, match[1]));
    }
  }

  // This runtime envelope schema is intentionally consumed by dependency-free contract verifiers.
  backendEntries.add(path.join(backendRoot, "src", "common", "schemas", "api-envelope.schema.ts"));

  const backendGraph = reachableSourceFiles(backendRoot, backendEntries);
  const backendOrphans = backendGraph.sourceFiles.filter((file) => !backendGraph.reachable.has(file));
  if (backendOrphans.length > 0) {
    throw new Error(`Unreachable backend source files must be removed or wired in:\n${backendOrphans.map(relative).join("\n")}`);
  }

  const frontendGraph = reachableSourceFiles(frontendRoot, [path.join(frontendRoot, "src", "main.tsx")]);
  const frontendOrphans = frontendGraph.sourceFiles.filter((file) => !frontendGraph.reachable.has(file));
  if (frontendOrphans.length > 0) {
    throw new Error(`Unreachable frontend source files must be removed or wired in:\n${frontendOrphans.map(relative).join("\n")}`);
  }
}

/** Confirms every root verifier is reachable from the permanent release gates rather than pass-specific history. */
function verifyRootVerifierReachability() {
  const scriptDirectory = path.join(root, "scripts");
  const scriptNames = readdirSync(scriptDirectory).filter((name) => name.endsWith(".mjs"));
  const dependencies = new Map();

  for (const scriptName of scriptNames) {
    const source = readFileSync(path.join(scriptDirectory, scriptName), "utf8");
    dependencies.set(
      scriptName,
      scriptNames.filter((candidate) => candidate !== scriptName && source.includes(candidate)),
    );
  }

  const reachable = new Set();
  const queue = ["verify-current-release-static.mjs", "run-current-release-gate.mjs"];
  while (queue.length > 0) {
    const scriptName = queue.pop();
    if (!scriptName || reachable.has(scriptName) || !dependencies.has(scriptName)) continue;
    reachable.add(scriptName);
    queue.push(...dependencies.get(scriptName));
  }

  const orphans = scriptNames.filter((name) => !reachable.has(name));
  if (orphans.length > 0) {
    throw new Error(`Unreferenced root verifier scripts must be removed or wired into the release gate:\n${orphans.join("\n")}`);
  }
}

/** Runs the permanent whole-project source hygiene checks. */
function main() {
  verifySourceTreeCleanliness();
  verifyFunctionComments();
  verifySourceReachability();
  verifyRootVerifierReachability();
  console.log("Whole-project source hygiene verification passed.");
}

main();
