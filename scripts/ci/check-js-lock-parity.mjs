#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const JAVASCRIPT_UPDATE_HOLDS = Object.freeze({
  "@types/node": "24.13.3",
  "@vitest/coverage-v8": "4.1.6",
  vitest: "4.1.6",
});

const defineCompatibleHold = ({ spec, allowedVersions, reason, sources }) =>
  Object.freeze({
    spec,
    allowedVersions: Object.freeze([...allowedVersions]),
    reason,
    sources: Object.freeze([...sources]),
  });

const DESKTOP_E2E_HOLD = Object.freeze({
  reason: "desktop-e2e-required",
  sources: Object.freeze([
    "https://github.com/webdriverio/desktop-mobile/issues/591",
    "https://github.com/webdriverio/webdriverio/issues/15476",
  ]),
});

export const JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS = Object.freeze({
  "@wdio/cli": defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.27.1"],
    ...DESKTOP_E2E_HOLD,
  }),
  "@wdio/local-runner": defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.27.1"],
    ...DESKTOP_E2E_HOLD,
  }),
  "@wdio/mocha-framework": defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.29.1"],
    ...DESKTOP_E2E_HOLD,
  }),
  "@wdio/spec-reporter": defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.27.1"],
    ...DESKTOP_E2E_HOLD,
  }),
  "@wdio/tauri-service": defineCompatibleHold({
    spec: "^1.0.0",
    allowedVersions: ["1.2.0"],
    ...DESKTOP_E2E_HOLD,
  }),
  "@wdio/types": defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.27.1"],
    ...DESKTOP_E2E_HOLD,
  }),
  "expect-webdriverio": defineCompatibleHold({
    spec: "^5.6.5",
    allowedVersions: ["5.6.5"],
    ...DESKTOP_E2E_HOLD,
  }),
  prettier: defineCompatibleHold({
    spec: "^3.8.3",
    allowedVersions: ["3.8.3"],
    reason: "liquid-markdown-corruption",
    sources: [
      "https://github.com/prettier/prettier/issues/19724",
      "https://github.com/prettier/prettier/pull/19730",
    ],
  }),
  webdriverio: defineCompatibleHold({
    spec: "^9.27.1",
    allowedVersions: ["9.27.1"],
    ...DESKTOP_E2E_HOLD,
  }),
});

