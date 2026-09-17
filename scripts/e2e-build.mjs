#!/usr/bin/env node
// Builds the isolated desktop e2e binary (t91).
//
// The binary is compiled with `src-tauri/tauri.e2e.conf.json`, so its
// identifier is `com.sortofremote.ng.e2e`: every Tauri profile directory, the
// WebView2 folder and the keychain service namespace follow that identifier.
// Cargo writes into a dedicated target (`.artifacts/e2e/target` by default),
// never `src-tauri/target`, where `tauri dev` rebuilds the production-identifier
// `app.exe` in place. The executable and its adjacent runtime files are then
// copied to `.artifacts/e2e/bin/<UTC>-<sha>/`, the copy's identity marker is
// verified, and `e2e-build-manifest.json` records its hash beside it. WDIO and
// the isolation self-test refuse any binary that fails those checks.

import { spawn, spawnSync } from "node:child_process";
import nodeFs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { browserDevLockPath } from "./dev-port.mjs";
import {
  E2E_BUILD_MANIFEST_FILE,
  E2E_BUILD_MANIFEST_SCHEMA,
  E2E_IDENTIFIER,
  E2eIsolationRefusal,
  POSIX_APP_IMAGE_NAMES,
  WINDOWS_APP_IMAGE_NAMES,
  assertIsolatedBinary,
  isInSharedCargoTarget,
  isSameOrInside,
} from "./lib/e2e-profile-isolation.mjs";

/** @typedef {import("./lib/e2e-profile-isolation.mjs").EnvRecord} EnvRecord */
/** @typedef {import("./lib/e2e-profile-isolation.mjs").Exec} Exec */

const LOG_PREFIX = "[e2e:build]";
const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const E2E_TAURI_CONFIG = "src-tauri/tauri.e2e.conf.json";
/** Skips `npm run build`; the build embeds the `out/` already on disk. */
export const REUSE_FRONTEND_CONFIG = '{"build":{"beforeBuildCommand":""}}';
export const DEFAULT_E2E_TARGET_DIR = path.join(".artifacts", "e2e", "target");
export const E2E_BIN_ROOT = path.join(".artifacts", "e2e", "bin");
export const E2E_CARGO_TARGET_DIR_ENV = "SORNG_E2E_CARGO_TARGET_DIR";
/** Runtime resource folders Tauri stages beside the executable. */
export const RUNTIME_RESOURCE_DIRS = Object.freeze([
  "opkssh",
  "file-viewer",
  "locales",
]);
/** Resource sources that only the production `beforeBuildCommand` stages. */
export const STAGED_RESOURCE_SOURCES = Object.freeze([
  {
    source: path.join("src-tauri", "crates", "sorng-opkssh-vendor", "bundle"),
    hint: "npm run stage:opkssh-vendor -- --release --enable",
  },
  {
    source: path.join(
      "src-tauri",
      "crates",
      "sorng-file-viewer-host",
      "bundle",
    ),
    hint: "npm run stage:file-viewer -- --release",
  },
]);

export const USAGE = [
  "usage: npm run e2e:build -- [--reuse-frontend] [--dry-run] [-- <tauri build args>]",
  "",
  "  --reuse-frontend  embed the existing out/ instead of running `npm run build`",
  "                    (rebuild out/ first after frontend changes)",
  "  --dry-run         print the build plan and exit",
  "",
  `Cargo target: ${E2E_CARGO_TARGET_DIR_ENV} or ${DEFAULT_E2E_TARGET_DIR} (never src-tauri/target).`,
].join("\n");

export class E2eBuildError extends Error {
  /**
   * @param {string} message
   * @param {{ usage?: boolean }} [options]
   */
  constructor(message, { usage = false } = {}) {
    super(message);
    this.name = "E2eBuildError";
    this.usage = usage;
  }
}

// Tauri build options that would change the identity, the profile or the
// location of the executable this script verifies.
const FORBIDDEN_PASSTHROUGH = [
  {
    matches: (arg) => arg === "--config" || arg === "-c",
    why: `the identity comes only from ${E2E_TAURI_CONFIG}`,
  },
  {
    matches: (arg) => arg.startsWith("--config=") || /^-c./.test(arg),
    why: `the identity comes only from ${E2E_TAURI_CONFIG}`,
  },
  {
    matches: (arg) => arg === "--release" || arg === "-r",
    why: "e2e uses the debug build",
  },
  {
    matches: (arg) => arg === "--target-dir" || arg.startsWith("--target-dir="),
    why: `set ${E2E_CARGO_TARGET_DIR_ENV} instead`,
  },
  {
    matches: (arg) =>
      arg === "--bundles" || arg === "-b" || arg.startsWith("--bundles="),
    why: "the e2e build never bundles",
  },
];

