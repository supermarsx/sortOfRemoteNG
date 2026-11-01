// Failure-only observation. It never changes the original readiness outcome.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CAPTURE_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_MS = 30 * 60 * 1000;
export const ARGS = Object.freeze([
  "scripts/native-build-env.mjs",
  "cargo",
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "-p",
  "sorng-protocols",
  "--lib",
  "private_forward_proxy",
  "--locked",
]);
const NAME = /^private_forward_proxy(?:::[A-Za-z_][A-Za-z0-9_]*)+$/;
export function assess(stdout, exitCode, reason = null, joined = true) {
  const base = {
    schemaVersion: 1,
    kind: "sorng-private-proxy-failure-diagnostic",
    status: "incomplete",
    reason: reason ?? "summary-unavailable",
    passed: 0,
    failed: 0,
    ignored: 0,
    failedTests: [],
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    cleanup: joined ? "joined" : "unconfirmed",
  };
  if (reason || !joined || typeof stdout !== "string") return base;
  const summaries = [
    ...stdout.matchAll(
      /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*$/gm,
    ),
  ];
  if (summaries.length !== 1) return base;
  const row = summaries[0],
    passed = Number(row[2]),
    failed = Number(row[3]),
    ignored = Number(row[4]);
  if (
    ![passed, failed, ignored].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000,
    )
  )
    return base;
  const names = [];
  for (const match of stdout.matchAll(/^test ([^\r\n]+) \.\.\. FAILED\r?$/gm)) {
    if (
      match[1].length > 512 ||
      !NAME.test(match[1]) ||
      names.includes(match[1]) ||
      names.length >= 512
    )
      return base;
    names.push(match[1]);
  }
  if (
    passed + failed === 0 ||
    names.length !== failed ||
    (failed === 0 && (exitCode !== 0 || row[1] !== "ok")) ||
    (failed > 0 && (row[1] !== "FAILED" || exitCode === 0))
  )
    return {
      ...base,
      passed,
      failed,
      ignored,
      reason: "failure-name-unavailable",
    };
  return {
    ...base,
    status: "observed",
    reason: failed
      ? "native-tests-failed"
      : ignored
        ? "native-tests-ignored"
        : "native-tests-passed",
    passed,
    failed,
    ignored,
    failedTests: names.sort(),
  };
}
export async function observe({
  launch = spawn,
  killGroup = (pid) => process.kill(-pid, "SIGKILL"),
  milliseconds = MAXIMUM_MS,
  onCancel,
} = {}) {
  assert(
    Number.isInteger(milliseconds) &&
      milliseconds > 0 &&
      milliseconds <= MAXIMUM_MS,
  );
  const end = performance.now() + milliseconds,
    reserve = Math.min(5000, Math.max(10, Math.floor(milliseconds / 4)));
  return new Promise((resolve) => {
    let child,
      first = null,
      bytes = 0,
      rootExited = false,
      closed = false,
      stdoutClosed = false,
      stderrClosed = false,
      settled = false;
    const chunks = [];
    let workTimer, endTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(workTimer);
      clearTimeout(endTimer);
      unsubscribe?.();
      const joined = closed && stdoutClosed && stderrClosed;
      if (!joined) {
        try {
          child?.unref();
        } catch {}
        for (const stream of [child?.stdout, child?.stderr]) {
          try {
            stream?.destroy();
            stream?.unref?.();
          } catch {}
        }
      }
      if (performance.now() >= end) first ??= "deadline";
      const report = assess(
        first ? "" : Buffer.concat(chunks).toString("utf8"),
        child?.exitCode ?? null,
        first,
        joined,
      );
      // Parsing must not turn an expired original lease into an observation.
      if (performance.now() >= end) first ??= "deadline";
      resolve(
        first ? assess("", child?.exitCode ?? null, first, joined) : report,
      );
    };
    const join = () => {
      if (closed && stdoutClosed && stderrClosed) finish();
    };
    const stop = (reason) => {
      first ??= reason;
      if (
        child?.pid &&
        !rootExited &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          killGroup(child.pid);
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }
      join();
    };
    let unsubscribe = onCancel?.(() => stop("cancelled"));
    workTimer = setTimeout(
      () => stop("deadline"),
      Math.max(1, milliseconds - reserve),
    );
    endTimer = setTimeout(() => {
      stop("deadline");
      finish();
    }, milliseconds);
    if (first) {
      finish();
      return;
    }
    try {
      child = launch(process.execPath, [...ARGS], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        shell: false,
        windowsHide: true,
        detached: true,
        env: {
          ...process.env,
          CI: "true",
          CARGO_TERM_COLOR: "never",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", () => stop("spawn-failed"));
      child.once("exit", () => {
        rootExited = true;
      });
      child.once("close", () => {
        closed = true;
        join();
      });
      for (const [which, stream] of [
        ["stdout", child.stdout],
        ["stderr", child.stderr],
      ]) {
        stream.on("error", () => stop("stream-failed"));
        stream.once("close", () => {
          if (which === "stdout") stdoutClosed = true;
          else stderrClosed = true;
          join();
        });
        stream.on("data", (chunk) => {
          if (first || settled) return;
          bytes += chunk.length;
          if (bytes > CAPTURE_BYTES) {
            stop("capture-bound");
            return;
          }
          if (which === "stdout") chunks.push(Buffer.from(chunk));
        });
      }
      if (performance.now() >= end) stop("deadline");
    } catch {
      first ??= "spawn-failed";
      finish();
    }
  });
}
export async function main() {
  assert(
    process.platform === "linux" &&
      process.argv.length === 4 &&
      process.argv[2] === "--output",
    "DIAGNOSTIC_SCOPE",
  );
  const parent = await fs.realpath(process.env.RUNNER_TEMP);
  const output = path.join(parent, "browser-private-proxy-diagnostic.json");
  assert(process.argv[3] === output, "DIAGNOSTIC_OUTPUT");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  const before = await fs.lstat(parent, { bigint: true });
  assert(
    before.isDirectory() &&
      !before.isSymbolicLink() &&
      before.uid === BigInt(process.getuid()),
    "DIAGNOSTIC_OUTPUT",
  );
  const report = await observe({
    onCancel: (stop) => {
      const cancel = () => stop();
      process.once("SIGTERM", cancel);
      process.once("SIGINT", cancel);
      return () => {
        process.removeListener("SIGTERM", cancel);
        process.removeListener("SIGINT", cancel);
      };
    },
  });
  const after = await fs.lstat(parent, { bigint: true });
  assert(
    before.dev === after.dev &&
      before.ino === after.ino &&
      before.mode === after.mode &&
      before.uid === after.uid &&
      (await fs.realpath(parent)) === parent,
    "DIAGNOSTIC_OUTPUT",
  );
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error("PRIVATE_PROXY_DIAGNOSTIC_UNAVAILABLE");
    process.exitCode = 2;
  }
}