function fail(message, details = undefined) {
  const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
  throw new Error(`JavaScript lock parity: ${message}${suffix}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stripJsonTrailingCommas(contents) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(contents[lookahead] ?? "")) lookahead += 1;
      if (contents[lookahead] === "}" || contents[lookahead] === "]") {
        continue;
      }
    }

    output += character;
  }

  return output;
}

export function parseBunLock(contents) {
  try {
    return JSON.parse(stripJsonTrailingCommas(contents));
  } catch (error) {
    fail("bun.lock is not valid text lockfile JSON", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sortedKeys(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return Object.keys(value).sort();
}

function assertSameKeys(expected, actual, label) {
  const expectedKeys = sortedKeys(expected, `${label} expected`);
  const actualKeys = sortedKeys(actual, `${label} actual`);
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    fail(`${label} keys differ`, {
      missing: expectedKeys.filter((key) => !actualKeys.includes(key)),
      obsolete: actualKeys.filter((key) => !expectedKeys.includes(key)),
    });
  }
}

function bunResolvedVersion(packages, name) {
  const entry = packages[name];
  if (!Array.isArray(entry) || typeof entry[0] !== "string") {
    fail(`${name} has no direct bun.lock package entry`);
  }
  const prefix = `${name}@`;
  if (!entry[0].startsWith(prefix) || entry[0].length === prefix.length) {
    fail(`${name} has an unsupported bun.lock resolution`, entry[0]);
  }
  return entry[0].slice(prefix.length);
}

export function inspectJsLockParity({
  packageJson,
  packageLock,
  bunLock,
  bunVersion,
}) {
  if (!isRecord(packageJson)) fail("package.json must contain an object");
  if (!isRecord(packageLock?.packages?.[""])) {
    fail("package-lock.json is missing its root packages entry");
  }
  if (!isRecord(bunLock?.workspaces?.[""]) || !isRecord(bunLock?.packages)) {
    fail("bun.lock is missing its root workspace or packages map");
  }

  const npmRoot = packageLock.packages[""];
  const bunRoot = bunLock.workspaces[""];
  const groups = ["dependencies", "devDependencies"];
  const direct = [];

  for (const group of groups) {
    const manifestDependencies = packageJson[group] ?? {};
    const npmDependencies = npmRoot[group] ?? {};
    const bunDependencies = bunRoot[group] ?? {};
    assertSameKeys(manifestDependencies, npmDependencies, `npm ${group}`);
    assertSameKeys(manifestDependencies, bunDependencies, `Bun ${group}`);

    for (const name of Object.keys(manifestDependencies).sort()) {
      const spec = manifestDependencies[name];
      if (typeof spec !== "string" || spec.length === 0) {
        fail(`${group}.${name} has an invalid manifest spec`, spec);
      }
      if (npmDependencies[name] !== spec || bunDependencies[name] !== spec) {
        fail(`${name} root specs are not synchronized`, {
          manifest: spec,
          npm: npmDependencies[name],
          bun: bunDependencies[name],
        });
      }

      const npmPackage = packageLock.packages[`node_modules/${name}`];
      if (!isRecord(npmPackage) || typeof npmPackage.version !== "string") {
        fail(`${name} has no exact package-lock.json resolution`);
      }
      const bunVersionResolved = bunResolvedVersion(bunLock.packages, name);
      if (bunVersionResolved !== npmPackage.version) {
        fail(`${name} resolves differently between npm and Bun`, {
          npm: npmPackage.version,
          bun: bunVersionResolved,
        });
      }
      direct.push({ group, name, spec, version: npmPackage.version });
    }
  }

  if (packageJson.version !== npmRoot.version) {
    fail("product version differs between package.json and package-lock.json", {
      packageJson: packageJson.version,
      packageLock: npmRoot.version,
    });
  }
  if (
    packageJson.engines?.node !== "24.x" ||
    npmRoot.engines?.node !== "24.x"
  ) {
    fail("Node engine must remain on the supported 24.x line", {
      packageJson: packageJson.engines?.node,
      packageLock: npmRoot.engines?.node,
    });
  }
  if (String(bunVersion).trim() !== "1.3.11") {
    fail(
      ".bun-version must remain pinned to 1.3.11",
      String(bunVersion).trim(),
    );
  }

  for (const [name, expected] of Object.entries(JAVASCRIPT_UPDATE_HOLDS)) {
    const spec = packageJson.devDependencies?.[name];
    const resolved = packageLock.packages[`node_modules/${name}`]?.version;
    if (spec !== expected || resolved !== expected) {
      fail(`${name} hold moved`, { expected, spec, resolved });
    }
  }

  for (const [name, hold] of Object.entries(
    JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS,
  )) {
    const spec = packageJson.devDependencies?.[name];
    const resolved = packageLock.packages[`node_modules/${name}`]?.version;
    if (spec !== hold.spec || !hold.allowedVersions.includes(resolved)) {
      fail(`${name} compatible hold moved`, {
        expectedSpec: hold.spec,
        allowedVersions: hold.allowedVersions,
        spec,
        resolved,
        reason: hold.reason,
      });
    }
  }

  return {
    production: Object.keys(packageJson.dependencies ?? {}).length,
    development: Object.keys(packageJson.devDependencies ?? {}).length,
    total: direct.length,
    bunVersion: String(bunVersion).trim(),
    holds: { ...JAVASCRIPT_UPDATE_HOLDS },
    compatibleHolds: { ...JAVASCRIPT_COMPATIBLE_UPDATE_HOLDS },
    direct,
  };
}

export function checkJsLockParity(repositoryRoot = DEFAULT_ROOT) {
  const readJson = (name) =>
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, name), "utf8"));
  return inspectJsLockParity({
    packageJson: readJson("package.json"),
    packageLock: readJson("package-lock.json"),
    bunLock: parseBunLock(
      fs.readFileSync(path.join(repositoryRoot, "bun.lock"), "utf8"),
    ),
    bunVersion: fs.readFileSync(
      path.join(repositoryRoot, ".bun-version"),
      "utf8",
    ),
  });
}

function parseRootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root") return path.resolve(argv[1]);
  fail("usage: check-js-lock-parity.mjs [--root <repository>] ");
}

function main(argv) {
  const result = checkJsLockParity(parseRootArgument(argv));
  process.stdout.write(
    `${JSON.stringify(
      {
        production: result.production,
        development: result.development,
        total: result.total,
        bunVersion: result.bunVersion,
        holds: result.holds,
        compatibleHolds: result.compatibleHolds,
      },
      null,
      2,
    )}\n`,
  );
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
