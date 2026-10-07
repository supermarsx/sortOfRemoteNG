#!/usr/bin/env node
// Automated regression evidence only. No browser, account or live login is opened.
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const vitest = "node_modules/vitest/vitest.mjs";
export const SUITES = Object.freeze(
  [
    ["google", "tests/protocol/googleAutologinClient.test.ts"],
    ["google", "src/utils/protocol/googleProxySession.test.ts"],
    ["cloudflare", "tests/protocol/cloudflareAutologinClient.test.ts"],
    ["cloudflare", "tests/protocol/CloudflareRuntimeIntegration.test.tsx"],
    ["porkbun", "tests/protocol/porkbunLoginClient.test.ts"],
    ["network", "tests/protocol/webNetworkClient.test.ts"],
    ["injection", "tests/protocol/ProxyPageScriptInsertion.test.ts"],
    ["injection", "tests/protocol/autologinAsset.test.ts"],
    ["injection", "tests/protocol/autologinScopedAsset.test.ts"],
    ["injection", "tests/protocol/autologinClientLifecycle.test.ts"],
    ["identity", "tests/protocol/browserCompatibility.test.ts"],
    ["identity", "tests/protocol/HttpViewerBrowserCompatibility.test.tsx"],
    ["readiness", "tests/protocol/WebBrowserPageReadiness.test.tsx"],
    ["isolation", "tests/protocol/webBrowserFrame.test.ts"],
    ["dark-mode", "tests/protocol/webDarkModeClient.test.ts"],
    ["dark-mode", "tests/protocol/webDarkReadinessRecovery.test.ts"],
    ["native-host-ui", "tests/protocol/originBrowser.test.ts"],
    ["native-host-ui", "tests/protocol/useOriginBrowser.test.tsx"],
    ["native-host-ui", "tests/protocol/OriginBrowserViewport.test.tsx"],
    ["domain-permissions", "tests/settings/websiteDomainPermissions.test.ts"],
    [
      "domain-permissions",
      "tests/settings/WebsiteDomainPermissionsEditor.test.tsx",
    ],
    [
      "domain-permissions",
      "tests/settings/nativeWebsitePermissionPersistence.test.ts",
    ],
  ].map(([area, file]) => Object.freeze({ area, file })),
);
export const LIVE_GOOGLE_PROBE =
  "live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies";
const NATIVE_INTEGRATIONS = Object.freeze([
  "origin_browser_real_origin",
  "origin_browser_native_auth",
]);
export const NATIVE_SUITES = Object.freeze([
  "cloudflare_challenge",
  "google_tests",
  "autologin_asset",
  "dark_mode::tests",
  "origin_browser",
  "private_forward_proxy",
  "private_forward_route",
  "browser_transport",
  "browser_dns",
  ...NATIVE_INTEGRATIONS,
]);
export function nativeArgs(filter) {
  if (!NATIVE_SUITES.includes(filter))
    throw new Error("Unknown native fixture suite");
  return [
    "scripts/native-build-env.mjs",
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-p",
    "sorng-protocols",
    ...(NATIVE_INTEGRATIONS.includes(filter)
      ? ["--test", filter]
      : ["--lib", filter]),
    "--locked",
    ...(filter === "google_tests" ? ["--", "--skip", LIVE_GOOGLE_PROBE] : []),
  ];
}
const HELP = `Usage: npm run browser:readiness -- [--native] [--report path.json]
Runs fixed deterministic Vitest suites; --native also runs Cloudflare challenge,
Google, auto-login asset, first-paint dark-mode and origin-preserving transport fixtures
through the native build wrapper. Transport fixtures do not certify native browser hosts.
Includes the public-API origin_browser_real_origin TLS/WSS integration target.
Includes origin_browser_native_auth native proxy-authentication boundary fixtures.
Includes native-host UI lifecycle and shared/per-connection domain permission contracts.
The anonymous live Google probe is explicitly excluded. No live login is tested.
--report writes a nonsecret JSON summary (replaces that report if it exists).
Exit 0: requested automated layers passed; NOT a live-login readiness result.
Exit 1: a requested layer failed or did not run. Exit 2: usage/report error.
Embedded browser prerequisite and all live stages always remain not-run.
See docs/browser-readiness.md for actual WebView acceptance steps.
`;