/**
 * @param {readonly string[]} argv
 * @returns {{ help: boolean, reuseFrontend: boolean, dryRun: boolean, passthrough: string[] }}
 */
export function parseBuildArgs(argv) {
  const options = {
    help: false,
    reuseFrontend: false,
    dryRun: false,
    /** @type {string[]} */
    passthrough: [],
  };
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  options.passthrough = separator === -1 ? [] : [...argv.slice(separator + 1)];
  for (const arg of own) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--reuse-frontend") {
      options.reuseFrontend = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new E2eBuildError(
        `unknown option ${JSON.stringify(arg)}; pass tauri build arguments after "--".\n${USAGE}`,
        { usage: true },
      );
    }
  }
  for (const arg of options.passthrough) {
    const forbidden = FORBIDDEN_PASSTHROUGH.find((rule) => rule.matches(arg));
    if (forbidden) {
      throw new E2eBuildError(
        `refusing tauri build argument ${JSON.stringify(arg)}: ${forbidden.why}.`,
      );
    }
  }
  return options;
}

/**
 * The `--target <triple>` passed through to tauri, or `null`.
 * @param {readonly string[]} passthrough
 * @returns {string | null}
 */
export function targetTripleFrom(passthrough) {
  for (let index = 0; index < passthrough.length; index += 1) {
    const arg = passthrough[index];
    if (arg === "--") {
      break;
    }
    if (arg === "--target" || arg === "-t") {
      const value = passthrough[index + 1];
      if (!value || value.startsWith("-")) {
        throw new E2eBuildError(`${arg} needs a target triple.`);
      }
      return value;
    }
    if (arg.startsWith("--target=")) {
      return arg.slice("--target=".length);
    }
  }
  return null;
}

/**
 * The absolute Cargo target for the e2e build. Refuses any `src-tauri/target`
 * (this checkout, a worktree or another checkout) and anything inside
 * `src-tauri`, where `tauri dev` watches and rebuilds.
 * @param {{ repoRoot?: string, env?: EnvRecord, platform?: NodeJS.Platform }} [options]
 * @returns {string}
 */
export function resolveE2eTargetDir({
  repoRoot = defaultRepoRoot,
  env = process.env,
  platform = process.platform,
} = {}) {
  const configured = env[E2E_CARGO_TARGET_DIR_ENV]?.trim();
  const targetDir = path.resolve(
    repoRoot,
    configured ? configured : DEFAULT_E2E_TARGET_DIR,
  );
  if (
    isInSharedCargoTarget(targetDir, { repoRoot, platform }) ||
    isSameOrInside(targetDir, path.join(repoRoot, "src-tauri"), platform)
  ) {
    throw new E2eBuildError(
      [
        `refusing Cargo target ${targetDir}.`,
        "  Why: src-tauri/target holds the production-identifier app.exe that `tauri dev` rebuilds in place; an e2e build there would overwrite it and race the running dev app.",
        `  Fix: unset ${E2E_CARGO_TARGET_DIR_ENV} (default ${DEFAULT_E2E_TARGET_DIR}) or point it outside src-tauri.`,
      ].join("\n"),
    );
  }
  return targetDir;
}

/**
 * `node scripts/native-build-env.mjs <node> <tauri.js> build --debug
 * --no-bundle --config src-tauri/tauri.e2e.conf.json [...]`.
 * @param {{ repoRoot?: string, nodePath?: string, reuseFrontend?: boolean, passthrough?: readonly string[] }} [options]
 * @returns {{ command: string, args: string[] }}
 */
export function buildTauriCommand({
  repoRoot = defaultRepoRoot,
  nodePath = process.execPath,
  reuseFrontend = false,
  passthrough = [],
} = {}) {
  const args = [
    path.join(repoRoot, "scripts", "native-build-env.mjs"),
    nodePath,
    path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
    "build",
    "--debug",
    "--no-bundle",
    "--config",
    E2E_TAURI_CONFIG,
    ...(reuseFrontend ? ["--config", REUSE_FRONTEND_CONFIG] : []),
    ...passthrough,
  ];
  return { command: nodePath, args };
}

