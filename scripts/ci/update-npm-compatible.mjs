#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS,
  JAVASCRIPT_UPDATE_HOLDS,
  checkJsLockParity,
} from "./check-js-lock-parity.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED_UPDATE_FILES = Object.freeze([
  "bun.lock",
  "package-lock.json",
  "package.json",
  "src-tauri/crates/sorng-about/src/js_deps.rs",
]);
const MANUAL_CROSS_GRAPH_PREFIXES = Object.freeze(["@tauri-apps/"]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message, details = undefined) {
  const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
  throw new Error(`Compatible npm update: ${message}${suffix}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key])]),
  );
}

function sameValue(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

export function parseStableSemVer(value) {
  const match = typeof value === "string" ? value.match(SEMVER_PATTERN) : null;
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: value,
  };
}

function compareSemVer(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

export function classifyDependencySpec(spec) {
  if (typeof spec !== "string" || spec.length === 0) return { kind: "invalid" };
  const prefix = spec[0] === "^" || spec[0] === "~" ? spec[0] : "";
  const version = parseStableSemVer(prefix ? spec.slice(1) : spec);
  if (!version) return { kind: "unsupported", spec };
  return { kind: prefix || "exact", prefix, version, spec };
}

function transitionWithinBoundary(classification, before, after) {
  if (compareSemVer(after, before) < 0) return false;
  if (classification.kind === "exact")
    return compareSemVer(after, before) === 0;
  if (classification.kind === "~") {
    return after.major === before.major && after.minor === before.minor;
  }
  if (classification.kind === "^") {
    if (before.major > 0) return after.major === before.major;
    if (before.minor > 0) {
      return after.major === 0 && after.minor === before.minor;
    }
    return compareSemVer(after, before) === 0;
  }
  return false;
}

function dependencyGroups(manifest) {
  if (
    !isRecord(manifest?.dependencies) ||
    !isRecord(manifest?.devDependencies)
  ) {
    fail("package.json must declare dependency and devDependency objects");
  }
  return ["dependencies", "devDependencies"];
}

function isManualCrossGraphHold(name) {
  return MANUAL_CROSS_GRAPH_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function compatibleUpdateHold(name) {
  return JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS[name];
}

function assertConfiguredHoldSpec(name, spec, hold) {
  if (spec !== hold.spec) {
    fail(`${name} explicit compatible hold spec drifted`, {
      expected: hold.spec,
      actual: spec,
      reason: hold.reason,
    });
  }
}

function compatibleHoldSummary(name, hold) {
  return {
    name,
    spec: hold.spec,
    allowedVersions: [...hold.allowedVersions],
    reason: hold.reason,
    sources: [...hold.sources],
  };
}

export function buildCompatibleUpdatePolicy(manifest) {
  const eligible = [];
  const exactHolds = [];
  const crossGraphHolds = [];
  const explicitHolds = [];
  const configuredHoldsSeen = new Set();

  for (const group of dependencyGroups(manifest)) {
    for (const [name, spec] of Object.entries(manifest[group])) {
      const classification = classifyDependencySpec(spec);
      if (
        classification.kind === "invalid" ||
        classification.kind === "unsupported"
      ) {
        fail(`${group}.${name} uses an unsupported update spec`, spec);
      }
      const explicitHold = compatibleUpdateHold(name);
      if (explicitHold) {
        assertConfiguredHoldSpec(name, spec, explicitHold);
        configuredHoldsSeen.add(name);
        explicitHolds.push(compatibleHoldSummary(name, explicitHold));
      } else if (isManualCrossGraphHold(name)) {
        crossGraphHolds.push(name);
      } else if (classification.kind === "exact") {
        exactHolds.push(name);
      } else {
        eligible.push(name);
      }
    }
  }

  const missingConfiguredHolds = Object.keys(
    JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS,
  ).filter((name) => !configuredHoldsSeen.has(name));
  if (missingConfiguredHolds.length > 0) {
    fail("explicit compatible holds are missing from package.json", {
      missing: missingConfiguredHolds.sort(),
    });
  }

  return {
    eligible: eligible.sort(),
    exactHolds: exactHolds.sort(),
    crossGraphHolds: crossGraphHolds.sort(),
    explicitHolds: explicitHolds.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function assertSameDependencyNames(before, after, group) {
  const beforeNames = Object.keys(before[group]).sort();
  const afterNames = Object.keys(after[group] ?? {}).sort();
  if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)) {
    fail(`${group} names changed`, {
      added: afterNames.filter((name) => !beforeNames.includes(name)),
      removed: beforeNames.filter((name) => !afterNames.includes(name)),
    });
  }
}

function packageOutsideDependencyMaps(manifest) {
  const copy = clone(manifest);
  delete copy.dependencies;
  delete copy.devDependencies;
  return copy;
}

export function assertCompatibleManifestUpdate(before, after) {
  for (const group of dependencyGroups(before)) {
    assertSameDependencyNames(before, after, group);
  }
  if (
    !sameValue(
      packageOutsideDependencyMaps(before),
      packageOutsideDependencyMaps(after),
    )
  ) {
    fail("npm changed package.json outside dependency specs");
  }

  const changes = [];
  for (const group of dependencyGroups(before)) {
    for (const [name, beforeSpec] of Object.entries(before[group])) {
      const afterSpec = after[group][name];
      const classification = classifyDependencySpec(beforeSpec);
      const afterClassification = classifyDependencySpec(afterSpec);
      const explicitHold = compatibleUpdateHold(name);
      const held =
        classification.kind === "exact" ||
        isManualCrossGraphHold(name) ||
        explicitHold;

      if (explicitHold) {
        assertConfiguredHoldSpec(name, beforeSpec, explicitHold);
      }

      if (held) {
        if (afterSpec !== beforeSpec) {
          fail(`${name} is held and its manifest spec moved`, {
            before: beforeSpec,
            after: afterSpec,
          });
        }
      } else {
        if (afterClassification.kind !== classification.kind) {
          fail(`${name} changed range style`, {
            before: beforeSpec,
            after: afterSpec,
          });
        }
        if (
          !transitionWithinBoundary(
            classification,
            classification.version,
            afterClassification.version,
          )
        ) {
          fail(`${name} crossed its compatible manifest boundary`, {
            before: beforeSpec,
            after: afterSpec,
          });
        }
      }
      if (beforeSpec !== afterSpec)
        changes.push({ group, name, beforeSpec, afterSpec });
    }
  }

  for (const [name, expected] of Object.entries(JAVASCRIPT_UPDATE_HOLDS)) {
    if (after.devDependencies?.[name] !== expected) {
      fail(`${name} explicit hold moved`, {
        expected,
        actual: after.devDependencies?.[name],
      });
    }
  }
  return changes;
}

function resolvedDirectVersion(lock, name) {
  const value = lock?.packages?.[`node_modules/${name}`]?.version;
  if (!parseStableSemVer(value))
    fail(`${name} has no stable direct npm resolution`, value);
  return value;
}

export function assertCompatibleLockUpdate({
  beforeManifest,
  beforeLock,
  afterManifest,
  afterLock,
}) {
  if (
    !isRecord(beforeLock?.packages?.[""]) ||
    !isRecord(afterLock?.packages?.[""])
  ) {
    fail("package-lock.json is missing its root entry");
  }
  const changes = [];

  for (const group of dependencyGroups(beforeManifest)) {
    assertSameDependencyNames(beforeManifest, afterManifest, group);
    const afterRootGroup = afterLock.packages[""][group] ?? {};
    if (!sameValue(afterRootGroup, afterManifest[group])) {
      fail(`package-lock root ${group} does not match package.json`);
    }

    for (const [name, beforeSpec] of Object.entries(beforeManifest[group])) {
      const beforeVersionText = resolvedDirectVersion(beforeLock, name);
      const afterVersionText = resolvedDirectVersion(afterLock, name);
      const beforeVersion = parseStableSemVer(beforeVersionText);
      const afterVersion = parseStableSemVer(afterVersionText);
      const classification = classifyDependencySpec(beforeSpec);
      const explicitHold = compatibleUpdateHold(name);
      const held =
        classification.kind === "exact" ||
        isManualCrossGraphHold(name) ||
        explicitHold;

      if (explicitHold) {
        assertConfiguredHoldSpec(name, beforeSpec, explicitHold);
        for (const [state, version] of [
          ["before", beforeVersionText],
          ["after", afterVersionText],
        ]) {
          if (!explicitHold.allowedVersions.includes(version)) {
            fail(`${name} explicit compatible hold resolution is not allowed`, {
              state,
              version,
              allowedVersions: explicitHold.allowedVersions,
              reason: explicitHold.reason,
            });
          }
        }
      }

      if (held) {
        if (afterVersionText !== beforeVersionText) {
          fail(`${name} is held and its npm resolution moved`, {
            before: beforeVersionText,
            after: afterVersionText,
          });
        }
      } else if (
        !transitionWithinBoundary(classification, beforeVersion, afterVersion)
      ) {
        fail(`${name} crossed its compatible resolved boundary`, {
          spec: beforeSpec,
          before: beforeVersionText,
          after: afterVersionText,
        });
      }

      if (beforeVersionText !== afterVersionText) {
        changes.push({
          group,
          name,
          beforeVersion: beforeVersionText,
          afterVersion: afterVersionText,
        });
      }
    }
  }

  if (afterManifest.version !== afterLock.packages[""].version) {
    fail("product version drifted between package.json and package-lock.json");
  }
  return changes;
}

function npmInvocation(args) {
  const configuredCli = process.env.npm_execpath;
  const bundledWindowsCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const npmCli = [configuredCli, bundledWindowsCli].find(
    (candidate) =>
      typeof candidate === "string" &&
      path.basename(candidate).toLowerCase() === "npm-cli.js" &&
      fs.existsSync(candidate),
  );
  if (npmCli) {
    return { command: process.execPath, args: [npmCli, ...args] };
  }
  return { command: "npm", args };
}

function run(command, args, { cwd, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed`, {
      status: result.status,
      error: result.error?.message,
      stdout: String(result.stdout ?? "").slice(-4_000),
      stderr: String(result.stderr ?? "").slice(-4_000),
    });
  }
  return result;
}

