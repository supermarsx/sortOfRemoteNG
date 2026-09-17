import type { SpawnSyncReturns } from "node:child_process";
import type nodeFs from "node:fs";

export declare const PRODUCTION_IDENTIFIER: "com.sortofremote.ng";
export declare const E2E_IDENTIFIER: "com.sortofremote.ng.e2e";
export declare const README_CAPTURE_IDENTIFIER: "com.sortofremote.ng.readme-capture";
export declare const PRODUCT_NAME: "sortOfRemoteNG";

export declare const PROFILE_MARKER_PREFIX: "SORNG_PROFILE_MARKER_V1[identifier=";
export declare const PROFILE_MARKER_SUFFIX: "]";
export declare const PROFILE_PROBE_ARG: "--sorng-profile-probe";
export declare const PROFILE_PROBE_SCHEMA: "sorng-profile-probe/v1";
export declare const PROFILE_PROBE_OUT_ENV: "SORNG_PROFILE_PROBE_OUT";
export declare const EXPECT_ISOLATED_PROFILE_ENV: "SORNG_EXPECT_ISOLATED_PROFILE";
export declare const E2E_PROFILE_JSON_ENV: "SORNG_E2E_PROFILE_JSON";
export declare const E2E_PREFLIGHT_ENV: "SORNG_E2E_PREFLIGHT";
export declare const ALLOW_RUNNING_PRODUCTION_ENV: "SORNG_E2E_ALLOW_RUNNING_PRODUCTION";
export declare const RUN_LOCK_TOKEN_ENV: "SORNG_E2E_RUN_LOCK_TOKEN";
export declare const WEBVIEW2_USER_DATA_FOLDER_ENV: "WEBVIEW2_USER_DATA_FOLDER";
export declare const WEBVIEW2_FOLDER_ARG: "--sorng-webview2-user-data-folder";
export declare const E2E_RUN_ID_ENV: "SORNG_E2E_RUN_ID";
export declare const E2E_RUN_DIR_ENV: "SORNG_E2E_RUN_DIR";
export declare const E2E_WEBVIEW2_DIR_ENV: "SORNG_E2E_WEBVIEW2_DIR";
export declare const E2E_RUN_ROOT_ENV: "SORNG_E2E_RUN_ROOT";
export declare const KEEP_RUN_DIR_ENV: "SORNG_E2E_KEEP_RUN_DIR";
export declare const RUNS_ROOT_NAME: "sorng-e2e-runs";
export declare const RUN_DIR_MARKER_FILE: ".sorng-e2e-run";
export declare const RUN_WEBVIEW2_DIR_NAME: "webview2";
export declare const WEBVIEW2_POLICY_KEYS: readonly string[];
export declare const SSH_HOME_DIR_NAME: "ssh-home";
export declare const PREFLIGHT_ENV_KEYS: readonly string[];

export declare const E2E_BUILD_MANIFEST_FILE: "e2e-build-manifest.json";
export declare const E2E_BUILD_MANIFEST_SCHEMA: "sorng-e2e-build-manifest/v1";

export type ProfileDirectoryKey =
  "appData" | "appLocalData" | "appConfig" | "appCache" | "appLog";
export type ProfileDirectories = Record<ProfileDirectoryKey, string>;

export declare const PROFILE_DIRECTORY_KEYS: readonly ProfileDirectoryKey[];
export declare const TAURI_PATH_DIRECTORY: Readonly<
  Record<ProfileDirectoryKey, number>
>;
export declare const WINDOWS_APP_IMAGE_NAMES: readonly string[];
export declare const POSIX_APP_IMAGE_NAMES: readonly string[];
export declare const AUTOSTART_REGISTRY_KEYS: readonly string[];
export declare const TAURI_DEV_COMMAND_PATTERN: RegExp;
export declare const WINDOWS_PROCESS_QUERY_SCRIPT: string;
export declare const WIPE_MODES: readonly WipeMode[];

export type WipeMode = "before-and-after" | "none";

