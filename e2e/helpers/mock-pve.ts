// t67-e8 — spawn/stop helper for the disposable mock Proxmox VE server.
//
// Proxmox VE is not containerisable, so `e2e/specs/28-proxmox` runs against a
// forked Node HTTPS fixture instead of a Docker service. The fixture lives in
// `e2e/helpers/fixtures/mock-pve/server.mjs`; this module owns its lifecycle
// and exposes the self-signed certificate fingerprint the app has to pin.
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const MOCK_PVE_SERVER_PATH = path.join(
  HELPERS_DIR,
  "fixtures",
  "mock-pve",
  "server.mjs",
);

export const MOCK_PVE_PORT = Number.parseInt(
  process.env.MOCK_PVE_PORT ?? "18006",
  10,
);
export const MOCK_PVE_HOST = process.env.MOCK_PVE_HOST ?? "127.0.0.1";
export const MOCK_PVE_USER = process.env.MOCK_PVE_USER ?? "root@pam";
export const MOCK_PVE_PASSWORD = process.env.MOCK_PVE_PASSWORD ?? "pve";

export interface MockPveInfo {
  url: string;
  host: string;
  port: number;
  /** `AA:BB:…` uppercase SHA-256 over the DER — what the app pins. */
  fingerprint: string;
  node: string;
  vmid: number;
  vmName: string;
  user: string;
  password: string;
}

export interface MockPveHandle extends MockPveInfo {
  stop: () => Promise<void>;
}

interface ReadyMessage extends MockPveInfo {
  type: "mock-pve-ready";
}

const isReadyMessage = (value: unknown): value is ReadyMessage =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "mock-pve-ready";

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    try {
      if (child.connected) child.send("stop");
    } catch {
      /* channel already gone — fall through to the signal */
    }
    child.kill("SIGTERM");
  });
}

/**
 * Fork the mock PVE server and resolve once it reports its bound port and
 * certificate fingerprint. Rejects (after cleaning the child up) on a startup
 * failure — most often a stale process still holding the fixed port, or a
 * missing `openssl` on PATH.
 */
export async function startMockPve(
  options: { port?: number; host?: string; requireTfa?: boolean } = {},
): Promise<MockPveHandle> {
  const child = fork(MOCK_PVE_SERVER_PATH, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      MOCK_PVE_PORT: String(options.port ?? MOCK_PVE_PORT),
      MOCK_PVE_HOST: options.host ?? MOCK_PVE_HOST,
      MOCK_PVE_PASSWORD: MOCK_PVE_PASSWORD,
      MOCK_PVE_REQUIRE_TFA: options.requireTfa ? "1" : "0",
    },
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout?.on("data", () => {
    /* drained so the pipe never blocks the fixture */
  });

  const info = await new Promise<MockPveInfo>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[mock-pve] server did not become ready within 20s. stderr:\n${stderr}`,
        ),
      );
    }, 20_000);
    timer.unref?.();

    child.once("message", (message) => {
      clearTimeout(timer);
      if (!isReadyMessage(message)) {
        reject(new Error("[mock-pve] unexpected ready message"));
        return;
      }
      const { type: _type, ...rest } = message;
      resolve(rest);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`[mock-pve] server exited early (code ${code}).\n${stderr}`),
      );
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  }).catch(async (error: unknown) => {
    await stopChild(child);
    throw error;
  });

  return {
    ...info,
    stop: () => stopChild(child),
  };
}

/**
 * The fingerprint the mock is currently serving, without starting a server.
 * Generates the disposable certificate on first use, exactly like the server
 * does, so a spec can assert the TOFU prompt before/without a live process.
 */
export async function readMockPveFingerprint(): Promise<string> {
  // `pathToFileURL` — a bare Windows path (`F:\…`) is not a valid ESM specifier.
  const module = (await import(
    /* @vite-ignore */ pathToFileURL(MOCK_PVE_SERVER_PATH).href
  )) as {
    ensureMockPveCertificate: (options?: { certDir?: string }) => {
      fingerprint: string;
    };
  };
  return module.ensureMockPveCertificate().fingerprint;
}
