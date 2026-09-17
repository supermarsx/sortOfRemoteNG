// Fail-closed profile isolation for local desktop e2e (t91).
//
// An e2e run may only launch a binary whose compiled identity is an isolation
// identifier. Tauri derives every profile directory from that identifier, and
// isolated builds namespace their keychain services with it. This module proves
// that identity before anything is launched (static marker scan, then the
// exit-early probe), serialises runs with a lock, and wipes only state that is
// asserted to belong to the isolated namespace. Nothing here computes a path
// from APPDATA-style environment variables, and no wipe target is ever derived
// from anything that could resolve to the production profile.
//
// Every uncertainty refuses with an `E2eIsolationRefusal` that says why and
// what to do. Process execution, spawning and the lock clock are injectable so
// the refusal matrix is unit-tested without launching real binaries.

import { spawnSync as nodeSpawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PRODUCTION_IDENTIFIER = "com.sortofremote.ng";
export const E2E_IDENTIFIER = "com.sortofremote.ng.e2e";
export const README_CAPTURE_IDENTIFIER = "com.sortofremote.ng.readme-capture";
export const PRODUCT_NAME = "sortOfRemoteNG";

export const PROFILE_MARKER_PREFIX = "SORNG_PROFILE_MARKER_V1[identifier=";
export const PROFILE_MARKER_SUFFIX = "]";
export const PROFILE_PROBE_ARG = "--sorng-profile-probe";
export const PROFILE_PROBE_SCHEMA = "sorng-profile-probe/v1";
export const PROFILE_PROBE_OUT_ENV = "SORNG_PROFILE_PROBE_OUT";
export const EXPECT_ISOLATED_PROFILE_ENV = "SORNG_EXPECT_ISOLATED_PROFILE";
export const E2E_PROFILE_JSON_ENV = "SORNG_E2E_PROFILE_JSON";
export const E2E_PREFLIGHT_ENV = "SORNG_E2E_PREFLIGHT";
export const ALLOW_RUNNING_PRODUCTION_ENV =
  "SORNG_E2E_ALLOW_RUNNING_PRODUCTION";
export const RUN_LOCK_TOKEN_ENV = "SORNG_E2E_RUN_LOCK_TOKEN";

// Per-run WebView2 user data folder (plan §4.3a / §4.6).
export const WEBVIEW2_USER_DATA_FOLDER_ENV = "WEBVIEW2_USER_DATA_FOLDER";
export const WEBVIEW2_FOLDER_ARG = "--sorng-webview2-user-data-folder";
export const E2E_RUN_ID_ENV = "SORNG_E2E_RUN_ID";
export const E2E_RUN_DIR_ENV = "SORNG_E2E_RUN_DIR";
export const E2E_WEBVIEW2_DIR_ENV = "SORNG_E2E_WEBVIEW2_DIR";
export const E2E_RUN_ROOT_ENV = "SORNG_E2E_RUN_ROOT";
export const KEEP_RUN_DIR_ENV = "SORNG_E2E_KEEP_RUN_DIR";
export const RUNS_ROOT_NAME = "sorng-e2e-runs";
export const RUN_DIR_MARKER_FILE = ".sorng-e2e-run";
export const RUN_WEBVIEW2_DIR_NAME = "webview2";
export const WEBVIEW2_POLICY_KEYS = Object.freeze([
  "HKLM\\Software\\Policies\\Microsoft\\Edge\\WebView2\\UserDataFolder",
  "HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\UserDataFolder",
]);

/** Isolated builds keep SSH state under `<appData>/ssh-home` (t91 addendum). */
export const SSH_HOME_DIR_NAME = "ssh-home";

/** Launcher-published proof; cleared before every preflight and re-published on success. */
export const PREFLIGHT_ENV_KEYS = Object.freeze([
  EXPECT_ISOLATED_PROFILE_ENV,
  E2E_PROFILE_JSON_ENV,
  E2E_PREFLIGHT_ENV,
  WEBVIEW2_USER_DATA_FOLDER_ENV,
]);

export const E2E_BUILD_MANIFEST_FILE = "e2e-build-manifest.json";
export const E2E_BUILD_MANIFEST_SCHEMA = "sorng-e2e-build-manifest/v1";

export const PROFILE_DIRECTORY_KEYS = Object.freeze([
  "appData",
  "appLocalData",
  "appConfig",
  "appCache",
  "appLog",
]);

/** `BaseDirectory` values of `@tauri-apps/api/path` for `plugin:path|resolve_directory`. */
export const TAURI_PATH_DIRECTORY = Object.freeze({
  appConfig: 13,
  appData: 14,
  appLocalData: 15,
  appCache: 16,
  appLog: 17,
});

export const WINDOWS_APP_IMAGE_NAMES = Object.freeze([
  "app.exe",
  "sortOfRemoteNG.exe",
]);
export const POSIX_APP_IMAGE_NAMES = Object.freeze(["app", "sortOfRemoteNG"]);

export const AUTOSTART_REGISTRY_KEYS = Object.freeze([
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  // auto-launch also records a Task Manager "enabled" flag under the same name.
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
]);

const MAX_IDENTIFIER_LENGTH = 128;
const ISOLATED_IDENTIFIER_PATTERN = /^com\.sortofremote\.ng\.[a-z0-9-]+$/;
const ERROR_NOT_FOUND = 1168;
const LOG_PREFIX = "[e2e-isolation]";

// ── refusals ────────────────────────────────────────────────────────────────

const GUIDANCE = {
  INVALID_IDENTIFIER: {
    why: "e2e only runs builds compiled with a com.sortofremote.ng.<suffix> isolation identifier; any other identity could resolve the production profile.",
    fix: "Configure the harness with E2E_IDENTIFIER (or README_CAPTURE_IDENTIFIER for the README capture).",
  },
  INVALID_OPTIONS: {
    why: "The harness was configured without a complete isolation contract.",
    fix: 'Pass { expectedIdentifier, wipe: "before-and-after" | "none" } to the e2e driver service.',
  },
  BINARY_NOT_CONFIGURED: {
    why: "The guard must check exactly the one application WDIO will launch.",
    fix: 'Set exactly one "tauri:options".application (TAURI_BINARY_PATH) for the run.',
  },
  BINARY_MISSING: {
    why: "The configured application is not a regular file at a canonical path, so its identity cannot be proven.",
    fix: "Point TAURI_BINARY_PATH at the full, non-symlinked path printed by `npm run e2e:build`.",
  },
  BINARY_IN_SHARED_TARGET: {
    why: "Binaries under src-tauri/target are rebuilt in place by `tauri dev` with the production identifier, so the checked file may not be the file that launches.",
    fix: "Build with `npm run e2e:build` and use the copy under .artifacts/e2e/bin/.",
  },
  BINARY_CHANGED: {
    why: "The application file changed after its identity was verified.",
    fix: "Wait for the build that is writing it to finish, then rerun.",
  },
  MARKER_MISSING: {
    why: "The binary carries no SORNG_PROFILE_MARKER_V1 identity marker. It predates profile isolation and would open the production profile, WebView2 data and keychain.",
    fix: "Never launch this binary under e2e. Rebuild with `npm run e2e:build`.",
  },
  MARKER_PRODUCTION: {
    why: "The binary is compiled with the production identifier; launching it would open the user's real profile, WebView2 data and keychain entries.",
    fix: "Rebuild with `npm run e2e:build` (src-tauri/tauri.e2e.conf.json).",
  },
  MARKER_MISMATCH: {
    why: "The binary is compiled for a different isolation identifier than this harness expects.",
    fix: "Use the binary built for the expected identifier.",
  },
  MARKER_AMBIGUOUS: {
    why: "The binary carries more than one distinct identity marker, so its identity cannot be proven.",
    fix: "Rebuild from a clean e2e target with `npm run e2e:build`.",
  },
  MANIFEST_INVALID: {
    why: "The build manifest beside the binary is unreadable or malformed.",
    fix: "Rebuild with `npm run e2e:build`.",
  },
  MANIFEST_MISMATCH: {
    why: "The binary does not match its build manifest (hash, size, name or identifier).",
    fix: "Rebuild with `npm run e2e:build`; do not edit files under .artifacts/e2e/bin/.",
  },
  PRODUCTION_PROCESS_RUNNING: {
    why: "A production-identifier sortOfRemoteNG process (for example `npm run tauri dev` or the installed app) is running. Strict policy: e2e never runs next to the real profile.",
    fix: `Close it yourself and rerun. Never stop someone else's \`tauri dev\`; wait for it to exit. Only after the isolation self-test passed may ${ALLOW_RUNNING_PRODUCTION_ENV}=1 override this check.`,
  },
  PROCESS_CHECK_FAILED: {
    why: "Running processes could not be listed, so the absence of a production app is unproven.",
    fix: "Make sure powershell.exe (Windows) or ps (POSIX) runs, then retry.",
  },
  E2E_BINARY_RUNNING: {
    why: "The e2e binary is already running. Another run is active or a crashed run left it behind; wiping its profile underneath it is unsafe.",
    fix: "Wait for the other run, or end that process tree after confirming it is an orphan.",
  },
  LOCK_HELD: {
    why: "Another e2e run holds the run lock for this identifier; runs share one isolated profile and must be serialised.",
    fix: "Wait for it to finish. The lock becomes stale only when its owning process has exited.",
  },
  LOCK_UNREADABLE: {
    why: "The run lock exists but cannot be parsed, so its owner is unknown.",
    fix: "Confirm no e2e run is active, then delete the lock file named above.",
  },
  PROBE_FAILED: {
    why: "The profile probe did not exit cleanly, so the binary's resolved profile is unproven.",
    fix: "Rebuild with `npm run e2e:build`; the probe must exit 0 without opening a window.",
  },
  PROBE_INVALID: {
    why: "The profile probe output does not satisfy the sorng-profile-probe/v1 contract.",
    fix: "Rebuild with `npm run e2e:build` so the harness and the binary agree on the contract.",
  },
  PROBE_PRODUCTION_PATH: {
    why: "The binary reports a profile directory that is, or overlaps, the production profile.",
    fix: "Do not run e2e with this binary. Report the probe output.",
  },
  WIPE_TARGET_UNSAFE: {
    why: "A wipe target could not be proven to be an isolated e2e profile root, so nothing was deleted.",
    fix: "Inspect the path named above; never delete it by hand unless it is an e2e root.",
  },
  WIPE_FAILED: {
    why: "The isolated e2e profile could not be removed, so the run would start from stale state.",
    fix: "Close any e2e app still holding files in it, then rerun.",
  },
  KEYCHAIN_TARGET_UNSAFE: {
    why: "A credential selected for cleanup is not an isolated e2e entry, so nothing was deleted.",
    fix: "Report this; the keychain cleanup selection is wrong.",
  },
  KEYCHAIN_CLEANUP_FAILED: {
    why: "Isolated e2e credential entries could not be listed or removed.",
    fix: "Retry; if it persists, remove the e2e (@<identifier>) entries in Credential Manager.",
  },
  AUTOSTART_NAME_UNSAFE: {
    why: "The autostart value name is not the exact isolated e2e name, so it was not touched.",
    fix: "Rebuild with `npm run e2e:build` so the probe reports the isolated autostart name.",
  },
  AUTOSTART_CLEANUP_FAILED: {
    why: "The isolated e2e autostart registry value could not be removed.",
    fix: "Remove the named value under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run.",
  },
  PREFLIGHT_MISSING: {
    why: "This WDIO worker has no proof that the launcher's isolation preflight passed for a live run.",
    fix: "Start e2e through the WDIO launcher with the isolation-aware driver service.",
  },
  RUN_ABORTED: {
    why: "An earlier worker in this run found the app outside its isolated profile and aborted the run.",
    fix: "Read the first worker's refusal; do not rerun until it is resolved.",
  },
  WORKER_PROFILE_MISMATCH: {
    why: "The running app resolved profile directories that differ from the verified probe.",
    fix: "Do not rerun. Report the directories above.",
  },
  RUN_DIR_UNSAFE: {
    why: "The per-run WebView2 run directory could not be proven to be a harness-owned run directory, so it was neither used nor deleted.",
    fix: `Unset ${E2E_RUN_ROOT_ENV}/${E2E_RUN_ID_ENV}/${E2E_RUN_DIR_ENV} overrides, or point ${E2E_RUN_ROOT_ENV} at a short directory outside every sortOfRemoteNG profile.`,
  },
  WEBVIEW2_POLICY_OVERRIDE: {
    why: "A WebView2 UserDataFolder policy applies to this app and can override the per-run WebView2 folder, which could put WebView storage in a shared profile.",
    fix: "Remove the named policy value (HKLM/HKCU Software\\Policies\\Microsoft\\Edge\\WebView2\\UserDataFolder) or run e2e on a machine without it.",
  },
  WEBVIEW2_POLICY_CHECK_FAILED: {
    why: "The WebView2 UserDataFolder policy keys could not be read, so the absence of an override is unproven.",
    fix: "Make sure reg.exe runs, then retry.",
  },
  WEBVIEW2_EVIDENCE_MISSING: {
    why: "The running app did not show that WebView2 uses the per-run folder.",
    fix: "Do not rerun. Report the folders above; a policy or runtime may be ignoring the override.",
  },
  KNOWN_HOSTS_CHANGED: {
    why: "The real ~/.ssh/known_hosts changed during the run while no production app was running; isolated builds must never write it.",
    fix: "Do not rerun. Inspect the change yourself and report it.",
  },
};

export class E2eIsolationRefusal extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    const guidance = GUIDANCE[code] ?? {
      why: "Profile isolation could not be proven.",
      fix: "Report this refusal.",
    };
    super(
      [
        `e2e refused to run [${code}]: ${detail}`,
        `  Why: ${guidance.why}`,
        `  Fix: ${guidance.fix}`,
      ].join("\n"),
    );
    this.name = "E2eIsolationRefusal";
    this.code = code;
    this.detail = detail;
  }
}

