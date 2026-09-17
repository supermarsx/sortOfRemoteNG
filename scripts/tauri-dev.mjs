#!/usr/bin/env node
// Import-safe Tauri development orchestrator. It selects a free port before
// Tauri starts, pins devUrl and the development capability origin to that port,
// and marks the beforeDev launch as fixed so it can never silently diverge.
// It also prints which app profile dev uses: the production identifier by
// default, or an opt-in isolated identifier with --isolated-profile.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertNoManagedDevLock,
  parseDevPort,
  resolveDevPort,
  DEFAULT_PORT,
} from "./dev-port.mjs";
import { stageVendorArtifact } from "./stage-opkssh-vendor.mjs";
import { stageFileViewerHost } from "./stage-file-viewer-host.mjs";
import { buildNativeChildEnvironment } from "./lib/native-child-env.mjs";
import {
  describeDevBuildResources,
  planDevBuildResources,
} from "./lib/dev-build-budget.mjs";

const require = createRequire(import.meta.url);
const tauriConfigPath = fileURLToPath(
  new URL("../src-tauri/tauri.conf.json", import.meta.url),
);
const defaultCapabilityPath = fileURLToPath(
  new URL("../src-tauri/capabilities/default.json", import.meta.url),
);

// The compiled identifier selects the Rust profile directories, the WebView2
// user data folder and, for any non-production identifier, the keychain service
// namespace. Dev deliberately stays on the production identifier (the user's
// real data) unless --isolated-profile is passed.
export const PRODUCTION_IDENTIFIER = "com.sortofremote.ng";
export const ISOLATED_PROFILE_FLAG = "--isolated-profile";
export const DEFAULT_ISOLATED_PROFILE_SUFFIX = "dev";
export const DEV_ISOLATED_IDENTIFIER = `${PRODUCTION_IDENTIFIER}.${DEFAULT_ISOLATED_PROFILE_SUFFIX}`;
// Harness identifiers whose profiles are wiped before and after every run,
// including future `-<slot>` variants; dev data must never live there.
const RESERVED_PROFILE_SUFFIXES = Object.freeze(["e2e", "readme-capture"]);
const PROFILE_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_IDENTIFIER_LENGTH = 128;

function isIsolatedProfileArgument(arg) {
  return (
    arg === ISOLATED_PROFILE_FLAG || arg.startsWith(`${ISOLATED_PROFILE_FLAG}=`)
  );
}

export function isolatedProfileIdentifier(
  suffix = DEFAULT_ISOLATED_PROFILE_SUFFIX,
) {
  if (typeof suffix !== "string" || !PROFILE_SUFFIX_PATTERN.test(suffix)) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG}=${suffix} is invalid: the suffix must be lowercase letters, digits and '-' (for example ${ISOLATED_PROFILE_FLAG}=dev2).`,
    );
  }
  const reserved = RESERVED_PROFILE_SUFFIXES.find(
    (name) => suffix === name || suffix.startsWith(`${name}-`),
  );
  if (reserved) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG}=${suffix} is reserved: ${PRODUCTION_IDENTIFIER}.${reserved} profiles belong to a test harness that wipes them on every run. Choose another suffix.`,
    );
  }
  const identifier = `${PRODUCTION_IDENTIFIER}.${suffix}`;
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG}=${suffix} is invalid: the identifier exceeds ${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return identifier;
}

function resolveDevProfileIdentifier(isolatedProfile) {
  if (isolatedProfile === undefined || isolatedProfile === null) {
    return PRODUCTION_IDENTIFIER;
  }
  const prefix = `${PRODUCTION_IDENTIFIER}.`;
  if (
    typeof isolatedProfile !== "string" ||
    !isolatedProfile.startsWith(prefix)
  ) {
    throw new Error(
      `isolatedProfile must be a ${prefix}<suffix> identifier, got ${JSON.stringify(isolatedProfile)}`,
    );
  }
  return isolatedProfileIdentifier(isolatedProfile.slice(prefix.length));
}

