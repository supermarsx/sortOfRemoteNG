#!/usr/bin/env node
// Resilient Next.js dev-server launcher used as Tauri's `beforeDevCommand`.
//
// When invoked by `scripts/tauri-dev.mjs`, the chosen port is already resolved
// and passed through `SORNG_DEV_PORT` (and the Tauri devUrl has been overridden
// to match). When invoked standalone (`npm run dev`), it resolves the port
// itself so a plain `next dev` also self-heals a stale listener.
//
// Flags:
//   --check   Resolve/repair the port and print the result, then exit (no Next).

import { spawn } from "node:child_process";
import process from "node:process";
import { resolveDevPort, isPortFree, DEFAULT_PORT } from "./dev-port.mjs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const log = (m) => console.log(`[dev-server] ${m}`);

const preEnv = process.env.SORNG_DEV_PORT;
const preResolved = process.env.SORNG_DEV_PORT_RESOLVED === "1";

async function main() {
  let port;
  if (preResolved && preEnv) {
    // The orchestrator (tauri-dev.mjs) already climbed to a free port and
    // aligned Tauri's devUrl to it. Re-probe at bind time to close the
    // resolve->bind race: if something grabbed it in between we re-resolve
    // with reclaim so we land back on the SAME port Tauri's devUrl expects
    // (climbing here would silently diverge from devUrl, so we don't).
    port = Number.parseInt(preEnv, 10);
    if (await isPortFree(port)) {
      log(`using port ${port} (resolved by tauri-dev launcher)`);
    } else {
      log(
        `port ${port} (from launcher) was taken before bind; reclaiming to ` +
          `keep Tauri devUrl in sync`,
      );
      const r = await resolveDevPort({ preferred: port, reclaim: true, log });
      port = r.port;
      if (r.changed) {
        log(
          `WARNING: could not hold ${preEnv}; now on ${port} but Tauri ` +
            `devUrl still points at ${preEnv}. Re-run \`npm run tauri:dev\`.`,
        );
      }
    }
  } else {
    // Standalone (`npm run dev`) or a direct `tauri dev` whose beforeDevCommand
    // is this script. Tauri's devUrl is the FIXED 3001 from config here, so we
    // prefer to reclaim 3001 (keeps devUrl valid). If we can't, we STILL climb
    // to a free port so `next dev` never EADDRINUSEs — and we warn that the
    // fixed devUrl won't match (the orchestrator path fixes devUrl).
    const r = await resolveDevPort({
      preferred: preEnv ? Number.parseInt(preEnv, 10) : DEFAULT_PORT,
      reclaim: true,
      log,
    });
    port = r.port;
    if (r.changed) {
      log(
        `NOTE: dev server climbed to port ${port}, not ${r.preferred}. ` +
          `A direct \`tauri dev\` has a fixed devUrl of ${r.preferred}; use ` +
          `\`npm run tauri:dev\` so Tauri's devUrl follows the chosen port.`,
      );
    }
  }

  if (checkOnly) {
    console.log(JSON.stringify({ port }));
    return;
  }

  const child = spawn(
    process.execPath,
    [
      "./node_modules/next/dist/bin/next",
      "dev",
      "--turbopack",
      "--port",
      String(port),
    ],
    { stdio: "inherit", env: { ...process.env, PORT: String(port) } },
  );

  const forward = (sig) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`[dev-server] fatal: ${err?.stack || err}`);
  process.exit(1);
});
