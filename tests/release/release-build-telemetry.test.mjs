import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildTauriInvocation,
  classifyProgressLine,
  listBundleArtifacts,
  observeBestEffort,
  parseArgs,
  resolveBuildOutcome,
} from "../../scripts/ci/run-release-native-build.mjs";

const releaseWorkflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
).replace(/\r\n?/gu, "\n");
const telemetrySource = readFileSync(
  new URL("../../scripts/ci/run-release-native-build.mjs", import.meta.url),
  "utf8",
).replace(/\r\n?/gu, "\n");
const buildJob = releaseWorkflow.slice(
  releaseWorkflow.indexOf("  build:"),
  releaseWorkflow.indexOf("  publish:"),
);

function step(name, nextName) {
  const start = buildJob.indexOf(`- name: ${name}`);
  const end = buildJob.indexOf(`- name: ${nextName}`, start);
  assert.ok(start >= 0, `missing workflow step ${name}`);
  assert.ok(end > start, `missing workflow step after ${name}`);
  return buildJob.slice(start, end);
}

test("Windows and Linux use the exact Tauri artifact command with Cargo timings", () => {
  const options = parseArgs([
    "--artifact-id",
    "windows-x86_64",
    "--platform",
    "windows",
    "--rust-target",
    "x86_64-pc-windows-msvc",
    "--bundles",
    "msi,nsis",
    "--features",
    "cert-auth,kafka-dynamic",
    "--heartbeat-seconds",
    "300",
    "--hard-timeout-minutes",
    "285",
  ]);
  const invocation = buildTauriInvocation(options, "win32", "cmd.exe");

  assert.equal(invocation.command, "cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "npm.cmd",
    "run",
    "tauri",
    "build",
    "--",
    "--target",
    "x86_64-pc-windows-msvc",
    "--bundles",
    "msi,nsis",
    "--config",
    "src-tauri/tauri.release.conf.json",
    "--features",
    "cert-auth,kafka-dynamic",
    "--",
    "--no-default-features",
    "--timings",
  ]);
});

test("progress classification names sorng-auth and the RPM bundling phase", () => {
  assert.deepEqual(classifyProgressLine("   Compiling sorng-auth v0.1.0"), {
    phase: "cargo-compile",
    detail: "sorng-auth",
  });
  assert.deepEqual(
    classifyProgressLine(
      "Bundling sortOfRemoteNG-26.43.0-1.x86_64.rpm (/tmp/bundle/rpm/app.rpm)",
    ),
    { phase: "bundle", detail: "rpm" },
  );
  assert.deepEqual(classifyProgressLine("Finished release profile"), {
    phase: "cargo-finished",
    detail: "release",
  });
  assert.equal(classifyProgressLine("ordinary compiler output"), null);
});

test("native release builds have bounded generous timeouts and live telemetry", () => {
  const macBuild = step(
    "Build native bundles",
    "Build native bundles with progress telemetry",
  );
  const telemetryBuild = step(
    "Build native bundles with progress telemetry",
    "Upload native build diagnostics",
  );

  assert.match(
    buildJob,
    /runs-on: \$\{\{ matrix\.os \}\}[\s\S]*?timeout-minutes: 360[\s\S]*?env:/,
  );
  assert.match(macBuild, /if: matrix\.platform == 'macos'/);
  assert.match(macBuild, /uses: tauri-apps\/tauri-action@[0-9a-f]{40}/);
  assert.match(
    telemetryBuild,
    /if: matrix\.platform == 'windows' \|\| matrix\.platform == 'linux'/,
  );
  assert.match(telemetryBuild, /timeout-minutes: 300/);
  assert.match(telemetryBuild, /shell: bash/);
  assert.match(telemetryBuild, /run-release-native-build\.mjs/);
  assert.match(telemetryBuild, /--heartbeat-seconds 300/);
  assert.match(telemetryBuild, /--hard-timeout-minutes 285/);
  assert.match(telemetryBuild, /--bundles "\$\{\{ matrix\.bundles \}\}"/);
  assert.doesNotMatch(telemetryBuild, /(?:bun|pnpm|yarn)\s+(?:run\s+)?tauri/);

  const stepTimeout = Number(
    telemetryBuild.match(/timeout-minutes: ([0-9]+)/u)?.[1],
  );
  const hardTimeout = Number(
    telemetryBuild.match(/--hard-timeout-minutes ([0-9]+)/u)?.[1],
  );
  assert.equal(stepTimeout, 300);
  assert.equal(hardTimeout, 285);
  assert.ok(
    hardTimeout > 180,
    "known one-to-three-hour builds must be tolerated",
  );
  assert.ok(
    hardTimeout < stepTimeout,
    "the launcher must fail with diagnostics before GitHub kills the step",
  );
});

