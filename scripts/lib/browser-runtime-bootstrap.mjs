// Normal builds consume reviewed engine releases; they never build Chromium.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "../browser-runtime-package.mjs";
import { LOCAL_RUNTIME_SELECTION_FILE } from "./browser-local-runtime.mjs";
import { releaseAssetUrl } from "./browser-runtime-release.mjs";

export const RUNTIME_RELEASE_CATALOG = fileURLToPath(
  new URL("../../native/cef-runtime-releases.json", import.meta.url),
);
export const RUNTIME_RELEASE_CACHE = fileURLToPath(
  new URL("../../.cache/cef-runtime-releases", import.meta.url),
);

export function validateRuntimeReleaseCatalog(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "kind,schemaVersion,targets" ||
    value.schemaVersion !== 1 ||
    value.kind !== "sorng-cef-runtime-releases" ||
    !value.targets ||
    typeof value.targets !== "object" ||
    Array.isArray(value.targets)
  )
    throw new Error("Invalid reviewed CEF release catalog");
  for (const [target, entry] of Object.entries(value.targets)) {
    if (
      !TARGETS.includes(target) ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join() !== "descriptorSha256,descriptorUrl" ||
      typeof entry.descriptorSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.descriptorSha256) ||
      /^0+$/.test(entry.descriptorSha256) ||
      typeof entry.descriptorUrl !== "string" ||
      !entry.descriptorUrl.endsWith(".json")
    )
      throw new Error(`Invalid reviewed CEF release entry: ${target}`);
    try {
      releaseAssetUrl(entry.descriptorUrl);
    } catch {
      throw new Error(`Invalid reviewed CEF release entry: ${target}`);
    }
  }
  return value;
}

/** Preserve deliberate SDK inputs and local registrations. Only an absent
 * registration can cause acquisition from this checkout's reviewed catalog.
 * A broken/stale registration must be repaired explicitly, never bypassed. */
export async function ensurePublishedRuntime(
  options,
  {
    catalogFile = RUNTIME_RELEASE_CATALOG,
    selectionFile = LOCAL_RUNTIME_SELECTION_FILE,
    cacheRoot = RUNTIME_RELEASE_CACHE,
    fetchRuntime,
  } = {},
) {
  if (
    !options.cef ||
    options.runtimeKind ||
    options.customManifest ||
    options.sourceLock ||
    options.artifactRoot ||
    options.sdk ||
    options.archive
  )
    return { acquired: false, reason: "explicit-configuration" };
  try {
    await lstat(selectionFile);
    return { acquired: false, reason: "existing-selection" };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const info = await lstat(catalogFile);
  if (!info.isFile() || info.size > 64 * 1024)
    throw new Error("CEF release catalog must be a bounded regular JSON file");
  const catalog = validateRuntimeReleaseCatalog(
    JSON.parse(await readFile(catalogFile, "utf8")),
  );
  const entry = catalog.targets[options.target];
  if (!entry)
    throw new Error(
      `No reviewed patched CEF release is published for ${options.target} in this checkout yet. Run the engine publication workflow and pin its descriptor, or register a locally built engine. See docs/cef-runtime-ci.md. No stock fallback or source rebuild was attempted.`,
    );
  const install =
    fetchRuntime ?? (await import("../cef-runtime-fetch.mjs")).fetchRuntime;
  const result = await install({
    ...entry,
    target: options.target,
    cacheRoot: path.resolve(cacheRoot),
    selectionFile: path.resolve(selectionFile),
    offline: !!options.offline || options.download === false,
  });
  return { acquired: true, result };
}
