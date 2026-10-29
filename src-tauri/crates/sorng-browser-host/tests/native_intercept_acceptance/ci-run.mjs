#!/usr/bin/env node
// t-mitmproxy M3: build this fixture and run it on the engine the preceding
// native acceptance step already verified, prepared and staged.
//
// It reuses that step's prepared custom runtime (CEF_PATH), its Cargo target
// directory, and its staged TLS bundle (helper, resources and, on Linux, the
// configured setuid sandbox). The TLS client inside that bundle is moved
// aside and this fixture's client is placed under the same name, because the
// sandbox bootstrap resolves helpers and its client DLL by the bundle's
// executable name. The TLS suite has already finished; nothing is rebuilt or
// re-verified for CEF, and nothing is published.
//
// Inputs (from the workflow): CEF_ENTRY (validated matrix row),
// CEF_ACCEPTANCE_OUTPUT (the preceding step's output directory), RUNNER_TEMP.
// Results land beside the other receipts as intercept-*.json / intercept-*.log.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_TARGETS,
  nativeChildEnvironment,
} from "../../../../../scripts/cef-runtime-acceptance-ci.mjs";
import {
  privateDesktopLaunch,
  assessPrivateDesktop,
} from "../../../../../scripts/cef-browser-acceptance.mjs";
import { ensureBrowserSandboxAccess } from "../../../../../scripts/lib/browser-sandbox-access.mjs";

const ROOT = path.resolve(
  fileURLToPath(new URL("../../../../../", import.meta.url)),
);
const HERE =
  "src-tauri/crates/sorng-browser-host/tests/native_intercept_acceptance";
const STEM = "sorng_cef_tls_acceptance"; // the staged bundle's executable name
const TIMEOUT_MS = 600_000;

function fail(message) {
  console.error(`[intercept-acceptance] ${message}`);
  process.exit(1);
}

async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

function run(executable, args, { env, cwd = ROOT, log, timeout }) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(log, { flags: "wx" });
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (chunk) => {
      out.write(chunk);
      tail = (tail + chunk).slice(-65536);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      out.end();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      out.end(() => resolve({ code, signal, timedOut, tail }));
    });
  });
}