const OPERATION_NAMES = Object.freeze(["updateNpm", "installBun", "syncAbout"]);

const DEFAULT_OPERATIONS = Object.freeze({
  updateNpm({ repositoryRoot, eligible }) {
    const npm = npmInvocation([
      "update",
      "--save",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--",
      ...eligible,
    ]);
    return run(npm.command, npm.args, { cwd: repositoryRoot });
  },
  installBun({ cwd, args }) {
    return run("bun", args, { cwd, quiet: true });
  },
  syncAbout({ repositoryRoot }) {
    return run(process.execPath, ["scripts/sync-js-deps.mjs", "--write"], {
      cwd: repositoryRoot,
    });
  },
});

function resolveOperations(overrides = {}) {
  if (!isRecord(overrides)) fail("operation overrides must be an object");
  const unexpected = Object.keys(overrides).filter(
    (name) => !OPERATION_NAMES.includes(name),
  );
  if (unexpected.length > 0) fail("unknown operation overrides", unexpected);
  const operations = { ...DEFAULT_OPERATIONS, ...overrides };
  for (const name of OPERATION_NAMES) {
    if (typeof operations[name] !== "function") {
      fail(`${name} operation must be a function`);
    }
  }
  return operations;
}

function readJson(repositoryRoot, name) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, name), "utf8"));
}

