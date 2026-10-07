#!/usr/bin/env node
// Persist local reviewed byte identities, never runtime admission or readiness.
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  identitySha256,
  inspectCustomRuntimeExports,
  preflightCustomRuntime,
  validateCustomRuntimeManifest,
} from "./browser-custom-runtime.mjs";
import { TARGETS } from "../browser-runtime-package.mjs";

export const LOCAL_RUNTIME_SELECTION_FILE = fileURLToPath(
  new URL("../../.artifacts/cef-local-selection.json", import.meta.url),
);
const pathFields = {
  customManifest: "manifest",
  sourceLock: "sourceLock",
  sdk: "sdk",
  artifactRoot: "artifactRoot",
};
const fail = (message) => {
  throw new Error(`${message}; no official fallback`);
};
const own = (value, key) => Object.hasOwn(value, key);

function shape(value, keys, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(`Invalid ${name} fields`);
}

function digest(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/.test(value) ||
    /^0+$/.test(value)
  )
    fail("Reviewed identity requires a nonzero SHA-256");
}

function relative(value) {
  // Parent traversal is intentional: SDKs can live outside .artifacts. Absolute
  // paths, drive-relative paths and host-specific separators are not portable.
  if (
    typeof value !== "string" ||
    !value ||
    /[\\:\x00-\x1f]/.test(value) ||
    value.startsWith("/") ||
    path.posix.normalize(value) !== value
  )
    fail(
      "Local runtime paths must be normalized relative paths from the selection file",
    );
  return value;
}

export function validateLocalRuntimeSelection(value) {
  shape(value, ["schemaVersion", "kind", "targets"], "local selection");
  if (value.schemaVersion !== 1 || value.kind !== "sorng-cef-local-selection")
    fail("Unsupported local runtime selection schema");
  if (
    !value.targets ||
    typeof value.targets !== "object" ||
    Array.isArray(value.targets) ||
    !Object.keys(value.targets).length
  )
    fail("Local selection requires target-keyed entries");
  for (const [target, entry] of Object.entries(value.targets)) {
    if (!TARGETS.includes(target))
      fail(`Unsupported local runtime target: ${target}`);
    shape(
      entry,
      [
        "manifest",
        "manifestSha256",
        "sourceLock",
        "sourceLockSha256",
        "sdk",
        "artifactRoot",
      ],
      "local target",
    );
    for (const field of Object.values(pathFields)) relative(entry[field]);
    digest(entry.manifestSha256);
    digest(entry.sourceLockSha256);
  }
  return value;
}

function document(file, optional = false) {
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.size > 32 * 1024 * 1024)
    fail(`Regular bounded JSON file required: ${file}`);
  const bytes = readFileSync(file, "utf8");
  try {
    return { value: JSON.parse(bytes), bytes };
  } catch {
    fail(`Corrupt runtime JSON: ${file}`);
  }
}

function readSelection(file, optional = false) {
  const found = document(file, optional);
  if (found) validateLocalRuntimeSelection(found.value);
  return found;
}

export function sameLocalPath(a, b) {
  const canonical = (value) => {
    const absolute = path.resolve(value);
    let result;
    try {
      result = realpathSync(absolute);
    } catch {
      result = absolute;
    }
    return process.platform === "win32" ? result.toLowerCase() : result;
  };
  return canonical(a) === canonical(b);
}

function selectedInputs(file, target, selection) {
  if (!own(selection.targets, target))
    fail(`Local runtime selection has no target ${target}`);
  const entry = selection.targets[target];
  const paths = Object.fromEntries(
    Object.entries(pathFields).map(([key, field]) => [
      key,
      path.resolve(path.dirname(file), entry[field]),
    ]),
  );
  const manifest = document(paths.customManifest).value;
  const sourceLock = document(paths.sourceLock).value;
  if (
    identitySha256(manifest) !== entry.manifestSha256 ||
    identitySha256(sourceLock) !== entry.sourceLockSha256
  )
    fail(
      "Stale local runtime manifest/source-lock identity; review and register again",
    );
  validateCustomRuntimeManifest(manifest, sourceLock);
  if (!manifest.artifacts.some((artifact) => artifact.target === target))
    fail("Selected manifest has no requested target");
  return { entry, paths, manifest, sourceLock };
}

/** Synchronous selection runs before the driver's custom-input validation. It
 * never fills missing fields from unrelated env/file configurations. */
