#!/usr/bin/env node
// Kill-free development port selection shared by the standalone Next.js and
// Tauri launchers. Port probing is intentionally advisory: a fixed Tauri port
// is checked again by the beforeDev process and any later bind race is allowed
// to fail closed in Next rather than terminating the process that won it.

import net from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_PORT = 3001;
export const MAX_PORT_SCAN = 100;
export const BROWSER_DEV_DIST_DIR = ".next";
export const TAURI_DEV_DIST_DIR = ".next-tauri-dev";

export function parseDevPort(value, label = "port") {
  const normalized =
    typeof value === "number" ? String(value) : String(value ?? "").trim();

  if (!/^[1-9]\d{0,4}$/.test(normalized)) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }

  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }

  return port;
}

export function browserDevLockPath(cwd = process.cwd()) {
  return resolve(cwd, BROWSER_DEV_DIST_DIR, "dev", "lock");
}

export function managedDevLockPath(cwd = process.cwd()) {
  return resolve(cwd, TAURI_DEV_DIST_DIR, "dev", "lock");
}

export function assertNoManagedDevLock({
  cwd = process.cwd(),
  existsSyncFn = existsSync,
} = {}) {
  const lockPath = managedDevLockPath(cwd);
  if (!existsSyncFn(lockPath)) return;

  throw new Error(
    `a Tauri-managed Next.js lock already exists at ${lockPath}. ` +
      "Refusing to start a second managed dev server. Stop the existing " +
      "`npm run tauri:dev` session; if no process is running, remove the " +
      "stale lock only after confirming that it is unowned",
  );
}

function tryBind(port, host) {
  return new Promise((resolveProbe) => {
    const server = net.createServer();
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveProbe(value);
    };

    server.once("error", (error) => {
      server.close(() => {});
      if (
        error &&
        (error.code === "EADDRNOTAVAIL" ||
          error.code === "EAFNOSUPPORT" ||
          error.code === "EINVAL")
      ) {
        settle(true);
      } else {
        settle(false);
      }
    });
    server.once("listening", () => {
      server.close(() => settle(true));
    });

    try {
      server.listen(port, host);
    } catch {
      settle(false);
    }
  });
}

export async function isPortFree(portValue) {
  const port = parseDevPort(portValue);
  for (const host of ["::", "0.0.0.0"]) {
    if (!(await tryBind(port, host))) return false;
  }
  return true;
}

export async function findFreePort(
  startValue,
  { isPortFreeFn = isPortFree, maxScan = MAX_PORT_SCAN } = {},
) {
  const start = parseDevPort(startValue, "starting port");
  if (!Number.isInteger(maxScan) || maxScan < 1) {
    throw new Error("maxScan must be a positive integer");
  }

  const end = Math.min(start + maxScan - 1, 65535);
  for (let port = start; port <= end; port++) {
    if (await isPortFreeFn(port)) return port;
  }

  throw new Error(
    `no free port found in range ${start}-${end} ` +
      `(scanned ${end - start + 1} ports)`,
  );
}

export async function resolveDevPort({
  preferred = process.env.SORNG_DEV_PORT ?? DEFAULT_PORT,
  fixed = false,
  isPortFreeFn = isPortFree,
  log = () => {},
} = {}) {
  const port = parseDevPort(preferred, "SORNG_DEV_PORT");

  if (await isPortFreeFn(port)) {
    log(`port ${port} is free`);
    return { port, preferred: port, changed: false, action: "free" };
  }

  log(`port ${port} is busy`);
  if (fixed) {
    throw new Error(
      `fixed Tauri dev port ${port} became occupied before Next.js could ` +
        "bind. Refusing to terminate the listener, climb to another port, or " +
        "diverge from Tauri's pinned devUrl. Stop the conflicting process or " +
        "rerun `npm run tauri:dev`",
    );
  }

  if (port === 65535) {
    throw new Error("port 65535 is busy and no higher valid port exists");
  }

  const selected = await findFreePort(port + 1, { isPortFreeFn });
  log(`port ${port} busy -> climbed to free port ${selected}`);
  return {
    port: selected,
    preferred: port,
    changed: true,
    action: "autoport",
  };
}