function fileHash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashesForAllowedFiles(repositoryRoot) {
  return Object.fromEntries(
    ALLOWED_UPDATE_FILES.map((name) => [
      name,
      fileHash(path.join(repositoryRoot, name)),
    ]),
  );
}

function validateBunWarnings(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const warnings = output
    .split(/\r?\n/)
    .filter((line) => /^warn:/i.test(line.trim()));
  const unexpected = warnings.filter(
    (line) =>
      !line.includes('Bun currently does not support nested "overrides"'),
  );
  if (unexpected.length > 0)
    fail("Bun emitted unexpected warnings", unexpected);
}

function canonicalizeBunLock(
  repositoryRoot,
  { verifyFrozenInstall, operations },
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "sorng-npm-update-"),
  );
  try {
    for (const name of ["package.json", "package-lock.json"]) {
      fs.copyFileSync(
        path.join(repositoryRoot, name),
        path.join(temporaryRoot, name),
      );
    }
    const manifestHash = fileHash(path.join(temporaryRoot, "package.json"));
    const npmLockHash = fileHash(path.join(temporaryRoot, "package-lock.json"));
    const passHashes = [];

    for (let pass = 1; pass <= 3; pass += 1) {
      const result = operations.installBun({
        cwd: temporaryRoot,
        args: ["install", "--lockfile-only", "--ignore-scripts"],
      });
      validateBunWarnings(result);
      if (fileHash(path.join(temporaryRoot, "package.json")) !== manifestHash) {
        fail(`Bun pass ${pass} changed package.json`);
      }
      if (
        fileHash(path.join(temporaryRoot, "package-lock.json")) !== npmLockHash
      ) {
        fail(`Bun pass ${pass} changed package-lock.json`);
      }
      passHashes.push(fileHash(path.join(temporaryRoot, "bun.lock")));
    }

    if (passHashes[1] !== passHashes[2]) {
      fail("canonical Bun lock did not stabilize by pass 3", passHashes);
    }

    if (verifyFrozenInstall) {
      const beforeFrozen = {
        packageJson: fileHash(path.join(temporaryRoot, "package.json")),
        packageLock: fileHash(path.join(temporaryRoot, "package-lock.json")),
        bunLock: fileHash(path.join(temporaryRoot, "bun.lock")),
      };
      const result = operations.installBun({
        cwd: temporaryRoot,
        args: ["install", "--frozen-lockfile", "--ignore-scripts"],
      });
      validateBunWarnings(result);
      const afterFrozen = {
        packageJson: fileHash(path.join(temporaryRoot, "package.json")),
        packageLock: fileHash(path.join(temporaryRoot, "package-lock.json")),
        bunLock: fileHash(path.join(temporaryRoot, "bun.lock")),
      };
      if (!sameValue(beforeFrozen, afterFrozen)) {
        fail("Bun frozen install changed package inputs", {
          beforeFrozen,
          afterFrozen,
        });
      }
    }

    fs.copyFileSync(
      path.join(temporaryRoot, "bun.lock"),
      path.join(repositoryRoot, "bun.lock"),
    );
    return { passHashes, canonicalHash: passHashes[2] };
  } finally {
    try {
      fs.rmSync(temporaryRoot, { force: true, recursive: true });
    } catch (error) {
      console.warn(
        `::warning::Unable to remove isolated Bun directory ${temporaryRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function assertCleanRepository(repositoryRoot) {
  const result = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repositoryRoot,
      quiet: true,
    },
  );
  if (String(result.stdout).trim().length > 0) {
    fail(
      "--write requires a clean working tree",
      String(result.stdout).trim().split(/\r?\n/),
    );
  }
}

function changedRepositoryFiles(repositoryRoot) {
  const tracked = run("git", ["diff", "--name-only", "--no-ext-diff"], {
    cwd: repositoryRoot,
    quiet: true,
  })
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    quiet: true,
  })
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function assertAllowedRepositoryDiff(repositoryRoot) {
  const changed = changedRepositoryFiles(repositoryRoot);
  const unexpected = changed.filter(
    (name) => !ALLOWED_UPDATE_FILES.includes(name),
  );
  if (unexpected.length > 0)
    fail("update touched files outside the atomic package set", unexpected);
  run("git", ["diff", "--check", "--", ...ALLOWED_UPDATE_FILES], {
    cwd: repositoryRoot,
    quiet: true,
  });
  return changed;
}

function assertToolchainPins(repositoryRoot) {
  const nodeVersion = fs
    .readFileSync(path.join(repositoryRoot, ".node-version"), "utf8")
    .trim();
  const bunVersion = fs
    .readFileSync(path.join(repositoryRoot, ".bun-version"), "utf8")
    .trim();
  if (nodeVersion !== "24.19.0")
    fail(".node-version must remain 24.19.0", nodeVersion);
  if (bunVersion !== "1.3.11")
    fail(".bun-version must remain 1.3.11", bunVersion);
}

function performUpdatePass(
  repositoryRoot,
  { verifyFrozenInstall, operations },
) {
  const beforeManifest = readJson(repositoryRoot, "package.json");
  const beforeLock = readJson(repositoryRoot, "package-lock.json");
  const policy = buildCompatibleUpdatePolicy(beforeManifest);

  operations.updateNpm({ repositoryRoot, eligible: policy.eligible });

  const afterManifest = readJson(repositoryRoot, "package.json");
  const afterLock = readJson(repositoryRoot, "package-lock.json");
  const manifestChanges = assertCompatibleManifestUpdate(
    beforeManifest,
    afterManifest,
  );
  const resolutionChanges = assertCompatibleLockUpdate({
    beforeManifest,
    beforeLock,
    afterManifest,
    afterLock,
  });
  const bun = canonicalizeBunLock(repositoryRoot, {
    verifyFrozenInstall,
    operations,
  });
  operations.syncAbout({ repositoryRoot });
  const parity = checkJsLockParity(repositoryRoot);

  return { policy, manifestChanges, resolutionChanges, bun, parity };
}

export function dryRunCompatibleUpdate(repositoryRoot = DEFAULT_ROOT) {
  assertToolchainPins(repositoryRoot);
  const manifest = readJson(repositoryRoot, "package.json");
  const policy = buildCompatibleUpdatePolicy(manifest);
  const parity = checkJsLockParity(repositoryRoot);
  return { mode: "dry-run", policy, parity };
}

export function writeCompatibleUpdate(
  repositoryRoot = DEFAULT_ROOT,
  { operations: operationOverrides = {} } = {},
) {
  const operations = resolveOperations(operationOverrides);
  assertToolchainPins(repositoryRoot);
  assertCleanRepository(repositoryRoot);
  const first = performUpdatePass(repositoryRoot, {
    verifyFrozenInstall: false,
    operations,
  });
  const firstFiles = assertAllowedRepositoryDiff(repositoryRoot);
  const firstHashes = hashesForAllowedFiles(repositoryRoot);
  const second = performUpdatePass(repositoryRoot, {
    verifyFrozenInstall: true,
    operations,
  });
  const secondFiles = assertAllowedRepositoryDiff(repositoryRoot);
  const secondHashes = hashesForAllowedFiles(repositoryRoot);

  if (!sameValue(firstHashes, secondHashes)) {
    fail("a second update/generation pass was not idempotent", {
      firstHashes,
      secondHashes,
    });
  }
  if (!sameValue(firstFiles, secondFiles)) {
    fail("the allowed update file set changed on the idempotency pass", {
      firstFiles,
      secondFiles,
    });
  }

  return {
    mode: "write",
    changed: secondFiles.length > 0,
    files: secondFiles,
    policy: second.policy,
    manifestChanges: first.manifestChanges,
    resolutionChanges: first.resolutionChanges,
    bunHash: second.bun.canonicalHash,
    directDependencies: second.parity.total,
  };
}

function parseArguments(argv) {
  if (argv.length === 0)
    fail(
      "usage: update-npm-compatible.mjs (--dry-run|--write) [--root <repository>]",
    );
  const mode = argv[0];
  if (!new Set(["--dry-run", "--write"]).has(mode)) {
    fail("first argument must be --dry-run or --write", mode);
  }
  if (argv.length === 1) return { mode, root: DEFAULT_ROOT };
  if (argv.length === 3 && argv[1] === "--root") {
    return { mode, root: path.resolve(argv[2]) };
  }
  fail(
    "usage: update-npm-compatible.mjs (--dry-run|--write) [--root <repository>]",
  );
}

function main(argv) {
  const { mode, root } = parseArguments(argv);
  const result =
    mode === "--write"
      ? writeCompatibleUpdate(root)
      : dryRunCompatibleUpdate(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