/**
 * The build's child environment: the dedicated target and no inherited `TAURI_CONFIG`.
 * @param {{ env?: EnvRecord, targetDir: string }} options
 * @returns {EnvRecord}
 */
export function buildEnvironment({ env = process.env, targetDir }) {
  const child = { ...env, CARGO_TARGET_DIR: targetDir };
  delete child.TAURI_CONFIG;
  return child;
}

/**
 * Refusals and warnings about the frontend the build embeds. `--reuse-frontend`
 * needs an existing `out/index.html` (warned when older than HEAD). Otherwise
 * `npm run build` writes `.next`, so a running browser `npm run dev` (which
 * holds `.next/dev/lock`) refuses the build; managed `tauri dev` uses
 * `.next-tauri-dev` and does not conflict.
 * @param {{ repoRoot?: string, reuseFrontend: boolean, headCommitTimeMs?: number | null, fs?: typeof nodeFs }} options
 * @returns {{ warnings: string[] }}
 */
export function frontendPreflight({
  repoRoot = defaultRepoRoot,
  reuseFrontend,
  headCommitTimeMs = null,
  fs = nodeFs,
}) {
  const warnings = [];
  if (reuseFrontend) {
    const index = path.join(repoRoot, "out", "index.html");
    let stat;
    try {
      stat = fs.statSync(index);
    } catch {
      throw new E2eBuildError(
        `--reuse-frontend needs a built frontend at ${index}; run \`npm run build\` first or drop --reuse-frontend.`,
      );
    }
    if (headCommitTimeMs !== null && stat.mtimeMs < headCommitTimeMs) {
      warnings.push(
        `${index} is older than the HEAD commit; the binary will embed that older frontend. Run \`npm run build\` first if the frontend changed.`,
      );
    }
    return { warnings };
  }
  const lock = browserDevLockPath(repoRoot);
  if (fs.existsSync(lock)) {
    throw new E2eBuildError(
      `a browser Next.js dev server holds ${lock}; \`npm run build\` would share its .next directory. Stop that \`npm run dev\` session, or build out/ earlier and pass --reuse-frontend.`,
    );
  }
  return { warnings };
}

/**
 * Warnings for runtime resources the e2e config does not stage itself.
 * @param {{ repoRoot?: string, fs?: typeof nodeFs }} [options]
 * @returns {string[]}
 */
export function stagedResourceWarnings({
  repoRoot = defaultRepoRoot,
  fs = nodeFs,
} = {}) {
  return STAGED_RESOURCE_SOURCES.filter(
    ({ source }) => !fs.existsSync(path.join(repoRoot, source)),
  ).map(
    ({ source, hint }) =>
      `${source} is missing; the e2e config does not stage it. Run \`${hint}\` first if the build fails on resources.`,
  );
}

/**
 * Candidate executables the build can produce, most specific first.
 * @param {{ targetDir: string, triple?: string | null, platform?: NodeJS.Platform }} options
 * @returns {string[]}
 */
export function builtExecutableCandidates({
  targetDir,
  triple = null,
  platform = process.platform,
}) {
  const names =
    platform === "win32" ? WINDOWS_APP_IMAGE_NAMES : POSIX_APP_IMAGE_NAMES;
  const profileDir = triple
    ? path.join(targetDir, triple, "debug")
    : path.join(targetDir, "debug");
  return names.map((name) => path.join(profileDir, name));
}

/**
 * The most recently written candidate executable; refuses when none exists.
 * @param {readonly string[]} candidates
 * @param {{ fs?: typeof nodeFs }} [options]
 * @returns {string}
 */
export function selectBuiltExecutable(candidates, { fs = nodeFs } = {}) {
  let selected = null;
  for (const candidate of candidates) {
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (stat.isFile() && (!selected || stat.mtimeMs > selected.mtimeMs)) {
      selected = { file: candidate, mtimeMs: stat.mtimeMs };
    }
  }
  if (!selected) {
    throw new E2eBuildError(
      `the build finished without an executable; looked for ${candidates.join(", ")}.`,
    );
  }
  return selected.file;
}

/**
 * `20260915T173012Z`
 * @param {Date} date
 */