function refuse(code, detail) {
  return new E2eIsolationRefusal(code, detail);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

// ── identifiers ─────────────────────────────────────────────────────────────

/** @param {unknown} identifier */
export function isIsolatedIdentifier(identifier) {
  return (
    typeof identifier === "string" &&
    identifier.length <= MAX_IDENTIFIER_LENGTH &&
    identifier !== PRODUCTION_IDENTIFIER &&
    ISOLATED_IDENTIFIER_PATTERN.test(identifier)
  );
}

/** @param {unknown} identifier */
export function assertIsolatedIdentifier(identifier) {
  if (!isIsolatedIdentifier(identifier)) {
    throw refuse(
      "INVALID_IDENTIFIER",
      `${JSON.stringify(identifier)} is not an isolation identifier (expected ${ISOLATED_IDENTIFIER_PATTERN}, never ${PRODUCTION_IDENTIFIER}).`,
    );
  }
  return /** @type {string} */ (identifier);
}

export function profileMarkerFor(identifier) {
  return `${PROFILE_MARKER_PREFIX}${identifier}${PROFILE_MARKER_SUFFIX}`;
}

export function keychainNamespaceFor(identifier) {
  return `@${assertIsolatedIdentifier(identifier)}`;
}

export function autostartNameFor(identifier) {
  return `${PRODUCT_NAME} (${assertIsolatedIdentifier(identifier)})`;
}

// ── paths ───────────────────────────────────────────────────────────────────

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function foldCase(value, platform) {
  return platform === "win32" ? value.toLowerCase() : value;
}

function stripTrailingSeparators(value, platform) {
  const api = pathApi(platform);
  const { root } = api.parse(value);
  let result = value;
  while (
    result.length > root.length &&
    (result.endsWith("/") || (platform === "win32" && result.endsWith("\\")))
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

function pathComponents(value, platform) {
  const api = pathApi(platform);
  const { root } = api.parse(value);
  const separators = platform === "win32" ? /[\\/]+/ : /\/+/;
  return value
    .slice(root.length)
    .split(separators)
    .filter((component) => component.length > 0);
}

/** Whether two absolute paths name the same location (case-insensitive on Windows). */
export function samePath(left, right, platform = process.platform) {
  const api = pathApi(platform);
  return (
    foldCase(
      stripTrailingSeparators(api.normalize(left), platform),
      platform,
    ) ===
    foldCase(stripTrailingSeparators(api.normalize(right), platform), platform)
  );
}

/** Whether `child` is `parent` or lies inside it. */
export function isSameOrInside(child, parent, platform = process.platform) {
  const api = pathApi(platform);
  const relative = api.relative(
    foldCase(api.normalize(parent), platform),
    foldCase(api.normalize(child), platform),
  );
  if (relative === "") {
    return true;
  }
  if (api.isAbsolute(relative)) {
    return false;
  }
  return pathComponents(relative, platform)[0] !== "..";
}

function isCanonicalAbsolute(value, platform) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const api = pathApi(platform);
  if (!api.isAbsolute(value)) {
    return false;
  }
  if (platform === "win32" && /^[\\/]{2}[?.][\\/]/.test(value)) {
    return false;
  }
  if (
    pathComponents(value, platform).some(
      (component) => component === "." || component === "..",
    )
  ) {
    return false;
  }
  return stripTrailingSeparators(api.normalize(value), platform) === value;
}

function countComponent(value, component, platform) {
  const wanted = foldCase(component, platform);
  return pathComponents(value, platform).filter(
    (entry) => foldCase(entry, platform) === wanted,
  ).length;
}

/** The prefix of `dir` up to and including its single `component` segment. */
function rootAtComponent(dir, component, platform) {
  const api = pathApi(platform);
  const { root } = api.parse(dir);
  const components = pathComponents(dir, platform);
  const wanted = foldCase(component, platform);
  const index = components.findIndex(
    (entry) => foldCase(entry, platform) === wanted,
  );
  if (index === -1) {
    return null;
  }
  return root + components.slice(0, index + 1).join(api.sep);
}

function replaceComponent(dir, from, to, platform) {
  const api = pathApi(platform);
  const { root } = api.parse(dir);
  const wanted = foldCase(from, platform);
  return (
    root +
    pathComponents(dir, platform)
      .map((entry) => (foldCase(entry, platform) === wanted ? to : entry))
      .join(api.sep)
  );
}

// ── identity marker scan ────────────────────────────────────────────────────

const MARKER_PREFIX_BYTES = Buffer.from(PROFILE_MARKER_PREFIX, "latin1");
const MARKER_SUFFIX_BYTE = PROFILE_MARKER_SUFFIX.charCodeAt(0);
// Enough trailing bytes to re-find a marker that straddles a chunk boundary.
const MARKER_WINDOW = MARKER_PREFIX_BYTES.length + MAX_IDENTIFIER_LENGTH + 1;
const INCOMPLETE = Symbol("incomplete");

function isIdentifierByte(byte) {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    byte === 0x2e ||
    byte === 0x2d
  );
}

function isAlphanumericByte(byte) {
  return isIdentifierByte(byte) && byte !== 0x2e && byte !== 0x2d;
}

function parseMarkerIdentifier(buffer, start, final) {
  let end = start;
  while (
    end < buffer.length &&
    end - start < MAX_IDENTIFIER_LENGTH &&
    isIdentifierByte(buffer[end])
  ) {
    end += 1;
  }
  if (end >= buffer.length) {
    return final ? null : INCOMPLETE;
  }
  if (
    buffer[end] !== MARKER_SUFFIX_BYTE ||
    end === start ||
    !isAlphanumericByte(buffer[start])
  ) {
    return null;
  }
  return buffer.toString("latin1", start, end);
}

/**
 * Incremental scanner for complete `SORNG_PROFILE_MARKER_V1[identifier=<id>]`
 * markers. Only a prefix followed by a valid identifier and `]` counts; matches
 * are keyed by absolute offset so overlap re-scans never double count.
 */
export function createProfileMarkerScanner() {
  let carry = Buffer.alloc(0);
  let carryOffset = 0;
  const matches = new Map();

  const scan = (buffer, base, final) => {
    let from = 0;
    for (;;) {
      const at = buffer.indexOf(MARKER_PREFIX_BYTES, from);
      if (at === -1) {
        break;
      }
      const identifier = parseMarkerIdentifier(
        buffer,
        at + MARKER_PREFIX_BYTES.length,
        final,
      );
      if (typeof identifier === "string") {
        matches.set(base + at, identifier);
      }
      from = at + 1;
    }
  };

  return {
    /** @param {Uint8Array} chunk */
    push(chunk) {
      const buffer = Buffer.concat([carry, Buffer.from(chunk)]);
      scan(buffer, carryOffset, false);
      const keepFrom = Math.max(0, buffer.length - (MARKER_WINDOW - 1));
      carry = Buffer.from(buffer.subarray(keepFrom));
      carryOffset += keepFrom;
    },
    finish() {
      scan(carry, carryOffset, true);
      carry = Buffer.alloc(0);
      const ordered = [...matches.entries()].sort(([a], [b]) => a - b);
      return {
        identifiers: [...new Set(ordered.map(([, identifier]) => identifier))],
        markerCount: ordered.length,
      };
    },
  };
}

/** Scans an in-memory buffer; `chunkSize` exercises the streaming path. */
export function scanProfileMarkerBuffer(buffer, { chunkSize } = {}) {
  const scanner = createProfileMarkerScanner();
  const size = chunkSize && chunkSize > 0 ? chunkSize : buffer.length || 1;
  for (let offset = 0; offset < buffer.length; offset += size) {
    scanner.push(buffer.subarray(offset, offset + size));
  }
  return scanner.finish();
}

/**
 * Streams `file` once, returning its markers, SHA-256 and size.
 * @param {string} file
 */
export async function inspectProfileBinary(
  file,
  { fs = nodeFs, chunkSize = 4 * 1024 * 1024 } = {},
) {
  const scanner = createProfileMarkerScanner();
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(file, {
    highWaterMark: chunkSize,
  })) {
    scanner.push(chunk);
    hash.update(chunk);
    size += chunk.length;
  }
  return { ...scanner.finish(), sha256: hash.digest("hex"), size };
}

/** Distinct marker identifiers in `file`, in file order. */
export async function scanProfileMarkers(file, options = {}) {
  return (await inspectProfileBinary(file, options)).identifiers;
}

// ── binary identity ─────────────────────────────────────────────────────────

function fingerprintOf(stat) {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    dev: stat.dev,
  };
}

function sameFingerprint(left, right) {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

/**
 * Whether `file` lies in a Cargo target that `tauri dev` rebuilds in place:
 * any `src-tauri/target` (this checkout, `.claude/worktrees/*`, or another
 * checkout), plus `<repoRoot>/src-tauri/target` explicitly.
 */
export function isInSharedCargoTarget(
  file,
  { repoRoot, platform = process.platform } = {},
) {
  if (
    repoRoot &&
    isSameOrInside(
      file,
      pathApi(platform).join(repoRoot, "src-tauri", "target"),
      platform,
    )
  ) {
    return true;
  }
  const components = pathComponents(file, platform).map((component) =>
    foldCase(component, platform),
  );
  return components.some(
    (component, index) =>
      component === "src-tauri" && components[index + 1] === "target",
  );
}

export function validateBuildManifest(
  manifest,
  { expectedIdentifier, binary, sha256, size, platform = process.platform },
) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw refuse("MANIFEST_INVALID", "the manifest is not a JSON object.");
  }
  if (manifest.schema !== E2E_BUILD_MANIFEST_SCHEMA) {
    throw refuse(
      "MANIFEST_INVALID",
      `schema is ${JSON.stringify(manifest.schema)}, expected ${E2E_BUILD_MANIFEST_SCHEMA}.`,
    );
  }
  const api = pathApi(platform);
  const problems = [];
  if (manifest.identifier !== expectedIdentifier) {
    problems.push(
      `identifier ${JSON.stringify(manifest.identifier)} != ${expectedIdentifier}`,
    );
  }
  if (
    typeof manifest.exe !== "string" ||
    manifest.exe !== api.basename(manifest.exe) ||
    foldCase(manifest.exe, platform) !==
      foldCase(api.basename(binary), platform)
  ) {
    problems.push(
      `exe ${JSON.stringify(manifest.exe)} is not the file name ${api.basename(binary)}`,
    );
  }
  if (manifest.sha256 !== sha256) {
    problems.push(`sha256 ${JSON.stringify(manifest.sha256)} != ${sha256}`);
  }
  if (manifest.size !== size) {
    problems.push(`size ${JSON.stringify(manifest.size)} != ${size}`);
  }
  if (problems.length > 0) {
    throw refuse("MANIFEST_MISMATCH", problems.join("; "));
  }
  return manifest;
}