// Consumes --isolated-profile[=<suffix>] from the launcher arguments. Arguments
// after `--` belong to Cargo and the app, so the flag is refused there.
export function parseDevProfileArguments(argv = [], env = {}) {
  if (env.npm_config_isolated_profile !== undefined) {
    throw new Error(
      `npm consumed ${ISOLATED_PROFILE_FLAG} as its own option, so the launcher never received it. Pass it after \`--\`: npm run tauri dev -- ${ISOLATED_PROFILE_FLAG}`,
    );
  }
  const separator = argv.indexOf("--");
  const launcherArguments = separator === -1 ? argv : argv.slice(0, separator);
  const runnerArguments = separator === -1 ? [] : argv.slice(separator);
  if (runnerArguments.some(isIsolatedProfileArgument)) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG} must come before \`--\`; arguments after it are passed to Cargo and the app.`,
    );
  }
  const flags = launcherArguments.filter(isIsolatedProfileArgument);
  if (flags.length > 1) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG} was given ${flags.length} times; pass it once.`,
    );
  }
  const [flag] = flags;
  return {
    isolatedProfile:
      flag === undefined
        ? null
        : isolatedProfileIdentifier(
            flag === ISOLATED_PROFILE_FLAG
              ? DEFAULT_ISOLATED_PROFILE_SUFFIX
              : flag.slice(ISOLATED_PROFILE_FLAG.length + 1),
          ),
    passthrough: [
      ...launcherArguments.filter((arg) => !isIsolatedProfileArgument(arg)),
      ...runnerArguments,
    ],
  };
}

// Display-only mirror of the base folders Tauri joins the identifier onto
// (`dirs::data_dir` and `dirs::data_local_dir`). On Windows those come from
// SHGetKnownFolderPath, which the logon APPDATA/LOCALAPPDATA values mirror.
// Nothing here reads, writes or deletes a profile.
export function resolveKnownFolders({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform === "win32") {
    return {
      data: env.APPDATA || win32.join(home, "AppData", "Roaming"),
      localData: env.LOCALAPPDATA || win32.join(home, "AppData", "Local"),
    };
  }
  if (platform === "darwin") {
    const support = posix.join(home, "Library", "Application Support");
    return { data: support, localData: support };
  }
  const data =
    env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : posix.join(home, ".local", "share");
  return { data, localData: data };
}

export function describeDevProfile({
  identifier,
  devUrl,
  platform = process.platform,
  env = process.env,
  knownFolders = resolveKnownFolders({ platform, env }),
}) {
  const isolated = identifier !== PRODUCTION_IDENTIFIER;
  const join = platform === "win32" ? win32.join : posix.join;
  const locations = [`data ${join(knownFolders.data, identifier)}`];
  if (platform === "win32") {
    // WebView2 honours this override over the folder Tauri passes.
    const override = env.WEBVIEW2_USER_DATA_FOLDER;
    locations.push(
      override
        ? `WebView2 ${join(override, "EBWebView")} (from WEBVIEW2_USER_DATA_FOLDER)`
        : `WebView2 ${join(knownFolders.localData, identifier, "EBWebView")}`,
    );
  }
  locations.push(
    isolated
      ? `keychain entries namespaced @${identifier}`
      : "keychain production entries",
    `origin ${devUrl}`,
  );
  if (!isolated) {
    return [
      `dev profile: PRODUCTION (${identifier}, shared with the installed app; your real data): ${locations.join(", ")}. Use ${ISOLATED_PROFILE_FLAG} for a separate, empty dev profile.`,
    ];
  }
  return [
    `dev profile: ISOLATED (${identifier}, separate from the installed app): ${locations.join(", ")}.`,
    `${ISOLATED_PROFILE_FLAG} compiles the app with identifier ${identifier}, so the app crate rebuilds (and again on the next launch without the flag). This profile starts empty: no production connections, settings or vault key.`,
  ];
}

export function buildDevSecurityOverride(portValue) {
  const port = parseDevPort(portValue);
  const { $schema: _schema, ...capability } = JSON.parse(
    readFileSync(defaultCapabilityPath, "utf8"),
  );
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const productionCsp = tauriConfig?.app?.security?.csp;
  if (
    typeof productionCsp !== "string" ||
    !productionCsp.includes("connect-src")
  ) {
    throw new Error("tauri.conf.json must define a connect-src CSP directive");
  }

  const httpOrigin = `http://localhost:${port}`;
  const websocketOrigin = `ws://localhost:${port}`;
  const devCsp = productionCsp.replace(
    /connect-src\s+([^;]*)/,
    (_directive, sources) =>
      `connect-src ${sources.trim()} ${httpOrigin} ${websocketOrigin}`,
  );

  return {
    capabilities: [
      {
        ...capability,
        remote: { urls: [httpOrigin] },
      },
    ],
    csp: devCsp,
  };
}