export function resolveLocalRuntime(
  options,
  selectionFile = LOCAL_RUNTIME_SELECTION_FILE,
) {
  if (options.runtimeKind === "official") {
    if (!options.officialRuntimeExplicit)
      fail(
        "Official SDK/development use requires explicit --cef-runtime-kind official",
      );
    if (options.customManifest || options.sourceLock || options.artifactRoot)
      fail("Custom inputs conflict with explicit official SDK selection");
    return options; // Deliberate development override, not a fallback.
  }
  if (options.runtimeKind && options.runtimeKind !== "custom")
    fail("Unknown CEF runtime kind");
  const file = path.resolve(selectionFile);
  const stored = readSelection(file, true);
  if (!stored) {
    if (
      options.runtimeKind === "custom" ||
      options.customManifest ||
      options.sourceLock ||
      options.artifactRoot
    )
      return options;
    fail(
      `Patched CEF selection is required. Register a reviewed runtime at ${file}, or supply complete custom inputs. See node scripts/lib/browser-local-runtime.mjs --help`,
    );
  }
  const selected = selectedInputs(file, options.target, stored.value);
  for (const key of Object.keys(pathFields))
    if (options[key] && !sameLocalPath(options[key], selected.paths[key]))
      fail(
        `Local selection conflicts with supplied ${key}; configurations cannot be mixed`,
      );
  if (options.archive) {
    const artifact = selected.manifest.artifacts.find(
      (item) => item.target === options.target,
    );
    if (
      !sameLocalPath(
        options.archive,
        path.resolve(selected.paths.artifactRoot, artifact.archive.path),
      )
    )
      fail("Local selection conflicts with supplied archive");
  }
  return Object.assign(options, selected.paths, {
    runtimeKind: "custom",
    localRuntimeSelection: {
      file,
      target: options.target,
      entrySha256: identitySha256(selected.entry),
    },
  });
}

/** Recheck selection and reviewed identities on prepare and every watcher run.
 * The existing prepared-runtime verifier still rehashes all SDK/archive bytes. */
export function verifyLocalRuntimeSelection(binding) {
  shape(binding, ["file", "target", "entrySha256"], "local selection binding");
  digest(binding.entrySha256);
  const file = path.resolve(binding.file);
  const current = selectedInputs(
    file,
    binding.target,
    readSelection(file).value,
  );
  if (identitySha256(current.entry) !== binding.entrySha256)
    fail(
      "Local runtime selection changed during this build; restart deliberately",
    );
  return current;
}

function localPath(parent, file) {
  const value =
    path.relative(parent, path.resolve(file)).split(path.sep).join("/") || ".";
  // Different Windows volumes cannot be represented relative to this file.
  return relative(value);
}

function prospectivePath(file) {
  try {
    return realpathSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(prospectivePath(parent), path.basename(file));
  }
}