/**
 * Proves the identity of the binary before anything launches it: a regular
 * file at a canonical path outside any shared Cargo target, carrying exactly
 * one distinct marker equal to `expectedIdentifier`, unchanged while scanned,
 * and matching `e2e-build-manifest.json` when one sits beside it.
 */
export async function assertIsolatedBinary({
  binary,
  expectedIdentifier,
  repoRoot,
  manifestPath,
  platform = process.platform,
  fs = nodeFs,
}) {
  const identifier = assertIsolatedIdentifier(expectedIdentifier);
  const api = pathApi(platform);
  if (typeof binary !== "string" || binary.trim().length === 0) {
    throw refuse("BINARY_NOT_CONFIGURED", "no application path was given.");
  }
  const resolved = api.resolve(binary.trim());

  let real;
  let before;
  try {
    const link = fs.lstatSync(resolved);
    if (link.isSymbolicLink()) {
      throw refuse("BINARY_MISSING", `${resolved} is a symbolic link.`);
    }
    real = fs.realpathSync.native(resolved);
    before = fs.statSync(real);
  } catch (error) {
    if (error instanceof E2eIsolationRefusal) {
      throw error;
    }
    throw refuse(
      "BINARY_MISSING",
      `${resolved} cannot be inspected: ${describeError(error)}`,
    );
  }
  if (!before.isFile()) {
    throw refuse("BINARY_MISSING", `${resolved} is not a regular file.`);
  }
  if (!samePath(real, resolved, platform)) {
    throw refuse(
      "BINARY_MISSING",
      `${resolved} resolves to ${real}; use the canonical path.`,
    );
  }
  if (isInSharedCargoTarget(resolved, { repoRoot, platform })) {
    throw refuse("BINARY_IN_SHARED_TARGET", resolved);
  }

  let inspection;
  try {
    inspection = await inspectProfileBinary(resolved, { fs });
  } catch (error) {
    throw refuse(
      "BINARY_MISSING",
      `${resolved} could not be read: ${describeError(error)}`,
    );
  }
  const after = fs.statSync(resolved);
  if (!sameFingerprint(fingerprintOf(before), fingerprintOf(after))) {
    throw refuse("BINARY_CHANGED", `${resolved} changed while it was scanned.`);
  }

  const { identifiers } = inspection;
  if (identifiers.length === 0) {
    throw refuse("MARKER_MISSING", `${resolved} has no identity marker.`);
  }
  if (identifiers.includes(PRODUCTION_IDENTIFIER)) {
    throw refuse(
      "MARKER_PRODUCTION",
      `${resolved} carries ${profileMarkerFor(PRODUCTION_IDENTIFIER)} (markers: ${identifiers.join(", ")}).`,
    );
  }
  if (identifiers.length > 1) {
    throw refuse(
      "MARKER_AMBIGUOUS",
      `${resolved} carries markers for ${identifiers.join(", ")}.`,
    );
  }
  if (identifiers[0] !== identifier) {
    throw refuse(
      "MARKER_MISMATCH",
      `${resolved} is compiled for ${identifiers[0]}, expected ${identifier}.`,
    );
  }

  const candidateManifest =
    manifestPath ?? api.join(api.dirname(resolved), E2E_BUILD_MANIFEST_FILE);
  let manifest = null;
  if (manifestPath || fs.existsSync(candidateManifest)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(candidateManifest, "utf8"));
    } catch (error) {
      throw refuse(
        "MANIFEST_INVALID",
        `${candidateManifest}: ${describeError(error)}`,
      );
    }
    manifest = validateBuildManifest(parsed, {
      expectedIdentifier: identifier,
      binary: resolved,
      sha256: inspection.sha256,
      size: inspection.size,
      platform,
    });
  }

  return {
    binary: resolved,
    identifier,
    identifiers,
    markerCount: inspection.markerCount,
    sha256: inspection.sha256,
    size: inspection.size,
    fingerprint: fingerprintOf(after),
    manifestPath: manifest ? candidateManifest : null,
  };
}

/** Refuses when a verified binary was replaced or modified since verification. */
export function assertBinaryUnchanged(verifiedBinary, { fs = nodeFs } = {}) {
  let current;
  try {
    current = fingerprintOf(fs.statSync(verifiedBinary.binary));
  } catch (error) {
    throw refuse(
      "BINARY_CHANGED",
      `${verifiedBinary.binary} is no longer readable: ${describeError(error)}`,
    );
  }
  if (!sameFingerprint(current, verifiedBinary.fingerprint)) {
    throw refuse(
      "BINARY_CHANGED",
      `${verifiedBinary.binary} changed after verification.`,
    );
  }
}

// ── profile probe ───────────────────────────────────────────────────────────

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Every production profile root the probe reports, one per distinct root. */
function productionRootsOf(probe, platform) {
  const roots = [];
  for (const key of PROFILE_DIRECTORY_KEYS) {
    const root = rootAtComponent(
      probe.productionDirs[key],
      PRODUCTION_IDENTIFIER,
      platform,
    );
    if (root && !roots.some((known) => samePath(known, root, platform))) {
      roots.push(root);
    }
  }
  return roots;
}

/**
 * Validates `sorng-profile-probe/v1` output for `expectedIdentifier`. Every
 * isolated directory must hold the identifier exactly once, have the matching
 * production directory as its identifier-swapped sibling, and neither contain
 * nor sit inside any production root. The WebView2 folder must stay out of the
 * production profile; with `expectedWebView2Folder` it must be exactly that
 * folder, selected by the launch flag. `sshHome` must be `<appData>/ssh-home`.
 */
export function validateProfileProbe(
  probe,
  expectedIdentifier,
  { platform = process.platform, expectedWebView2Folder } = {},
) {
  const identifier = assertIsolatedIdentifier(expectedIdentifier);
  const invalid = (detail) => refuse("PROBE_INVALID", detail);
  if (!isPlainObject(probe)) {
    throw invalid("the probe output is not a JSON object.");
  }
  if (probe.schema !== PROFILE_PROBE_SCHEMA) {
    throw invalid(
      `schema is ${JSON.stringify(probe.schema)}, expected ${PROFILE_PROBE_SCHEMA}.`,
    );
  }
  if (probe.identifier !== identifier) {
    throw invalid(
      `identifier is ${JSON.stringify(probe.identifier)}, expected ${identifier}.`,
    );
  }
  if (probe.marker !== profileMarkerFor(identifier)) {
    throw invalid(`marker is ${JSON.stringify(probe.marker)}.`);
  }
  if (probe.kind !== "isolated") {
    throw invalid(
      `kind is ${JSON.stringify(probe.kind)}, expected "isolated".`,
    );
  }
  if (probe.keychainNamespace !== keychainNamespaceFor(identifier)) {
    throw invalid(
      `keychainNamespace is ${JSON.stringify(probe.keychainNamespace)}, expected "@${identifier}".`,
    );
  }
  if (probe.autostartName !== autostartNameFor(identifier)) {
    throw invalid(
      `autostartName is ${JSON.stringify(probe.autostartName)}, expected ${JSON.stringify(autostartNameFor(identifier))}.`,
    );
  }
  if (!Number.isSafeInteger(probe.pid) || probe.pid <= 0) {
    throw invalid(`pid is ${JSON.stringify(probe.pid)}.`);
  }
  if (!isPlainObject(probe.dirs) || !isPlainObject(probe.productionDirs)) {
    throw invalid("dirs and productionDirs must be objects.");
  }

  for (const key of PROFILE_DIRECTORY_KEYS) {
    const dir = probe.dirs[key];
    const production = probe.productionDirs[key];
    if (!isCanonicalAbsolute(dir, platform)) {
      throw invalid(
        `dirs.${key} ${JSON.stringify(dir)} is not a canonical absolute path.`,
      );
    }
    if (!isCanonicalAbsolute(production, platform)) {
      throw invalid(
        `productionDirs.${key} ${JSON.stringify(production)} is not a canonical absolute path.`,
      );
    }
    if (countComponent(dir, PRODUCTION_IDENTIFIER, platform) > 0) {
      throw refuse(
        "PROBE_PRODUCTION_PATH",
        `dirs.${key} ${dir} contains the production identifier segment.`,
      );
    }
    if (countComponent(dir, identifier, platform) !== 1) {
      throw invalid(
        `dirs.${key} ${dir} must contain the ${identifier} segment exactly once.`,
      );
    }
    if (
      countComponent(production, PRODUCTION_IDENTIFIER, platform) !== 1 ||
      countComponent(production, identifier, platform) !== 0
    ) {
      throw invalid(
        `productionDirs.${key} ${production} must contain the ${PRODUCTION_IDENTIFIER} segment exactly once.`,
      );
    }
    if (samePath(dir, production, platform)) {
      throw refuse(
        "PROBE_PRODUCTION_PATH",
        `dirs.${key} equals its production directory ${production}.`,
      );
    }
    const sibling = replaceComponent(
      dir,
      identifier,
      PRODUCTION_IDENTIFIER,
      platform,
    );
    if (!samePath(sibling, production, platform)) {
      throw invalid(
        `productionDirs.${key} ${production} is not the production sibling of ${dir}.`,
      );
    }
  }

  const productionRoots = productionRootsOf(probe, platform);
  for (const key of PROFILE_DIRECTORY_KEYS) {
    const dir = probe.dirs[key];
    const root = rootAtComponent(dir, identifier, platform);
    for (const productionRoot of productionRoots) {
      if (
        isSameOrInside(dir, productionRoot, platform) ||
        isSameOrInside(productionRoot, root, platform)
      ) {
        throw refuse(
          "PROBE_PRODUCTION_PATH",
          `dirs.${key} ${dir} overlaps the production profile root ${productionRoot}.`,
        );
      }
    }
  }

  validateProbeWebView2(probe, productionRoots, {
    platform,
    expectedWebView2Folder,
  });

  const expectedSshHome = pathApi(platform).join(
    probe.dirs.appData,
    SSH_HOME_DIR_NAME,
  );
  if (
    typeof probe.sshHome !== "string" ||
    probe.sshHome !== stripTrailingSeparators(probe.sshHome, platform) ||
    !samePath(probe.sshHome, expectedSshHome, platform)
  ) {
    throw invalid(
      `sshHome is ${JSON.stringify(probe.sshHome ?? null)}, expected ${expectedSshHome}.`,
    );
  }
  return probe;
}

const WEBVIEW2_SOURCES = Object.freeze(["arg", "env", "tauri-default"]);

function validateProbeWebView2(
  probe,
  productionRoots,
  { platform, expectedWebView2Folder },
) {
  const invalid = (detail) => refuse("PROBE_INVALID", `webview2: ${detail}`);
  const webview2 = probe.webview2;
  if (!isPlainObject(webview2)) {
    throw invalid("the webview2 block is missing.");
  }
  if (!WEBVIEW2_SOURCES.includes(webview2.source)) {
    throw invalid(`source is ${JSON.stringify(webview2.source)}.`);
  }
  if (
    !isCanonicalAbsolute(webview2.tauriDefault, platform) ||
    !samePath(webview2.tauriDefault, probe.dirs.appLocalData, platform)
  ) {
    throw invalid(
      `tauriDefault ${JSON.stringify(webview2.tauriDefault)} is not dirs.appLocalData ${probe.dirs.appLocalData}.`,
    );
  }
  if (
    !isCanonicalAbsolute(webview2.productionDefault, platform) ||
    !samePath(
      webview2.productionDefault,
      probe.productionDirs.appLocalData,
      platform,
    )
  ) {
    throw invalid(
      `productionDefault ${JSON.stringify(webview2.productionDefault)} is not productionDirs.appLocalData ${probe.productionDirs.appLocalData}.`,
    );
  }

  const folder = webview2.userDataFolder;
  if (folder !== null && !isCanonicalAbsolute(folder, platform)) {
    throw invalid(
      `userDataFolder ${JSON.stringify(folder)} is not a canonical absolute path.`,
    );
  }
  if (folder !== null) {
    for (const productionRoot of [
      webview2.productionDefault,
      ...productionRoots,
    ]) {
      if (
        isSameOrInside(folder, productionRoot, platform) ||
        isSameOrInside(productionRoot, folder, platform)
      ) {
        throw refuse(
          "PROBE_PRODUCTION_PATH",
          `webview2.userDataFolder ${folder} overlaps the production profile ${productionRoot}.`,
        );
      }
    }
    if (countComponent(folder, PRODUCTION_IDENTIFIER, platform) > 0) {
      throw refuse(
        "PROBE_PRODUCTION_PATH",
        `webview2.userDataFolder ${folder} contains the production identifier segment.`,
      );
    }
  }

  if (expectedWebView2Folder !== undefined) {
    if (webview2.source !== "arg") {
      throw invalid(
        `source is ${JSON.stringify(webview2.source)}; a harness run must select its folder with ${WEBVIEW2_FOLDER_ARG}.`,
      );
    }
    if (
      folder === null ||
      !samePath(folder, expectedWebView2Folder, platform)
    ) {
      throw invalid(
        `userDataFolder ${JSON.stringify(folder)} is not the run folder ${expectedWebView2Folder}.`,
      );
    }
  }
}