async function main() {
  const entry = JSON.parse(process.env.CEF_ENTRY ?? "null");
  const target = entry?.target;
  if (!Object.hasOwn(NATIVE_TARGETS, target)) fail("unknown native target");
  if (NATIVE_TARGETS[target].platform !== process.platform)
    fail("native target differs from this runner");
  const temp = await realpath(process.env.RUNNER_TEMP ?? "");
  const destination = await realpath(process.env.CEF_ACCEPTANCE_OUTPUT ?? "");
  if (path.relative(temp, destination).startsWith(".."))
    fail("acceptance output must be inside runner temp");
  const plan = JSON.parse(
    await readFile(path.join(destination, "prepared-plan.json"), "utf8"),
  );
  if (plan.target !== target || plan.runtimeKind !== "custom" || !plan.sdk)
    fail("prepared custom runtime plan missing or for another target");
  const sdk = await realpath(plan.sdk);
  const cargo = path.join(destination, "cargo");
  const env = nativeChildEnvironment(process.env, sdk, cargo);
  const windows = process.platform === "win32";
  const mac = process.platform === "darwin";

  // 1. Build the fixture client exactly like its siblings (locked, own lock).
  const build = await run(
    process.execPath,
    [
      "scripts/native-build-env.mjs",
      "cargo",
      "build",
      "--manifest-path",
      `${HERE}/Cargo.toml`,
      windows ? "--lib" : "--bins",
      "--locked",
      "--target",
      target,
      "-j2",
    ],
    {
      env,
      log: path.join(destination, "intercept-build.log"),
      timeout: 5_400_000,
    },
  );
  if (build.code !== 0) {
    console.error(build.tail.slice(-8192));
    fail("fixture build failed; see intercept-build.log");
  }
  const binRoot = path.join(cargo, target, "debug");
  const client = path.join(
    binRoot,
    windows
      ? "sorng_cef_intercept_acceptance.dll"
      : "sorng-cef-intercept-acceptance",
  );

  // 2. Place it inside the verified TLS stage under the stage's client name.
  const stage = path.join(destination, mac ? "stage-tls.app" : "stage-tls");
  const executable = windows
    ? path.join(stage, `${STEM}.exe`)
    : mac
      ? path.join(stage, "Contents", "MacOS", STEM)
      : path.join(stage, STEM);
  const replaced = windows ? path.join(stage, `${STEM}.dll`) : executable;
  if (!(await exists(executable)) || !(await exists(replaced)))
    fail(
      "staged TLS bundle missing; the native acceptance step did not stage it",
    );
  await rename(replaced, `${replaced}.tls-original`);
  await copyFile(client, replaced);
  if (!windows) await chmod(replaced, 0o755);
  if (windows)
    await ensureBrowserSandboxAccess({ bundle: stage, appName: STEM });

  // 3. Run once, unattended, with a fresh output directory.
  const output = path.join(destination, "intercept-run");
  await mkdir(output);
  const childEnv = {
    ...env,
    SORNG_CEF_ACCEPTANCE_OUTPUT: output,
    SORNG_CEF_ACCEPTANCE_RUN_ID: randomUUID(),
    ...(process.platform === "linux" ? { GDK_BACKEND: "x11" } : {}),
  };
  let exitCode;
  let clientOutput = "";
  let desktop;
  if (windows) {
    const launchDir = path.join(destination, "intercept-launch");
    await mkdir(launchDir);
    const launch = privateDesktopLaunch({
      executable,
      output: launchDir,
      timeoutMs: TIMEOUT_MS,
    });
    const launcher = await run(launch.command, launch.args, {
      env: childEnv,
      cwd: path.dirname(executable),
      log: path.join(destination, "intercept-launcher.log"),
      timeout: TIMEOUT_MS + 30_000,
    });
    let result;
    try {
      result = JSON.parse(await readFile(launch.result, "utf8"));
    } catch {}
    desktop = {
      launcherExit: launcher.code,
      failures: assessPrivateDesktop(result),
      ...(result && typeof result === "object" ? result : {}),
    };
    exitCode = result?.started === true ? result.exitCode : null;
    clientOutput =
      (await readFile(launch.stdout, "utf8").catch(() => "")) +
      (await readFile(launch.stderr, "utf8").catch(() => ""));
  } else {
    const client = await run(executable, [], {
      env: childEnv,
      cwd: path.dirname(executable),
      log: path.join(destination, "intercept-client.log"),
      timeout: TIMEOUT_MS,
    });
    exitCode = client.timedOut ? null : client.code;
    clientOutput = client.tail;
  }
  for (const line of clientOutput.split(/\r?\n/))
    if (
      line.startsWith("intercept-acceptance") ||
      line.startsWith("native intercept")
    )
      console.log(line);

  // 4. Keep the receipts beside the other native reports.
  let report = null;
  try {
    report = JSON.parse(
      await readFile(path.join(output, "native-report.json"), "utf8"),
    );
  } catch {}
  for (const [from, to] of [
    ["native-report.json", "intercept-native-report.json"],
    ["cef.log", "intercept-cef.log"],
    ["error.txt", "intercept-error.log"],
  ])
    await copyFile(path.join(output, from), path.join(destination, to)).catch(
      () => {},
    );
  const ok =
    exitCode === 0 &&
    report?.ok === true &&
    report?.customCa === true &&
    (desktop ? desktop.failures.length === 0 : true);
  const summary = {
    schema: 1,
    kind: "sorng-cef-intercept-acceptance",
    target,
    platform: process.platform,
    arch: process.arch,
    exitCode,
    ok,
    patchId: report?.patchId ?? null,
    capabilities: report?.capabilities ?? null,
    customCa: report?.customCa ?? null,
    timing: report?.timing ?? null,
    failures: report?.failures ?? ["no native report"],
    desktop: desktop ?? { kind: "caller-provided" },
    engineRebuilt: false,
    publicationAllowed: false,
  };
  await writeFile(
    path.join(destination, "intercept-summary.json"),
    JSON.stringify(summary, null, 2),
    { flag: "wx" },
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!ok)
    fail(
      "intercepting proxy acceptance failed; see intercept-native-report.json",
    );
}

main().catch((error) => fail(error?.stack ?? String(error)));
