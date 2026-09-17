#!/usr/bin/env node
// The t91 first-launch checklist (plan §7 steps 2-13) as an automated,
// stop-on-first-unexpected self-test for one isolated e2e binary.
//
// It proves, with the binary itself, that an e2e launch stays out of the
// production profile: static identity, WebView2 policy, production processes,
// a metadata-only production snapshot, the exit-early probe, four refusal
// controls that must exit 78 and create nothing, and one direct launch that
// must create only isolated state. The production snapshot is compared after
// every launch. Teardown always runs and removes only asserted e2e state.
//
// The production snapshot records names, types, sizes and mtimes (never file
// contents), the SHA-256 of ~/.ssh/known_hosts, Credential Manager target
// names with LastWritten (never credential blobs) and HKCU Run value names.
// Snapshot locations come from the known-folder environment for observation
// only and are cross-checked against the probe; every wipe target still comes
// from the validated probe (scripts/lib/e2e-profile-isolation.mjs).
//
// Every process, the clock and the OS queries are injectable, so the phase
// ordering and the refusal matrix are unit-tested without launching anything.

import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ALLOW_RUNNING_PRODUCTION_ENV,
  E2E_BUILD_MANIFEST_FILE,
  E2E_IDENTIFIER,
  E2E_RUN_DIR_ENV,
  E2E_RUN_ID_ENV,
  E2E_WEBVIEW2_DIR_ENV,
  EXPECT_ISOLATED_PROFILE_ENV,
  PREFLIGHT_ENV_KEYS,
  PRODUCTION_IDENTIFIER,
  PROFILE_PROBE_ARG,
  PROFILE_PROBE_OUT_ENV,
  RUNS_ROOT_NAME,
  RUN_DIR_MARKER_FILE,
  RUN_LOCK_TOKEN_ENV,
  RUN_WEBVIEW2_DIR_NAME,
  WEBVIEW2_FOLDER_ARG,
  WEBVIEW2_USER_DATA_FOLDER_ENV,
  acquireRunLock,
  assertBinaryUnchanged,
  assertIsolatedBinary,
  buildKeychainListScript,
  checkWebView2PolicyOverride,
  cleanupIsolatedAutostart,
  cleanupIsolatedKeychain,
  createRunDir,
  defaultExec,
  encodePowerShellCommand,
  hashFileIfExists,
  inspectRunningProcesses,
  isIsolatedKeychainTarget,
  isProcessAlive,
  parseRegQueryValueNames,
  profileRootPairs,
  releaseRunLock,
  resolveRunProfile,
  runProfileProbe,
  samePath,
  snapshotFileMetadata,
  webview2Launch,
  wipeIsolatedProfile,
  wipeRunDir,
} from "./lib/e2e-profile-isolation.mjs";

/** @typedef {import("./lib/e2e-profile-isolation.mjs").EnvRecord} EnvRecord */
/** @typedef {import("./lib/e2e-profile-isolation.mjs").Exec} Exec */
/** @typedef {import("./lib/e2e-profile-isolation.mjs").Logger} Logger */
/** @typedef {import("./lib/e2e-profile-isolation.mjs").FileMetadataEntry} FileMetadataEntry */
/** @typedef {ReturnType<typeof snapshotFileMetadata>} MetadataSnapshot */
/**
 * @typedef {object} ProductionSnapshot
 * @property {string} capturedAt
 * @property {MetadataSnapshot} appData
 * @property {MetadataSnapshot} localData
 * @property {Array<{ path: string, exists: boolean, type: string | null, mtimeMs: number | null }>} webview2Storage
 * @property {{ roaming: string[] | null, local: string[] | null }} knownFolderNames
 * @property {MetadataSnapshot} ssh
 * @property {MetadataSnapshot} opk
 * @property {string | null} knownHostsSha256
 * @property {{ supported: boolean, entries: Array<{ target: string, type: number, lastWritten: string }> }} credentials
 * @property {{ supported: boolean, names: string[] }} runValues
 */
/**
 * @typedef {object} SnapshotChange
 * @property {string} section
 * @property {string} kind
 * @property {string} path
 * @property {string} [before]
 * @property {string} [after]
 */
/**
 * @typedef {object} PhaseRecord
 * @property {string} id
 * @property {string} step
 * @property {string} title
 * @property {"passed" | "unexpected" | "not-run"} status
 * @property {number} [durationMs]
 * @property {string} [summary]
 * @property {string} [code]
 * @property {string[]} [problems]
 * @property {string[]} [warnings]
 * @property {Record<string, any>} [evidence]
 */
/**
 * @typedef {object} SelftestReport
 * @property {string} schema
 * @property {string} identifier
 * @property {string} startedAt
 * @property {string | null} finishedAt
 * @property {string} binary
 * @property {string | null} sha256
 * @property {string | null} runId
 * @property {string | null} runDir
 * @property {"passed" | "stopped"} outcome
 * @property {string | null} stoppedAt
 * @property {"strict" | "informational"} productionComparison
 * @property {boolean} webview2Fallback
 * @property {string[]} wdioGroups
 * @property {PhaseRecord[]} phases
 */

const LOG_PREFIX = "[e2e:isolation:selftest]";
const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const SELFTEST_REPORT_SCHEMA = "sorng-e2e-isolation-selftest/v1";
/** The app's profile-guard refusal exit code (`src-tauri/src/app_profile.rs`). */
export const REFUSED_EXIT_CODE = 78;
export const MISMATCH_IDENTIFIER = `${E2E_IDENTIFIER}-mismatch`;
/** The namespaced vault DEK an isolated first launch bootstraps. */
export const VAULT_MASTER_DEK_TARGET = `com.sortofremoteng.vault@${E2E_IDENTIFIER}/master-dek`;
export const PRODUCTION_CREDENTIAL_PREFIXES = Object.freeze([
  "com.sortofremoteng.",
  "sortofremoteng.",
]);
/** Production WebView2 storage directories whose mtimes are recorded (stat only). */
export const PRODUCTION_WEBVIEW2_STORAGE_DIRS = Object.freeze([
  "EBWebView",
  "EBWebView/Default",
  "EBWebView/Default/Local Storage",
  "EBWebView/Default/Session Storage",
  "EBWebView/Default/IndexedDB",
  "EBWebView/Default/Cache",
  "EBWebView/Default/Code Cache",
]);
export const RUN_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const DEFAULT_LAUNCH_TIMEOUT_MS = 60_000;
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
export const DEFAULT_CONTROL_TIMEOUT_MS = 15_000;
export const EXIT_WAIT_MS = 15_000;
const SNAPSHOT_MAX_ENTRIES = 200_000;

/** WDIO hand-off groups in plan §7 order (steps 14, 15, 15a, 16). */
export const WDIO_GROUPS = Object.freeze([
  {
    name: "startup",
    step: "§7.14",
    specs: ["e2e/specs/01-startup/app-launch.spec.ts"],
  },
  {
    name: "mutating",
    step: "§7.15",
    specs: ["e2e/specs/02-collections/collection-create.spec.ts"],
  },
  {
    name: "ssh",
    step: "§7.15a",
    specs: [
      "e2e/specs/34-security-extended/trust-center-database.spec.ts",
      "e2e/specs/06-ssh/ssh-connect.spec.ts",
    ],
  },
  {
    name: "dsm",
    step: "§7.16",
    specs: ["e2e/specs/26-synology/dsm-web-autofill.spec.ts"],
  },
]);
export const DEFAULT_WDIO_GROUPS = Object.freeze(["startup", "mutating"]);

export const USAGE = [
  "usage: npm run e2e:isolation:selftest -- --binary <exe> [options]",
  "",
  "  --binary <exe>            the e2e binary from `npm run e2e:build` (required)",
  "  --report <file.json>      JSON report path (default .artifacts/e2e/selftest-<UTC>.json)",
  "  --launch-timeout-ms <n>   direct-launch evidence timeout (default 60000)",
  "  --keep-e2e-state          leave the isolated profile and run dir for inspection",
  `  --wdio[=<groups>]         after a pass, run WDIO specs in §7 order; groups: ${WDIO_GROUPS.map(({ name }) => name).join(", ")}, all (default ${DEFAULT_WDIO_GROUPS.join(",")})`,
  "",
  `Strict by default: stops while a production-identifier app runs. ${ALLOW_RUNNING_PRODUCTION_ENV}=1 makes production comparisons informational.`,
].join("\n");

export class SelftestUsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SelftestUsageError";
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

// ── arguments ───────────────────────────────────────────────────────────────

/**
 * @param {readonly string[]} argv
 */