export function parseArgs(args) {
  const options = { native: false, report: null, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--native", "--report", "--help"].includes(flag) || seen.has(flag))
      throw new Error("Invalid or repeated option. Use --help.");
    seen.add(flag);
    if (flag === "--native") options.native = true;
    if (flag === "--help") options.help = true;
    if (flag === "--report") {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error("--report requires a path.");
      options.report = args[++i];
    }
  }
  return options;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

async function execute(command, args, cwd) {
  try {
    const { stdout } = await exec(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "true",
        CARGO_TERM_COLOR: "never",
        NO_COLOR: "1",
      },
      timeout:
        args[0] === "scripts/native-build-env.mjs" ? 30 * 60_000 : 5 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    // Never forward raw child output, paths, exception messages or test values.
    return {
      exitCode: Number.isInteger(error.code) ? error.code : null,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      reason:
        error.code === "ENOENT" ? "executable-unavailable" : "command-failed",
    };
  }
}

export function assessVitest(data, exitCode, repo = root) {
  const files = Array.isArray(data?.testResults) ? data.testResults : [];
  const suites = SUITES.map(({ area, file }) => {
    const matches = files.filter(
      (result) =>
        typeof result?.name === "string" &&
        path
          .relative(repo, path.resolve(repo, result.name))
          .replaceAll("\\", "/") === file,
    );
    const assertions =
      matches.length === 1 && Array.isArray(matches[0].assertionResults)
        ? matches[0].assertionResults
        : [];
    const total = assertions.length;
    const passed = assertions.filter(
      (result) => result?.status === "passed",
    ).length;
    const status =
      matches.length === 0 || total === 0
        ? "not-run"
        : matches.length === 1 &&
            matches[0].status === "passed" &&
            passed === total
          ? "passed"
          : "failed";
    return { area, file, status, tests: total, passed };
  });
  const tests = suites.reduce((n, suite) => n + suite.tests, 0);
  const complete =
    exitCode === 0 &&
    data?.success === true &&
    files.length === SUITES.length &&
    suites.every((suite) => suite.status === "passed") &&
    data.numTotalTests === tests &&
    data.numPassedTests === tests &&
    [
      "numFailedTests",
      "numPendingTests",
      "numTodoTests",
      "numFailedTestSuites",
      "numPendingTestSuites",
    ].every((key) => data[key] === 0);
  return {
    status: complete ? "passed" : "failed",
    reason: complete
      ? "all-required-tests-passed"
      : "incomplete-or-failed-tests",
    tests,
    suites,
  };
}

export function assessNative(result) {
  const receipts = [
    ...(result.stdout || "").matchAll(
      /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/g,
    ),
  ];
  const receipt = receipts.length === 1 ? receipts[0] : null;
  const passed = receipt ? Number(receipt[2]) : 0;
  const failed = receipt ? Number(receipt[3]) : 0;
  const ignored = receipt ? Number(receipt[4]) : 0;
  const complete =
    result.exitCode === 0 &&
    receipt?.[1] === "ok" &&
    passed > 0 &&
    failed === 0 &&
    ignored === 0;
  return {
    status: complete
      ? "passed"
      : result.reason === "executable-unavailable"
        ? "not-run"
        : "failed",
    reason: complete
      ? "scoped-native-tests-passed"
      : result.reason === "executable-unavailable"
        ? "executable-unavailable"
        : "incomplete-or-failed-tests",
    passed,
    failed,
    ignored,
  };
}

export async function runReadiness(options = {}, dependencies = {}) {
  const repo = dependencies.root ?? root;
  const run = dependencies.execute ?? execute;
  const exists = dependencies.isFile ?? isFile;
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    loginReadiness: "not-run",
    deterministic: {
      status: "not-run",
      reason: "missing-prerequisites",
      durationMs: 0,
    },
    native: {
      status: "not-run",
      reason: "not-requested",
      suites: NATIVE_SUITES.map((id) => ({
        id,
        cwd: ".",
        command: `node ${nativeArgs(id).join(" ")}`,
        status: "not-run",
        reason: "not-requested",
        durationMs: 0,
      })),
      liveGoogleProbe: {
        status: "not-run",
        reason: "explicitly-excluded",
        test: LIVE_GOOGLE_PROBE,
      },
    },
    embeddedLive: {
      status: "not-run",
      reason: "manual-webview-validation-required",
      browserPrerequisite: {
        status: "not-run",
        reason: "not-probed-by-this-runner",
      },
      sites: ["google", "cloudflare", "porkbun"].map((site) => ({
        site,
        stages: [
          "opening",
          "email-or-username",
          "password",
          "challenge",
          "authenticated",
          "reload-session",
        ].map((stage) => ({ stage, status: "not-run" })),
      })),
    },
  };
  const missing = [vitest, ...SUITES.map(({ file }) => file)].filter(
    (file) => !exists(path.join(repo, file)),
  );
  if (missing.length) report.deterministic.missing = missing;
  else {
    const started = performance.now();
    const scratch = await mkdtemp(
      path.join(tmpdir(), "sorng-browser-readiness-"),
    );
    try {
      const output = path.join(scratch, "vitest.json");
      const result = await run(
        process.execPath,
        [
          "--max-old-space-size=4096",
          vitest,
          "run",
          ...SUITES.map(({ file }) => file),
          "--reporter=json",
          `--outputFile=${output}`,
        ],
        repo,
      );
      let data;
      try {
        data = JSON.parse(await readFile(output, "utf8"));
      } catch {
        /* missing/invalid receipt fails */
      }
      report.deterministic = assessVitest(data, result.exitCode, repo);
      report.deterministic.durationMs = Math.round(performance.now() - started);
    } finally {
      // Only the fresh directory returned by mkdtemp belongs to this runner.
      await rm(scratch, { recursive: true, force: true });
    }
  }
  if (options.native) {
    for (const suite of report.native.suites) {
      const started = performance.now();
      const prerequisites = [
        "scripts/native-build-env.mjs",
        "src-tauri/Cargo.toml",
        ...(NATIVE_INTEGRATIONS.includes(suite.id)
          ? [`src-tauri/crates/sorng-protocols/tests/${suite.id}.rs`]
          : []),
      ];
      if (prerequisites.some((file) => !exists(path.join(repo, file)))) {
        suite.reason = "missing-prerequisites";
        continue;
      }
      Object.assign(
        suite,
        assessNative(await run(process.execPath, nativeArgs(suite.id), repo)),
      );
      suite.durationMs = Math.round(performance.now() - started);
    }
    report.native.status = report.native.suites.every(
      (suite) => suite.status === "passed",
    )
      ? "passed"
      : "failed";
    report.native.reason =
      report.native.status === "passed"
        ? "all-scoped-native-suites-passed"
        : "incomplete-or-failed-suites";
  }
  report.automatedGate = {
    scope: options.native
      ? "deterministic-and-scoped-native"
      : "deterministic-only",
    status:
      report.deterministic.status === "passed" &&
      (!options.native || report.native.status === "passed")
        ? "passed"
        : "failed",
  };
  report.finishedAt = new Date().toISOString();
  return report;
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(args);
  } catch {
    console.error("Invalid browser-readiness options. Use --help.");
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  console.log(
    "Running deterministic browser regressions; live login is not tested.",
  );
  if (options.native)
    console.log(
      "Scoped native browser, injection, dark-mode and origin-preserving transport fixtures requested.",
    );
  try {
    const report = await runReadiness(options);
    if (options.report) {
      const output = path.resolve(options.report);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
    return report.automatedGate.status === "passed" ? 0 : 1;
  } catch {
    console.error(
      "Browser readiness could not complete or write its report; no pass recorded.",
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main();
