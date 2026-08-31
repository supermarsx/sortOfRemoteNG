#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { freemem, hostname, loadavg, totalmem } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_HEARTBEAT_SECONDS = 300;
const DEFAULT_HARD_TIMEOUT_MINUTES = 285;
const ARTIFACT_SCAN_SECONDS = 30;
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]+$/u;
const SAFE_TARGET = /^[A-Za-z0-9_.-]+$/u;
const SAFE_BUNDLES = /^[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*$/u;
const SAFE_FEATURES = SAFE_BUNDLES;

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function positiveInteger(value, option) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return Number.parseInt(value, 10);
}

export function parseArgs(argv) {
  const options = {
    heartbeatSeconds: DEFAULT_HEARTBEAT_SECONDS,
    hardTimeoutMinutes: DEFAULT_HARD_TIMEOUT_MINUTES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = requiredValue(argv, index, option);
    index += 1;
    switch (option) {
      case "--artifact-id":
        options.artifactId = value;
        break;
      case "--platform":
        options.platform = value;
        break;
      case "--rust-target":
        options.rustTarget = value;
        break;
      case "--bundles":
        options.bundles = value;
        break;
      case "--features":
        options.features = value;
        break;
      case "--heartbeat-seconds":
        options.heartbeatSeconds = positiveInteger(value, option);
        break;
      case "--hard-timeout-minutes":
        options.hardTimeoutMinutes = positiveInteger(value, option);
        break;
      default:
        throw new Error(`Unknown option ${option}.`);
    }
  }

  for (const name of [
    "artifactId",
    "platform",
    "rustTarget",
    "bundles",
    "features",
  ]) {
    if (!options[name]) {
      throw new Error(
        `Missing required option --${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}.`,
      );
    }
  }
  if (!SAFE_IDENTIFIER.test(options.artifactId)) {
    throw new Error("--artifact-id contains unsupported characters.");
  }
  if (options.platform !== "windows" && options.platform !== "linux") {
    throw new Error("--platform must be windows or linux.");
  }
  if (!SAFE_TARGET.test(options.rustTarget)) {
    throw new Error("--rust-target contains unsupported characters.");
  }
  if (!SAFE_BUNDLES.test(options.bundles)) {
    throw new Error("--bundles must be a comma-separated bundle list.");
  }
  if (!SAFE_FEATURES.test(options.features)) {
    throw new Error("--features must be a comma-separated Cargo feature list.");
  }
  if (options.heartbeatSeconds < 30) {
    throw new Error("--heartbeat-seconds must be at least 30.");
  }
  if (options.hardTimeoutMinutes * 60 <= options.heartbeatSeconds) {
    throw new Error("The hard timeout must exceed the heartbeat interval.");
  }

  return options;
}

export function buildTauriInvocation(
  options,
  platform = process.platform,
  commandShell = process.env.ComSpec,
) {
  const npmArgs = [
    "run",
    "tauri",
    "build",
    "--",
    "--target",
    options.rustTarget,
    "--bundles",
    options.bundles,
    "--config",
    "src-tauri/tauri.release.conf.json",
    "--features",
    options.features,
    "--",
    "--no-default-features",
    "--timings",
  ];
  if (platform === "win32") {
    return {
      command: commandShell || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...npmArgs],
    };
  }
  return { command: "npm", args: npmArgs };
}

function stripControlSequences(value) {
  return value
    .replace(ANSI_ESCAPE, "")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

export function classifyProgressLine(value) {
  const line = stripControlSequences(value);
  const compiling = /\bCompiling\s+([A-Za-z0-9_.-]+)/u.exec(line);
  if (compiling) {
    return { phase: "cargo-compile", detail: compiling[1] };
  }
  if (/\bFinished\b.*\brelease\b/iu.test(line)) {
    return { phase: "cargo-finished", detail: "release" };
  }

  const lower = line.toLowerCase();
  if (/\bbundling\b/iu.test(line) || /\brpmbuild\b/iu.test(line)) {
    for (const [kind, hints] of [
      ["rpm", [".rpm", "/rpm/", "\\rpm\\", "rpmbuild"]],
      ["deb", [".deb", "/deb/", "\\deb\\"]],
      ["appimage", [".appimage", "/appimage/", "\\appimage\\"]],
      ["msi", [".msi", "/msi/", "\\msi\\"]],
      ["nsis", ["-setup.exe", "/nsis/", "\\nsis\\"]],
    ]) {
      if (hints.some((hint) => lower.includes(hint))) {
        return { phase: "bundle", detail: kind };
      }
    }
  }
  return null;
}

function artifactKind(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".appimage")) return "appimage";
  if (lower.endsWith(".deb")) return "deb";
  if (lower.endsWith(".rpm")) return "rpm";
  if (lower.endsWith(".msi")) return "msi";
  if (lower.endsWith("-setup.exe")) return "nsis";
  return null;
}