export function parseSelftestArgs(argv) {
  const options = {
    help: false,
    /** @type {string | null} */
    binary: null,
    /** @type {string | null} */
    reportPath: null,
    keepE2eState: false,
    launchTimeoutMs: DEFAULT_LAUNCH_TIMEOUT_MS,
    /** @type {string[]} */
    wdioGroups: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const value = () => {
      if (inline !== undefined) {
        return inline;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new SelftestUsageError(`${name} needs a value.`);
      }
      index += 1;
      return next;
    };
    const flag = () => {
      if (inline !== undefined) {
        throw new SelftestUsageError(`${name} takes no value.`);
      }
      return true;
    };
    switch (name) {
      case "--help":
      case "-h":
        options.help = flag();
        break;
      case "--binary":
        options.binary = value();
        break;
      case "--report":
        options.reportPath = value();
        break;
      case "--keep-e2e-state":
        options.keepE2eState = flag();
        break;
      case "--launch-timeout-ms": {
        const text = value();
        const parsed = Number(text);
        if (!/^\d+$/.test(text) || parsed < 1_000 || parsed > 600_000) {
          throw new SelftestUsageError(
            `--launch-timeout-ms must be an integer between 1000 and 600000; got ${JSON.stringify(text)}.`,
          );
        }
        options.launchTimeoutMs = parsed;
        break;
      }
      case "--wdio":
        options.wdioGroups = parseWdioGroups(inline);
        break;
      default:
        throw new SelftestUsageError(`unknown option ${JSON.stringify(arg)}.`);
    }
  }
  if (!options.help && !options.binary?.trim()) {
    throw new SelftestUsageError("--binary <exe> is required.");
  }
  return options;
}

function parseWdioGroups(inline) {
  if (inline === undefined) {
    return [...DEFAULT_WDIO_GROUPS];
  }
  const requested = inline
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new SelftestUsageError("--wdio= needs at least one group.");
  }
  const known = WDIO_GROUPS.map(({ name }) => name);
  if (requested.includes("all")) {
    return known;
  }
  for (const group of requested) {
    if (!known.includes(group)) {
      throw new SelftestUsageError(
        `unknown WDIO group ${JSON.stringify(group)}; expected ${known.join(", ")} or all.`,
      );
    }
  }
  // Always §7 order, whatever order was typed.
  return known.filter((group) => requested.includes(group));
}

// ── locations ───────────────────────────────────────────────────────────────

/**
 * The known folders Tauri joins identifiers onto, for observation only.
 * @param {{ platform?: NodeJS.Platform, env?: EnvRecord, homeDir?: string }} [options]
 * @returns {{ roaming: string, local: string, home: string }}
 */
export function resolveKnownFolders({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (platform === "win32") {
    const roaming = env.APPDATA?.trim();
    const local = env.LOCALAPPDATA?.trim();
    if (
      !roaming ||
      !local ||
      !path.win32.isAbsolute(roaming) ||
      !path.win32.isAbsolute(local)
    ) {
      throw new Error(
        "APPDATA and LOCALAPPDATA must be absolute to locate the production profile for the snapshot.",
      );
    }
    return { roaming, local, home: homeDir };
  }
  const data =
    platform === "darwin"
      ? path.join(homeDir, "Library", "Application Support")
      : env.XDG_DATA_HOME?.trim() && path.isAbsolute(env.XDG_DATA_HOME.trim())
        ? env.XDG_DATA_HOME.trim()
        : path.join(homeDir, ".local", "share");
  return { roaming: data, local: data, home: homeDir };
}

/**
 * @param {{ knownFolders: { roaming: string, local: string, home: string }, identifier?: string }} options
 */
export function snapshotLocations({
  knownFolders,
  identifier = E2E_IDENTIFIER,
}) {
  const sshDir = path.join(knownFolders.home, ".ssh");
  return {
    roamingParent: knownFolders.roaming,
    localParent: knownFolders.local,
    productionRoaming: path.join(knownFolders.roaming, PRODUCTION_IDENTIFIER),
    productionLocal: path.join(knownFolders.local, PRODUCTION_IDENTIFIER),
    e2eRoaming: path.join(knownFolders.roaming, identifier),
    e2eLocal: path.join(knownFolders.local, identifier),
    sshDir,
    knownHosts: path.join(sshDir, "known_hosts"),
    opkDir: path.join(knownFolders.home, ".opk"),
  };
}

// ── OS adapter (Credential Manager, registry, processes) ────────────────────

// Reads only Type, TargetName and LastWritten of each CREDENTIALW. The
// CredentialBlob pointer is never dereferenced, so no secret reaches this
// process; targets outside the app's prefixes never leave PowerShell.
export const CREDENTIAL_METADATA_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.Collections.Generic;",
  "using System.Runtime.InteropServices;",
  "public class SorngCredentialMetadata { public string TargetName { get; set; } public UInt32 Type { get; set; } public string LastWritten { get; set; } }",
  "public static class SorngE2eCredentialMetadata {",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  private struct CredentialHeader { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public UInt32 LastWrittenLow; public UInt32 LastWrittenHigh; }",
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  "  private static extern bool CredEnumerateW(string filter, UInt32 flags, out UInt32 count, out IntPtr credentials);",
  '  [DllImport("advapi32.dll")]',
  "  private static extern void CredFree(IntPtr buffer);",
  "  public static SorngCredentialMetadata[] List() {",
  "    UInt32 count; IntPtr list;",
  "    if (!CredEnumerateW(null, 0, out count, out list)) {",
  "      int error = Marshal.GetLastWin32Error();",
  "      if (error == 1168) { return new SorngCredentialMetadata[0]; }",
  "      throw new System.ComponentModel.Win32Exception(error);",
  "    }",
  "    try {",
  "      List<SorngCredentialMetadata> rows = new List<SorngCredentialMetadata>();",
  "      for (int index = 0; index < count; index++) {",
  "        IntPtr entry = Marshal.ReadIntPtr(list, index * IntPtr.Size);",
  "        CredentialHeader header = (CredentialHeader)Marshal.PtrToStructure(entry, typeof(CredentialHeader));",
  "        if (header.TargetName == IntPtr.Zero) { continue; }",
  "        UInt64 written = ((UInt64)header.LastWrittenHigh << 32) | header.LastWrittenLow;",
  "        rows.Add(new SorngCredentialMetadata { TargetName = Marshal.PtrToStringUni(header.TargetName), Type = header.Type, LastWritten = written.ToString() });",
  "      }",
  "      return rows.ToArray();",
  "    } finally { CredFree(list); }",
  "  }",
  "}",
  "'@",
  `$prefixes = @(${PRODUCTION_CREDENTIAL_PREFIXES.map((prefix) => `'${prefix}'`).join(", ")})`,
  "$rows = @([SorngE2eCredentialMetadata]::List() | Where-Object { $name = $_.TargetName; @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 })",
  "ConvertTo-Json -InputObject @{ entries = $rows } -Compress -Depth 3",
].join("\n");

const ISOLATED_NAMESPACE_TARGET =
  /^[^/@*]+@com\.sortofremote\.ng\.[a-z0-9-]+\//i;

function hasProductionPrefix(target) {
  const lower = target.toLowerCase();
  return PRODUCTION_CREDENTIAL_PREFIXES.some((prefix) =>
    lower.startsWith(prefix),
  );
}

/**
 * Production credential metadata from `CREDENTIAL_METADATA_SCRIPT` output:
 * app-prefixed targets only, isolated `@com.sortofremote.ng.<suffix>`
 * namespaces excluded (they are tracked separately), sorted by target.
 * @param {unknown} stdout
 * @returns {Array<{ target: string, type: number, lastWritten: string }>}
 */
export function parseCredentialMetadata(stdout) {
  const parsed = JSON.parse(String(stdout ?? "").trim() || "{}");
  const rows =
    parsed?.entries == null
      ? []
      : Array.isArray(parsed.entries)
        ? parsed.entries
        : [parsed.entries];
  const entries = [];
  for (const row of rows) {
    if (
      typeof row?.TargetName !== "string" ||
      !Number.isSafeInteger(row.Type) ||
      typeof row.LastWritten !== "string" ||
      !/^\d+$/.test(row.LastWritten)
    ) {
      throw new Error("malformed credential metadata row.");
    }
    if (
      !hasProductionPrefix(row.TargetName) ||
      ISOLATED_NAMESPACE_TARGET.test(row.TargetName)
    ) {
      continue;
    }
    entries.push({
      target: row.TargetName,
      type: row.Type,
      lastWritten: row.LastWritten,
    });
  }
  return entries.sort((left, right) =>
    left.target < right.target ? -1 : left.target > right.target ? 1 : 0,
  );
}

function powerShell(exec, script) {
  return exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(script),
    ],
    {},
  );
}

function execOutcome(result, what) {
  if (!result || result.error || result.status !== 0) {
    const detail = !result
      ? "no result"
      : result.error
        ? describeError(result.error)
        : `exit ${result.status}: ${String(result.stderr ?? "")
            .trim()
            .slice(-500)}`;
    throw new Error(`${what} failed (${detail}).`);
  }
  return String(result.stdout ?? "");
}

/**
 * The real OS queries. Only Windows is supported: the §7 procedure depends on
 * Credential Manager, HKCU Run values and WebView2.
 * @param {{ platform?: NodeJS.Platform, exec?: Exec, log?: Logger }} [options]
 */
