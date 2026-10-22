#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "../browser-runtime-package.mjs";
import { validateRuntimeReleaseCatalog } from "../lib/browser-runtime-bootstrap.mjs";

export function checkReleaseRuntimeCatalog(value) {
  const catalog = validateRuntimeReleaseCatalog(value);
  const missing = TARGETS.filter((target) => !catalog.targets[target]);
  if (missing.length)
    throw new Error(
      `Release blocked before tag allocation: reviewed patched CEF runtime releases are missing for ${missing.join(", ")}. Publish and pin all six platform runtimes first.`,
    );
  return {
    targets: [...TARGETS],
    catalogComplete: true,
    nativeAcceptance: "not-observed",
  };
}

export async function main() {
  return checkReleaseRuntimeCatalog(
    JSON.parse(
      await readFile(
        new URL("../../native/cef-runtime-releases.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