export type RefusalCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_OPTIONS"
  | "BINARY_NOT_CONFIGURED"
  | "BINARY_MISSING"
  | "BINARY_IN_SHARED_TARGET"
  | "BINARY_CHANGED"
  | "MARKER_MISSING"
  | "MARKER_PRODUCTION"
  | "MARKER_MISMATCH"
  | "MARKER_AMBIGUOUS"
  | "MANIFEST_INVALID"
  | "MANIFEST_MISMATCH"
  | "PRODUCTION_PROCESS_RUNNING"
  | "PROCESS_CHECK_FAILED"
  | "E2E_BINARY_RUNNING"
  | "LOCK_HELD"
  | "LOCK_UNREADABLE"
  | "PROBE_FAILED"
  | "PROBE_INVALID"
  | "PROBE_PRODUCTION_PATH"
  | "WIPE_TARGET_UNSAFE"
  | "WIPE_FAILED"
  | "KEYCHAIN_TARGET_UNSAFE"
  | "KEYCHAIN_CLEANUP_FAILED"
  | "AUTOSTART_NAME_UNSAFE"
  | "AUTOSTART_CLEANUP_FAILED"
  | "PREFLIGHT_MISSING"
  | "RUN_ABORTED"
  | "WORKER_PROFILE_MISMATCH"
  | "RUN_DIR_UNSAFE"
  | "WEBVIEW2_POLICY_OVERRIDE"
  | "WEBVIEW2_POLICY_CHECK_FAILED"
  | "WEBVIEW2_EVIDENCE_MISSING"
  | "KNOWN_HOSTS_CHANGED";

export declare class E2eIsolationRefusal extends Error {
  constructor(code: RefusalCode, detail: string);
  readonly code: RefusalCode;
  readonly detail: string;
}

export interface ProfileProbe {
  schema: "sorng-profile-probe/v1";
  marker: string;
  identifier: string;
  kind: "production" | "isolated";
  keychainNamespace: string | null;
  autostartName: string;
  dirs: ProfileDirectories;
  productionDirs: ProfileDirectories;
  webview2: {
    userDataFolder: string | null;
    source: "arg" | "env" | "tauri-default";
    tauriDefault: string;
    productionDefault: string;
  };
  sshHome: string | null;
  pid: number;
}

export interface RunProfile {
  runId: string;
  runRoot: string;
  runDir: string;
  webview2Dir: string;
}

export interface ExecResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}
export type Exec = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => ExecResult;
export type SpawnSyncLike = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => Pick<
  SpawnSyncReturns<string>,
  "status" | "signal" | "stdout" | "stderr" | "error"
> & { pid?: number };

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

type Platform = NodeJS.Platform;
/** Environment maps (`process.env` or a plain object in tests). */
export type EnvRecord = Record<string, string | undefined>;
type FsLike = typeof nodeFs;

export declare function isIsolatedIdentifier(identifier: unknown): boolean;
export declare function assertIsolatedIdentifier(identifier: unknown): string;
export declare function profileMarkerFor(identifier: string): string;
export declare function keychainNamespaceFor(identifier: string): string;
export declare function autostartNameFor(identifier: string): string;
export declare function samePath(
  left: string,
  right: string,
  platform?: Platform,
): boolean;
export declare function isSameOrInside(
  child: string,
  parent: string,
  platform?: Platform,
): boolean;

export interface MarkerScanResult {
  identifiers: string[];
  markerCount: number;
}
export declare function createProfileMarkerScanner(): {
  push(chunk: Uint8Array): void;
  finish(): MarkerScanResult;
};
export declare function scanProfileMarkerBuffer(
  buffer: Uint8Array,
  options?: { chunkSize?: number },
): MarkerScanResult;
export declare function inspectProfileBinary(
  file: string,
  options?: { fs?: FsLike; chunkSize?: number },
): Promise<MarkerScanResult & { sha256: string; size: number }>;
export declare function scanProfileMarkers(
  file: string,
  options?: { fs?: FsLike; chunkSize?: number },
): Promise<string[]>;

export declare function isInSharedCargoTarget(
  file: string,
  options?: { repoRoot?: string; platform?: Platform },
): boolean;

export interface E2eBuildManifest {
  schema: "sorng-e2e-build-manifest/v1";
  identifier: string;
  /** File name of the executable, relative to the manifest's directory. */
  exe: string;
  sha256: string;
  size: number;
  [key: string]: unknown;
}
export declare function validateBuildManifest(
  manifest: unknown,
  options: {
    expectedIdentifier: string;
    binary: string;
    sha256: string;
    size: number;
    platform?: Platform;
  },
): E2eBuildManifest;

