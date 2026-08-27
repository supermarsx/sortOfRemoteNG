import { execFileSync } from "node:child_process";
import net from "node:net";

/**
 * Per-run WebDriver port allocation.
 *
 * `tauri-driver` listens on one port (`--port`) and starts a native WebDriver
 * (msedgedriver on Windows, WebKitWebDriver elsewhere) on a second port
 * (`--native-port`). Both default to fixed values (4444 / 4445), so two WDIO
 * runs on the same machine silently attach to each other's sessions.
 *
 * Every run therefore allocates its own free pair here. The resolved values are
 * published back into `process.env` because WDIO workers re-parse the config
 * file in a child process; without that, the launcher and its workers would
 * each allocate a different port and the workers would connect to nothing.
 *
 * Set `TAURI_DRIVER_PORT` / `TAURI_NATIVE_DRIVER_PORT` to pin either port when
 * a caller needs deterministic values (for example a multi-phase script that
 * waits for the driver port to close between phases).
 */

export const DRIVER_PORT_ENV = "TAURI_DRIVER_PORT";
export const NATIVE_PORT_ENV = "TAURI_NATIVE_DRIVER_PORT";

export interface DriverPorts {
  driverPort: number;
  nativePort: number;
}

interface Allocation {
  ports: DriverPorts;
  pinned: Record<keyof DriverPorts, boolean>;
}

const PORT_KEYS = ["driverPort", "nativePort"] as const;

const ENV_VAR_BY_KEY: Record<keyof DriverPorts, string> = {
  driverPort: DRIVER_PORT_ENV,
  nativePort: NATIVE_PORT_ENV,
};

/**
 * Binds every requested port at the same time before releasing any of them, so
 * the returned ports are distinct. Runs in a child process because the config
 * file needs the ports synchronously while it is still being evaluated.
 */
const ALLOCATOR_SCRIPT = `
const net = require('node:net');
const count = Number(process.argv[1]);
const servers = [];
let listening = 0;
let failed = false;

const fail = (error) => {
  if (failed) {
    return;
  }
  failed = true;
  process.stderr.write(String((error && error.message) || error));
  process.exit(1);
};

for (let index = 0; index < count; index += 1) {
  const server = net.createServer();
  servers.push(server);
  server.on('error', fail);
  server.listen(0, '127.0.0.1', () => {
    listening += 1;
    if (listening < count) {
      return;
    }
    const ports = servers.map((entry) => entry.address().port);
    let closed = 0;
    for (const entry of servers) {
      entry.close(() => {
        closed += 1;
        if (closed === count) {
          process.stdout.write(JSON.stringify(ports));
        }
      });
    }
  });
}
`;

let allocation: Allocation | null = null;

/**
 * Resolves this process' driver ports, allocating free ones on first use.
 * Memoised, and stable for the lifetime of the process unless
 * {@link ensureDriverPortsAvailable} has to replace a port that went busy.
 */
export function resolveDriverPorts(): DriverPorts {
  if (!allocation) {
    allocation = createAllocation();
    publishAllocation(allocation.ports);
  }

  return allocation.ports;
}

/**
 * Re-checks the allocated ports immediately before the driver is spawned and
 * replaces any that were taken in the meantime. Pinned ports are left alone:
 * the caller asked for those explicitly, so a conflict has to surface as a
 * driver startup failure rather than a silent port change.
 */
export async function ensureDriverPortsAvailable(): Promise<DriverPorts> {
  const current = resolveDriverPorts();
  if (!allocation) {
    return current;
  }

  const busyKeys: Array<keyof DriverPorts> = [];
  for (const key of PORT_KEYS) {
    if (allocation.pinned[key]) {
      continue;
    }
    if (await isPortFree(current[key])) {
      continue;
    }
    busyKeys.push(key);
  }

  if (busyKeys.length === 0) {
    return current;
  }

  const replacements = allocateFreePorts(busyKeys.length);
  const ports: DriverPorts = { ...current };
  busyKeys.forEach((key, index) => {
    ports[key] = replacements[index];
  });

  assertDistinct(ports);
  allocation = { ports, pinned: allocation.pinned };
  publishAllocation(ports);

  return ports;
}

/** Test seam: drops the memoised allocation. */
export function resetDriverPortsForTesting(): void {
  allocation = null;
}

function createAllocation(): Allocation {
  const pinnedDriverPort = readPortEnv(DRIVER_PORT_ENV);
  const pinnedNativePort = readPortEnv(NATIVE_PORT_ENV);

  const needed =
    (pinnedDriverPort === null ? 1 : 0) + (pinnedNativePort === null ? 1 : 0);
  const allocated = allocateFreePorts(needed);

  const ports: DriverPorts = {
    driverPort: pinnedDriverPort ?? (allocated.shift() as number),
    nativePort: pinnedNativePort ?? (allocated.shift() as number),
  };

  assertDistinct(ports);

  return {
    ports,
    pinned: {
      driverPort: pinnedDriverPort !== null,
      nativePort: pinnedNativePort !== null,
    },
  };
}

function assertDistinct(ports: DriverPorts): void {
  if (ports.driverPort !== ports.nativePort) {
    return;
  }

  throw new Error(
    `${DRIVER_PORT_ENV} and ${NATIVE_PORT_ENV} must differ; both resolved to ${ports.driverPort}.`,
  );
}

function publishAllocation(ports: DriverPorts): void {
  for (const key of PORT_KEYS) {
    process.env[ENV_VAR_BY_KEY[key]] = String(ports[key]);
  }
}

function readPortEnv(envVar: string): number | null {
  const raw = process.env[envVar]?.trim();
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `${envVar} must be a TCP port between 1 and 65535; received "${raw}".`,
    );
  }

  return parsed;
}

function allocateFreePorts(count: number): number[] {
  if (count <= 0) {
    return [];
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return runAllocator(count);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    [
      `Unable to allocate ${count} free TCP port(s) for tauri-driver.`,
      `Set ${DRIVER_PORT_ENV} and ${NATIVE_PORT_ENV} to pin them manually.`,
      lastError instanceof Error ? lastError.message : String(lastError),
    ].join("\n"),
  );
}

function runAllocator(count: number): number[] {
  const stdout = execFileSync(
    process.execPath,
    ["-e", ALLOCATOR_SCRIPT, String(count)],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );

  const parsed: unknown = JSON.parse(stdout);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== count ||
    parsed.some((port) => !Number.isInteger(port))
  ) {
    throw new Error(`Port allocator returned unexpected output: ${stdout}`);
  }

  return parsed as number[];
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, "127.0.0.1");
  });
}