export async function registerLocalRuntime({
  selectionFile = LOCAL_RUNTIME_SELECTION_FILE,
  target,
  manifest: manifestFile,
  sourceLock: sourceLockFile,
  sdk,
  artifactRoot,
  reviewedManifestSha256,
  reviewedSourceLockSha256,
  replace = false,
}) {
  if (!TARGETS.includes(target)) fail("Unsupported local runtime target");
  digest(reviewedManifestSha256);
  digest(reviewedSourceLockSha256);
  const file = path.resolve(selectionFile);
  const parent = path.dirname(file);
  const relativeToSdk = path.relative(
    realpathSync(path.resolve(sdk)),
    prospectivePath(file),
  );
  if (
    !path.isAbsolute(relativeToSdk) &&
    relativeToSdk !== ".." &&
    !relativeToSdk.startsWith(`..${path.sep}`)
  )
    fail("Local selection must be outside the SDK inventory");
  const entry = {
    manifest: localPath(parent, manifestFile),
    manifestSha256: reviewedManifestSha256,
    sourceLock: localPath(parent, sourceLockFile),
    sourceLockSha256: reviewedSourceLockSha256,
    sdk: localPath(parent, sdk),
    artifactRoot: localPath(parent, artifactRoot),
  };
  const candidate = {
    schemaVersion: 1,
    kind: "sorng-cef-local-selection",
    targets: { [target]: entry },
  };
  validateLocalRuntimeSelection(candidate);
  const selected = selectedInputs(file, target, candidate);
  const preflight = await preflightCustomRuntime({
    manifest: selected.manifest,
    sourceLock: selected.sourceLock,
    target,
    artifactRoot: selected.paths.artifactRoot,
    sdkRoot: selected.paths.sdk,
  });
  const artifact = selected.manifest.artifacts.find(
    (item) => item.target === target,
  );
  await inspectCustomRuntimeExports(
    path.join(selected.paths.sdk, artifact.runtime.library),
    target,
  );
  // No filesystem mutations until the existing preflight and exports pass.
  await mkdir(parent, { recursive: true });
  const lockFile = `${file}.lock`;
  const guard = await open(lockFile, "wx");
  const temporary = path.join(
    parent,
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;
  try {
    const previous = readSelection(file, true);
    if (previous && own(previous.value.targets, target) && !replace)
      fail("Target is already registered; deliberate --replace is required");
    const next = previous?.value ?? {
      schemaVersion: 1,
      kind: "sorng-cef-local-selection",
      targets: {},
    };
    next.targets[target] = entry;
    validateLocalRuntimeSelection(next);
    // Catch manifest/lock changes during byte inspection before publishing.
    selectedInputs(file, target, candidate);
    const output = await open(temporary, "wx");
    temporaryCreated = true;
    try {
      await output.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await output.sync();
    } finally {
      await output.close();
    }
    if (readSelection(file, true)?.bytes !== previous?.bytes)
      fail("Local selection changed during registration");
    await rename(temporary, file); // Same-directory atomic replace on supported OSes.
    temporaryCreated = false;
    return {
      selectionFile: file,
      target,
      manifestSha256: entry.manifestSha256,
      sourceLockSha256: entry.sourceLockSha256,
      filesVerified: preflight.filesVerified,
      sourceAuthenticity: "not-established-by-hashes",
      nativeAcceptance: "not-tested",
      runtimeCapability: "not-probed",
      productionReady: false,
    };
  } finally {
    if (temporaryCreated) await unlink(temporary);
    await guard.close();
    await unlink(lockFile);
  }
}

export const HELP = `Register an independently reviewed patched CEF runtime locally:
  node scripts/lib/browser-local-runtime.mjs register --target TRIPLE
    --manifest JSON --lock JSON --sdk DIR --artifact-root DIR
    --reviewed-manifest-sha256 SHA256 --reviewed-source-lock-sha256 SHA256
    [--selection FILE] [--replace]

Default: ignored .artifacts/cef-local-selection.json, anchored to the repository.
Normal app builds read that default; --selection is for isolated registrations.
Identities use browser-custom-runtime identitySha256 (canonical JSON, not raw
file formatting). Supply identities obtained from independent review. Paths are
stored relative to the selection file; Windows inputs must share its volume.
Existing target replacement requires --replace. Other target entries survive.
Registration checks the existing byte/receipt preflight and defined V2 exports;
it does not download, execute the engine, or establish source authenticity.
Native acceptance: not-tested. productionReady=false. No runtime admission.
`;

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || (argv.length === 1 && ["--help", "-h"].includes(argv[0])))
    return HELP;
  if (argv[0] !== "register") fail("Expected register command");
  const names = {
    selection: "selectionFile",
    target: "target",
    manifest: "manifest",
    lock: "sourceLock",
    sdk: "sdk",
    "artifact-root": "artifactRoot",
    "reviewed-manifest-sha256": "reviewedManifestSha256",
    "reviewed-source-lock-sha256": "reviewedSourceLockSha256",
  };
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(argv[i]);
    if (!match || (!own(names, match[1]) && match[1] !== "replace"))
      fail(`Unknown registration option ${argv[i]}`);
    const key = match[1] === "replace" ? "replace" : names[match[1]];
    if (own(options, key)) fail(`Duplicate registration option ${match[1]}`);
    if (key === "replace") {
      if (match[2] !== undefined) fail("--replace takes no value");
      options.replace = true;
    } else {
      const value = match[2] ?? argv[++i];
      if (!value || value.startsWith("--"))
        fail(`--${match[1]} requires a value`);
      options[key] = value;
    }
  }
  for (const [flag, name] of Object.entries(names))
    if (name !== "selectionFile" && !options[name])
      fail(`--${flag} is required`);
  return registerLocalRuntime(options);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((value) =>
      process.stdout.write(
        typeof value === "string"
          ? value
          : `${JSON.stringify(value, null, 2)}\n`,
      ),
    )
    .catch((error) => {
      console.error(`[browser-local-runtime] ${error.message}`);
      process.exitCode = 1;
    });
}