export interface BinaryFingerprint {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}
export interface VerifiedBinary {
  binary: string;
  identifier: string;
  identifiers: string[];
  markerCount: number;
  sha256: string;
  size: number;
  fingerprint: BinaryFingerprint;
  manifestPath: string | null;
}
export declare function assertIsolatedBinary(options: {
  binary: string | undefined;
  expectedIdentifier: string;
  repoRoot?: string;
  manifestPath?: string;
  platform?: Platform;
  fs?: FsLike;
}): Promise<VerifiedBinary>;
export declare function assertBinaryUnchanged(
  verifiedBinary: VerifiedBinary,
  options?: { fs?: FsLike },
): void;

export declare function validateProfileProbe(
  probe: unknown,
  expectedIdentifier: string,
  options?: { platform?: Platform; expectedWebView2Folder?: string },
): ProfileProbe;
export declare function runProfileProbe(options: {
  verifiedBinary: VerifiedBinary;
  expectedIdentifier: string;
  runProfile?: RunProfile;
  timeoutMs?: number;
  env?: EnvRecord;
  spawnSync?: SpawnSyncLike;
  tmpDir?: string;
  platform?: Platform;
  fs?: FsLike;
}): ProfileProbe;
export declare function profileRoots(
  probe: ProfileProbe,
  options?: { platform?: Platform },
): string[];
export declare function profileRootPairs(
  probe: ProfileProbe,
  options?: { platform?: Platform },
): Array<{ root: string; productionRoot: string }>;
export declare function assertSafeWipeTarget(
  root: string,
  probe: ProfileProbe,
  options?: { platform?: Platform; fs?: FsLike },
): { root: string; exists: boolean };
export declare function wipeIsolatedProfile(
  probe: ProfileProbe,
  options?: { platform?: Platform; fs?: FsLike },
): { roots: string[]; removed: string[] };

export declare function resolveRunProfile(options: {
  env?: EnvRecord;
  identifier: string;
  platform?: Platform;
  tmpDir?: string;
  createRunId?: () => string;
}): RunProfile;
export declare function webview2Launch(
  runProfile: RunProfile,
  options?: { platform?: Platform },
): { env: Record<string, string>; args: string[] };
export declare function assertWebView2LaunchArgs(
  args: unknown,
  runProfile: RunProfile,
  options?: { platform?: Platform },
): string;
export declare function assertSafeRunDir(
  dir: string,
  options: { runRoot: string; platform?: Platform; fs?: FsLike },
): { dir: string; runId: string; markerMtimeMs: number };
export declare function createRunDir(
  runProfile: RunProfile,
  options?: { platform?: Platform; fs?: FsLike },
): { dir: string; runId: string; markerMtimeMs: number; created: boolean };
export declare function wipeRunDir(
  dir: string,
  options: { runRoot: string; platform?: Platform; fs?: FsLike },
): boolean;
export declare function sweepStaleRunDirs(options: {
  runRoot: string;
  keepRunIds?: readonly string[];
  lockDir?: string;
  isAlive?: (pid: number) => boolean;
  now?: () => Date;
  staleAfterMs?: number;
  platform?: Platform;
  fs?: FsLike;
  log?: Logger;
}): string[];
export declare function parseRegQueryValueNames(stdout: unknown): string[];
export declare function findWebView2PolicyOverrides(
  names: readonly string[],
  options?: { binary?: string },
): string[];
export declare function checkWebView2PolicyOverride(options?: {
  binary?: string;
  platform?: Platform;
  exec?: Exec;
}): { supported: boolean; overrides: string[] };
export declare function assertWebView2Evidence(options: {
  probe: ProfileProbe;
  runProfile: RunProfile;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  platform?: Platform;
  fs?: FsLike;
}): Promise<{ runFolder: string; defaultFolder: string }>;

export declare function defaultExec(
  file: string,
  args: readonly string[],
  options?: Record<string, unknown>,
): ExecResult;
export declare function encodePowerShellCommand(script: string): string;
export declare function decodePowerShellCommand(encoded: string): string;

export declare function keychainTargetPattern(identifier: string): RegExp;
export declare function isIsolatedKeychainTarget(
  target: unknown,
  identifier: string,
): boolean;
export declare function buildKeychainListScript(identifier: string): string;
export declare function buildKeychainDeleteScript(
  identifier: string,
  targets: readonly string[],
): string;
export declare function cleanupIsolatedKeychain(
  identifier: string,
  options?: { platform?: Platform; exec?: Exec; log?: Logger },
): { supported: boolean; deleted: string[]; missing: string[] };

export declare function parseIsolatedAutostartName(
  name: unknown,
): string | null;
export declare function cleanupIsolatedAutostart(
  autostartName: string,
  options?: {
    expectedIdentifier?: string;
    platform?: Platform;
    exec?: Exec;
    log?: Logger;
  },
): { supported: boolean; removed: string[] };

