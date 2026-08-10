#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CATALOG_PATH = path.join(
  REPOSITORY_ROOT,
  "src-tauri",
  "crates",
  "sorng-about",
  "src",
  "js_deps.rs",
);

const GROUPS = [
  { manifestKey: "dependencies", label: "production" },
  { manifestKey: "devDependencies", label: "development" },
];

function fail(message) {
  throw new Error(`JavaScript dependency catalog: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSameKeys(left, right, context) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
    const missing = leftKeys.filter((key) => !rightKeys.includes(key));
    const obsolete = rightKeys.filter((key) => !leftKeys.includes(key));
    fail(
      `${context} keys differ (missing: ${missing.join(", ") || "none"}; obsolete: ${obsolete.join(", ") || "none"})`,
    );
  }
}

export function categorizeJsDependency(name) {
  if (name.startsWith("@tauri-apps/")) return "Tauri Integration";
  if (
    name.startsWith("react") ||
    ["lucide-react", "react-dom", "react-i18next"].includes(name)
  ) {
    return "React & UI";
  }
  if (
    name === "next" ||
    name === "eslint-config-next" ||
    name === "@next/eslint-plugin-next"
  ) {
    return "Next.js";
  }
  if (name === "@xterm/xterm" || name.startsWith("@xterm/addon-")) {
    return "Terminal Emulation";
  }
  if (name === "webssh2-frontend") {
    return "Remote Desktop & SSH";
  }
  if (["qrcode", "jsqr"].includes(name)) return "Cryptography & Auth";
  if (["i18next", "i18next-browser-languagedetector"].includes(name)) {
    return "Internationalization";
  }
  if (name === "ipaddr.js") return "Networking";
  if (name === "idb") return "Storage";
  if (name === "gifenc") return "Media";
  if (name.startsWith("@types/")) return "Type Definitions";
  if (
    name === "@eslint/js" ||
    name === "globals" ||
    name === "eslint" ||
    name.startsWith("eslint-")
  ) {
    return "Linting";
  }
  if (
    name === "vitest" ||
    name === "fake-indexeddb" ||
    name === "jsdom" ||
    name === "webdriverio" ||
    name === "expect-webdriverio" ||
    name.startsWith("@vitest/") ||
    name.startsWith("@testing-library/") ||
    name.startsWith("@wdio/")
  ) {
    return "Testing";
  }
  if (name === "vite" || name.startsWith("@vitejs/")) return "Build Tooling";
  if (
    name === "typescript" ||
    name.startsWith("typescript-") ||
    name.startsWith("@webgpu/")
  ) {
    return "TypeScript";
  }
  if (
    ["tailwindcss", "postcss", "autoprefixer"].includes(name) ||
    name.startsWith("@tailwindcss/")
  ) {
    return "CSS & Styling";
  }
  if (name === "prettier") return "Formatting";
  if (name === "turbo") return "Monorepo";
  return "Other";
}

export function collectDirectDependencies(packageJson, packageLock) {
  if (!isRecord(packageJson) || !isRecord(packageLock)) {
    fail("package.json and package-lock.json must contain JSON objects");
  }
  if (!isRecord(packageLock.packages) || !isRecord(packageLock.packages[""])) {
    fail("package-lock.json is missing the root packages entry");
  }

  const lockRoot = packageLock.packages[""];
  const seenNames = new Set();
  const catalog = {};

  for (const { manifestKey, label } of GROUPS) {
    const manifestDependencies = packageJson[manifestKey] ?? {};
    const lockedDependencies = lockRoot[manifestKey] ?? {};
    if (!isRecord(manifestDependencies) || !isRecord(lockedDependencies)) {
      fail(`${manifestKey} must be an object in both package files`);
    }
    assertSameKeys(manifestDependencies, lockedDependencies, manifestKey);

    catalog[label] = Object.keys(manifestDependencies)
      .sort()
      .map((name) => {
        if (seenNames.has(name)) fail(`${name} is declared in multiple groups`);
        seenNames.add(name);

        const manifestSpec = manifestDependencies[name];
        if (lockedDependencies[name] !== manifestSpec) {
          fail(
            `${name} root lock spec ${JSON.stringify(lockedDependencies[name])} does not match ${JSON.stringify(manifestSpec)}`,
          );
        }

        const lockedPackage = packageLock.packages[`node_modules/${name}`];
        if (!isRecord(lockedPackage)) fail(`${name} has no root lock package`);
        if (
          typeof lockedPackage.version !== "string" ||
          lockedPackage.version.length === 0
        ) {
          fail(`${name} has no exact locked version`);
        }
        if (
          typeof lockedPackage.license !== "string" ||
          lockedPackage.license.length === 0
        ) {
          fail(`${name} has no locked license metadata`);
        }

        return {
          name,
          version: lockedPackage.version,
          license: lockedPackage.license,
          category: categorizeJsDependency(name),
        };
      });
  }

  return catalog;
}

function rustString(value) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}"`;
}

function renderEntries(entries) {
  return entries
    .map(
      ({ name, version, license, category }) =>
        `    (${rustString(name)}, ${rustString(version)}, ${rustString(license)}, ${rustString(category)}),`,
    )
    .join("\n");
}

export function renderJsDependencyCatalog(catalog) {
  return `// @generated by scripts/sync-js-deps.mjs from package.json and package-lock.json.
// Do not edit manually; run \`npm run about:js-deps:generate\`.

use crate::types::{DependencyCategory, DependencyInfo};
use std::collections::HashMap;

#[rustfmt::skip]
const PRODUCTION_DEPS: &[(&str, &str, &str, &str)] = &[
${renderEntries(catalog.production)}
];

#[rustfmt::skip]
const DEV_DEPS: &[(&str, &str, &str, &str)] = &[
${renderEntries(catalog.development)}
];

fn to_dependency_info(
    (name, version, license, category): &(&str, &str, &str, &str),
) -> DependencyInfo {
    DependencyInfo {
        name: (*name).to_string(),
        version: (*version).to_string(),
        license: (*license).to_string(),
        authors: vec![],
        repository: String::new(),
        description: String::new(),
        category: (*category).to_string(),
    }
}

pub fn get_all_js_deps() -> Vec<DependencyInfo> {
    PRODUCTION_DEPS
        .iter()
        .chain(DEV_DEPS.iter())
        .map(to_dependency_info)
        .collect()
}

pub fn get_deps_by_category() -> Vec<DependencyCategory> {
    let mut map: HashMap<String, Vec<DependencyInfo>> = HashMap::new();
    for dep in get_all_js_deps() {
        map.entry(dep.category.clone()).or_default().push(dep);
    }
    let mut categories: Vec<DependencyCategory> = map
        .into_iter()
        .map(|(name, dependencies)| DependencyCategory {
            description: format!("{} dependencies", name),
            name,
            dependencies,
        })
        .collect();
    categories.sort_by(|left, right| left.name.cmp(&right.name));
    categories
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generated_catalog_entries_are_unique_and_populated() {
        let dependencies = get_all_js_deps();
        assert_eq!(dependencies.len(), PRODUCTION_DEPS.len() + DEV_DEPS.len());

        let mut names = HashSet::new();
        for dependency in dependencies {
            assert!(
                names.insert(dependency.name.clone()),
                "duplicate {}",
                dependency.name
            );
            assert!(
                !dependency.version.is_empty(),
                "missing version for {}",
                dependency.name
            );
            assert!(
                !dependency.license.is_empty(),
                "missing license for {}",
                dependency.name
            );
            assert!(
                !dependency.category.is_empty(),
                "missing category for {}",
                dependency.name
            );
        }
    }
}
`;
}

export function generatedTextMatches(current, expected) {
  const normalize = (value) => value.replace(/\r\n?/g, "\n");
  return normalize(current) === normalize(expected);
}

function loadCatalog() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, "package-lock.json"), "utf8"),
  );
  return collectDirectDependencies(packageJson, packageLock);
}

function parseMode(argv) {
  if (argv.length !== 1 || !["--check", "--write"].includes(argv[0])) {
    fail("usage: node scripts/sync-js-deps.mjs (--check|--write)");
  }
  return argv[0];
}

function main(argv) {
  const mode = parseMode(argv);
  const catalog = loadCatalog();
  const expected = renderJsDependencyCatalog(catalog);
  const current = fs.existsSync(CATALOG_PATH)
    ? fs.readFileSync(CATALOG_PATH, "utf8")
    : "";
  const synchronized = generatedTextMatches(current, expected);

  if (mode === "--check" && !synchronized) {
    fail("generated Rust catalog is stale; run npm run about:js-deps:generate");
  }
  if (mode === "--write" && !synchronized) {
    fs.writeFileSync(CATALOG_PATH, expected, "utf8");
  }

  const total = catalog.production.length + catalog.development.length;
  console.log(
    `JavaScript About catalog synchronized: ${catalog.production.length} production + ${catalog.development.length} development = ${total} direct dependencies.`,
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