/**
 * Runs `<binary> --sorng-profile-probe` for a binary that `assertIsolatedBinary`
 * verified. A pre-isolation binary would ignore the flag and open the
 * production profile, so an unverified or changed binary is never spawned.
 * With `runProfile`, the probe gets the exact WebView2 inputs of the run
 * (`webview2Launch`) and must report that folder, selected by the flag.
 */
export function runProfileProbe({
  verifiedBinary,
  expectedIdentifier,
  runProfile,
  timeoutMs = 30_000,
  env = process.env,
  spawnSync = nodeSpawnSync,
  tmpDir = os.tmpdir(),
  platform = process.platform,
  fs = nodeFs,
}) {
  const identifier = assertIsolatedIdentifier(expectedIdentifier);
  if (
    !isPlainObject(verifiedBinary) ||
    typeof verifiedBinary.binary !== "string" ||
    !Array.isArray(verifiedBinary.identifiers) ||
    verifiedBinary.identifiers.length !== 1 ||
    verifiedBinary.identifiers[0] !== identifier ||
    !isPlainObject(verifiedBinary.fingerprint)
  ) {
    throw refuse(
      "PROBE_FAILED",
      "the probe only runs a binary verified by assertIsolatedBinary for the same identifier.",
    );
  }
  assertBinaryUnchanged(verifiedBinary, { fs });
  const launch = runProfile
    ? webview2Launch(runProfile, { platform })
    : { env: {}, args: [] };

  const workDir = fs.mkdtempSync(path.join(tmpDir, "sorng-profile-probe-"));
  const outFile = path.join(workDir, "probe.json");
  try {
    const childEnv = { ...env };
    delete childEnv[WEBVIEW2_USER_DATA_FOLDER_ENV];
    const result = spawnSync(
      verifiedBinary.binary,
      [PROFILE_PROBE_ARG, ...launch.args],
      {
        env: {
          ...childEnv,
          ...launch.env,
          [PROFILE_PROBE_OUT_ENV]: outFile,
          [EXPECT_ISOLATED_PROFILE_ENV]: identifier,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        windowsHide: true,
        shell: false,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const stderrTail = String(result?.stderr ?? "")
      .trim()
      .slice(-2000);
    if (result?.error) {
      const timedOut =
        /** @type {NodeJS.ErrnoException} */ (result.error).code ===
        "ETIMEDOUT";
      throw refuse(
        "PROBE_FAILED",
        timedOut
          ? `the probe did not exit within ${timeoutMs} ms and was killed.`
          : `the probe could not start: ${describeError(result.error)}`,
      );
    }
    if (result?.status !== 0) {
      throw refuse(
        "PROBE_FAILED",
        `the probe exited with ${result?.status ?? `signal ${result?.signal}`}${stderrTail ? `: ${stderrTail}` : "."}`,
      );
    }
    let probe;
    try {
      probe = JSON.parse(fs.readFileSync(outFile, "utf8"));
    } catch (error) {
      throw refuse(
        "PROBE_INVALID",
        `no readable probe JSON at ${PROFILE_PROBE_OUT_ENV}: ${describeError(error)}`,
      );
    }
    validateProfileProbe(probe, identifier, {
      platform,
      expectedWebView2Folder: runProfile ? runProfile.webview2Dir : undefined,
    });
    if (Number.isSafeInteger(result.pid) && probe.pid !== result.pid) {
      throw refuse(
        "PROBE_INVALID",
        `probe pid ${probe.pid} is not the spawned process ${result.pid}.`,
      );
    }
    assertBinaryUnchanged(verifiedBinary, { fs });
    return probe;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Unique isolated profile roots (the prefix ending at the identifier segment). */
export function profileRoots(probe, { platform = process.platform } = {}) {
  return profileRootPairs(probe, { platform }).map(({ root }) => root);
}

/** Each isolated root with the production root at the same parent. */
export function profileRootPairs(probe, { platform = process.platform } = {}) {
  validateProfileProbe(probe, probe?.identifier, { platform });
  const pairs = [];
  for (const key of PROFILE_DIRECTORY_KEYS) {
    const root = rootAtComponent(probe.dirs[key], probe.identifier, platform);
    const productionRoot = rootAtComponent(
      probe.productionDirs[key],
      PRODUCTION_IDENTIFIER,
      platform,
    );
    if (!pairs.some((pair) => samePath(pair.root, root, platform))) {
      pairs.push({ root, productionRoot });
    }
  }
  return pairs;
}

// ── wipe ────────────────────────────────────────────────────────────────────

/**
 * Throws unless `root` is provably an isolated e2e profile root of `probe`:
 * canonical absolute, not a filesystem root or its direct child, basename equal
 * to the isolation identifier, derived from the probe, beside its production
 * sibling without overlapping any production root, and (when present) a real
 * directory rather than a symlink or junction.
 */
export function assertSafeWipeTarget(
  root,
  probe,
  { platform = process.platform, fs = nodeFs } = {},
) {
  const unsafe = (detail) =>
    refuse("WIPE_TARGET_UNSAFE", `${JSON.stringify(root)}: ${detail}`);
  let pairs;
  try {
    pairs = profileRootPairs(probe, { platform });
  } catch (error) {
    throw unsafe(
      `the probe is not a valid isolated probe (${describeError(error)}).`,
    );
  }
  const api = pathApi(platform);
  const identifier = probe.identifier;
  if (!isCanonicalAbsolute(root, platform)) {
    throw unsafe("not a canonical absolute path.");
  }
  const parent = api.dirname(root);
  if (api.parse(root).root === root || api.parse(parent).root === parent) {
    throw unsafe("a filesystem root or a direct child of one.");
  }
  if (api.basename(root) !== identifier || !isIsolatedIdentifier(identifier)) {
    throw unsafe(`basename is not the isolation identifier ${identifier}.`);
  }
  const pair = pairs.find((candidate) =>
    samePath(candidate.root, root, platform),
  );
  if (!pair) {
    throw unsafe("not a profile root reported by the probe.");
  }
  if (!samePath(parent, api.dirname(pair.productionRoot), platform)) {
    throw unsafe(
      `its parent differs from the production root's parent ${api.dirname(pair.productionRoot)}.`,
    );
  }
  for (const { productionRoot } of pairs) {
    if (
      isSameOrInside(root, productionRoot, platform) ||
      isSameOrInside(productionRoot, root, platform)
    ) {
      throw unsafe(`overlaps the production root ${productionRoot}.`);
    }
  }

  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return { root, exists: false };
    }
    throw unsafe(`cannot be inspected (${describeError(error)}).`);
  }
  if (stat.isSymbolicLink()) {
    throw unsafe("is a symbolic link or junction.");
  }
  if (!stat.isDirectory()) {
    throw unsafe("is not a directory.");
  }
  const real = fs.realpathSync.native(root);
  if (!samePath(real, root, platform)) {
    throw unsafe(`resolves to ${real}.`);
  }
  return { root, exists: true };
}

/** Removes every isolated profile root of `probe`, asserting each first. */
export function wipeIsolatedProfile(
  probe,
  { platform = process.platform, fs = nodeFs } = {},
) {
  const roots = profileRoots(probe, { platform });
  for (const root of roots) {
    assertSafeWipeTarget(root, probe, { platform, fs });
  }
  const removed = [];
  for (const root of roots) {
    const target = assertSafeWipeTarget(root, probe, { platform, fs });
    if (!target.exists) {
      continue;
    }
    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
    } catch (error) {
      throw refuse("WIPE_FAILED", `${root}: ${describeError(error)}`);
    }
    if (fs.existsSync(root)) {
      throw refuse("WIPE_FAILED", `${root} still exists after removal.`);
    }
    removed.push(root);
  }
  return { roots, removed };
}

// ── per-run WebView2 folder ─────────────────────────────────────────────────

const RUN_ID_PATTERN = /^[0-9a-f]{12}$/;
const PROFILE_SEGMENT_PATTERN = /^com\.sortofremote\.ng(?:\..*)?$/i;
const STALE_RUN_DIR_MS = 6 * 60 * 60 * 1000;

function assertRunRoot(runRoot, platform) {
  const unsafe = (detail) =>
    refuse("RUN_DIR_UNSAFE", `runs root ${JSON.stringify(runRoot)}: ${detail}`);
  if (!isCanonicalAbsolute(runRoot, platform)) {
    throw unsafe("not a canonical absolute path.");
  }
  const api = pathApi(platform);
  if (api.parse(runRoot).root === runRoot) {
    throw unsafe("a filesystem root.");
  }
  if (
    pathComponents(runRoot, platform).some((component) =>
      PROFILE_SEGMENT_PATTERN.test(component),
    )
  ) {
    throw unsafe(
      "inside a sortOfRemoteNG profile directory (a profile wipe could remove it, or it could share production state).",
    );
  }
  // The app refuses WebView2 folders with 8.3 short names or components that
  // Windows silently rewrites, so refuse them here with an actionable message.
  if (
    platform === "win32" &&
    pathComponents(runRoot, platform).some(
      (component) =>
        /~\d/.test(component) ||
        /[. ]$/.test(component) ||
        component.includes(":"),
    )
  ) {
    throw unsafe(
      `uses an 8.3 short name or a component ending in '.' or ' '; set ${E2E_RUN_ROOT_ENV} to a long-name path.`,
    );
  }
}

function normaliseAbsolute(value, platform) {
  const api = pathApi(platform);
  return stripTrailingSeparators(api.normalize(value), platform);
}

/**
 * Resolves this run's WebView2 run directory. The values are published into
 * `env`, so WDIO workers (which re-parse the config) and later phases of a
 * pinned multi-phase run reuse the launcher's run, like `driver-ports.ts`.
 * Pure path logic: nothing is created here.
 *
 * - `SORNG_E2E_RUN_ID`: 12 lowercase hex characters.
 * - `SORNG_E2E_RUN_DIR`: `<runs root>/<run id>`, the runs root being
 *   `SORNG_E2E_RUN_ROOT`, else `%LOCALAPPDATA%\sorng-e2e-runs` on Windows,
 *   else `os.tmpdir()/sorng-e2e-runs`.
 * - `SORNG_E2E_WEBVIEW2_DIR`: `<run dir>/webview2`.
 */
export function resolveRunProfile({
  env = process.env,
  identifier,
  platform = process.platform,
  tmpDir = os.tmpdir(),
  createRunId = () => randomBytes(6).toString("hex"),
} = {}) {
  assertIsolatedIdentifier(identifier);
  const api = pathApi(platform);
  const override = env[E2E_RUN_ROOT_ENV]?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const base = override
    ? override
    : platform === "win32" && localAppData
      ? api.join(localAppData, RUNS_ROOT_NAME)
      : api.join(tmpDir, RUNS_ROOT_NAME);
  if (!api.isAbsolute(base)) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `runs root ${JSON.stringify(base)} is not absolute.`,
    );
  }
  const runRoot = normaliseAbsolute(base, platform);
  assertRunRoot(runRoot, platform);

  const pinnedRunId = env[E2E_RUN_ID_ENV]?.trim();
  const runId = pinnedRunId || createRunId();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `${E2E_RUN_ID_ENV} ${JSON.stringify(runId)} is not 12 lowercase hex characters.`,
    );
  }
  const runDir = api.join(runRoot, runId);
  const webview2Dir = api.join(runDir, RUN_WEBVIEW2_DIR_NAME);
  for (const [key, expected] of [
    [E2E_RUN_DIR_ENV, runDir],
    [E2E_WEBVIEW2_DIR_ENV, webview2Dir],
  ]) {
    const pinned = env[key]?.trim();
    if (pinned && !samePath(pinned, expected, platform)) {
      throw refuse(
        "RUN_DIR_UNSAFE",
        `${key} ${JSON.stringify(pinned)} is not ${expected} (derived from the runs root and run id).`,
      );
    }
  }

  env[E2E_RUN_ID_ENV] = runId;
  env[E2E_RUN_DIR_ENV] = runDir;
  env[E2E_WEBVIEW2_DIR_ENV] = webview2Dir;
  return { runId, runRoot, runDir, webview2Dir };
}