export function buildTauriLaunchPlan({
  port: portValue,
  passthrough = [],
  baseEnv = process.env,
  securityOverride,
  isolatedProfile,
  nativeEnvironmentOptions,
  buildResourceOptions,
} = {}) {
  const port = parseDevPort(portValue);
  const identifier = resolveDevProfileIdentifier(isolatedProfile);
  if (passthrough.some(isIsolatedProfileArgument)) {
    throw new Error(
      `${ISOLATED_PROFILE_FLAG} must be consumed by parseDevProfileArguments and never forwarded to Tauri.`,
    );
  }
  const devUrl = `http://localhost:${port}`;
  const security = securityOverride ?? buildDevSecurityOverride(port);
  // The override becomes TAURI_CONFIG, an app crate build input. Without an
  // isolated profile it must stay byte-identical so dev neither rebuilds nor
  // leaves the production profile.
  const override = {
    ...(identifier === PRODUCTION_IDENTIFIER ? {} : { identifier }),
    build: { devUrl },
    app: { security },
  };
  const buildResources = planDevBuildResources({
    ...buildResourceOptions,
    argv: passthrough,
    baseEnv,
  });

  return {
    port,
    devUrl,
    identifier,
    buildResources,
    env: {
      ...buildNativeChildEnvironment({
        ...nativeEnvironmentOptions,
        baseEnv,
        argv: passthrough,
      }),
      ...buildResources.environment,
      SORNG_DEV_PORT: String(port),
      SORNG_DEV_PORT_RESOLVED: "1",
      SORNG_TAURI_MANAGED_DEV: "1",
    },
    tauriArgs: ["dev", "-c", JSON.stringify(override), ...passthrough],
  };
}

export function prepareTauriDevOpkssh(
  passthrough,
  env,
  log,
  stage = stageVendorArtifact,
) {
  return stage({
    argv: passthrough.filter(
      (arg, index) =>
        arg === "--target" ||
        passthrough[index - 1] === "--target" ||
        arg.startsWith("--target="),
    ),
    env,
    log,
  });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const host = dependencies.process ?? process;
  const baseEnv = dependencies.env ?? host.env;
  const log =
    dependencies.log ?? ((message) => console.log(`[tauri-dev] ${message}`));
  const { isolatedProfile, passthrough } = parseDevProfileArguments(
    argv,
    baseEnv,
  );
  const preferred = parseDevPort(
    baseEnv.SORNG_DEV_PORT ?? DEFAULT_PORT,
    "SORNG_DEV_PORT",
  );

  (dependencies.assertNoManagedDevLock ?? assertNoManagedDevLock)();
  const selected = await (dependencies.resolveDevPort ?? resolveDevPort)({
    preferred,
    fixed: false,
    log,
  });
  const plan = buildTauriLaunchPlan({
    port: selected.port,
    passthrough,
    baseEnv,
    isolatedProfile,
    nativeEnvironmentOptions: dependencies.nativeEnvironmentOptions,
    buildResourceOptions: dependencies.buildResourceOptions,
  });

  log(`dev server will use port ${plan.port} (${selected.action})`);
  log(`pinning Tauri devUrl and capability origin -> ${plan.devUrl}`);
  const platform = host.platform ?? process.platform;
  for (const line of describeDevProfile({
    identifier: plan.identifier,
    devUrl: plan.devUrl,
    platform,
    env: baseEnv,
    knownFolders: (dependencies.resolveKnownFolders ?? resolveKnownFolders)({
      platform,
      env: baseEnv,
    }),
  }))
    log(line);
  log(describeDevBuildResources(plan.buildResources));
  log(
    "Cargo defaults include all supported features; reduced builds require --no-default-features. Native services still require their documented drivers/tools.",
  );
  log(
    "Checking the embedded OPKSSH runtime before native launch; explicit CLI-only opt-out uses SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE=1.",
  );
  (dependencies.prepareTauriDevOpkssh ?? prepareTauriDevOpkssh)(
    passthrough,
    plan.env,
    log,
  );
  (dependencies.stageFileViewerHost ?? stageFileViewerHost)({
    argv: passthrough,
    env: plan.env,
    log,
  });

  const tauriBin = require.resolve("@tauri-apps/cli/tauri.js");
  const child = (dependencies.spawn ?? spawn)(
    host.execPath,
    [tauriBin, ...plan.tauriArgs],
    {
      stdio: "inherit",
      env: plan.env,
      shell: false,
    },
  );

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  host.on("SIGINT", () => forward("SIGINT"));
  host.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) host.kill(host.pid, signal);
    else host.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(
      `[tauri-dev] failed to launch Tauri: ${error?.stack || error}`,
    );
    host.exit(1);
  });
  return child;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[tauri-dev] fatal: ${error?.stack || error}`);
    process.exit(1);
  });
}