export function utcStamp(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/**
 * Where the verified copy goes: `<repo>/.artifacts/e2e/bin/<UTC>-<sha>/` with
 * the executable (same file name), the runtime resource folders and the
 * shared libraries that sit beside it in the Cargo profile directory.
 */
export function planArtifactCopy({
  sourceExe,
  repoRoot = defaultRepoRoot,
  now,
  shortSha,
  platform = process.platform,
  fs = nodeFs,
}) {
  const sourceDir = path.dirname(sourceExe);
  const binDir = path.join(
    repoRoot,
    E2E_BIN_ROOT,
    `${utcStamp(now)}-${shortSha || "nogit"}`,
  );
  const libraryPattern =
    platform === "win32" ? /\.dll$/i : /\.(?:so(?:\.\d+)*|dylib)$/;
  const directories = [];
  const libraries = [];
  let names = [];
  try {
    names = fs.readdirSync(sourceDir).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const from = path.join(sourceDir, name);
    let stat;
    try {
      stat = fs.lstatSync(from);
    } catch {
      continue;
    }
    if (stat.isDirectory() && RUNTIME_RESOURCE_DIRS.includes(name)) {
      directories.push({ from, to: path.join(binDir, name) });
    } else if (stat.isFile() && libraryPattern.test(name)) {
      libraries.push({ from, to: path.join(binDir, name) });
    }
  }
  return {
    binDir,
    exe: { from: sourceExe, to: path.join(binDir, path.basename(sourceExe)) },
    directories,
    libraries,
  };
}

/**
 * Copies a plan into a new bin directory; refuses to reuse an existing one.
 * `onCreated` runs once the directory is this build's own, so a failure after
 * that point can remove it without touching another build's copy.
 */
export function executeArtifactCopy(
  plan,
  { fs = nodeFs, onCreated = () => {} } = {},
) {
  fs.mkdirSync(path.dirname(plan.binDir), { recursive: true });
  try {
    fs.mkdirSync(plan.binDir);
  } catch (error) {
    throw new E2eBuildError(
      `cannot create ${plan.binDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  onCreated();
  fs.copyFileSync(plan.exe.from, plan.exe.to, fs.constants.COPYFILE_EXCL);
  for (const { from, to } of plan.libraries) {
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
  for (const { from, to } of plan.directories) {
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  }
  return plan.exe.to;
}

export function createBuildManifest({
  verifiedBinary,
  builtAt,
  git,
  targetDir,
  args,
  sourceExe,
  plan,
}) {
  return {
    schema: E2E_BUILD_MANIFEST_SCHEMA,
    identifier: verifiedBinary.identifier,
    exe: path.basename(verifiedBinary.binary),
    sha256: verifiedBinary.sha256,
    size: verifiedBinary.size,
    builtAt: builtAt.toISOString(),
    gitHead: git.head,
    gitDirty: git.dirty,
    targetDir,
    args,
    sourceExe,
    resources: plan.directories.map(({ to }) => path.basename(to)),
    libraries: plan.libraries.map(({ to }) => path.basename(to)),
  };
}

/**
 * HEAD, a short sha, the commit time and whether tracked files changed.
 * @param {{ repoRoot?: string, exec: Exec }} options
 * @returns {{ head: string | null, shortSha: string | null, commitTimeMs: number | null, dirty: boolean | null }}
 */
export function readGitState({ repoRoot = defaultRepoRoot, exec }) {
  const git = (args) => {
    const result = exec("git", args, { cwd: repoRoot });
    return result && !result.error && result.status === 0
      ? String(result.stdout ?? "").trim()
      : null;
  };
  const head = git(["rev-parse", "HEAD"]);
  const commitTime = git(["log", "-1", "--format=%ct"]);
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  return {
    head,
    shortSha: head ? head.slice(0, 12) : null,
    commitTimeMs: commitTime ? Number(commitTime) * 1000 : null,
    dirty: status === null ? null : status.length > 0,
  };
}

function defaultExec(file, args, options = {}) {
  return spawnSync(file, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function defaultRun(command, args, { env, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal: signal ?? null }),
    );
  });
}

const defaultLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

/**
 * Builds, copies, verifies and records the e2e binary. Returns the process
 * exit code; every refusal is printed with its reason.
 * @param {readonly string[]} [argv]
 * @param {Record<string, any>} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    repoRoot = defaultRepoRoot,
    env = process.env,
    platform = process.platform,
    nodePath = process.execPath,
    fs = nodeFs,
    exec = defaultExec,
    run = defaultRun,
    now = () => new Date(),
    log = defaultLog,
    verifyBinary = assertIsolatedBinary,
  } = deps;

  let binDir = null;
  try {
    const options = parseBuildArgs(argv);
    if (options.help) {
      log.info(USAGE);
      return 0;
    }
    const targetDir = resolveE2eTargetDir({ repoRoot, env, platform });
    const triple = targetTripleFrom(options.passthrough);
    const git = readGitState({ repoRoot, exec });
    const { warnings } = frontendPreflight({
      repoRoot,
      reuseFrontend: options.reuseFrontend,
      headCommitTimeMs: git.commitTimeMs,
      fs,
    });
    for (const warning of [
      ...warnings,
      ...stagedResourceWarnings({ repoRoot, fs }),
    ]) {
      log.warn(`${LOG_PREFIX} warning: ${warning}`);
    }

    const { command, args } = buildTauriCommand({
      repoRoot,
      nodePath,
      reuseFrontend: options.reuseFrontend,
      passthrough: options.passthrough,
    });
    const childEnv = buildEnvironment({ env, targetDir });
    log.info(
      `${LOG_PREFIX} identifier ${E2E_IDENTIFIER} (${E2E_TAURI_CONFIG})`,
    );
    log.info(`${LOG_PREFIX} CARGO_TARGET_DIR=${targetDir}`);
    log.info(
      `${LOG_PREFIX} frontend: ${options.reuseFrontend ? "reusing out/ (beforeBuildCommand disabled)" : "npm run build"}`,
    );
    log.info(`${LOG_PREFIX} ${[command, ...args].join(" ")}`);
    if (env.TAURI_CONFIG !== undefined) {
      log.warn(
        `${LOG_PREFIX} ignoring the inherited TAURI_CONFIG for this build.`,
      );
    }
    if (options.dryRun) {
      return 0;
    }

    const startedAt = now();
    const result = await run(command, args, { env: childEnv, cwd: repoRoot });
    if (result.code !== 0) {
      throw new E2eBuildError(
        `tauri build failed with ${result.signal ? `signal ${result.signal}` : `exit code ${String(result.code)}`}.`,
      );
    }

    const sourceExe = selectBuiltExecutable(
      builtExecutableCandidates({ targetDir, triple, platform }),
      { fs },
    );
    const plan = planArtifactCopy({
      sourceExe,
      repoRoot,
      now: startedAt,
      shortSha: git.shortSha,
      platform,
      fs,
    });
    const binary = executeArtifactCopy(plan, {
      fs,
      onCreated: () => {
        binDir = plan.binDir;
      },
    });

    const verified = await verifyBinary({
      binary,
      expectedIdentifier: E2E_IDENTIFIER,
      repoRoot,
      platform,
      fs,
    });
    const manifestPath = path.join(plan.binDir, E2E_BUILD_MANIFEST_FILE);
    const manifest = createBuildManifest({
      verifiedBinary: verified,
      builtAt: startedAt,
      git,
      targetDir,
      args: [command, ...args],
      sourceExe,
      plan,
    });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    const recorded = await verifyBinary({
      binary,
      expectedIdentifier: E2E_IDENTIFIER,
      repoRoot,
      manifestPath,
      platform,
      fs,
    });

    log.info(
      `${LOG_PREFIX} verified marker [${recorded.identifiers.join(", ")}] x${recorded.markerCount}, sha256 ${recorded.sha256}`,
    );
    log.info(`${LOG_PREFIX} manifest ${manifestPath}`);
    log.info(`TAURI_BINARY_PATH=${recorded.binary}`);
    log.info(
      `${LOG_PREFIX} next: npm run e2e:isolation:selftest -- --binary "${recorded.binary}"`,
    );
    return 0;
  } catch (error) {
    if (binDir && fs.existsSync(binDir)) {
      // Never leave an unverified binary where the harness looks for one.
      fs.rmSync(binDir, { recursive: true, force: true });
    }
    if (
      error instanceof E2eBuildError ||
      error instanceof E2eIsolationRefusal
    ) {
      log.error(`${LOG_PREFIX} ${error.message}`);
      return error instanceof E2eBuildError && error.usage ? 2 : 1;
    }
    throw error;
  }
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