function assertRunProfileShape(runProfile, platform) {
  const api = pathApi(platform);
  if (
    !isPlainObject(runProfile) ||
    typeof runProfile.runId !== "string" ||
    !RUN_ID_PATTERN.test(runProfile.runId) ||
    typeof runProfile.runRoot !== "string" ||
    typeof runProfile.runDir !== "string" ||
    typeof runProfile.webview2Dir !== "string"
  ) {
    throw refuse("RUN_DIR_UNSAFE", "the run profile is malformed.");
  }
  assertRunRoot(runProfile.runRoot, platform);
  if (
    !samePath(
      runProfile.runDir,
      api.join(runProfile.runRoot, runProfile.runId),
      platform,
    ) ||
    !samePath(
      runProfile.webview2Dir,
      api.join(runProfile.runDir, RUN_WEBVIEW2_DIR_NAME),
      platform,
    )
  ) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `run dir ${runProfile.runDir} / ${runProfile.webview2Dir} is not derived from ${runProfile.runRoot} and ${runProfile.runId}.`,
    );
  }
  return runProfile;
}

/** The launch inputs that select the run's WebView2 folder (env and app flag). */
export function webview2Launch(
  runProfile,
  { platform = process.platform } = {},
) {
  const { webview2Dir } = assertRunProfileShape(runProfile, platform);
  return {
    env: { [WEBVIEW2_USER_DATA_FOLDER_ENV]: webview2Dir },
    args: [`${WEBVIEW2_FOLDER_ARG}=${webview2Dir}`],
  };
}

/**
 * Refuses launch args that do not select exactly this run's WebView2 folder
 * (the flag travels through `tauri:options.args` even if env is dropped).
 */
export function assertWebView2LaunchArgs(
  args,
  runProfile,
  { platform = process.platform } = {},
) {
  const [expected] = webview2Launch(runProfile, { platform }).args;
  const list = Array.isArray(args) ? args : [];
  const flags = list.filter(
    (arg) =>
      typeof arg === "string" &&
      (arg === WEBVIEW2_FOLDER_ARG ||
        arg.startsWith(`${WEBVIEW2_FOLDER_ARG}=`)),
  );
  if (flags.length !== 1 || flags[0] !== expected) {
    throw refuse(
      "INVALID_OPTIONS",
      `launch args must contain exactly ${expected}; found ${JSON.stringify(flags)}.`,
    );
  }
  return expected;
}

/**
 * Throws unless `dir` is a harness-owned run directory: directly under
 * `runRoot`, named by a 12-hex run id, holding a `.sorng-e2e-run` marker whose
 * content is that id, and neither it nor the marker a symlink or junction.
 */
export function assertSafeRunDir(
  dir,
  { runRoot, platform = process.platform, fs = nodeFs } = {},
) {
  const unsafe = (detail) =>
    refuse("RUN_DIR_UNSAFE", `${JSON.stringify(dir)}: ${detail}`);
  const api = pathApi(platform);
  if (typeof runRoot !== "string") {
    throw unsafe("no runs root to check against.");
  }
  assertRunRoot(runRoot, platform);
  if (!isCanonicalAbsolute(dir, platform)) {
    throw unsafe("not a canonical absolute path.");
  }
  if (!samePath(api.dirname(dir), runRoot, platform)) {
    throw unsafe(`its parent is not the runs root ${runRoot}.`);
  }
  const runId = api.basename(dir);
  if (!RUN_ID_PATTERN.test(runId)) {
    throw unsafe("its name is not a 12-hex run id.");
  }
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    throw unsafe(`cannot be inspected (${describeError(error)}).`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafe("is not a real directory (symlink, junction or file).");
  }
  if (!samePath(fs.realpathSync.native(dir), dir, platform)) {
    throw unsafe("resolves elsewhere.");
  }
  const markerPath = api.join(dir, RUN_DIR_MARKER_FILE);
  let markerStat;
  let marker;
  try {
    markerStat = fs.lstatSync(markerPath);
    marker = markerStat.isFile() ? fs.readFileSync(markerPath, "utf8") : null;
  } catch (error) {
    throw unsafe(
      `has no readable ${RUN_DIR_MARKER_FILE} (${describeError(error)}).`,
    );
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || marker !== runId) {
    throw unsafe(`its ${RUN_DIR_MARKER_FILE} does not contain ${runId}.`);
  }
  return { dir, runId, markerMtimeMs: markerStat.mtimeMs };
}

/**
 * Creates (or, for a pinned multi-phase run, re-verifies) the run directory,
 * its marker and its empty `webview2` folder.
 */
export function createRunDir(
  runProfile,
  { platform = process.platform, fs = nodeFs } = {},
) {
  const { runRoot, runDir, runId, webview2Dir } = assertRunProfileShape(
    runProfile,
    platform,
  );
  fs.mkdirSync(runRoot, { recursive: true });
  const rootStat = fs.lstatSync(runRoot);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    !samePath(fs.realpathSync.native(runRoot), runRoot, platform)
  ) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `runs root ${runRoot} is a symlink, junction or file.`,
    );
  }

  let created = false;
  try {
    fs.mkdirSync(runDir);
    created = true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
      throw refuse(
        "RUN_DIR_UNSAFE",
        `${runDir} cannot be created: ${describeError(error)}`,
      );
    }
  }
  if (created) {
    fs.writeFileSync(
      pathApi(platform).join(runDir, RUN_DIR_MARKER_FILE),
      runId,
      {
        flag: "wx",
      },
    );
  }
  const verified = assertSafeRunDir(runDir, { runRoot, platform, fs });

  try {
    fs.mkdirSync(webview2Dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
      throw refuse(
        "RUN_DIR_UNSAFE",
        `${webview2Dir} cannot be created: ${describeError(error)}`,
      );
    }
  }
  const webviewStat = fs.lstatSync(webview2Dir);
  if (webviewStat.isSymbolicLink() || !webviewStat.isDirectory()) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `${webview2Dir} is a symlink, junction or file.`,
    );
  }
  return { ...verified, created };
}

/** Removes a run directory after `assertSafeRunDir`; absent is fine. */
export function wipeRunDir(
  dir,
  { runRoot, platform = process.platform, fs = nodeFs } = {},
) {
  try {
    fs.lstatSync(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return false;
    }
    throw refuse("RUN_DIR_UNSAFE", `${dir}: ${describeError(error)}`);
  }
  assertSafeRunDir(dir, { runRoot, platform, fs });
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  } catch (error) {
    throw refuse("WIPE_FAILED", `${dir}: ${describeError(error)}`);
  }
  if (fs.existsSync(dir)) {
    throw refuse("WIPE_FAILED", `${dir} still exists after removal.`);
  }
  return true;
}

/** Run ids referenced by live run locks (any identifier) in `lockDir`. */
function liveLockRunIds(lockDir, fs, isAlive) {
  const ids = new Set();
  let names = [];
  try {
    names = fs.readdirSync(lockDir);
  } catch {
    return ids;
  }
  for (const name of names) {
    if (!/^sorng-e2e-.+\.lock$/.test(name)) {
      continue;
    }
    try {
      const record = JSON.parse(
        fs.readFileSync(path.join(lockDir, name), "utf8"),
      );
      if (typeof record?.runId === "string" && isAlive(record.pid)) {
        ids.add(record.runId);
      }
    } catch {
      // An unreadable lock protects nothing we can name; its owner refuses on its own.
    }
  }
  return ids;
}

/**
 * Best-effort removal of marker-verified run directories that no live lock
 * references and whose marker is older than `staleAfterMs`. Never throws.
 */
export function sweepStaleRunDirs({
  runRoot,
  keepRunIds = [],
  lockDir = os.tmpdir(),
  isAlive = isProcessAlive,
  now = () => new Date(),
  staleAfterMs = STALE_RUN_DIR_MS,
  platform = process.platform,
  fs = nodeFs,
  log = defaultLog,
}) {
  const removed = [];
  let names = [];
  try {
    assertRunRoot(runRoot, platform);
    names = fs.readdirSync(runRoot);
  } catch {
    return removed;
  }
  const live = liveLockRunIds(lockDir, fs, isAlive);
  for (const name of names) {
    if (
      !RUN_ID_PATTERN.test(name) ||
      keepRunIds.includes(name) ||
      live.has(name)
    ) {
      continue;
    }
    const dir = pathApi(platform).join(runRoot, name);
    try {
      const { markerMtimeMs } = assertSafeRunDir(dir, {
        runRoot,
        platform,
        fs,
      });
      if (now().getTime() - markerMtimeMs < staleAfterMs) {
        continue;
      }
      wipeRunDir(dir, { runRoot, platform, fs });
      removed.push(dir);
    } catch (error) {
      log.warn(
        `${LOG_PREFIX} left run dir ${dir} in place: ${describeError(error)}`,
      );
    }
  }
  return removed;
}

/** Value names from `reg query <key>` output (4-space separated rows). */
export function parseRegQueryValueNames(stdout) {
  const names = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z0-9_]+)(?: {4}.*)?$/.exec(line);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

/** Policy value names that would apply a UserDataFolder override to this app. */
export function findWebView2PolicyOverrides(names, { binary } = {}) {
  const watched = new Set(
    [...WINDOWS_APP_IMAGE_NAMES, "*"].map((name) => name.toLowerCase()),
  );
  if (binary) {
    watched.add(path.win32.basename(binary).toLowerCase());
  }
  return names.filter((name) => watched.has(name.toLowerCase()));
}

/**
 * Read-only check of the WebView2 `UserDataFolder` policy keys. A policy value
 * for `app.exe`, `sortOfRemoteNG.exe`, `*` or the binary's own name can override
 * the per-run folder, so its presence refuses the run.
 */
export function checkWebView2PolicyOverride({
  binary,
  platform = process.platform,
  exec = defaultExec,
} = {}) {
  if (platform !== "win32") {
    return { supported: false, overrides: [] };
  }
  const overrides = [];
  for (const key of WEBVIEW2_POLICY_KEYS) {
    const result = exec("reg.exe", ["query", key], {});
    if (result?.error) {
      throw refuse(
        "WEBVIEW2_POLICY_CHECK_FAILED",
        `reg query ${key}: ${execFailure(result)}`,
      );
    }
    if (result.status === 1) {
      continue;
    }
    if (result.status !== 0) {
      throw refuse(
        "WEBVIEW2_POLICY_CHECK_FAILED",
        `reg query ${key}: ${execFailure(result)}`,
      );
    }
    for (const name of findWebView2PolicyOverrides(
      parseRegQueryValueNames(result.stdout),
      { binary },
    )) {
      overrides.push(`${key}\\${name}`);
    }
  }
  if (overrides.length > 0) {
    throw refuse("WEBVIEW2_POLICY_OVERRIDE", overrides.join(", "));
  }
  return { supported: true, overrides };
}

const MTIME_TOLERANCE_MS = 2_000;

/**
 * Worker-side positive evidence that WebView2 honours the per-run folder:
 * `<webview2Dir>/EBWebView` appears (not older than the run marker) while the
 * identifier-default `<tauriDefault>/EBWebView` never exists. The production
 * WebView2 folder is never touched.
 */
