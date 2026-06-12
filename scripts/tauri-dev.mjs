#!/usr/bin/env node
// Resilient `tauri dev` orchestrator.
//
// Problem this solves:
//   `tauri dev` runs `beforeDevCommand` (the Next.js dev server) and then waits
//   on `build.devUrl` (http://localhost:3001). A stale dev server left on 3001
//   makes `next dev` fail with EADDRINUSE and aborts the whole launch.
//
// What this does:
//   1. Resolve a usable port BEFORE starting Tauri: reclaim a stale listener on
//      3001 if possible, else auto-select the next free port.
//   2. Pass the chosen port to `beforeDevCommand` via `SORNG_DEV_PORT` so the
//      Next dev server binds it.
//   3. Keep Tauri's `devUrl` in agreement with the chosen port by merging a
//      `-c {"build":{"devUrl": "http://localhost:<port>"}}` config override into
//      `tauri dev`. (Tauri's CLI `-c/--config` deep-merges JSON over the file,
//      so we never mutate tauri.conf.json on disk.)
//
// Any extra args after this script are forwarded to `tauri dev`
// (e.g. `--features full-dev -- --no-default-features`).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { resolveDevPort, DEFAULT_PORT } from "./dev-port.mjs";

const require = createRequire(import.meta.url);

const passthrough = process.argv.slice(2);
const log = (m) => console.log(`[tauri-dev] ${m}`);

async function main() {
  const preferred = process.env.SORNG_DEV_PORT
    ? Number.parseInt(process.env.SORNG_DEV_PORT, 10)
    : DEFAULT_PORT;

  // This orchestrator OWNS Tauri's devUrl (it injects a -c override below), so
  // it does NOT need to keep the fixed 3001 — increment-until-free is the
  // primary, kill-free strategy. We always make devUrl follow the chosen port.
  const { port, action } = await resolveDevPort({
    preferred,
    reclaim: false,
    log,
  });

  log(`dev server will use port ${port} (${action})`);

  const env = {
    ...process.env,
    SORNG_DEV_PORT: String(port),
    // Signal to dev-server.mjs that the port is already resolved/aligned.
    SORNG_DEV_PORT_RESOLVED: "1",
  };

  const tauriArgs = ["dev"];

  // ALWAYS pin Tauri's devUrl to the resolved port so both sides agree, no
  // matter which port we climbed to (this is a launch-time -c merge over
  // tauri.conf.json; the file on disk is never mutated).
  const override = JSON.stringify({
    build: { devUrl: `http://localhost:${port}` },
  });
  tauriArgs.push("-c", override);
  log(`pinning Tauri devUrl -> http://localhost:${port}`);

  tauriArgs.push(...passthrough);

  // Invoke the pinned Tauri CLI's JS entry directly with the current Node
  // binary. This avoids the Windows `.cmd` shim (spawn EINVAL without a shell)
  // and keeps the launch fully cross-platform with no shell quoting concerns.
  const tauriBin = require.resolve("@tauri-apps/cli/tauri.js");
  const child = spawn(process.execPath, [tauriBin, ...tauriArgs], {
    stdio: "inherit",
    env,
    shell: false,
  });

  const forward = (sig) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(`[tauri-dev] failed to launch tauri: ${err?.stack || err}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(`[tauri-dev] fatal: ${err?.stack || err}`);
  process.exit(1);
});