export function listBundleArtifacts(
  bundleRoot,
  { readDirectory = readdirSync, readStats = statSync } = {},
) {
  const artifacts = [];

  function visit(directory, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = readDirectory(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      try {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path, depth + 1);
        } else if (entry.isFile()) {
          const kind = artifactKind(path);
          if (!kind) continue;
          const stats = readStats(path);
          artifacts.push({
            kind,
            path,
            sizeBytes: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          });
        }
      } catch {
        // Bundle files can be renamed atomically while an interval is walking
        // the directory. Observability must never turn that race into failure.
        continue;
      }
    }
  }

  visit(bundleRoot, 0);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

export function observeBestEffort(
  label,
  observation,
  onError = (message) => console.warn(message),
) {
  try {
    return observation();
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    try {
      onError(
        `[release-build-observation-warning] observation=${label} error=${errorName}`,
      );
    } catch {
      // A closed log stream must not promote optional telemetry into failure.
    }
    return undefined;
  }
}

function formatDuration(milliseconds) {
  return `${Math.max(0, Math.round(milliseconds / 1000))}s`;
}

function diskSnapshot(path) {
  try {
    const stats = statfsSync(path, { bigint: true });
    return {
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function terminateProcessTree(child, reason) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  console.error(
    `[release-build-stop] timestamp=${new Date().toISOString()} reason=${reason} pid=${child.pid}`,
  );
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "inherit",
    });
    return;
  }
  const gracefulSignal = reason === "SIGINT" ? "SIGINT" : "SIGTERM";
  try {
    process.kill(-child.pid, gracefulSignal);
  } catch {
    child.kill(gracefulSignal);
  }
  const forceTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 10_000);
  forceTimer.unref();
}

export function resolveBuildOutcome({
  childCode,
  childSignal,
  cancellationSignal,
  timedOut,
}) {
  if (timedOut) {
    return { result: "hard-timeout", exitCode: 124, signal: null };
  }
  const signal = cancellationSignal || childSignal || null;
  if (signal === "SIGINT") {
    return { result: "cancelled", exitCode: 130, signal };
  }
  if (signal === "SIGTERM") {
    return { result: "cancelled", exitCode: 143, signal };
  }
  if (signal) {
    return { result: "failure", exitCode: 1, signal };
  }
  const exitCode = Number.isInteger(childCode) ? childCode : 1;
  return {
    result: exitCode === 0 ? "success" : "failure",
    exitCode,
    signal: null,
  };
}

function appendSummary(path, report) {
  if (!path) return;
  const artifactRows = report.artifacts.length
    ? report.artifacts
        .map(
          (artifact) =>
            `| ${artifact.kind} | \`${artifact.relativePath}\` | ${artifact.sizeBytes} | ${artifact.discoveredElapsedSeconds}s |`,
        )
        .join("\n")
    : "| none discovered | - | - | - |";
  appendFileSync(
    path,
    [
      `### Native build telemetry: ${report.artifactId}`,
      "",
      `- Result: ${report.result}`,
      `- Signal: ${report.signal ?? "none"}`,
      `- Elapsed: ${report.elapsedSeconds}s`,
      `- Last phase: \`${report.lastPhase}\``,
      `- Hard timeout: ${report.hardTimeoutMinutes} minutes (silence alone never triggers it)`,
      "",
      "| Bundle | Path | Bytes | Discovered after |",
      "| --- | --- | ---: | ---: |",
      artifactRows,
      "",
    ].join("\n"),
  );
}