export interface ProcessRecord {
  pid: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
}
export interface ClassifiedProcess {
  pid: number;
  name: string;
  executablePath: string | null;
  reason: string;
}
export declare function listCandidateProcesses(options?: {
  platform?: Platform;
  exec?: Exec;
}): ProcessRecord[];
export declare function classifyProcesses(
  records: readonly ProcessRecord[],
  options?: { binary?: string; platform?: Platform; selfPid?: number },
): { production: ClassifiedProcess[]; sameBinary: ClassifiedProcess[] };
export declare function inspectRunningProcesses(
  binary: string,
  options?: { platform?: Platform; exec?: Exec; selfPid?: number },
): { production: ClassifiedProcess[]; sameBinary: ClassifiedProcess[] };
export declare function listProductionProcesses(
  binary: string,
  options?: { platform?: Platform; exec?: Exec; selfPid?: number },
): ClassifiedProcess[];

export interface RunLock {
  path: string;
  pid: number;
  token: string;
  runId: string | null;
  startedAt: string;
  cwd: string;
  inherited: boolean;
}
export declare function runLockPath(
  identifier: string,
  options?: { lockDir?: string },
): string;
export declare function isProcessAlive(pid: number): boolean;
export declare function readRunLock(
  identifier: string,
  options?: { lockDir?: string; fs?: FsLike },
): (Omit<RunLock, "inherited"> & Record<string, unknown>) | null;
export declare function acquireRunLock(
  identifier: string,
  options?: {
    runId?: string;
    lockDir?: string;
    env?: EnvRecord;
    pid?: number;
    cwd?: string;
    now?: () => Date;
    isAlive?: (pid: number) => boolean;
    fs?: FsLike;
    log?: Logger;
  },
): RunLock;
export declare function releaseRunLock(
  lock: RunLock | null | undefined,
  options?: { fs?: FsLike },
): boolean;
export declare function markRunAborted(options: {
  identifier: string;
  runId: string;
  reason: string;
  lockDir?: string;
  now?: () => Date;
  fs?: FsLike;
}): string;

export interface FileMetadataEntry {
  path: string;
  type: "file" | "dir" | "link" | "other";
  size: number;
  mtimeMs: number;
}
export declare function snapshotFileMetadata(
  dir: string,
  options?: { depth?: number; maxEntries?: number; fs?: FsLike },
): {
  root: string;
  exists: boolean;
  truncated: boolean;
  entries: FileMetadataEntry[];
};
export declare function hashFileIfExists(
  file: string,
  options?: { fs?: FsLike },
): string | null;

export interface IsolatedE2eRun {
  runId: string;
  identifier: string;
  wipe: WipeMode;
  binary: VerifiedBinary;
  probe: ProfileProbe;
  lock: RunLock;
  runProfile: RunProfile;
  knownHostsHash: string | null;
  productionProcesses: ClassifiedProcess[];
  /** Publish into the launcher's `process.env` before starting the driver. */
  env: Record<string, string>;
  /** Synchronous and idempotent; safe inside `exit` handlers. */
  teardown(): { errors: string[]; warnings: string[] };
}
export declare function prepareIsolatedE2eRun(options: {
  binary: string | undefined;
  expectedIdentifier: string;
  wipe: WipeMode;
  runProfile: RunProfile;
  repoRoot?: string;
  env?: EnvRecord;
  platform?: Platform;
  exec?: Exec;
  spawnSync?: SpawnSyncLike;
  fs?: FsLike;
  lockDir?: string;
  tmpDir?: string;
  isAlive?: (pid: number) => boolean;
  selfPid?: number;
  knownHostsPath?: string;
  probeTimeoutMs?: number;
  now?: () => Date;
  log?: Logger;
}): Promise<IsolatedE2eRun>;

export declare function verifyWorkerPreflight(options?: {
  env?: EnvRecord;
  lockDir?: string;
  isAlive?: (pid: number) => boolean;
  platform?: Platform;
  fs?: FsLike;
}): {
  runId: string;
  identifier: string;
  probe: ProfileProbe;
  runProfile: RunProfile;
  lockPath: string;
};
export declare function assertResolvedProfileDirectories(
  probe: ProfileProbe,
  resolved: Partial<Record<ProfileDirectoryKey, unknown>> | null | undefined,
  options?: { platform?: Platform },
): ProfileDirectories;