test("heartbeats expose liveness, resources, phase, and RPM duration without silence kills", () => {
  assert.match(telemetrySource, /\[release-build-heartbeat\]/);
  assert.match(telemetrySource, /timestamp=/);
  assert.match(telemetrySource, /output_silence=/);
  assert.match(telemetrySource, /phase=\$\{currentPhase\}/);
  assert.match(telemetrySource, /physical_free_bytes=/);
  assert.match(telemetrySource, /workspace_free_bytes=/);
  assert.match(telemetrySource, /child_pid=/);
  assert.match(telemetrySource, /progress\.detail === "sorng-auth"/);
  assert.match(telemetrySource, /bundle_duration=/);
  assert.match(telemetrySource, /bundleStartedAt\.get\(artifact\.kind\)/);
  assert.match(telemetrySource, /ARTIFACT_SCAN_SECONDS = 30/);
  assert.match(
    telemetrySource,
    /setTimeout\([\s\S]*?options\.hardTimeoutMinutes \* 60 \* 1000/,
  );
  assert.doesNotMatch(
    telemetrySource,
    /(?:Date\.now\(\)\s*-\s*lastOutputAt|lastOutputAt\s*[<>])[^\n]*terminateProcessTree/,
  );
});

test("artifact observation tolerates directory and rename races", () => {
  const missingDirectory = listBundleArtifacts("missing", {
    readDirectory() {
      throw Object.assign(new Error("directory disappeared"), {
        code: "ENOENT",
      });
    },
  });
  assert.deepEqual(missingDirectory, []);

  const renamedArtifact = listBundleArtifacts("bundle", {
    readDirectory() {
      return [
        {
          name: "sortOfRemoteNG.rpm",
          isDirectory: () => false,
          isFile: () => true,
        },
      ];
    },
    readStats() {
      throw Object.assign(new Error("artifact renamed during stat"), {
        code: "ENOENT",
      });
    },
  });
  assert.deepEqual(renamedArtifact, []);

  const warnings = [];
  const observation = observeBestEffort(
    "artifact-scan",
    () => {
      throw new RangeError("transient observer failure");
    },
    (warning) => warnings.push(warning),
  );
  assert.equal(observation, undefined);
  assert.deepEqual(warnings, [
    "[release-build-observation-warning] observation=artifact-scan error=RangeError",
  ]);
  assert.equal(
    observeBestEffort(
      "closed-log-stream",
      () => {
        throw new Error("observation failed");
      },
      () => {
        throw new Error("log stream closed");
      },
    ),
    undefined,
  );
  assert.match(
    telemetrySource,
    /setInterval\([\s\S]*?observeBestEffort\("heartbeat", heartbeat\)/,
  );
  assert.match(
    telemetrySource,
    /observeBestEffort\("artifact-scan", scanArtifacts\)/,
  );
  assert.match(
    telemetrySource,
    /observeBestEffort\("final-artifact-scan", scanArtifacts\)/,
  );
});

test("cancellation preserves SIGINT and SIGTERM with conventional exit codes", () => {
  assert.deepEqual(
    resolveBuildOutcome({
      childCode: 1,
      childSignal: "SIGTERM",
      cancellationSignal: "SIGINT",
      timedOut: false,
    }),
    { result: "cancelled", exitCode: 130, signal: "SIGINT" },
  );
  assert.deepEqual(
    resolveBuildOutcome({
      childCode: null,
      childSignal: "SIGTERM",
      cancellationSignal: "SIGTERM",
      timedOut: false,
    }),
    { result: "cancelled", exitCode: 143, signal: "SIGTERM" },
  );
  assert.deepEqual(
    resolveBuildOutcome({
      childCode: null,
      childSignal: "SIGTERM",
      cancellationSignal: "SIGTERM",
      timedOut: true,
    }),
    { result: "hard-timeout", exitCode: 124, signal: null },
  );
  assert.match(
    telemetrySource,
    /const handleSigint = \(\) => requestCancellation\("SIGINT"\)/,
  );
  assert.match(
    telemetrySource,
    /const handleSigterm = \(\) => requestCancellation\("SIGTERM"\)/,
  );
  assert.match(
    telemetrySource,
    /const gracefulSignal = reason === "SIGINT" \? "SIGINT" : "SIGTERM"/,
  );
  assert.match(telemetrySource, /cancellationSignal,/);
  assert.match(telemetrySource, /childSignal: result\.signal/);
  assert.match(telemetrySource, /`- Signal: \$\{report\.signal \?\? "none"\}`/);
});

test("Cargo timing and telemetry files stay outside the public release asset set", () => {
  const diagnostics = step(
    "Upload native build diagnostics",
    "Verify Windows dynamic native imports",
  );
  assert.match(
    diagnostics,
    /if: always\(\) && \(matrix\.platform == 'windows' \|\| matrix\.platform == 'linux'\)/,
  );
  assert.match(
    diagnostics,
    /uses: actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6\.0\.0/,
  );
  assert.match(
    diagnostics,
    /name: build-diagnostics-\$\{\{ matrix\.artifact_id \}\}/,
  );
  assert.match(
    diagnostics,
    /\.ci\/build-telemetry\/\$\{\{ matrix\.artifact_id \}\}\.json/,
  );
  assert.match(
    diagnostics,
    /src-tauri\/target\/cargo-timings\/cargo-timing\.html/,
  );
  assert.match(
    diagnostics,
    /\.ci\/build-telemetry\/\$\{\{ matrix\.artifact_id \}\}\.json[\s\S]*?include-hidden-files: true/,
  );
  assert.match(diagnostics, /if-no-files-found: warn/);
  assert.doesNotMatch(diagnostics, /name: release-/);
  assert.match(
    releaseWorkflow,
    /Download all validated target assets[\s\S]*?pattern: release-\*/,
  );
});

test("telemetry options reject unbounded or ambiguous launcher input", () => {
  assert.throws(
    () =>
      parseArgs([
        "--artifact-id",
        "windows-x86_64",
        "--platform",
        "macos",
        "--rust-target",
        "x86_64-pc-windows-msvc",
        "--bundles",
        "msi,nsis",
        "--features",
        "cert-auth",
      ]),
    /windows or linux/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--artifact-id",
        "linux-x86_64",
        "--platform",
        "linux",
        "--rust-target",
        "x86_64-unknown-linux-gnu",
        "--bundles",
        "appimage,deb,rpm",
        "--features",
        "cert-auth",
        "--heartbeat-seconds",
        "10",
      ]),
    /at least 30/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--artifact-id",
        "windows-x86_64",
        "--platform",
        "windows",
        "--rust-target",
        "x86_64-pc-windows-msvc",
        "--bundles",
        "msi,nsis",
        "--features",
        "cert-auth&echo-unsafe",
      ]),
    /Cargo feature list/,
  );
});