export async function run(options, environment = process.env) {
  const workspace = resolve(environment.GITHUB_WORKSPACE || process.cwd());
  const bundleRoot = resolve(
    workspace,
    "src-tauri",
    "target",
    options.rustTarget,
    "release",
    "bundle",
  );
  const reportPath = resolve(
    workspace,
    ".ci",
    "build-telemetry",
    `${options.artifactId}.json`,
  );
  const startedAt = Date.now();
  let lastOutputAt = startedAt;
  let currentPhase = "launch";
  let timedOut = false;
  const phaseEvents = [];
  const bundleStartedAt = new Map();
  const discovered = new Map();

  function recordEvent(event) {
    phaseEvents.push(event);
    if (phaseEvents.length > 256) phaseEvents.shift();
  }

  function markPhase(progress) {
    if (!progress) return;
    currentPhase = `${progress.phase}:${progress.detail}`;
    const now = Date.now();
    if (progress.phase === "bundle" && !bundleStartedAt.has(progress.detail)) {
      bundleStartedAt.set(progress.detail, now);
      const event = {
        type: "bundle-start",
        bundle: progress.detail,
        at: new Date(now).toISOString(),
        elapsedSeconds: Math.round((now - startedAt) / 1000),
      };
      recordEvent(event);
      console.log(
        `[release-build-phase] timestamp=${event.at} artifact=${options.artifactId} elapsed=${event.elapsedSeconds}s phase=bundle-start bundle=${progress.detail}`,
      );
    } else if (
      progress.phase === "cargo-finished" ||
      (progress.phase === "cargo-compile" && progress.detail === "sorng-auth")
    ) {
      const event = {
        type: progress.phase,
        detail: progress.detail,
        at: new Date(now).toISOString(),
        elapsedSeconds: Math.round((now - startedAt) / 1000),
      };
      recordEvent(event);
      console.log(
        `[release-build-phase] timestamp=${event.at} artifact=${options.artifactId} elapsed=${event.elapsedSeconds}s phase=${progress.phase} detail=${progress.detail}`,
      );
    }
  }

  function scanArtifacts() {
    const now = Date.now();
    for (const artifact of listBundleArtifacts(bundleRoot)) {
      if (discovered.has(artifact.path)) continue;
      const bundleStarted = bundleStartedAt.get(artifact.kind);
      const entry = {
        ...artifact,
        relativePath: relative(workspace, artifact.path).replaceAll("\\", "/"),
        discoveredAt: new Date(now).toISOString(),
        discoveredElapsedSeconds: Math.round((now - startedAt) / 1000),
        bundleDurationSeconds:
          bundleStarted === undefined
            ? null
            : Math.round((now - bundleStarted) / 1000),
      };
      discovered.set(artifact.path, entry);
      recordEvent({
        type: "artifact-discovered",
        bundle: artifact.kind,
        at: entry.discoveredAt,
        elapsedSeconds: entry.discoveredElapsedSeconds,
        bundleDurationSeconds: entry.bundleDurationSeconds,
      });
      console.log(
        `[release-build-artifact] timestamp=${entry.discoveredAt} artifact=${options.artifactId} bundle=${artifact.kind} elapsed=${entry.discoveredElapsedSeconds}s bundle_duration=${entry.bundleDurationSeconds ?? "unknown"}s bytes=${entry.sizeBytes} path=${entry.relativePath}`,
      );
    }
  }

  let child;
  function heartbeat() {
    scanArtifacts();
    const now = Date.now();
    const disk = diskSnapshot(workspace);
    const loads = loadavg();
    console.log(
      [
        "[release-build-heartbeat]",
        `timestamp=${new Date(now).toISOString()}`,
        `host=${hostname()}`,
        `artifact=${options.artifactId}`,
        `elapsed=${formatDuration(now - startedAt)}`,
        `output_silence=${formatDuration(now - lastOutputAt)}`,
        `phase=${currentPhase}`,
        `child_pid=${child?.pid ?? "not-started"}`,
        `physical_free_bytes=${freemem()}`,
        `physical_total_bytes=${totalmem()}`,
        `workspace_free_bytes=${disk.freeBytes ?? "unknown"}`,
        `workspace_total_bytes=${disk.totalBytes ?? "unknown"}`,
        `load_1m=${loads[0].toFixed(2)}`,
      ].join(" "),
    );
  }

  const invocation = buildTauriInvocation(options);
  console.log(
    `[release-build-phase] timestamp=${new Date(startedAt).toISOString()} artifact=${options.artifactId} elapsed=0s phase=launch bundles=${options.bundles} hard_timeout=${options.hardTimeoutMinutes}m heartbeat=${options.heartbeatSeconds}s`,
  );
  child = spawn(invocation.command, invocation.args, {
    cwd: workspace,
    env: environment,
    detached: process.platform !== "win32",
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  function forwardOutput(stream, destination) {
    let pending = "";
    stream.on("data", (chunk) => {
      lastOutputAt = Date.now();
      destination.write(chunk);
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) markPhase(classifyProgressLine(line));
    });
    stream.on("end", () => {
      if (pending) markPhase(classifyProgressLine(pending));
    });
  }

  forwardOutput(child.stdout, process.stdout);
  forwardOutput(child.stderr, process.stderr);
  observeBestEffort("initial-heartbeat", heartbeat);
  const heartbeatTimer = setInterval(
    () => observeBestEffort("heartbeat", heartbeat),
    options.heartbeatSeconds * 1000,
  );
  const scanTimer = setInterval(
    () => observeBestEffort("artifact-scan", scanArtifacts),
    ARTIFACT_SCAN_SECONDS * 1000,
  );
  const timeoutTimer = setTimeout(
    () => {
      timedOut = true;
      const elapsed = formatDuration(Date.now() - startedAt);
      console.error(
        `::error title=Native build hard timeout::${options.artifactId} exceeded ${options.hardTimeoutMinutes} minutes (elapsed ${elapsed}); last live phase was ${currentPhase}. Periods without compiler output were tolerated while heartbeats confirmed that the process remained alive.`,
      );
      terminateProcessTree(child, "hard-timeout");
    },
    options.hardTimeoutMinutes * 60 * 1000,
  );

  let cancellationSignal = null;
  function requestCancellation(signal) {
    if (timedOut || cancellationSignal) return;
    cancellationSignal = signal;
    console.error(
      `[release-build-cancel] timestamp=${new Date().toISOString()} artifact=${options.artifactId} signal=${signal}`,
    );
    terminateProcessTree(child, signal);
  }
  const handleSigint = () => requestCancellation("SIGINT");
  const handleSigterm = () => requestCancellation("SIGTERM");
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  const result = await new Promise((resolveResult) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolveResult({ code: 1, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      resolveResult({ code, signal, error: null });
    });
  });

  clearInterval(heartbeatTimer);
  clearInterval(scanTimer);
  clearTimeout(timeoutTimer);
  process.removeListener("SIGINT", handleSigint);
  process.removeListener("SIGTERM", handleSigterm);
  observeBestEffort("final-artifact-scan", scanArtifacts);

  const finishedAt = Date.now();
  const outcome = resolveBuildOutcome({
    childCode: result.code,
    childSignal: result.signal,
    cancellationSignal,
    timedOut,
  });
  const report = {
    schemaVersion: 1,
    artifactId: options.artifactId,
    platform: options.platform,
    rustTarget: options.rustTarget,
    bundles: options.bundles.split(","),
    result: outcome.result,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    cancellationSignal,
    childExitCode: result.code,
    childSignal: result.signal,
    launchError: result.error,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    elapsedSeconds: Math.round((finishedAt - startedAt) / 1000),
    lastOutputSilenceSeconds: Math.round((finishedAt - lastOutputAt) / 1000),
    lastPhase: currentPhase,
    heartbeatSeconds: options.heartbeatSeconds,
    hardTimeoutMinutes: options.hardTimeoutMinutes,
    phaseEvents,
    artifacts: [...discovered.values()],
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  appendSummary(environment.GITHUB_STEP_SUMMARY, report);

  console.log(
    `[release-build-finish] timestamp=${report.finishedAt} artifact=${options.artifactId} result=${report.result} exit_code=${report.exitCode} signal=${report.signal ?? "none"} elapsed=${report.elapsedSeconds}s artifacts=${report.artifacts.length} last_phase=${report.lastPhase}`,
  );
  if (result.error)
    console.error(`Native build launch failed: ${result.error}`);
  return outcome.exitCode;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  process.exitCode = await run(options);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