export async function assertWebView2Evidence({
  probe,
  runProfile,
  timeoutMs = 15_000,
  pollMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  platform = process.platform,
  fs = nodeFs,
}) {
  const { runRoot, runDir, webview2Dir } = assertRunProfileShape(
    runProfile,
    platform,
  );
  const api = pathApi(platform);
  const { markerMtimeMs } = assertSafeRunDir(runDir, { runRoot, platform, fs });
  const runFolder = api.join(webview2Dir, "EBWebView");
  const defaultFolder = api.join(probe.webview2.tauriDefault, "EBWebView");
  const exists = (target) => {
    try {
      return fs.lstatSync(target);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };

  const deadline = now() + timeoutMs;
  for (;;) {
    if (exists(defaultFolder)) {
      throw refuse(
        "WEBVIEW2_EVIDENCE_MISSING",
        `${defaultFolder} exists, so WebView2 ignored the per-run folder ${webview2Dir}.`,
      );
    }
    const stat = exists(runFolder);
    if (
      stat &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.mtimeMs >= markerMtimeMs - MTIME_TOLERANCE_MS
    ) {
      return { runFolder, defaultFolder };
    }
    if (now() >= deadline) {
      throw refuse(
        "WEBVIEW2_EVIDENCE_MISSING",
        `${runFolder} did not appear within ${timeoutMs} ms.`,
      );
    }
    await sleep(pollMs);
  }
}

// ── command execution ───────────────────────────────────────────────────────

/**
 * Default synchronous executor: `(file, args, options) => spawnSync result`.
 * Tests inject a fake with the same shape.
 */
export function defaultExec(file, args, options = {}) {
  return nodeSpawnSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function encodePowerShellCommand(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function decodePowerShellCommand(encoded) {
  return Buffer.from(encoded, "base64").toString("utf16le");
}

function powerShellArgs(script) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodePowerShellCommand(script),
  ];
}

function psSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function execSucceeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function execFailure(result) {
  if (!result) {
    return "no result";
  }
  if (result.error) {
    return describeError(result.error);
  }
  const stderr = String(result.stderr ?? "")
    .trim()
    .slice(-1000);
  return `exit ${result.status ?? `signal ${result.signal}`}${stderr ? `: ${stderr}` : ""}`;
}

function runPowerShell(exec, script) {
  return exec("powershell.exe", powerShellArgs(script), {});
}

// ── keychain ────────────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Windows Credential Manager target of an isolated entry:
 * `<logical service without / @ *>@<identifier>/<account>`. Production services
 * never carry `@<identifier>`, so this cannot select a production entry.
 */
export function keychainTargetPattern(identifier) {
  return new RegExp(
    `^[^/@*]+@${escapeRegExp(assertIsolatedIdentifier(identifier))}/[^*]+$`,
  );
}

export function isIsolatedKeychainTarget(target, identifier) {
  return (
    typeof target === "string" &&
    isIsolatedIdentifier(identifier) &&
    keychainTargetPattern(identifier).test(target)
  );
}

// Reads only Flags, Type and TargetName of each CREDENTIALW; CredentialBlob is
// never dereferenced, so no secret material reaches this process.
const CREDENTIAL_INTEROP = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.Collections.Generic;",
  "using System.Runtime.InteropServices;",
  "public static class SorngE2eCredentials {",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  private struct CredentialHeader { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; }",
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  "  private static extern bool CredEnumerateW(string filter, UInt32 flags, out UInt32 count, out IntPtr credentials);",
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  "  private static extern bool CredDeleteW(string target, UInt32 type, UInt32 flags);",
  '  [DllImport("advapi32.dll")]',
  "  private static extern void CredFree(IntPtr buffer);",
  "  public static string[] GenericTargetNames() {",
  "    UInt32 count; IntPtr list;",
  "    if (!CredEnumerateW(null, 0, out count, out list)) {",
  "      int error = Marshal.GetLastWin32Error();",
  `      if (error == ${ERROR_NOT_FOUND}) { return new string[0]; }`,
  "      throw new System.ComponentModel.Win32Exception(error);",
  "    }",
  "    try {",
  "      List<string> names = new List<string>();",
  "      for (int index = 0; index < count; index++) {",
  "        IntPtr entry = Marshal.ReadIntPtr(list, index * IntPtr.Size);",
  "        CredentialHeader header = (CredentialHeader)Marshal.PtrToStructure(entry, typeof(CredentialHeader));",
  "        if (header.Type == 1 && header.TargetName != IntPtr.Zero) { names.Add(Marshal.PtrToStringUni(header.TargetName)); }",
  "      }",
  "      return names.ToArray();",
  "    } finally { CredFree(list); }",
  "  }",
  "  public static int DeleteGeneric(string target) {",
  "    if (CredDeleteW(target, 1, 0)) { return 0; }",
  "    return Marshal.GetLastWin32Error();",
  "  }",
  "}",
  "'@",
].join("\n");

export function buildKeychainListScript(identifier) {
  return [
    CREDENTIAL_INTEROP,
    `$pattern = [regex]${psSingleQuoted(keychainTargetPattern(identifier).source)}`,
    "$matched = @([SorngE2eCredentials]::GenericTargetNames() | Where-Object { $pattern.IsMatch($_) })",
    "ConvertTo-Json -InputObject @{ matched = $matched } -Compress",
  ].join("\n");
}

export function buildKeychainDeleteScript(identifier, targets) {
  for (const target of targets) {
    if (!isIsolatedKeychainTarget(target, identifier)) {
      throw refuse(
        "KEYCHAIN_TARGET_UNSAFE",
        `${JSON.stringify(target)} is not an isolated ${identifier} credential target.`,
      );
    }
  }
  return [
    CREDENTIAL_INTEROP,
    `$pattern = [regex]${psSingleQuoted(keychainTargetPattern(identifier).source)}`,
    `$targets = @(${targets.map(psSingleQuoted).join(", ")})`,
    "$results = @(foreach ($target in $targets) {",
    "  if (-not $pattern.IsMatch($target)) { throw 'refusing to delete a credential target outside the e2e namespace' }",
    "  [pscustomobject]@{ target = $target; error = [SorngE2eCredentials]::DeleteGeneric($target) }",
    "})",
    "ConvertTo-Json -InputObject $results -Compress",
  ].join("\n");
}

function parseJsonOutput(result, code, what) {
  try {
    return JSON.parse(String(result.stdout ?? "").trim());
  } catch (error) {
    throw refuse(
      code,
      `${what} returned unparseable output: ${describeError(error)}`,
    );
  }
}

/**
 * Deletes the generic credentials of the isolated namespace. The PowerShell
 * listing is re-validated here and the delete script re-checks each exact
 * name, so a selection bug refuses instead of deleting.
 */
export function cleanupIsolatedKeychain(
  identifier,
  { platform = process.platform, exec = defaultExec, log = defaultLog } = {},
) {
  assertIsolatedIdentifier(identifier);
  if (platform !== "win32") {
    log.warn(
      `${LOG_PREFIX} keychain cleanup is Windows-only; isolated @${identifier} entries on ${platform} are left in place.`,
    );
    return { supported: false, deleted: [], missing: [] };
  }

  const listed = runPowerShell(exec, buildKeychainListScript(identifier));
  if (!execSucceeded(listed)) {
    throw refuse(
      "KEYCHAIN_CLEANUP_FAILED",
      `listing credential targets failed: ${execFailure(listed)}`,
    );
  }
  const parsed = parseJsonOutput(
    listed,
    "KEYCHAIN_CLEANUP_FAILED",
    "the credential listing",
  );
  const matched = Array.isArray(parsed?.matched)
    ? parsed.matched
    : parsed?.matched == null
      ? []
      : [parsed.matched];
  for (const target of matched) {
    if (!isIsolatedKeychainTarget(target, identifier)) {
      throw refuse(
        "KEYCHAIN_TARGET_UNSAFE",
        `the listing selected ${JSON.stringify(target)}.`,
      );
    }
  }
  if (matched.length === 0) {
    return { supported: true, deleted: [], missing: [] };
  }

  const deletion = runPowerShell(
    exec,
    buildKeychainDeleteScript(identifier, matched),
  );
  if (!execSucceeded(deletion)) {
    throw refuse(
      "KEYCHAIN_CLEANUP_FAILED",
      `deleting credential targets failed: ${execFailure(deletion)}`,
    );
  }
  const rows = parseJsonOutput(
    deletion,
    "KEYCHAIN_CLEANUP_FAILED",
    "the credential deletion",
  );
  const results = Array.isArray(rows) ? rows : [rows];
  const deleted = [];
  const missing = [];
  const failed = [];
  for (const row of results) {
    if (!matched.includes(row?.target)) {
      throw refuse(
        "KEYCHAIN_TARGET_UNSAFE",
        `the deletion reported ${JSON.stringify(row?.target)}.`,
      );
    }
    if (row.error === 0) {
      deleted.push(row.target);
    } else if (row.error === ERROR_NOT_FOUND) {
      missing.push(row.target);
    } else {
      failed.push(`${row.target} (Win32 error ${row.error})`);
    }
  }
  if (failed.length > 0) {
    throw refuse("KEYCHAIN_CLEANUP_FAILED", failed.join(", "));
  }
  return { supported: true, deleted, missing };
}

// ── autostart ───────────────────────────────────────────────────────────────

/** The isolation identifier named by an exact isolated autostart value name. */
export function parseIsolatedAutostartName(name) {
  if (typeof name !== "string") {
    return null;
  }
  const match = /^sortOfRemoteNG \((com\.sortofremote\.ng\.[a-z0-9-]+)\)$/.exec(
    name,
  );
  return match && isIsolatedIdentifier(match[1]) ? match[1] : null;
}

/**
 * Removes the exact isolated autostart value (`sortOfRemoteNG (<identifier>)`)
 * from HKCU Run and StartupApproved\Run. Any other name is refused untouched.
 */
export function cleanupIsolatedAutostart(
  autostartName,
  {
    expectedIdentifier,
    platform = process.platform,
    exec = defaultExec,
    log = defaultLog,
  } = {},
) {
  const identifier = parseIsolatedAutostartName(autostartName);
  if (
    !identifier ||
    (expectedIdentifier !== undefined && identifier !== expectedIdentifier)
  ) {
    throw refuse(
      "AUTOSTART_NAME_UNSAFE",
      `${JSON.stringify(autostartName)} is not ${JSON.stringify(expectedIdentifier ? autostartNameFor(expectedIdentifier) : "sortOfRemoteNG (<isolation identifier>)")}.`,
    );
  }
  if (platform !== "win32") {
    log.warn(
      `${LOG_PREFIX} autostart cleanup is Windows-only; ${autostartName} on ${platform} is left in place.`,
    );
    return { supported: false, removed: [] };
  }

  const removed = [];
  for (const key of AUTOSTART_REGISTRY_KEYS) {
    const query = exec("reg.exe", ["query", key, "/v", autostartName], {});
    if (query?.error) {
      throw refuse(
        "AUTOSTART_CLEANUP_FAILED",
        `reg query ${key} failed: ${execFailure(query)}`,
      );
    }
    if (query.status === 1) {
      continue;
    }
    if (query.status !== 0) {
      throw refuse(
        "AUTOSTART_CLEANUP_FAILED",
        `reg query ${key} failed: ${execFailure(query)}`,
      );
    }
    const deletion = exec(
      "reg.exe",
      ["delete", key, "/v", autostartName, "/f"],
      {},
    );
    if (!execSucceeded(deletion)) {
      throw refuse(
        "AUTOSTART_CLEANUP_FAILED",
        `reg delete ${key} /v ${autostartName} failed: ${execFailure(deletion)}`,
      );
    }
    removed.push(key);
  }
  return { supported: true, removed };
}

// ── running processes ───────────────────────────────────────────────────────

/** Command lines of `tauri dev` launchers, which run the production identifier. */
export const TAURI_DEV_COMMAND_PATTERN =
  /(?:^|[\s"'\\/])(?:tauri-dev\.mjs|tauri:dev)(?=$|[\s"'])|(?:^|[\s"'\\/])(?:tauri|tauri\.js|tauri\.mjs|tauri\.cmd|cargo-tauri(?:\.exe)?)["']?\s+(?:tauri\s+)?dev(?=$|\s)/i;

// Command lines are only emitted for processes that mention "tauri", and they
// never leave the classifier: refusal messages name pid, image and reason only.
export const WINDOWS_PROCESS_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$names = @('app.exe', 'sortofremoteng.exe', 'node.exe', 'cargo.exe', 'cargo-tauri.exe')",
  "$rows = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Name -and ($names -contains $_.Name.ToLowerInvariant()) } | ForEach-Object {",
  "  $command = $null",
  "  if ($_.CommandLine -and ($_.CommandLine -match 'tauri')) { $command = [string]$_.CommandLine }",
  "  $image = $null",
  "  if ($_.ExecutablePath) { $image = [string]$_.ExecutablePath }",
  "  [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; executablePath = $image; commandLine = $command }",
  "})",
  "ConvertTo-Json -InputObject $rows -Compress -Depth 3",
].join("\n");

