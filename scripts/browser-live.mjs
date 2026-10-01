#!/usr/bin/env node
// Live public-page acceptance, not authenticated login. Fresh native profiles only.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const sites = ["google", "cloudflare", "porkbun"];
if (args.includes("--help")) {
  console.log(
    "Usage: npm run browser:live -- [--site google|cloudflare|porkbun] [--dark|--both] [--report path.json]\n" +
      "Windows only. Opens public pages through the real production proxy in disposable WebView2 profiles.\n" +
      "Default: all three sites, dark mode off and on. No passwords or account login.\n" +
      "Writes .artifacts/browser-live.json. Exit 0 means requested login forms rendered, NOT authenticated login.",
  );
  process.exit(0);
}
let selected = sites;
let modes = [false, true];
let reportPath = path.join(root, ".artifacts/browser-live.json");
const seen = new Set();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (seen.has(flag)) throw new Error("Repeated option");
  seen.add(flag);
  if (flag === "--site" && sites.includes(args[index + 1]))
    selected = [args[++index]];
  else if (flag === "--dark") modes = [true];
  else if (flag === "--both") modes = [false, true];
  else if (
    flag === "--report" &&
    args[index + 1] &&
    !args[index + 1].startsWith("--")
  )
    reportPath = path.resolve(root, args[++index]);
  else throw new Error("Invalid option; use --help");
}
if (seen.has("--dark") && seen.has("--both"))
  throw new Error("Choose --dark or --both");
if (process.platform !== "win32")
  throw new Error("The live WebView2 acceptance probe requires Windows");

function execute(command, argv, onLine, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pending = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      pending += data.toString();
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        onLine(pending.slice(0, end).trim());
        pending = pending.slice(end + 1);
      }
    });
    // Runtime reports never print page content, console messages or token-bearing URLs.
    child.stderr.on("data", (data) => process.stderr.write(data));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (pending.trim()) onLine(pending.trim());
      resolve({ code, timedOut });
    });
  });
}

let executable;
console.log("Building native live browser acceptance probe...");
const build = await execute(
  process.execPath,
  [
    "scripts/native-build-env.mjs",
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-p",
    "sorng-file-viewer-host",
    "--test",
    "native_live_browser",
    "--no-run",
    "--locked",
    "--message-format=json",
  ],
  (line) => {
    try {
      const event = JSON.parse(line);
      if (
        event.reason === "compiler-artifact" &&
        event.target?.name === "native_live_browser" &&
        event.executable
      )
        executable = event.executable;
      if (event.reason === "compiler-message" && event.message?.rendered)
        process.stderr.write(event.message.rendered);
    } catch {
      /* Cargo helper announcements are not result records. */
    }
  },
  30 * 60_000,
);
if (build.code !== 0 || !executable)
  throw new Error("Native live probe could not be built");

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  scope:
    "anonymous real WebView2 with production proxy and native network guard; not the full React shell",
  authenticatedLogin: "not-run-no-credentials",
  runs: [],
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
for (const site of selected) {
  for (const dark of modes) {
    let receipt;
    const outcome = await execute(
      executable,
      ["--live", site, ...(dark ? ["--dark"] : [])],
      (line) => {
        const prefix = "SORNG_LIVE_BROWSER_RESULT=";
        if (line.startsWith(prefix)) {
          try {
            receipt = JSON.parse(line.slice(prefix.length));
          } catch {
            /* Incomplete result fails below. */
          }
        }
      },
      90_000,
    );
    const snapshot = receipt?.snapshots?.at(-1);
    const formReady =
      outcome.code === 0 &&
      receipt?.observed === true &&
      receipt.guardFailed === false &&
      receipt.activations > 0 &&
      receipt.activationErrors === 0 &&
      receipt.temporaryProfileRemoved === true &&
      snapshot?.documentSequence === receipt.documentSequence &&
      receipt.elapsedMs - snapshot.elapsedMs >= 0 &&
      receipt.elapsedMs - snapshot.elapsedMs < 8000 &&
      snapshot?.bodyVisible === true &&
      (snapshot.emailFields > 0 || snapshot.passwordFields > 0) &&
      snapshot.insecureBrowser === false &&
      snapshot.accessDenied === false &&
      snapshot.bootstrapErrors === 0 &&
      snapshot.turnstileErrors === 0 &&
      (!dark || snapshot.darkPresented === true);
    report.runs.push({
      site,
      darkMode: dark,
      loginForm: formReady ? "rendered" : "not-ready",
      exitCode: outcome.code,
      timedOut: outcome.timedOut,
      evidence: receipt ?? null,
    });
    console.log(
      `${site} dark=${dark}: ${formReady ? "login form rendered" : "NOT READY"}; ` +
        `requests=${receipt?.proxyRequests ?? 0}, observations=${receipt?.snapshots?.length ?? 0}, ` +
        `challenge=${snapshot?.challenge ?? "unknown"}, authenticated login NOT TESTED`,
    );
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
}
report.completedAt = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Evidence: ${path.relative(root, reportPath)} (no credentials, cookies, query strings or page text)`,
);
process.exitCode = report.runs.every((run) => run.loginForm === "rendered")
  ? 0
  : 1;
