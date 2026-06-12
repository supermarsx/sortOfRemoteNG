#!/usr/bin/env node
// Resilient dev-server port resolution for `tauri dev`.
//
// The Tauri `beforeDevCommand` starts the Next.js dev server on a fixed port
// (3001, matching `build.devUrl` in tauri.conf.json). When a previous dev
// session leaves a stale listener on that port, `next dev` aborts with
// `EADDRINUSE` and takes `tauri dev` down with it.
//
// This module makes the port acquisition self-healing. The PRIMARY behavior
// (per the user's directive: "keep upping the port until you find a free one")
// is increment-until-free:
//   1. If the preferred port (3001) is free, use it.
//   2. If it is busy, climb 3001 -> 3002 -> 3003 -> ... and bind-probe each one
//      until a free port is found. This never depends on killing a holder, so
//      it cannot EADDRINUSE even against a foreign / unkillable process.
//
// `reclaim` (kill the stale listener to free the preferred port) is an OPT-IN
// escape hatch used only by the path that has a *fixed* Tauri devUrl it cannot
// rewrite (a direct `tauri dev`). The orchestrator (`npm run tauri:dev`) climbs
// freely and pins `build.devUrl` to the chosen port via `tauri dev -c {...}` so
// both sides always agree.
//
// Pure-Node port probing (net.createServer) is used everywhere; the OS shell is
// only invoked to identify/kill a stale PID, and only when reclaiming.

import net from "node:net";
import { spawnSync } from "node:child_process";

export const DEFAULT_PORT = 3001;
// Bound the increment-until-free search. The user's directive is "keep upping
// the port until you find a free one"; we cap the climb so a pathological
// machine (everything bound) fails loudly instead of spinning forever.
export const MAX_PORT_SCAN = 100;

/**
 * Resolve whether a TCP port is free to bind on the loopback + all interfaces.
 * Uses a real bind attempt (the same operation `next dev` performs), so this
 * detects EADDRINUSE exactly as the dev server would.
 *
 * @param {number} port
 * @param {string} [host] bind host (default 0.0.0.0 to match `next dev`)
 * @returns {Promise<boolean>} true if the port is free
 */