function parsePosixProcessList(stdout) {
  const records = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const args = match[2].trim();
    const executablePath = args.split(/\s+/)[0];
    records.push({
      pid: Number(match[1]),
      name: path.posix.basename(executablePath),
      executablePath,
      commandLine: /tauri/i.test(args) ? args : null,
    });
  }
  return records;
}

/** Lists candidate processes as `{ pid, name, executablePath, commandLine }`. */
export function listCandidateProcesses({
  platform = process.platform,
  exec = defaultExec,
} = {}) {
  if (platform === "win32") {
    const result = runPowerShell(exec, WINDOWS_PROCESS_QUERY_SCRIPT);
    if (!execSucceeded(result)) {
      throw refuse("PROCESS_CHECK_FAILED", execFailure(result));
    }
    const text = String(result.stdout ?? "").trim();
    let parsed;
    try {
      parsed = text.length === 0 ? [] : JSON.parse(text);
    } catch (error) {
      throw refuse(
        "PROCESS_CHECK_FAILED",
        `unparseable process list: ${describeError(error)}`,
      );
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (
        !isPlainObject(row) ||
        !Number.isSafeInteger(row.pid) ||
        typeof row.name !== "string"
      ) {
        throw refuse("PROCESS_CHECK_FAILED", "malformed process record.");
      }
    }
    return rows;
  }
  const result = exec("ps", ["-axww", "-o", "pid=", "-o", "args="], {});
  if (!execSucceeded(result)) {
    throw refuse("PROCESS_CHECK_FAILED", execFailure(result));
  }
  return parsePosixProcessList(result.stdout);
}

/**
 * Pure classifier. `production`: any app image other than `binary` (an
 * unreadable image path counts as production) and any `tauri dev` launcher.
 * `sameBinary`: instances of the e2e binary itself.
 */
export function classifyProcesses(
  records,
  { binary, platform = process.platform, selfPid = process.pid } = {},
) {
  const imageNames = (
    platform === "win32" ? WINDOWS_APP_IMAGE_NAMES : POSIX_APP_IMAGE_NAMES
  ).map((name) => foldCase(name, platform));
  const production = [];
  const sameBinary = [];
  for (const record of records) {
    if (record.pid === selfPid) {
      continue;
    }
    const summary = {
      pid: record.pid,
      name: record.name,
      executablePath: record.executablePath ?? null,
    };
    if (imageNames.includes(foldCase(String(record.name), platform))) {
      if (!record.executablePath) {
        production.push({
          ...summary,
          reason: "app image whose path is unreadable (assumed production)",
        });
      } else if (binary && samePath(record.executablePath, binary, platform)) {
        sameBinary.push({ ...summary, reason: "the e2e binary" });
      } else {
        production.push({
          ...summary,
          reason: "app image outside the verified e2e binary",
        });
      }
      continue;
    }
    if (
      typeof record.commandLine === "string" &&
      TAURI_DEV_COMMAND_PATTERN.test(record.commandLine)
    ) {
      production.push({
        ...summary,
        reason: "`tauri dev` launcher (production identifier)",
      });
    }
  }
  return { production, sameBinary };
}

export function inspectRunningProcesses(binary, options = {}) {
  return classifyProcesses(listCandidateProcesses(options), {
    binary,
    platform: options.platform,
    selfPid: options.selfPid,
  });
}

/** Production-identifier processes running beside `binary`. */
export function listProductionProcesses(binary, options = {}) {
  return inspectRunningProcesses(binary, options).production;
}

function describeProcesses(processes) {
  return processes
    .map(
      ({ pid, name, executablePath, reason }) =>
        `pid ${pid} ${name}${executablePath ? ` (${executablePath})` : ""}: ${reason}`,
    )
    .join("; ");
}

// ── run lock ────────────────────────────────────────────────────────────────

export function runLockPath(identifier, { lockDir = os.tmpdir() } = {}) {
  return path.join(
    lockDir,
    `sorng-e2e-${assertIsolatedIdentifier(identifier)}.lock`,
  );
}

