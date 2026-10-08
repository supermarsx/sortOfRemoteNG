#!/usr/bin/env node
// Exercise the production DLL link graph without app startup or user data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const flag = "--sorng-browser-network-probe";
const passed = "browser-network-probe: loopback/auth/shutdown passed";

export function assertNetworkProbeSupported(bytes) {
  // Older clients ignore unknown flags and would launch the real app. Refuse
  // them before executing anything. Only use a locally built/trusted bundle.
  if (
    !bytes.includes(Buffer.from(flag)) ||
    !bytes.includes(Buffer.from(passed))
  )
    throw new Error(
      "Client lacks the exit-early network probe; rebuild before testing. App was not launched.",
    );
}

export async function probeBrowserClientNetwork(
  bundle,
  { run = spawnSync, appName = "sortofremoteng" } = {},
) {
  if (process.platform !== "win32")
    throw new Error("This final-link probe requires Windows");
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(appName))
    throw new Error("Invalid browser probe executable name");
  const root = path.resolve(bundle);
  const dll = path.join(root, `${appName}.dll`);
  const bytes = await readFile(dll);
  assertNetworkProbeSupported(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const started = Date.now();
  const result = run(path.join(root, `${appName}.exe`), [flag], {
    cwd: root,
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error || result.status !== 0 || !output.includes(passed)) {
    const code =
      result.status == null
        ? "no exit code"
        : `0x${(result.status >>> 0).toString(16)}`;
    throw new Error(
      `Browser network probe failed (${code}${result.error?.code ? `, ${result.error.code}` : ""}). No app profiles were opened.`,
    );
  }
  if (
    createHash("sha256")
      .update(await readFile(dll))
      .digest("hex") !== sha256
  )
    throw new Error("Client changed while the network probe was running");
  return {
    ok: true,
    clientSha256: sha256,
    elapsedMs: Date.now() - started,
    loopbackProxy: "passed",
    authenticationRequired: true,
    shutdown: "passed",
    appProfilesOpened: false,
    cefInitialized: false,
    websiteLoginTested: false,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3) {
    console.error(
      "usage: node scripts/browser-client-network-probe.mjs <trusted Windows bundle directory>",
    );
    process.exitCode = 2;
  } else {
    try {
      console.log(
        JSON.stringify(
          await probeBrowserClientNetwork(process.argv[2]),
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
