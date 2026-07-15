#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cargoPackageName,
  projectVersion,
  renderFrontendVersionModule,
  rewriteCargoLock,
  rewriteMemberCargoManifest,
  rewriteRootCargoManifest,
} from "./versioning.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const USER_VISIBLE_VERSION_FILES = [
  "src/components/app/SplashScreen.tsx",
  "src/components/app/CriticalErrorScreen.tsx",
  "src/components/SettingsDialog/sections/AboutSettings.tsx",
  "src/components/SettingsDialog/sections/UpdaterSettings.tsx",
  "e2e/specs/01-startup/app-launch.spec.ts",
];
const RELEASE_LITERAL_PATTERN =
  /(?<![\d.])v?(?:0\.1\.0|\d{2}\.\d+(?:\.\d+)?)(?![\d.])/g;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function write(relativePath, contents) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function walkFiles(relativeDirectory, fileName) {
  const found = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name === fileName) {
        found.push(child.replaceAll(path.sep, "/"));
      }
    }
  };
  visit(relativeDirectory);
  return found.sort();
}

function buildPlan() {
  const authority = JSON.parse(read("version.json"));
  const projection = projectVersion(authority.version);
  const changes = [];

  const plan = (relativePath, expected) => {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    const current = fs.existsSync(absolutePath) ? read(relativePath) : null;
    if (current !== expected) changes.push({ relativePath, current, expected });
  };

  const packageJson = JSON.parse(read("package.json"));
  packageJson.version = projection.machineVersion;
  plan("package.json", jsonText(packageJson));

  const packageLock = JSON.parse(read("package-lock.json"));
  packageLock.version = projection.machineVersion;
  if (!packageLock.packages?.[""]) {
    throw new Error('package-lock.json is missing packages[""]');
  }
  packageLock.packages[""].version = projection.machineVersion;
  plan("package-lock.json", jsonText(packageLock));

  const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
  tauriConfig.version = "../package.json";
  plan("src-tauri/tauri.conf.json", jsonText(tauriConfig));

  plan(
    "src/generated/version.ts",
    renderFrontendVersionModule(
      projection.publicVersion,
      projection.machineVersion,
    ),
  );

  const rootManifestPath = "src-tauri/Cargo.toml";
  const rootManifest = read(rootManifestPath);
  plan(
    rootManifestPath,
    rewriteRootCargoManifest(rootManifest, projection.machineVersion),
  );

  const memberManifestPaths = walkFiles("src-tauri/crates", "Cargo.toml");
  const firstPartyPackageNames = new Set([cargoPackageName(rootManifest)]);
  let productCrateCount = 0;
  let vendorWrapperCount = 0;

  for (const manifestPath of memberManifestPaths) {
    const manifest = read(manifestPath);
    const packageName = cargoPackageName(manifest);
    if (firstPartyPackageNames.has(packageName)) {
      throw new Error(
        `Duplicate first-party Cargo package name: ${packageName}`,
      );
    }
    firstPartyPackageNames.add(packageName);
    if (packageName.endsWith("-vendor")) vendorWrapperCount += 1;
    else productCrateCount += 1;
    plan(manifestPath, rewriteMemberCargoManifest(manifest));
  }

  const rootLockPath = "src-tauri/Cargo.lock";
  const rootLock = rewriteCargoLock(
    read(rootLockPath),
    firstPartyPackageNames,
    projection.machineVersion,
  );
  const missingRootLockPackages = [...firstPartyPackageNames].filter(
    (name) => !rootLock.found.has(name),
  );
  if (missingRootLockPackages.length > 0) {
    throw new Error(
      `Root Cargo.lock is missing first-party packages: ${missingRootLockPackages.join(", ")}`,
    );
  }
  plan(rootLockPath, rootLock.text);

  for (const lockPath of walkFiles("src-tauri/crates", "Cargo.lock")) {
    const lock = rewriteCargoLock(
      read(lockPath),
      firstPartyPackageNames,
      projection.machineVersion,
    );
    if (lock.found.size > 0) plan(lockPath, lock.text);
  }

  return {
    ...projection,
    changes,
    firstPartyPackageCount: firstPartyPackageNames.size,
    memberManifestCount: memberManifestPaths.length,
    productCrateCount,
    vendorWrapperCount,
  };
}

function releaseLiteralViolations() {
  const violations = [];
  for (const relativePath of USER_VISIBLE_VERSION_FILES) {
    const lines = read(relativePath).split(/\r?\n/);
    lines.forEach((line, index) => {
      RELEASE_LITERAL_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(RELEASE_LITERAL_PATTERN)) {
        violations.push(`${relativePath}:${index + 1}: ${match[0]}`);
      }
    });
  }

  const mcpTypesPath = "src-tauri/crates/sorng-mcp/src/types.rs";
  const mcpTypes = read(mcpTypesPath);
  if (/MCP_SERVER_VERSION[^\n]*=\s*"[^"]+"/.test(mcpTypes)) {
    violations.push(
      `${mcpTypesPath}: MCP_SERVER_VERSION must inherit CARGO_PKG_VERSION`,
    );
  }
  return violations;
}

export function run(mode) {
  if (mode !== "check" && mode !== "write") {
    throw new Error(
      `Unknown mode ${JSON.stringify(mode)}; use --check or --write`,
    );
  }

  let plan = buildPlan();
  if (mode === "write") {
    for (const change of plan.changes)
      write(change.relativePath, change.expected);
    plan = buildPlan();
  }

  const violations = releaseLiteralViolations();
  if (plan.changes.length > 0 || violations.length > 0) {
    if (plan.changes.length > 0) {
      console.error("Version-derived files are out of sync:");
      for (const change of plan.changes)
        console.error(`  - ${change.relativePath}`);
      console.error("Run `npm run version:sync` and commit the results.");
    }
    if (violations.length > 0) {
      console.error(
        "Hard-coded first-party/user-visible release literals found:",
      );
      for (const violation of violations) console.error(`  - ${violation}`);
      console.error(
        "Render APP_VERSION/formatAppVersion or inherit CARGO_PKG_VERSION instead.",
      );
    }
    return 1;
  }

  console.log(
    `Version ${plan.publicVersion} is synchronized as machine-only SemVer ${plan.machineVersion}.`,
  );
  console.log(
    `Cargo audit: ${plan.productCrateCount} product crates + ${plan.vendorWrapperCount} vendor wrappers + root app = ${plan.firstPartyPackageCount} first-party packages.`,
  );
  return 0;
}

function cliMode(argv) {
  const flags = argv.filter(
    (value) => value === "--check" || value === "--write",
  );
  if (flags.length !== 1 || argv.length !== 1) {
    throw new Error("Usage: node scripts/sync-version.mjs (--check|--write)");
  }
  return flags[0].slice(2);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.exitCode = run(cliMode(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