export function isPortFree(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      // EADDRINUSE / EACCES / EADDRNOTAVAIL all mean "cannot bind here".
      server.close(() => {});
      resolve(false);
      void err;
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Find the PID(s) holding a LISTEN socket on the given TCP port.
 * Cross-platform; returns a de-duplicated array of numeric PIDs (may be empty).
 *
 * @param {number} port
 * @returns {number[]}
 */
export function findListenerPids(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      // Get-NetTCPConnection is the robust modern API; fall back to netstat if
      // the cmdlet is unavailable (older/Server SKUs).
      const ps = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `try { Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | ` +
            `Select-Object -ExpandProperty OwningProcess } catch { ` +
            `(netstat -ano | Select-String ':${port}\\s' | Select-String 'LISTENING') ` +
            `-replace '.*\\s(\\d+)$','$1' }`,
        ],
        { encoding: "utf8" },
      );
      for (const line of String(ps.stdout || "").split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    } else {
      // lsof is the most portable; fall back to fuser.
      let out = "";
      const lsof = spawnSync("lsof", [`-ti`, `tcp:${port}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
      });
      if (lsof.status === 0) {
        out = String(lsof.stdout || "");
      } else {
        const fuser = spawnSync("fuser", [`${port}/tcp`], { encoding: "utf8" });
        // fuser prints PIDs on stderr in some builds, stdout in others.
        out = `${fuser.stdout || ""} ${fuser.stderr || ""}`;
      }
      for (const tok of out.split(/\s+/)) {
        const pid = Number.parseInt(tok.trim(), 10);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    }
  } catch {
    // Best-effort: if discovery fails we simply report no PIDs and the caller
    // falls back to auto-port selection.
  }
  return [...pids].filter((pid) => pid !== process.pid);
}

/**
 * Kill the given PID, cross-platform. Returns true if the kill command
 * reported success.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function killPid(pid) {
  try {
    if (process.platform === "win32") {
      const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        encoding: "utf8",
      });
      return r.status === 0;
    }
    const r = spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Attempt to reclaim a busy port by killing its listener(s), then re-probe
 * with a short backoff to let the OS release the socket.
 *
 * @param {number} port
 * @returns {Promise<{reclaimed: boolean, pids: number[]}>}
 */
export async function reclaimPort(port) {
  const pids = findListenerPids(port);
  if (pids.length === 0) {
    // Nothing identifiable holding it (could be TIME_WAIT or a perms issue).
    const free = await waitForFree(port, 1500);
    return { reclaimed: free, pids: [] };
  }
  for (const pid of pids) killPid(pid);
  const free = await waitForFree(port, 3000);
  return { reclaimed: free, pids };
}

/**
 * Poll until the port becomes free or the timeout elapses (bind-race backoff).
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function waitForFree(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let delay = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await isPortFree(port)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(delay, deadline - Date.now()));
    delay = Math.min(delay * 2, 500);
  }
}

/**
 * Increment-until-free: starting at `start`, probe by actually attempting to
 * bind and step up one port at a time (3001 -> 3002 -> 3003 -> ...) until a
 * free one is found. This is the PRIMARY port-acquisition behavior (the user's
 * directive: "keep upping the port until you find a free one"). It never relies
 * on killing a holder, so it works against foreign / unkillable processes too.
 *
 * The search is bounded by MAX_PORT_SCAN; if every port in the window is busy
 * (and we hit 65535), it throws a clear, actionable error rather than silently
 * landing on an ephemeral port the caller can't predict (Tauri's devUrl has to
 * be able to follow the chosen port, so it must be deterministic).
 *
 * @param {number} start first port to try (inclusive)
 * @returns {Promise<number>} the first free port at or above `start`
 */
export async function findFreePort(start) {
  for (let p = start; p < start + MAX_PORT_SCAN; p++) {
    if (p > 65535) break;
    if (await isPortFree(p)) return p;
  }
  const end = Math.min(start + MAX_PORT_SCAN - 1, 65535);
  throw new Error(
    `no free port found in range ${start}-${end} ` +
      `(scanned ${MAX_PORT_SCAN} ports). Free a port or set SORNG_DEV_PORT.`,
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve the port the dev server should bind, self-healing port conflicts.
 *
 * PRIMARY strategy = increment-until-free (the user's directive). Starting at
 * the preferred port (3001), we bind-probe and step up until a free port is
 * found. This is the single source of truth used by EVERY invocation path
 * (`npm run tauri:dev`, `npm run dev`, and a direct `tauri dev`'s
 * beforeDevCommand). It never depends on killing a holder, so it cannot
 * EADDRINUSE even against a foreign / unkillable process.
 *
 *   - preferred port free  -> use it (action "free")
 *   - preferred port busy  -> climb 3001->3002->... to the first free one
 *                             (action "autoport", changed=true)
 *
 * `reclaim` is an OPT-IN escape hatch for the one path that has a *fixed*
 * Tauri devUrl it cannot rewrite (a direct `tauri dev`, where devUrl=3001 is
 * baked into config). There, before climbing, we try to free the preferred
 * port by killing a stale listener so the fixed devUrl stays valid. If reclaim
 * fails, we STILL climb (never EADDRINUSE) and the caller is told the devUrl
 * won't match — see dev-server.mjs.
 *
 * @param {object} [opts]
 * @param {number} [opts.preferred] preferred port (default DEFAULT_PORT)
 * @param {boolean} [opts.reclaim] try to free the preferred port first (default false)
 * @param {(msg: string) => void} [opts.log] logger
 * @returns {Promise<{port: number, preferred: number, changed: boolean, action: string}>}
 */
export async function resolveDevPort(opts = {}) {
  const preferred = Number.parseInt(
    String(opts.preferred ?? process.env.SORNG_DEV_PORT ?? DEFAULT_PORT),
    10,
  );
  const reclaim = opts.reclaim ?? false;
  const log = opts.log ?? (() => {});

  if (await isPortFree(preferred)) {
    log(`port ${preferred} is free`);
    return { port: preferred, preferred, changed: false, action: "free" };
  }

  log(`port ${preferred} is busy`);

  if (reclaim) {
    const { reclaimed, pids } = await reclaimPort(preferred);
    if (reclaimed) {
      const who = pids.length
        ? `stale PID ${pids.join(", ")}`
        : "stale listener";
      log(`port ${preferred} busy -> reclaimed ${who}`);
      return {
        port: preferred,
        preferred,
        changed: false,
        action: "reclaimed",
      };
    }
    log(`could not reclaim port ${preferred}; climbing to next free port`);
  }

  // PRIMARY behavior: keep upping the port until we find a free one.
  const port = await findFreePort(preferred + 1);
  log(`port ${preferred} busy -> climbed to free port ${port}`);
  return { port, preferred, changed: true, action: "autoport" };
}