export function createSystemAdapter({
  platform = process.platform,
  exec = defaultExec,
  log = defaultLog,
} = {}) {
  const windows = platform === "win32";
  return {
    supported: windows,
    checkWebView2Policy: (binary) =>
      checkWebView2PolicyOverride({ binary, platform, exec }),
    inspectProcesses: (binary, selfPid) =>
      inspectRunningProcesses(binary, { platform, exec, selfPid }),
    listProductionCredentials() {
      if (!windows) {
        return { supported: false, entries: [] };
      }
      const stdout = execOutcome(
        powerShell(exec, CREDENTIAL_METADATA_SCRIPT),
        "listing credential metadata",
      );
      return { supported: true, entries: parseCredentialMetadata(stdout) };
    },
    listIsolatedCredentialTargets(identifier) {
      if (!windows) {
        return { supported: false, targets: [] };
      }
      const stdout = execOutcome(
        powerShell(exec, buildKeychainListScript(identifier)),
        "listing isolated credential targets",
      );
      const parsed = JSON.parse(stdout.trim() || "{}");
      const matched =
        parsed?.matched == null
          ? []
          : Array.isArray(parsed.matched)
            ? parsed.matched
            : [parsed.matched];
      for (const target of matched) {
        if (!isIsolatedKeychainTarget(target, identifier)) {
          throw new Error(
            `the isolated credential listing returned ${JSON.stringify(target)}.`,
          );
        }
      }
      return { supported: true, targets: [...matched].sort() };
    },
    listRunValueNames() {
      if (!windows) {
        return { supported: false, names: [] };
      }
      const result = exec("reg.exe", ["query", RUN_REGISTRY_KEY], {});
      if (result && !result.error && result.status === 1) {
        return { supported: true, names: [] };
      }
      const stdout = execOutcome(result, `reg query ${RUN_REGISTRY_KEY}`);
      return { supported: true, names: parseRegQueryValueNames(stdout).sort() };
    },
    cleanupKeychain: (identifier) =>
      cleanupIsolatedKeychain(identifier, { platform, exec, log }),
    cleanupAutostart: (autostartName, identifier) =>
      cleanupIsolatedAutostart(autostartName, {
        expectedIdentifier: identifier,
        platform,
        exec,
        log,
      }),
    /** Ends exactly this process tree; never by image name. */
    killTree(pid) {
      if (windows) {
        exec("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {});
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    },
  };
}

// ── production snapshot ─────────────────────────────────────────────────────

function lstatOrNull(fs, target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function entryType(stat) {
  return stat.isSymbolicLink()
    ? "link"
    : stat.isDirectory()
      ? "dir"
      : stat.isFile()
        ? "file"
        : "other";
}

function directoryNames(fs, dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Metadata-only picture of every production location an isolated launch must
 * leave alone (plan §7 step 6 and addendum §6).
 * @param {{ locations: ReturnType<typeof snapshotLocations>, adapter: any, fs?: typeof nodeFs, now?: () => Date, maxEntries?: number }} options
 * @returns {ProductionSnapshot}
 */
export function captureProductionSnapshot({
  locations,
  adapter,
  fs = nodeFs,
  now = () => new Date(),
  maxEntries = SNAPSHOT_MAX_ENTRIES,
}) {
  return {
    capturedAt: now().toISOString(),
    appData: snapshotFileMetadata(locations.productionRoaming, {
      fs,
      maxEntries,
    }),
    localData: snapshotFileMetadata(locations.productionLocal, {
      depth: 1,
      fs,
      maxEntries,
    }),
    webview2Storage: PRODUCTION_WEBVIEW2_STORAGE_DIRS.map((relative) => {
      const stat = lstatOrNull(
        fs,
        path.join(locations.productionLocal, ...relative.split("/")),
      );
      return stat
        ? {
            path: relative,
            exists: true,
            type: entryType(stat),
            mtimeMs: stat.mtimeMs,
          }
        : { path: relative, exists: false, type: null, mtimeMs: null };
    }),
    knownFolderNames: {
      roaming: directoryNames(fs, locations.roamingParent),
      local: directoryNames(fs, locations.localParent),
    },
    ssh: snapshotFileMetadata(locations.sshDir, { depth: 1, fs, maxEntries }),
    opk: snapshotFileMetadata(locations.opkDir, { depth: 1, fs, maxEntries }),
    knownHostsSha256: hashFileIfExists(locations.knownHosts, { fs }),
    credentials: adapter.listProductionCredentials(),
    runValues: adapter.listRunValueNames(),
  };
}

/**
 * Counts only; the report never copies the production listings.
 * @param {ProductionSnapshot} snapshot
 */
export function summarizeSnapshot(snapshot) {
  return {
    appDataEntries: snapshot.appData.exists
      ? snapshot.appData.entries.length
      : null,
    localDataEntries: snapshot.localData.exists
      ? snapshot.localData.entries.length
      : null,
    webview2StorageDirs: snapshot.webview2Storage.filter(({ exists }) => exists)
      .length,
    sshEntries: snapshot.ssh.exists ? snapshot.ssh.entries.length : null,
    opkEntries: snapshot.opk.exists ? snapshot.opk.entries.length : null,
    knownHosts: snapshot.knownHostsSha256 ? "hashed" : "absent",
    credentials: snapshot.credentials.supported
      ? snapshot.credentials.entries.length
      : "unsupported",
    runValues: snapshot.runValues.supported
      ? snapshot.runValues.names.length
      : "unsupported",
  };
}

/**
 * Why a snapshot cannot support a complete comparison, if it cannot.
 * @param {ProductionSnapshot} snapshot
 * @returns {string[]}
 */
export function snapshotGaps(snapshot) {
  const gaps = [];
  for (const section of ["appData", "localData", "ssh", "opk"]) {
    if (snapshot[section].truncated) {
      gaps.push(`${section} listing was truncated`);
    }
  }
  if (!snapshot.credentials.supported) {
    gaps.push("credential metadata is unavailable on this host");
  }
  if (!snapshot.runValues.supported) {
    gaps.push("HKCU Run values are unavailable on this host");
  }
  return gaps;
}

function diffMetadata(section, before, after, record) {
  if (before.exists !== after.exists) {
    record(section, after.exists ? "added" : "removed", "<root>");
  }
  if (before.truncated || after.truncated) {
    record(section, "incomplete", "<root>");
  }
  const previous = new Map(before.entries.map((entry) => [entry.path, entry]));
  const current = new Map(after.entries.map((entry) => [entry.path, entry]));
  for (const [name, entry] of current) {
    const old = previous.get(name);
    if (!old) {
      record(section, "added", name);
    } else if (
      old.type !== entry.type ||
      old.size !== entry.size ||
      old.mtimeMs !== entry.mtimeMs
    ) {
      record(section, "changed", name, {
        before: `${old.type} ${old.size} B mtime ${old.mtimeMs}`,
        after: `${entry.type} ${entry.size} B mtime ${entry.mtimeMs}`,
      });
    }
  }
  for (const name of previous.keys()) {
    if (!current.has(name)) {
      record(section, "removed", name);
    }
  }
}

/**
 * Every difference between two production snapshots. `allowedKnownFolderNames`
 * lists the e2e names that may appear or vanish directly under the roaming and
 * local known folders; `allowedRunValues` the isolated autostart value names.
 * @param {ProductionSnapshot} before
 * @param {ProductionSnapshot} after
 * @param {{ allowedKnownFolderNames?: { roaming?: readonly string[], local?: readonly string[] }, allowedRunValues?: readonly string[] }} [options]
 * @returns {{ changes: SnapshotChange[], expected: SnapshotChange[] }}
 */
export function diffSnapshots(
  before,
  after,
  {
    allowedKnownFolderNames = { roaming: [], local: [] },
    allowedRunValues = [],
  } = {},
) {
  const changes = [];
  const expected = [];
  const record = (section, kind, name, detail = {}) =>
    changes.push({ section, kind, path: name, ...detail });

  for (const section of ["appData", "localData", "ssh", "opk"]) {
    diffMetadata(section, before[section], after[section], record);
  }

  const storageBefore = new Map(
    before.webview2Storage.map((entry) => [entry.path, entry]),
  );
  for (const entry of after.webview2Storage) {
    const old = storageBefore.get(entry.path);
    if (
      !old ||
      old.exists !== entry.exists ||
      old.type !== entry.type ||
      old.mtimeMs !== entry.mtimeMs
    ) {
      record("webview2Storage", "changed", entry.path, {
        before: old?.exists ? `mtime ${old.mtimeMs}` : "absent",
        after: entry.exists ? `mtime ${entry.mtimeMs}` : "absent",
      });
    }
  }

  for (const folder of ["roaming", "local"]) {
    const previous = before.knownFolderNames[folder];
    const current = after.knownFolderNames[folder];
    if ((previous === null) !== (current === null)) {
      record("knownFolderNames", "changed", `<${folder}>`);
      continue;
    }
    const allowed = new Set(
      (allowedKnownFolderNames[folder] ?? []).map((name) => name.toLowerCase()),
    );
    const was = new Set(previous ?? []);
    const now = new Set(current ?? []);
    for (const [kind, names, other] of [
      ["added", now, was],
      ["removed", was, now],
    ]) {
      for (const name of names) {
        if (other.has(name)) {
          continue;
        }
        if (allowed.has(name.toLowerCase())) {
          expected.push({ section: "knownFolderNames", kind, path: name });
        } else {
          record("knownFolderNames", kind, `<${folder}>/${name}`);
        }
      }
    }
  }

  if (before.knownHostsSha256 !== after.knownHostsSha256) {
    record("knownHosts", "changed", "~/.ssh/known_hosts", {
      before: before.knownHostsSha256 ? "hashed" : "absent",
      after: after.knownHostsSha256 ? "hashed (different)" : "absent",
    });
  }

  if (before.credentials.supported !== after.credentials.supported) {
    record("credentials", "incomplete", "<credential manager>");
  } else {
    const previous = new Map(
      before.credentials.entries.map((entry) => [entry.target, entry]),
    );
    const current = new Map(
      after.credentials.entries.map((entry) => [entry.target, entry]),
    );
    for (const [target, entry] of current) {
      const old = previous.get(target);
      if (!old) {
        record("credentials", "added", target);
      } else if (
        old.lastWritten !== entry.lastWritten ||
        old.type !== entry.type
      ) {
        record("credentials", "changed", target, {
          before: `LastWritten ${old.lastWritten}`,
          after: `LastWritten ${entry.lastWritten}`,
        });
      }
    }
    for (const target of previous.keys()) {
      if (!current.has(target)) {
        record("credentials", "removed", target);
      }
    }
  }

  if (before.runValues.supported !== after.runValues.supported) {
    record("runValues", "incomplete", RUN_REGISTRY_KEY);
  } else {
    const was = new Set(before.runValues.names);
    const now = new Set(after.runValues.names);
    for (const [kind, names, other] of [
      ["added", now, was],
      ["removed", was, now],
    ]) {
      for (const name of names) {
        if (other.has(name)) {
          continue;
        }
        if (allowedRunValues.includes(name)) {
          expected.push({ section: "runValues", kind, path: name });
        } else {
          record("runValues", kind, name);
        }
      }
    }
  }

  return { changes, expected };
}

/** @param {SnapshotChange} change */
export function formatChange(change) {
  const detail =
    change.before !== undefined || change.after !== undefined
      ? ` (${change.before ?? "?"} -> ${change.after ?? "?"})`
      : "";
  return `${change.section}: ${change.kind} ${change.path}${detail}`;
}

// ── launches ────────────────────────────────────────────────────────────────

/**
 * The §7 step 9 refusal controls. Each must exit 78 and create nothing. They
 * run with the probe flag first, so a regressed guard can at worst print a
 * probe instead of opening a window; the controls whose failure could not
 * reach production state are repeated as real launches. Control (c) names the
 * production WebView2 folder and therefore never runs without the probe flag.
 * @param {{ runProfile: import("./lib/e2e-profile-isolation.mjs").RunProfile, locations: { productionLocal: string }, identifier?: string }} options
 * @returns {Array<{ id: string, description: string, modes: Array<"probe" | "launch">, env: EnvRecord, args: string[], mustNotExist: string[] }>}
 */
export function negativeControls({
  runProfile,
  locations,
  identifier = E2E_IDENTIFIER,
}) {
  const flag = (folder) => `${WEBVIEW2_FOLDER_ARG}=${folder}`;
  const otherFolder = path.join(runProfile.runDir, "other");
  return [
    {
      id: "a-identifier-mismatch",
      description: `${EXPECT_ISOLATED_PROFILE_ENV}=${MISMATCH_IDENTIFIER} with the run's WebView2 inputs`,
      modes: ["probe", "launch"],
      env: {
        [EXPECT_ISOLATED_PROFILE_ENV]: MISMATCH_IDENTIFIER,
        [WEBVIEW2_USER_DATA_FOLDER_ENV]: runProfile.webview2Dir,
      },
      args: [flag(runProfile.webview2Dir)],
      mustNotExist: [],
    },
    {
      id: "b-harness-without-webview2-folder",
      description: `${EXPECT_ISOLATED_PROFILE_ENV}=${identifier} with no WebView2 flag and no ${WEBVIEW2_USER_DATA_FOLDER_ENV}`,
      modes: ["probe", "launch"],
      env: { [EXPECT_ISOLATED_PROFILE_ENV]: identifier },
      args: [],
      mustNotExist: [],
    },
    {
      id: "c-webview2-flag-production-folder",
      description: `${WEBVIEW2_FOLDER_ARG} naming the production WebView2 folder`,
      modes: ["probe"],
      env: { [EXPECT_ISOLATED_PROFILE_ENV]: identifier },
      args: [flag(path.join(locations.productionLocal, "EBWebView"))],
      mustNotExist: [],
    },
    {
      id: "d-webview2-flag-env-mismatch",
      description: `${WEBVIEW2_FOLDER_ARG}=<run>/webview2 while ${WEBVIEW2_USER_DATA_FOLDER_ENV}=<run>/other`,
      modes: ["probe", "launch"],
      env: {
        [EXPECT_ISOLATED_PROFILE_ENV]: identifier,
        [WEBVIEW2_USER_DATA_FOLDER_ENV]: otherFolder,
      },
      args: [flag(runProfile.webview2Dir)],
      mustNotExist: [otherFolder],
    },
  ];
}

function withoutKeys(env, keys) {
  const copy = { ...env };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

/** Launch environment without any inherited harness or WebView2 inputs. */
function cleanLaunchEnv(env) {
  return withoutKeys(env, [
    ...PREFLIGHT_ENV_KEYS,
    PROFILE_PROBE_OUT_ENV,
    RUN_LOCK_TOKEN_ENV,
  ]);
}

/**
 * Environment for a WDIO hand-off: a fresh run with its own lock and run dir.
 * @param {EnvRecord} env
 * @param {string} binary
 * @returns {EnvRecord}
 */
export function wdioEnvironment(env, binary) {
  return {
    ...withoutKeys(env, [
      ...PREFLIGHT_ENV_KEYS,
      PROFILE_PROBE_OUT_ENV,
      RUN_LOCK_TOKEN_ENV,
      E2E_RUN_ID_ENV,
      E2E_RUN_DIR_ENV,
      E2E_WEBVIEW2_DIR_ENV,
    ]),
    TAURI_BINARY_PATH: binary,
  };
}

function defaultStartProcess(file, args, { env }) {
  const child = nodeSpawn(file, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let stderr = "";
  child.stdout?.resume();
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) =>
      resolve({ code, signal: signal ?? null }),
    );
    child.once("error", (error) =>
      resolve({ code: null, signal: null, error: describeError(error) }),
    );
  });
  return { pid: child.pid ?? null, exited, stderrTail: () => stderr };
}

function defaultRunWdio({ spec, env, repoRoot, nodePath }) {
  return new Promise((resolve) => {
    const child = nodeSpawn(
      nodePath,
      [
        path.join(repoRoot, "node_modules", "@wdio", "cli", "bin", "wdio.js"),
        "run",
        "e2e/wdio.conf.ts",
        "--spec",
        spec,
      ],
      { cwd: repoRoot, env, stdio: "inherit", shell: false },
    );
    child.once("error", (error) =>
      resolve({ code: null, error: describeError(error) }),
    );
    child.once("exit", (code, signal) =>
      resolve({ code, signal: signal ?? null }),
    );
  });
}

function track(handle) {
  const tracked = { ...handle, result: null };
  handle.exited.then((result) => {
    tracked.result = result;
  });
  return tracked;
}

async function waitForExit(ctx, tracked, timeoutMs) {
  const deadline = ctx.clock() + timeoutMs;
  for (;;) {
    await Promise.resolve();
    if (tracked.result) {
      return tracked.result;
    }
    if (ctx.clock() >= deadline) {
      return null;
    }
    await ctx.sleep(ctx.pollMs);
  }
}

async function stopProcess(ctx, tracked) {
  if (!tracked || tracked.result) {
    return tracked?.result ?? null;
  }
  if (tracked.pid) {
    ctx.adapter.killTree(tracked.pid);
  }
  return waitForExit(ctx, tracked, EXIT_WAIT_MS);
}

// ── checks shared by phases ─────────────────────────────────────────────────

function existsPath(fs, target) {
  return lstatOrNull(fs, target) !== null;
}

/** The e2e roots are absent and the run dir holds only its marker and an empty webview2 folder. */
function nothingCreatedProblems(ctx, mustNotExist = []) {
  const { fs, locations, runProfile } = ctx;
  const problems = [];
  for (const root of [locations.e2eRoaming, locations.e2eLocal]) {
    if (existsPath(fs, root)) {
      problems.push(`${root} exists`);
    }
  }
  const runEntries = directoryNames(fs, runProfile.runDir) ?? [];
  const expectedEntries = [RUN_DIR_MARKER_FILE, RUN_WEBVIEW2_DIR_NAME].sort();
  if (runEntries.join("\n") !== expectedEntries.join("\n")) {
    problems.push(
      `${runProfile.runDir} holds ${JSON.stringify(runEntries)}, expected ${JSON.stringify(expectedEntries)}`,
    );
  }
  const webviewEntries = directoryNames(fs, runProfile.webview2Dir) ?? [];
  if (webviewEntries.length > 0) {
    problems.push(
      `${runProfile.webview2Dir} is not empty (${webviewEntries.join(", ")})`,
    );
  }
  for (const target of mustNotExist) {
    if (existsPath(fs, target)) {
      problems.push(`${target} exists`);
    }
  }
  return problems;
}

function allowedDifferences(ctx) {
  return {
    allowedKnownFolderNames: {
      roaming: [E2E_IDENTIFIER],
      local: [E2E_IDENTIFIER, RUNS_ROOT_NAME],
    },
    allowedRunValues: ctx.probe ? [ctx.probe.autostartName] : [],
  };
}

/**
 * Compares production with the baseline. A difference is a problem, or only a
 * warning when production processes were allowed to run beside the test.
 */
function compareProduction(ctx, label) {
  const after = captureProductionSnapshot({
    locations: ctx.locations,
    adapter: ctx.adapter,
    fs: ctx.fs,
    now: ctx.now,
  });
  const { changes, expected } = diffSnapshots(
    ctx.baseline,
    after,
    allowedDifferences(ctx),
  );
  const lines = changes.map(formatChange);
  const result = {
    evidence: {
      production: changes.length === 0 ? "unchanged" : "changed",
      changes: lines,
      expected: expected.map(formatChange),
    },
    problems: [],
    warnings: [],
  };
  if (lines.length === 0) {
    return result;
  }
  if (ctx.productionRunning) {
    result.warnings = lines.map(
      (line) =>
        `${label}: production changed while production processes ran (informational): ${line}`,
    );
  } else {
    result.problems = lines.map(
      (line) =>
        `${label}: production changed with no production process running (HARD FAIL; delete nothing): ${line}`,
    );
  }
  return result;
}

function isolatedTargets(ctx) {
  return ctx.adapter.listIsolatedCredentialTargets(E2E_IDENTIFIER);
}

function probeEvidence(probe) {
  return {
    kind: probe.kind,
    keychainNamespace: probe.keychainNamespace,
    autostartName: probe.autostartName,
    webview2: {
      source: probe.webview2.source,
      userDataFolder: probe.webview2.userDataFolder,
    },
    sshHome: probe.sshHome,
    dirs: probe.dirs,
  };
}

function runProbe(ctx) {
  assertBinaryUnchanged(ctx.verified, { fs: ctx.fs });
  return runProfileProbe({
    verifiedBinary: ctx.verified,
    expectedIdentifier: E2E_IDENTIFIER,
    runProfile: ctx.runProfile,
    timeoutMs: ctx.probeTimeoutMs,
    env: cleanLaunchEnv(ctx.runEnv),
    spawnSync: ctx.spawnSync,
    tmpDir: ctx.tmpDir,
    platform: ctx.platform,
    fs: ctx.fs,
  });
}

function sameLocationSet(actual, expected, platform) {
  return (
    actual.length === expected.length &&
    actual.every((entry) =>
      expected.some((candidate) => samePath(entry, candidate, platform)),
    )
  );
}

function metadataChanges(before, after) {
  const changes = [];
  diffMetadata("e2e", before, after, (section, kind, name, detail) =>
    changes.push(formatChange({ section, kind, path: name, ...detail })),
  );
  return changes;
}

// ── phases ──────────────────────────────────────────────────────────────────

/** @typedef {{ status?: string, summary?: string, evidence?: object, problems?: string[], warnings?: string[] }} PhaseResult */

export const CORE_PHASES = Object.freeze([
  {
    id: "host",
    step: "§7",
    title: "Windows host with Credential Manager, registry and WebView2",
    async run(ctx) {
      if (!ctx.adapter.supported) {
        return {
          problems: [
            `the §7 procedure needs Windows (Credential Manager, HKCU Run values, WebView2); this host is ${ctx.platform}.`,
          ],
        };
      }
      ctx.knownFolders =
        ctx.injectedKnownFolders ??
        resolveKnownFolders({
          platform: ctx.platform,
          env: ctx.env,
          homeDir: ctx.homeDir,
        });
      ctx.locations = snapshotLocations({ knownFolders: ctx.knownFolders });
      return {
        summary: `roaming ${ctx.knownFolders.roaming}, local ${ctx.knownFolders.local}`,
        evidence: { platform: ctx.platform, knownFolders: ctx.knownFolders },
      };
    },
  },
  {
    id: "binary-identity",
    step: "§7.4",
    title: "static identity: manifest, marker, no production marker",
    async run(ctx) {
      const binary = path.resolve(ctx.options.binary);
      ctx.verified = await assertIsolatedBinary({
        binary,
        expectedIdentifier: E2E_IDENTIFIER,
        repoRoot: ctx.repoRoot,
        manifestPath: path.join(path.dirname(binary), E2E_BUILD_MANIFEST_FILE),
        platform: ctx.platform,
        fs: ctx.fs,
      });
      return {
        summary: `markers [${ctx.verified.identifiers.join(", ")}] x${ctx.verified.markerCount}, sha256 ${ctx.verified.sha256}, manifest ok`,
        evidence: {
          binary: ctx.verified.binary,
          sha256: ctx.verified.sha256,
          size: ctx.verified.size,
          markers: ctx.verified.identifiers,
          markerCount: ctx.verified.markerCount,
          productionMarkers: 0,
          manifest: ctx.verified.manifestPath,
        },
      };
    },
  },
  {
    id: "webview2-policy",
    step: "§7.5",
    title: "no WebView2 UserDataFolder policy override",
    async run(ctx) {
      const policy = ctx.adapter.checkWebView2Policy(ctx.verified.binary);
      return {
        summary: `policy overrides: ${policy.overrides.length}`,
        evidence: policy,
      };
    },
  },
  {
    id: "production-processes",
    step: "§7.2",
    title: "no production-identifier process (U1 strict unless allowed)",
    async run(ctx) {
      const { production, sameBinary } = ctx.adapter.inspectProcesses(
        ctx.verified.binary,
        ctx.selfPid,
      );
      const describe = (entries) =>
        entries
          .map(({ pid, name, reason }) => `pid ${pid} ${name} (${reason})`)
          .join("; ");
      const evidence = {
        production: production.map(({ pid, name }) => ({ pid, name })),
        sameBinary: sameBinary.map(({ pid, name }) => ({ pid, name })),
        allowRunningProduction: ctx.env[ALLOW_RUNNING_PRODUCTION_ENV] === "1",
      };
      if (sameBinary.length > 0) {
        return {
          evidence,
          problems: [
            `the e2e binary is already running: ${describe(sameBinary)}. Wait for that run or end that exact process tree after confirming it is an orphan.`,
          ],
        };
      }
      if (production.length === 0) {
        return { summary: "none running", evidence };
      }
      if (!evidence.allowRunningProduction) {
        return {
          evidence,
          problems: [
            `production-identifier processes are running: ${describe(production)}. Strict policy: wait for them to exit; never stop the user's \`tauri dev\`.`,
          ],
        };
      }
      ctx.productionRunning = true;
      return {
        summary: `${production.length} running, allowed by ${ALLOW_RUNNING_PRODUCTION_ENV}=1; production comparisons are informational`,
        evidence,
        warnings: [
          `${ALLOW_RUNNING_PRODUCTION_ENV}=1: running beside ${describe(production)}; production snapshot differences are reported, not enforced.`,
        ],
      };
    },
  },
  {
    id: "run-lock",
    step: "§7.7",
    title: "run lock for a fresh run id",
    async run(ctx) {
      ctx.runEnv = withoutKeys(ctx.env, [
        ...PREFLIGHT_ENV_KEYS,
        PROFILE_PROBE_OUT_ENV,
        RUN_LOCK_TOKEN_ENV,
        E2E_RUN_ID_ENV,
        E2E_RUN_DIR_ENV,
        E2E_WEBVIEW2_DIR_ENV,
      ]);
      ctx.runProfile = resolveRunProfile({
        env: ctx.runEnv,
        identifier: E2E_IDENTIFIER,
        platform: ctx.platform,
        tmpDir: ctx.tmpDir,
        ...(ctx.createRunId ? { createRunId: ctx.createRunId } : {}),
      });
      ctx.lock = acquireRunLock(E2E_IDENTIFIER, {
        runId: ctx.runProfile.runId,
        lockDir: ctx.lockDir,
        env: ctx.runEnv,
        pid: ctx.selfPid,
        now: ctx.now,
        isAlive: ctx.isAlive,
        fs: ctx.fs,
        log: ctx.log,
      });
      return {
        summary: `run ${ctx.runProfile.runId}, lock ${ctx.lock.path}`,
        evidence: { runProfile: ctx.runProfile, lock: ctx.lock.path },
      };
    },
  },
  {
    id: "production-snapshot",
    step: "§7.6",
    title: "metadata-only production snapshot",
    async run(ctx) {
      ctx.baseline = captureProductionSnapshot({
        locations: ctx.locations,
        adapter: ctx.adapter,
        fs: ctx.fs,
        now: ctx.now,
      });
      const e2eSnapshot = (root) =>
        snapshotFileMetadata(root, {
          fs: ctx.fs,
          maxEntries: SNAPSHOT_MAX_ENTRIES,
        });
      ctx.e2eBefore = {
        roaming: e2eSnapshot(ctx.locations.e2eRoaming),
        local: e2eSnapshot(ctx.locations.e2eLocal),
      };
      const summary = summarizeSnapshot(ctx.baseline);
      return {
        summary: Object.entries(summary)
          .map(([key, value]) => `${key} ${value}`)
          .join(", "),
        evidence: summary,
        problems: snapshotGaps(ctx.baseline).map(
          (gap) => `${gap}; the comparison would be unproven`,
        ),
      };
    },
  },
  {
    id: "run-dir",
    step: "§7.7",
    title: "run dir with marker and empty webview2 folder",
    async run(ctx) {
      const created = createRunDir(ctx.runProfile, {
        platform: ctx.platform,
        fs: ctx.fs,
      });
      ctx.runDirCreated = created.created;
      const problems = created.created
        ? []
        : [`${ctx.runProfile.runDir} already existed for a fresh run id`];
      const entries = directoryNames(ctx.fs, ctx.runProfile.webview2Dir) ?? [];
      if (entries.length > 0) {
        problems.push(`${ctx.runProfile.webview2Dir} is not empty`);
      }
      return { summary: ctx.runProfile.runDir, problems };
    },
  },
  {
    id: "identity-probe",
    step: "§7.8",
    title: "probe (before the wipe): identity, locations, creates nothing",
    async run(ctx) {
      const probe = runProbe(ctx);
      ctx.probe = probe;
      const problems = [];
      const pairs = profileRootPairs(probe, { platform: ctx.platform });
      const { locations } = ctx;
      if (
        !sameLocationSet(
          pairs.map(({ root }) => root),
          [locations.e2eRoaming, locations.e2eLocal],
          ctx.platform,
        )
      ) {
        problems.push(
          `the probe's isolated roots ${JSON.stringify(pairs.map(({ root }) => root))} are not ${locations.e2eRoaming} and ${locations.e2eLocal}`,
        );
      }
      if (
        !sameLocationSet(
          pairs.map(({ productionRoot }) => productionRoot),
          [locations.productionRoaming, locations.productionLocal],
          ctx.platform,
        ) ||
        !samePath(
          probe.webview2.productionDefault,
          locations.productionLocal,
          ctx.platform,
        )
      ) {
        problems.push(
          `the probe's production roots differ from the snapshot's ${locations.productionRoaming} and ${locations.productionLocal}; the snapshot would watch the wrong folders`,
        );
      }
      for (const [key, root] of [
        ["roaming", locations.e2eRoaming],
        ["local", locations.e2eLocal],
      ]) {
        for (const change of metadataChanges(
          ctx.e2eBefore[key],
          snapshotFileMetadata(root, {
            fs: ctx.fs,
            maxEntries: SNAPSHOT_MAX_ENTRIES,
          }),
        )) {
          problems.push(`the probe changed ${root}: ${change}`);
        }
      }
      const webviewEntries =
        directoryNames(ctx.fs, ctx.runProfile.webview2Dir) ?? [];
      if (webviewEntries.length > 0) {
        problems.push(`the probe wrote into ${ctx.runProfile.webview2Dir}`);
      }
      const production = compareProduction(ctx, "identity probe");
      return {
        summary: `kind ${probe.kind}, keychain ${probe.keychainNamespace}, WebView2 ${probe.webview2.source} ${probe.webview2.userDataFolder}`,
        evidence: { probe: probeEvidence(probe), ...production.evidence },
        problems: [...problems, ...production.problems],
        warnings: production.warnings,
      };
    },
  },
  {
    id: "pre-run-wipe",
    step: "§7.7",
    title:
      "wipe asserted e2e roots, e2e credentials and the e2e autostart value",
    async run(ctx) {
      const { removed } = wipeIsolatedProfile(ctx.probe, {
        platform: ctx.platform,
        fs: ctx.fs,
      });
      const keychain = ctx.adapter.cleanupKeychain(E2E_IDENTIFIER);
      const autostart = ctx.adapter.cleanupAutostart(
        ctx.probe.autostartName,
        E2E_IDENTIFIER,
      );
      const problems = [];
      for (const root of [ctx.locations.e2eRoaming, ctx.locations.e2eLocal]) {
        if (existsPath(ctx.fs, root)) {
          problems.push(`${root} still exists after the wipe`);
        }
      }
      const remaining = isolatedTargets(ctx).targets;
      if (remaining.length > 0) {
        problems.push(
          `isolated credentials remain after cleanup: ${remaining.join(", ")}`,
        );
      }
      if (
        ctx.adapter.listRunValueNames().names.includes(ctx.probe.autostartName)
      ) {
        problems.push(`the ${ctx.probe.autostartName} Run value remains`);
      }
      const production = compareProduction(ctx, "pre-run wipe");
      return {
        summary: `${removed.length} root(s), ${keychain.deleted.length} credential(s), ${autostart.removed.length} autostart value(s) removed`,
        evidence: {
          removedRoots: removed,
          deletedCredentials: keychain.deleted,
          removedAutostartKeys: autostart.removed,
          ...production.evidence,
        },
        problems: [...problems, ...production.problems],
        warnings: production.warnings,
      };
    },
  },
  {
    id: "probe",
    step: "§7.8",
    title: "probe with the exact run inputs creates nothing",
    async run(ctx) {
      const started = ctx.clock();
      const probe = runProbe(ctx);
      const problems = nothingCreatedProblems(ctx);
      if (existsPath(ctx.fs, probe.sshHome)) {
        problems.push(`${probe.sshHome} exists after the probe`);
      }
      if (
        JSON.stringify(probeEvidence(probe)) !==
        JSON.stringify(probeEvidence(ctx.probe))
      ) {
        problems.push(
          "the probe reported a different profile than before the wipe",
        );
      }
      const remaining = isolatedTargets(ctx).targets;
      if (remaining.length > 0) {
        problems.push(`the probe created credentials: ${remaining.join(", ")}`);
      }
      const production = compareProduction(ctx, "probe");
      return {
        summary: `exit 0 in ${ctx.clock() - started} ms; e2e roots, run-dir EBWebView and ssh-home absent`,
        evidence: {
          probe: probeEvidence(probe),
          durationMs: ctx.clock() - started,
          ...production.evidence,
        },
        problems: [...problems, ...production.problems],
        warnings: production.warnings,
      };
    },
  },
  {
    id: "negative-controls",
    step: "§7.9",
    title: "refusal controls exit 78 and create nothing",
    async run(ctx) {
      const controls = negativeControls({
        runProfile: ctx.runProfile,
        locations: ctx.locations,
      });
      const results = [];
      const warnings = [];
      for (const control of controls) {
        for (const mode of control.modes) {
          assertBinaryUnchanged(ctx.verified, { fs: ctx.fs });
          const outDir = ctx.fs.mkdtempSync(
            path.join(ctx.tmpDir, "sorng-selftest-control-"),
          );
          const outFile = path.join(outDir, "probe.json");
          const env = {
            ...cleanLaunchEnv(ctx.runEnv),
            ...control.env,
            [PROFILE_PROBE_OUT_ENV]: outFile,
          };
          const args =
            mode === "probe"
              ? [PROFILE_PROBE_ARG, ...control.args]
              : control.args;
          const started = ctx.clock();
          const tracked = track(
            ctx.startProcess(ctx.verified.binary, args, { env }),
          );
          let outcome = await waitForExit(ctx, tracked, ctx.controlTimeoutMs);
          const problems = [];
          if (!outcome) {
            outcome = await stopProcess(ctx, tracked);
            problems.push(
              `did not exit within ${ctx.controlTimeoutMs} ms and was ended by PID tree`,
            );
          } else if (outcome.code !== REFUSED_EXIT_CODE) {
            problems.push(
              `exited with ${outcome.error ? `spawn error ${outcome.error}` : outcome.signal ? `signal ${outcome.signal}` : `code ${outcome.code}`}, expected ${REFUSED_EXIT_CODE}`,
            );
          }
          const stderr = String(tracked.stderrTail?.() ?? "").trim();
          if (
            outcome?.code === REFUSED_EXIT_CODE &&
            !/profile guard/i.test(stderr)
          ) {
            warnings.push(
              `${control.id} (${mode}) exited 78 without the profile-guard message`,
            );
          }
          if (existsPath(ctx.fs, outFile)) {
            problems.push("wrote a probe report");
          }
          ctx.fs.rmSync(outDir, { recursive: true, force: true });
          problems.push(...nothingCreatedProblems(ctx, control.mustNotExist));
          const production = compareProduction(ctx, `control ${control.id}`);
          problems.push(...production.problems);
          warnings.push(...production.warnings);
          results.push({
            id: control.id,
            mode,
            description: control.description,
            exitCode: outcome?.code ?? null,
            signal: outcome?.signal ?? null,
            durationMs: ctx.clock() - started,
            stderr: stderr.split(/\r?\n/).slice(-1)[0]?.slice(0, 300) ?? "",
          });
          if (problems.length > 0) {
            return {
              evidence: { controls: results },
              problems: problems.map(
                (problem) => `control ${control.id} (${mode}): ${problem}`,
              ),
              warnings,
            };
          }
        }
      }
      return {
        summary: `${results.length} refusals: ${results.map(({ id, mode }) => `${id.slice(0, 1)}/${mode}`).join(", ")} all exit 78, nothing created`,
        evidence: { controls: results },
        warnings,
      };
    },
  },
  {
    id: "direct-launch",
    step: "§7.10",
    title: "direct launch creates only isolated state, then PID-tree stop",
    async run(ctx) {
      assertBinaryUnchanged(ctx.verified, { fs: ctx.fs });
      const { fs, locations, runProfile, probe } = ctx;
      const launch = webview2Launch(runProfile, { platform: ctx.platform });
      const env = {
        ...cleanLaunchEnv(ctx.runEnv),
        ...launch.env,
        [EXPECT_ISOLATED_PROFILE_ENV]: E2E_IDENTIFIER,
      };
      const runFolder = path.join(runProfile.webview2Dir, "EBWebView");
      const defaultFolder = path.join(probe.webview2.tauriDefault, "EBWebView");
      const evidence = {
        pid: null,
        roamingCreated: false,
        runWebView2Populated: false,
        defaultWebView2Absent: true,
        vaultDekCreated: false,
        isolatedCredentials: [],
        elapsedMs: 0,
        exit: null,
      };
      const problems = [];
      const started = ctx.clock();
      const tracked = track(
        ctx.startProcess(ctx.verified.binary, launch.args, { env }),
      );
      ctx.launched = tracked;
      evidence.pid = tracked.pid;

      for (;;) {
        await Promise.resolve();
        if (tracked.result) {
          problems.push(
            `the app exited (${tracked.result.error ?? tracked.result.signal ?? `code ${tracked.result.code}`}) before all evidence appeared`,
          );
          break;
        }
        if (existsPath(fs, defaultFolder)) {
          evidence.defaultWebView2Absent = false;
          ctx.webview2Fallback = true;
          problems.push(
            `${defaultFolder} was created: the WebView2 override did not take effect (§7.13). Storage stayed identifier-isolated and is wiped, but the per-run contract failed; report it (remedy: a programmatic data_directory follow-up, not a relaxed check).`,
          );
          break;
        }
        evidence.roamingCreated = existsPath(fs, locations.e2eRoaming);
        evidence.runWebView2Populated =
          (directoryNames(fs, runFolder) ?? []).length > 0;
        if (evidence.roamingCreated && evidence.runWebView2Populated) {
          evidence.isolatedCredentials = isolatedTargets(ctx).targets;
          evidence.vaultDekCreated = evidence.isolatedCredentials.includes(
            VAULT_MASTER_DEK_TARGET,
          );
          if (evidence.vaultDekCreated) {
            break;
          }
        }
        if (ctx.clock() - started >= ctx.options.launchTimeoutMs) {
          const missing = [
            !evidence.roamingCreated && `${locations.e2eRoaming} created`,
            !evidence.runWebView2Populated && `${runFolder} populated`,
            !evidence.vaultDekCreated &&
              `credential ${VAULT_MASTER_DEK_TARGET}`,
          ].filter(Boolean);
          problems.push(
            `missing evidence after ${ctx.options.launchTimeoutMs} ms: ${missing.join(", ")}`,
          );
          break;
        }
        await ctx.sleep(ctx.launchPollMs);
      }
      evidence.elapsedMs = ctx.clock() - started;

      evidence.exit = await stopProcess(ctx, tracked);
      if (!evidence.exit) {
        problems.push(
          `pid ${tracked.pid} did not exit within ${EXIT_WAIT_MS} ms of its PID-tree stop`,
        );
      }
      if (evidence.defaultWebView2Absent && existsPath(fs, defaultFolder)) {
        evidence.defaultWebView2Absent = false;
        ctx.webview2Fallback = true;
        problems.push(
          `${defaultFolder} exists after the launch: the WebView2 override did not take effect (§7.13).`,
        );
      }
      const runEntries = (directoryNames(fs, runProfile.runDir) ?? []).filter(
        (name) =>
          name !== RUN_DIR_MARKER_FILE && name !== RUN_WEBVIEW2_DIR_NAME,
      );
      if (runEntries.length > 0) {
        problems.push(
          `the launch created ${runEntries.join(", ")} in ${runProfile.runDir}`,
        );
      }
      const unexpectedCredentials = evidence.isolatedCredentials.filter(
        (target) => target !== VAULT_MASTER_DEK_TARGET,
      );
      return {
        summary: `pid ${evidence.pid}: ${locations.e2eRoaming} created, ${runFolder} populated, ${defaultFolder} absent, ${VAULT_MASTER_DEK_TARGET} created in ${evidence.elapsedMs} ms`,
        evidence,
        problems,
        warnings:
          unexpectedCredentials.length > 0
            ? [
                `the launch also created isolated credentials: ${unexpectedCredentials.join(", ")}`,
              ]
            : [],
      };
    },
  },
  {
    id: "post-check",
    step: "§7.11",
    title: "production unchanged after the launch",
    async run(ctx) {
      const production = compareProduction(ctx, "post-check");
      return {
        summary:
          production.evidence.production === "unchanged"
            ? "production snapshot, EBWebView storage mtimes, credentials, known_hosts, Run values, ~/.ssh and ~/.opk unchanged"
            : "production changed",
        evidence: production.evidence,
        problems: production.problems,
        warnings: production.warnings,
      };
    },
  },
]);

export const TEARDOWN_PHASE = Object.freeze({
  id: "teardown",
  step: "§7.12",
  title: "stop the app, wipe e2e state, release the lock",
  async run(ctx) {
    const problems = [];
    const warnings = [];
    const evidence = {
      stoppedApp: false,
      wipedProfile: false,
      wipedRunDir: false,
      lockReleased: false,
      keptE2eState: ctx.options.keepE2eState,
    };
    const attempt = (label, action) => {
      try {
        return action();
      } catch (error) {
        problems.push(`${label}: ${describeError(error)}`);
        return undefined;
      }
    };
    if (ctx.launched && !ctx.launched.result) {
      evidence.stoppedApp = true;
      if (!(await stopProcess(ctx, ctx.launched))) {
        problems.push(`pid ${ctx.launched.pid} did not exit`);
      }
    }
    if (ctx.options.keepE2eState) {
      warnings.push(
        `--keep-e2e-state: kept the isolated profile${ctx.runProfile ? ` and ${ctx.runProfile.runDir}` : ""}; the next run's wipe removes them.`,
      );
    } else {
      if (ctx.probe) {
        attempt("profile wipe", () => {
          wipeIsolatedProfile(ctx.probe, {
            platform: ctx.platform,
            fs: ctx.fs,
          });
          evidence.wipedProfile = true;
        });
        attempt("keychain cleanup", () =>
          ctx.adapter.cleanupKeychain(E2E_IDENTIFIER),
        );
        attempt("autostart cleanup", () =>
          ctx.adapter.cleanupAutostart(ctx.probe.autostartName, E2E_IDENTIFIER),
        );
        attempt("verification", () => {
          for (const root of [
            ctx.locations.e2eRoaming,
            ctx.locations.e2eLocal,
          ]) {
            if (existsPath(ctx.fs, root)) {
              problems.push(`${root} remains`);
            }
          }
          const remaining = isolatedTargets(ctx).targets;
          if (remaining.length > 0) {
            problems.push(
              `isolated credentials remain: ${remaining.join(", ")}`,
            );
          }
        });
      }
      // A fresh run id is ours; wipeRunDir still asserts its marker first.
      if (ctx.lock && ctx.runProfile) {
        attempt("run dir", () => {
          wipeRunDir(ctx.runProfile.runDir, {
            runRoot: ctx.runProfile.runRoot,
            platform: ctx.platform,
            fs: ctx.fs,
          });
          evidence.wipedRunDir = true;
        });
      }
    }
    if (ctx.lock) {
      evidence.lockReleased = Boolean(
        attempt("lock", () => releaseRunLock(ctx.lock, { fs: ctx.fs })),
      );
    }
    if (ctx.baseline) {
      const production = attempt("final comparison", () =>
        compareProduction(ctx, "teardown"),
      );
      if (production) {
        problems.push(...production.problems);
        warnings.push(...production.warnings);
        evidence.production = production.evidence.production;
      }
    }
    return {
      summary: `profile ${evidence.wipedProfile ? "wiped" : "untouched"}, run dir ${evidence.wipedRunDir ? "wiped" : "untouched"}, lock ${evidence.lockReleased ? "released" : "not held"}`,
      evidence,
      problems,
      warnings,
    };
  },
});

/**
 * One phase per spec, in §7 order, each followed by the production comparison.
 * @param {readonly string[]} groups
 */
export function wdioPhases(groups) {
  const phases = [];
  for (const group of WDIO_GROUPS) {
    if (!groups.includes(group.name)) {
      continue;
    }
    for (const spec of group.specs) {
      phases.push({
        id: `wdio-${group.name}-${path.posix.basename(spec, ".spec.ts")}`,
        step: group.step,
        title: `WDIO ${spec}`,
        async run(ctx) {
          const result = await ctx.runWdio({
            spec,
            env: wdioEnvironment(ctx.env, ctx.verified.binary),
            repoRoot: ctx.repoRoot,
            nodePath: ctx.nodePath,
          });
          const problems = [];
          if (result.code !== 0) {
            problems.push(
              `wdio exited with ${result.error ?? result.signal ?? `code ${result.code}`}`,
            );
          }
          for (const root of [
            ctx.locations.e2eRoaming,
            ctx.locations.e2eLocal,
          ]) {
            if (existsPath(ctx.fs, root)) {
              problems.push(`${root} remains after the run's teardown`);
            }
          }
          const production = compareProduction(ctx, `wdio ${spec}`);
          return {
            summary: `exit ${result.code}; production ${production.evidence.production}`,
            evidence: { spec, exit: result, ...production.evidence },
            problems: [...problems, ...production.problems],
            warnings: production.warnings,
          };
        },
      });
    }
  }
  return phases;
}

// ── runner ──────────────────────────────────────────────────────────────────

const defaultLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function createContext(options, deps) {
  const now = deps.now ?? (() => new Date());
  const platform = deps.platform ?? process.platform;
  const log = deps.log ?? defaultLog;
  return {
    options: {
      reportPath: null,
      keepE2eState: false,
      launchTimeoutMs: DEFAULT_LAUNCH_TIMEOUT_MS,
      wdioGroups: [],
      ...options,
    },
    repoRoot: deps.repoRoot ?? defaultRepoRoot,
    env: { ...(deps.env ?? process.env) },
    platform,
    fs: deps.fs ?? nodeFs,
    adapter:
      deps.adapter ??
      createSystemAdapter({ platform, exec: deps.exec ?? defaultExec, log }),
    spawnSync: deps.spawnSync ?? nodeSpawnSync,
    startProcess: deps.startProcess ?? defaultStartProcess,
    runWdio: deps.runWdio ?? defaultRunWdio,
    now,
    clock: () => now().getTime(),
    sleep:
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    log,
    lockDir: deps.lockDir,
    tmpDir: deps.tmpDir ?? os.tmpdir(),
    isAlive: deps.isAlive ?? isProcessAlive,
    selfPid: deps.selfPid ?? process.pid,
    homeDir: deps.homeDir ?? os.homedir(),
    nodePath: deps.nodePath ?? process.execPath,
    createRunId: deps.createRunId,
    injectedKnownFolders: deps.knownFolders,
    pollMs: deps.pollMs ?? 250,
    launchPollMs: deps.launchPollMs ?? 1_000,
    probeTimeoutMs: deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    controlTimeoutMs: deps.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS,
    // Filled in by the phases.
    knownFolders: null,
    locations: null,
    verified: null,
    productionRunning: false,
    runEnv: null,
    runProfile: null,
    lock: null,
    baseline: null,
    e2eBefore: null,
    runDirCreated: false,
    probe: null,
    launched: null,
    webview2Fallback: false,
  };
}

async function executePhase(phase, ctx) {
  const started = ctx.clock();
  /** @type {PhaseResult} */
  let result;
  let code;
  try {
    result = (await phase.run(ctx)) ?? {};
  } catch (error) {
    code = /** @type {{ code?: string }} */ (error)?.code;
    result = { problems: [describeError(error)] };
  }
  const problems = result.problems ?? [];
  return {
    id: phase.id,
    step: phase.step,
    title: phase.title,
    status: problems.length > 0 ? "unexpected" : "passed",
    durationMs: ctx.clock() - started,
    summary: result.summary ?? "",
    ...(code ? { code } : {}),
    problems,
    warnings: result.warnings ?? [],
    evidence: result.evidence ?? {},
  };
}

/**
 * Runs the core phases until the first unexpected result, always tears down,
 * then (only after a full pass) hands off to the selected WDIO specs.
 * @param {{ binary: string, reportPath?: string | null, keepE2eState?: boolean, launchTimeoutMs?: number, wdioGroups?: string[] }} options
 * @param {Record<string, any>} [deps]
 * @returns {Promise<SelftestReport>}
 */
export async function runSelftest(options, deps = {}) {
  const ctx = createContext(options, deps);
  options = ctx.options;
  /** @type {SelftestReport} */
  const report = {
    schema: SELFTEST_REPORT_SCHEMA,
    identifier: E2E_IDENTIFIER,
    startedAt: ctx.now().toISOString(),
    finishedAt: null,
    binary: path.resolve(options.binary),
    sha256: null,
    runId: null,
    runDir: null,
    outcome: "passed",
    stoppedAt: null,
    productionComparison: "strict",
    webview2Fallback: false,
    wdioGroups: options.wdioGroups,
    phases: [],
  };
  const phases = [...CORE_PHASES];
  let stopped = false;
  for (const phase of phases) {
    if (stopped) {
      report.phases.push({
        id: phase.id,
        step: phase.step,
        title: phase.title,
        status: "not-run",
      });
      continue;
    }
    ctx.log.info(`${LOG_PREFIX} ${phase.step} ${phase.id}: ${phase.title}`);
    const record = await executePhase(phase, ctx);
    report.phases.push(record);
    if (record.status === "unexpected") {
      stopped = true;
      report.stoppedAt = phase.id;
    }
  }

  const teardown = await executePhase(TEARDOWN_PHASE, ctx);
  report.phases.push(teardown);
  if (!stopped && teardown.status === "unexpected") {
    stopped = true;
    report.stoppedAt = TEARDOWN_PHASE.id;
  }

  for (const phase of wdioPhases(ctx.options.wdioGroups)) {
    if (stopped) {
      report.phases.push({
        id: phase.id,
        step: phase.step,
        title: phase.title,
        status: "not-run",
      });
      continue;
    }
    ctx.log.info(`${LOG_PREFIX} ${phase.step} ${phase.id}`);
    const record = await executePhase(phase, ctx);
    report.phases.push(record);
    if (record.status === "unexpected") {
      stopped = true;
      report.stoppedAt = phase.id;
    }
  }

  report.outcome = stopped ? "stopped" : "passed";
  report.finishedAt = ctx.now().toISOString();
  report.sha256 = ctx.verified?.sha256 ?? null;
  report.runId = ctx.runProfile?.runId ?? null;
  report.runDir = ctx.runProfile?.runDir ?? null;
  report.productionComparison = ctx.productionRunning
    ? "informational"
    : "strict";
  report.webview2Fallback = ctx.webview2Fallback;
  return report;
}

// ── reports ─────────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  passed: "PASS",
  unexpected: "STOP",
  "not-run": "SKIP",
};

/**
 * @param {SelftestReport} report
 * @param {{ jsonPath?: string | null }} [options]
 */
export function formatHumanReport(report, { jsonPath = null } = {}) {
  const lines = [
    `t91 e2e isolation self-test: ${report.outcome === "passed" ? "PASSED" : `STOPPED at ${report.stoppedAt}`}`,
    `binary  ${report.binary}`,
    `sha256  ${report.sha256 ?? "unverified"}`,
    `run     ${report.runId ?? "-"}${report.runDir ? ` (${report.runDir})` : ""}`,
    `production comparison: ${report.productionComparison}`,
    "",
  ];
  for (const phase of report.phases) {
    const label =
      phase.status === "passed" && phase.id === TEARDOWN_PHASE.id
        ? "DONE"
        : (STATUS_LABEL[phase.status] ?? phase.status);
    const duration =
      phase.durationMs === undefined ? "" : ` (${phase.durationMs} ms)`;
    lines.push(
      `${label}  ${phase.step} ${phase.id}: ${phase.title}${duration}`,
    );
    if (phase.summary) {
      lines.push(`      ${phase.summary}`);
    }
    for (const problem of phase.problems ?? []) {
      lines.push(`      ! ${problem}`);
    }
    for (const warning of phase.warnings ?? []) {
      lines.push(`      ~ ${warning}`);
    }
  }
  if (report.webview2Fallback) {
    lines.push(
      "",
      "WebView2 fallback (§7.13): the per-run folder was ignored. Report to the coordinator; do not relax the check.",
    );
  }
  if (jsonPath) {
    lines.push("", `JSON report: ${jsonPath}`);
  }
  return lines.join("\n");
}

/**
 * @param {string} repoRoot
 * @param {Date} date
 */
export function defaultReportPath(repoRoot, date) {
  const stamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return path.join(repoRoot, ".artifacts", "e2e", `selftest-${stamp}.json`);
}

/**
 * @param {SelftestReport} report
 * @param {{ jsonPath: string, fs?: typeof nodeFs }} options
 */
export function writeReports(report, { jsonPath, fs = nodeFs }) {
  const textPath = jsonPath.replace(/\.json$/i, "") + ".txt";
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(textPath, `${formatHumanReport(report, { jsonPath })}\n`);
  return { jsonPath, textPath };
}

/**
 * @param {readonly string[]} [argv]
 * @param {Record<string, any>} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? defaultLog;
  let options;
  try {
    options = parseSelftestArgs(argv);
  } catch (error) {
    if (error instanceof SelftestUsageError) {
      log.error(`${LOG_PREFIX} ${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    log.info(USAGE);
    return 0;
  }
  const repoRoot = deps.repoRoot ?? defaultRepoRoot;
  const now = deps.now ?? (() => new Date());
  const report = await runSelftest(options, { ...deps, log });
  const jsonPath = options.reportPath
    ? path.resolve(options.reportPath)
    : defaultReportPath(repoRoot, now());
  writeReports(report, { jsonPath, fs: deps.fs ?? nodeFs });
  const text = formatHumanReport(report, { jsonPath });
  if (report.outcome === "passed") {
    log.info(text);
    return 0;
  }
  log.error(text);
  return 1;
}

function isDirectRun() {
  if (!process.argv[1]) {
    return false;
  }
  const invoked = path.resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  // Windows paths are case-insensitive; a lowercase drive in the cwd must not
  // turn `npm run` into a silent no-op.
  return process.platform === "win32"
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
}

if (isDirectRun()) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    },
  );
}