function runAbortPath(lockPath) {
  return `${lockPath}.abort`;
}

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/** The parsed lock file, `null` when absent; refuses when unreadable. */
export function readRunLock(identifier, { lockDir, fs = nodeFs } = {}) {
  const lockPath = runLockPath(identifier, { lockDir });
  let text;
  try {
    text = fs.readFileSync(lockPath, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw refuse("LOCK_UNREADABLE", `${lockPath}: ${describeError(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (
    !isPlainObject(parsed) ||
    !Number.isSafeInteger(parsed.pid) ||
    parsed.pid <= 0 ||
    typeof parsed.token !== "string" ||
    parsed.token.length === 0
  ) {
    throw refuse("LOCK_UNREADABLE", lockPath);
  }
  return { ...parsed, path: lockPath };
}

/**
 * Takes `os.tmpdir()/sorng-e2e-<identifier>.lock` with `wx`. A lock is stale
 * only when its pid is dead. A caller holding the lock may hand it to a child
 * run through `SORNG_E2E_RUN_LOCK_TOKEN` (same run id); the child then never
 * releases it. The record names the run id so workers can prove their run is live.
 */
export function acquireRunLock(
  identifier,
  {
    runId,
    lockDir,
    env = process.env,
    pid = process.pid,
    cwd = process.cwd(),
    now = () => new Date(),
    isAlive = isProcessAlive,
    fs = nodeFs,
    log = defaultLog,
  } = {},
) {
  const lockPath = runLockPath(identifier, { lockDir });
  if (runId !== undefined && !RUN_ID_PATTERN.test(runId)) {
    throw refuse(
      "RUN_DIR_UNSAFE",
      `run id ${JSON.stringify(runId)} is invalid.`,
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    const record = {
      pid,
      token,
      runId: runId ?? null,
      startedAt: now().toISOString(),
      cwd,
    };
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
        throw refuse("LOCK_UNREADABLE", `${lockPath}: ${describeError(error)}`);
      }
      const existing = readRunLock(identifier, { lockDir, fs });
      if (!existing) {
        continue;
      }
      const inheritedToken = env[RUN_LOCK_TOKEN_ENV];
      if (
        inheritedToken &&
        inheritedToken === existing.token &&
        (runId === undefined || existing.runId === runId) &&
        isAlive(existing.pid)
      ) {
        return { ...existing, path: lockPath, inherited: true };
      }
      if (isAlive(existing.pid)) {
        throw refuse(
          "LOCK_HELD",
          `${lockPath} is held by pid ${existing.pid} since ${existing.startedAt ?? "unknown"} (cwd ${existing.cwd ?? "unknown"}).`,
        );
      }
      log.warn(
        `${LOG_PREFIX} removing stale run lock of exited pid ${existing.pid}: ${lockPath}`,
      );
      fs.rmSync(lockPath, { force: true });
      fs.rmSync(runAbortPath(lockPath), { force: true });
      continue;
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify(record));
    } catch (error) {
      fs.closeSync(descriptor);
      fs.rmSync(lockPath, { force: true });
      throw refuse("LOCK_UNREADABLE", `${lockPath}: ${describeError(error)}`);
    }
    fs.closeSync(descriptor);
    return { ...record, path: lockPath, inherited: false };
  }
  throw refuse(
    "LOCK_HELD",
    `${lockPath} was re-created by another run while stale state was cleared.`,
  );
}

/** Releases a lock this run owns; never deletes another run's lock. */
export function releaseRunLock(lock, { fs = nodeFs } = {}) {
  if (!lock || lock.inherited) {
    return false;
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(lock.path, "utf8"));
  } catch {
    return false;
  }
  if (current?.token !== lock.token) {
    return false;
  }
  fs.rmSync(runAbortPath(lock.path), { force: true });
  fs.rmSync(lock.path, { force: true });
  return true;
}

/** Records that a worker found the run unsafe; later workers refuse to start. */
export function markRunAborted({
  identifier,
  runId,
  reason,
  lockDir,
  now = () => new Date(),
  fs = nodeFs,
}) {
  const abortPath = runAbortPath(runLockPath(identifier, { lockDir }));
  fs.writeFileSync(
    abortPath,
    JSON.stringify({ runId, reason, at: now().toISOString() }),
  );
  return abortPath;
}

function readRunAbort(lockPath, fs) {
  try {
    return JSON.parse(fs.readFileSync(runAbortPath(lockPath), "utf8"));
  } catch {
    return null;
  }
}

// ── metadata-only observation ───────────────────────────────────────────────

/**
 * Name, type, size and mtime of every entry under `dir` (lstat only; never
 * opens files and never follows links).
 */
export function snapshotFileMetadata(
  dir,
  { depth = Number.POSITIVE_INFINITY, maxEntries = 20_000, fs = nodeFs } = {},
) {
  const entries = [];
  let truncated = false;
  let rootStat;
  try {
    rootStat = fs.lstatSync(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return { root: dir, exists: false, truncated, entries };
    }
    throw error;
  }
  if (!rootStat.isDirectory()) {
    return { root: dir, exists: true, truncated, entries };
  }
  const pending = [{ absolute: dir, relative: "", level: 1 }];
  while (pending.length > 0 && !truncated) {
    const current =
      /** @type {{absolute: string, relative: string, level: number}} */ (
        pending.shift()
      );
    let names;
    try {
      names = fs.readdirSync(current.absolute).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      const absolute = path.join(current.absolute, name);
      const relative = current.relative ? `${current.relative}/${name}` : name;
      let stat;
      try {
        stat = fs.lstatSync(absolute);
      } catch {
        continue;
      }
      const type = stat.isSymbolicLink()
        ? "link"
        : stat.isDirectory()
          ? "dir"
          : stat.isFile()
            ? "file"
            : "other";
      entries.push({
        path: relative,
        type,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      if (type === "dir" && current.level < depth) {
        pending.push({ absolute, relative, level: current.level + 1 });
      }
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { root: dir, exists: true, truncated, entries };
}

/** SHA-256 of a file, or `null` when absent. The content is never returned. */
export function hashFileIfExists(file, { fs = nodeFs } = {}) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let read;
    while (
      (read = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0
    ) {
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

// ── launcher preflight ──────────────────────────────────────────────────────

const defaultLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export const WIPE_MODES = Object.freeze(["before-and-after", "none"]);

const PREFLIGHT_STEPS = 9;

/**
 * The launcher-side guard, run before tauri-driver starts:
 *   1. binary identity (marker scan, shared-target and manifest checks)
 *   2. WebView2 UserDataFolder policy check
 *   3. production-process check (strict unless SORNG_E2E_ALLOW_RUNNING_PRODUCTION=1)
 *   4. run lock (records the run id)
 *   5. run directory with its marker and empty `webview2` folder
 *   6. profile probe with the exact WebView2 launch inputs
 *   7. wipe of the asserted isolated roots, keychain entries and autostart value
 *   8. real known_hosts hash
 *   9. environment to publish
 * Returns that environment plus a synchronous `teardown()`. Refuses (throws
 * `E2eIsolationRefusal`) on any uncertainty, releasing the lock if it was taken.
 * Nothing is wiped unless the probe validated.
 */
export async function prepareIsolatedE2eRun({
  binary,
  expectedIdentifier,
  wipe,
  runProfile,
  repoRoot,
  env = process.env,
  platform = process.platform,
  exec = defaultExec,
  spawnSync = nodeSpawnSync,
  fs = nodeFs,
  lockDir,
  tmpDir = os.tmpdir(),
  isAlive = isProcessAlive,
  selfPid = process.pid,
  knownHostsPath = path.join(os.homedir(), ".ssh", "known_hosts"),
  probeTimeoutMs = 30_000,
  now = () => new Date(),
  log = defaultLog,
}) {
  const identifier = assertIsolatedIdentifier(expectedIdentifier);
  if (!WIPE_MODES.includes(wipe)) {
    throw refuse(
      "INVALID_OPTIONS",
      `wipe is ${JSON.stringify(wipe)}, expected one of ${WIPE_MODES.join(", ")}.`,
    );
  }
  if (!runProfile) {
    throw refuse(
      "INVALID_OPTIONS",
      "runProfile (resolveRunProfile) is required so WebView2 uses a per-run folder.",
    );
  }
  assertRunProfileShape(runProfile, platform);
  const step = (index, message) =>
    log.info(`${LOG_PREFIX} ${index}/${PREFLIGHT_STEPS} ${message}`);

  const verifiedBinary = await assertIsolatedBinary({
    binary,
    expectedIdentifier: identifier,
    repoRoot,
    platform,
    fs,
  });
  step(
    1,
    `binary ${verifiedBinary.binary}: marker [${verifiedBinary.identifiers.join(", ")}] x${verifiedBinary.markerCount}, sha256 ${verifiedBinary.sha256}${verifiedBinary.manifestPath ? ", manifest ok" : ", no manifest"}`,
  );

  const policy = checkWebView2PolicyOverride({
    binary: verifiedBinary.binary,
    platform,
    exec,
  });
  step(
    2,
    `WebView2 UserDataFolder policy: ${policy.supported ? "none" : `not applicable on ${platform}`}`,
  );

  const processes = inspectRunningProcesses(verifiedBinary.binary, {
    platform,
    exec,
    selfPid,
  });
  if (processes.sameBinary.length > 0) {
    throw refuse("E2E_BINARY_RUNNING", describeProcesses(processes.sameBinary));
  }
  const allowProduction = env[ALLOW_RUNNING_PRODUCTION_ENV] === "1";
  if (processes.production.length > 0 && !allowProduction) {
    throw refuse(
      "PRODUCTION_PROCESS_RUNNING",
      describeProcesses(processes.production),
    );
  }
  if (processes.production.length > 0) {
    // U1 "allow once proven": only this check is relaxed; every other guard
    // below still refuses.
    log.warn(
      [
        `${LOG_PREFIX} WARNING: ${ALLOW_RUNNING_PRODUCTION_ENV}=1 overrides the production-process refusal.`,
        `${LOG_PREFIX} Running next to production-identifier processes: ${describeProcesses(processes.production)}`,
        `${LOG_PREFIX} Use this only after the t91-g2 first-launch checklist has proven isolation for this binary.`,
      ].join("\n"),
    );
  }
  step(
    3,
    `production processes: ${processes.production.length === 0 ? "none" : `${processes.production.length} (allowed by override)`}`,
  );

  const lock = acquireRunLock(identifier, {
    runId: runProfile.runId,
    lockDir,
    env,
    pid: selfPid,
    now,
    isAlive,
    fs,
    log,
  });
  step(4, `run lock ${lock.path}${lock.inherited ? " (inherited)" : ""}`);

  let probe;
  let knownHostsHash;
  let createdRunDir = false;
  try {
    sweepStaleRunDirs({
      runRoot: runProfile.runRoot,
      keepRunIds: [runProfile.runId],
      lockDir,
      isAlive,
      now,
      platform,
      fs,
      log,
    });
    const runDir = createRunDir(runProfile, { platform, fs });
    createdRunDir = runDir.created;
    step(
      5,
      `run dir ${runProfile.runDir} (${runDir.created ? "created" : "reused, marker verified"})`,
    );

    probe = runProfileProbe({
      verifiedBinary,
      expectedIdentifier: identifier,
      runProfile,
      timeoutMs: probeTimeoutMs,
      env,
      spawnSync,
      tmpDir,
      platform,
      fs,
    });
    const roots = profileRootPairs(probe, { platform });
    for (const { root, productionRoot } of roots) {
      for (const profileRoot of [root, productionRoot]) {
        if (
          isSameOrInside(runProfile.runDir, profileRoot, platform) ||
          isSameOrInside(profileRoot, runProfile.runDir, platform)
        ) {
          throw refuse(
            "RUN_DIR_UNSAFE",
            `${runProfile.runDir} overlaps the profile root ${profileRoot}.`,
          );
        }
      }
    }
    if (runDir.created && fs.readdirSync(runProfile.webview2Dir).length > 0) {
      throw refuse(
        "PROBE_INVALID",
        `the probe wrote into the WebView2 run folder ${runProfile.webview2Dir}; it must create nothing.`,
      );
    }
    step(
      6,
      `probe: kind ${probe.kind}, keychain ${probe.keychainNamespace}, WebView2 ${probe.webview2.source} ${probe.webview2.userDataFolder}, roots ${roots.map(({ root }) => root).join(", ")}`,
    );

    if (wipe === "before-and-after") {
      const { removed } = wipeIsolatedProfile(probe, { platform, fs });
      const keychain = cleanupIsolatedKeychain(identifier, {
        platform,
        exec,
        log,
      });
      const autostart = cleanupIsolatedAutostart(probe.autostartName, {
        expectedIdentifier: identifier,
        platform,
        exec,
        log,
      });
      step(
        7,
        `pre-run wipe: ${removed.length} root(s), ${keychain.deleted.length} credential(s), ${autostart.removed.length} autostart value(s)`,
      );
    } else {
      step(7, "wipe: none (the caller owns the isolated profile lifecycle)");
    }

    knownHostsHash = hashFileIfExists(knownHostsPath, { fs });
    step(8, `real known_hosts ${knownHostsHash ? "hashed" : "absent"}`);
    assertBinaryUnchanged(verifiedBinary, { fs });
  } catch (error) {
    if (createdRunDir) {
      try {
        wipeRunDir(runProfile.runDir, {
          runRoot: runProfile.runRoot,
          platform,
          fs,
        });
      } catch (cleanupError) {
        log.warn(
          `${LOG_PREFIX} left run dir ${runProfile.runDir}: ${describeError(cleanupError)}`,
        );
      }
    }
    releaseRunLock(lock, { fs });
    throw error;
  }

  const runId = runProfile.runId;
  const publishedEnv = {
    [EXPECT_ISOLATED_PROFILE_ENV]: identifier,
    ...webview2Launch(runProfile, { platform }).env,
    [E2E_PROFILE_JSON_ENV]: JSON.stringify(probe),
    [E2E_PREFLIGHT_ENV]: `ok:${runId}`,
  };
  step(9, `published ${Object.keys(publishedEnv).join(", ")}`);

  let teardownReport = null;
  const teardown = () => {
    if (teardownReport) {
      return teardownReport;
    }
    const errors = [];
    const warnings = [];
    const attempt = (label, action) => {
      try {
        action();
      } catch (error) {
        errors.push(`${label}: ${describeError(error)}`);
      }
    };
    if (wipe === "before-and-after") {
      attempt("wipe", () => wipeIsolatedProfile(probe, { platform, fs }));
      attempt("keychain", () =>
        cleanupIsolatedKeychain(identifier, { platform, exec, log }),
      );
      attempt("autostart", () =>
        cleanupIsolatedAutostart(probe.autostartName, {
          expectedIdentifier: identifier,
          platform,
          exec,
          log,
        }),
      );
      if (env[KEEP_RUN_DIR_ENV] === "1") {
        warnings.push(
          `${KEEP_RUN_DIR_ENV}=1: kept run dir ${runProfile.runDir}.`,
        );
      } else {
        attempt("run dir", () =>
          wipeRunDir(runProfile.runDir, {
            runRoot: runProfile.runRoot,
            platform,
            fs,
          }),
        );
      }
    }
    attempt("known_hosts", () => {
      if (hashFileIfExists(knownHostsPath, { fs }) === knownHostsHash) {
        return;
      }
      if (processes.production.length > 0) {
        warnings.push(
          `${knownHostsPath} changed during the run; production processes were running (${describeProcesses(processes.production)}).`,
        );
        return;
      }
      throw refuse("KNOWN_HOSTS_CHANGED", knownHostsPath);
    });
    attempt("lock", () => releaseRunLock(lock, { fs }));
    for (const warning of warnings) {
      log.warn(`${LOG_PREFIX} ${warning}`);
    }
    for (const error of errors) {
      log.error(`${LOG_PREFIX} teardown ${error}`);
    }
    teardownReport = { errors, warnings };
    return teardownReport;
  };

  return {
    runId,
    identifier,
    wipe,
    binary: verifiedBinary,
    probe,
    lock,
    runProfile,
    knownHostsHash,
    productionProcesses: processes.production,
    env: publishedEnv,
    teardown,
  };
}

// ── worker verification ─────────────────────────────────────────────────────

/**
 * Worker-side proof that the launcher preflight passed for a live run: the
 * published `ok:<runId>` matching `SORNG_E2E_RUN_ID`, a probe that still
 * validates for the run's WebView2 folder, a live lock naming that run id, and
 * no abort recorded for the run.
 */
export function verifyWorkerPreflight({
  env = process.env,
  lockDir,
  isAlive = isProcessAlive,
  platform = process.platform,
  fs = nodeFs,
} = {}) {
  const preflight = /^ok:([0-9a-f]{12})$/.exec(env[E2E_PREFLIGHT_ENV] ?? "");
  if (!preflight || preflight[1] !== env[E2E_RUN_ID_ENV]) {
    throw refuse(
      "PREFLIGHT_MISSING",
      `${E2E_PREFLIGHT_ENV} is ${JSON.stringify(env[E2E_PREFLIGHT_ENV] ?? null)} for run ${JSON.stringify(env[E2E_RUN_ID_ENV] ?? null)}.`,
    );
  }
  const runId = preflight[1];
  const identifier = env[EXPECT_ISOLATED_PROFILE_ENV];
  if (!isIsolatedIdentifier(identifier)) {
    throw refuse(
      "PREFLIGHT_MISSING",
      `${EXPECT_ISOLATED_PROFILE_ENV} is ${JSON.stringify(identifier ?? null)}.`,
    );
  }
  const runProfile = resolveRunProfile({ env, identifier, platform });
  if (
    runProfile.runId !== runId ||
    !samePath(
      env[WEBVIEW2_USER_DATA_FOLDER_ENV] ?? "",
      runProfile.webview2Dir,
      platform,
    )
  ) {
    throw refuse(
      "PREFLIGHT_MISSING",
      `${WEBVIEW2_USER_DATA_FOLDER_ENV} is not the run folder ${runProfile.webview2Dir}.`,
    );
  }
  let probe;
  try {
    probe = JSON.parse(env[E2E_PROFILE_JSON_ENV] ?? "");
  } catch {
    throw refuse("PREFLIGHT_MISSING", `${E2E_PROFILE_JSON_ENV} is not JSON.`);
  }
  validateProfileProbe(probe, identifier, {
    platform,
    expectedWebView2Folder: runProfile.webview2Dir,
  });

  const lock = readRunLock(identifier, { lockDir, fs });
  if (!lock || lock.runId !== runId || !isAlive(lock.pid)) {
    throw refuse(
      "PREFLIGHT_MISSING",
      `the run lock for ${identifier} is not held by live run ${runId}.`,
    );
  }
  const abort = readRunAbort(lock.path, fs);
  if (abort && abort.runId === runId) {
    throw refuse("RUN_ABORTED", String(abort.reason ?? "no reason recorded"));
  }
  return { runId, identifier, probe, runProfile, lockPath: lock.path };
}

/** Compares app-resolved directories (path plugin) with the verified probe. */
export function assertResolvedProfileDirectories(
  probe,
  resolved,
  { platform = process.platform } = {},
) {
  validateProfileProbe(probe, probe?.identifier, { platform });
  const mismatches = [];
  for (const key of PROFILE_DIRECTORY_KEYS) {
    const actual = resolved?.[key];
    if (
      typeof actual !== "string" ||
      !isCanonicalAbsolute(actual, platform) ||
      !samePath(actual, probe.dirs[key], platform) ||
      countComponent(actual, probe.identifier, platform) !== 1 ||
      countComponent(actual, PRODUCTION_IDENTIFIER, platform) !== 0
    ) {
      mismatches.push(
        `${key}: app resolved ${JSON.stringify(actual ?? null)}, probe ${probe.dirs[key]}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw refuse("WORKER_PROFILE_MISMATCH", mismatches.join("; "));
  }
  return resolved;
}
