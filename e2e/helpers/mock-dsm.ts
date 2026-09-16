// t84-e8 — spawn/stop helper for the disposable mock Synology DSM server.
//
// Real DSM and Virtual DSM are off limits (licence), so
// `e2e/specs/26-synology/nas-api-permissions.spec.ts` drives the native
// "Synology NAS API" view against a forked Node HTTP fixture instead of a
// Docker service. The fixture lives in
// `e2e/helpers/fixtures/mock-dsm/server.mjs`; this module owns its lifecycle
// and the value-free IPC snapshots a spec uses to assert what the app sent.
import { fork, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const MOCK_DSM_SERVER_PATH = path.join(
  HELPERS_DIR,
  "fixtures",
  "mock-dsm",
  "server.mjs",
);

export const MOCK_DSM_PORT = Number.parseInt(
  process.env.MOCK_DSM_PORT ?? "18501",
  10,
);
export const MOCK_DSM_HOST = process.env.MOCK_DSM_HOST ?? "127.0.0.1";

export type MockDsmAccountName =
  | "admin"
  | "viewer"
  | "enroll"
  | "portal"
  | "otp"
  | "otp-seed"
  | "approve"
  | "remote-admin";

/**
 * Synthetic Base32 seed the `otp-seed` account checks codes against (RFC 6238,
 * HMAC-SHA-1, 6 digits, 30 s, current step ±1). Override with
 * `MOCK_DSM_TOTP_SEED` or the `totpSeed` option; never a real authenticator.
 */
export const DEFAULT_MOCK_DSM_TOTP_SEED = "JBSWY3DPEHPK3PXP";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The RFC 6238 code (HMAC-SHA-1, 6 digits, 30 s) the fixture's `otp-seed`
 * account accepts at `atMs`, so a spec can type or compare a valid code. Same
 * algorithm as `mockDsmTotpCode` in the fixture (node-tested for parity).
 */
export function mockDsmTotpCode(seed: string, atMs: number = Date.now()) {
  const clean = seed.replace(/[\s=]/gu, "").toUpperCase();
  if (!clean || /[^A-Z2-7]/u.test(clean)) {
    throw new Error("[mock-dsm] the TOTP seed is not Base32");
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = ((buffer << 5) | BASE32_ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const mac = crypto
    .createHmac("sha1", Buffer.from(bytes))
    .update(message)
    .digest();
  const binary = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * - `absent`: no `SYNO.API.Auth.UIConfig`, so the app must sign in legacy.
 * - `no_reply`: UIConfig serves an `_SSID` key but the fixture never answers
 *   Noise message 2, so the app must record `ik_incomplete`. The fixture has
 *   no Noise responder; the full `ik` path is covered by t84-e2's Rust tests.
 */
export type MockDsmUiConfig = "absent" | "no_reply";

/**
 * - `real`: DSM's response shapes per t84-r1's audit (`Utilization.disk`
 *   object, `{users|groups, offset, total}` envelopes, `device_id`).
 * - `legacy`: the shapes the pre-t84 decoders accept, to prove a decoder
 *   takes both. Set `MOCK_DSM_WIRE=legacy` to run the whole spec that way.
 */
export type MockDsmWire = "real" | "legacy";

export const MOCK_DSM_WIRE: MockDsmWire =
  process.env.MOCK_DSM_WIRE === "legacy" ? "legacy" : "real";

export interface MockDsmCredentials {
  username: string;
  password: string;
}

export interface MockDsmInfo {
  url: string;
  host: string;
  port: number;
  uiConfig: MockDsmUiConfig;
  wire: MockDsmWire;
  accounts: Record<MockDsmAccountName, MockDsmCredentials>;
  /** The only one-time code the `otp` account accepts. */
  otpCode: string;
  /** The synthetic Base32 seed behind the `otp-seed` account's codes. */
  totpSeed: string;
  /** Whether `otp-seed` refuses a code for a step that already signed in. */
  rejectReusedStep: boolean;
  /** `SYNO.Core.System.Utilization` CPU values served to full sessions. */
  cpu: Record<string, number | string>;
  /** Private NAS metadata that must never appear in access diagnostics. */
  hostname: string;
  serial: string;
}

/** One `SYNO.API.Auth login`, without any credential or token value. */
export interface MockDsmLogin {
  account: string;
  version: number;
  session: string | null;
  format: string | null;
  enableSynoToken: boolean;
  /**
   * Whether the code matched: `246810` for `otp`, the seed's TOTP (±1 step)
   * for `otp-seed`. A reused step refused by `rejectReusedStep` is `"valid"`
   * with code 404.
   */
  otpCode: "absent" | "valid" | "invalid";
  enableDeviceToken: boolean;
  deviceName: boolean;
  deviceId: "absent" | "trusted" | "rejected";
  ikMessage: boolean;
  ikMessageBytes: number;
  deviceTokenIssued: boolean;
  /** DSM error code, `0` for success. */
  code: number;
}

export interface MockDsmCall {
  api: string | null;
  method: string | null;
  version: number | null;
  account: string | null;
  sessionKind: "full" | "portal" | "limited" | null;
  /** Whether the request carried `X-SYNO-HASH`. */
  requestHash: boolean;
  code: number;
}

/** A request the app should not send, recorded without any value. */
export interface MockDsmUnexpected {
  api: string | null;
  method: string | null;
  version: number | null;
  account: string | null;
  kind:
    | "malformed"
    | "unknown_api"
    | "unknown_method"
    | "unsupported_version"
    | "unexpected_param"
    | "missing_param"
    | "invalid_param"
    | "unquoted_string"
    | "quoted_string";
  /** Parameter name only, for parameter kinds. */
  param: string | null;
  code: number;
}

export interface MockDsmSnapshot {
  uiConfig: MockDsmUiConfig;
  wire: MockDsmWire;
  uiConfigRequests: number;
  activeSessions: {
    account: string;
    kind: "full" | "portal" | "limited";
    sessionName: string | null;
  }[];
  logins: MockDsmLogin[];
  calls: MockDsmCall[];
  unexpected: MockDsmUnexpected[];
}

export interface MockDsmHandle extends MockDsmInfo {
  snapshot: () => Promise<MockDsmSnapshot>;
  /** Forget sessions, trusted devices and recorded traffic. */
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

interface ReadyMessage extends MockDsmInfo {
  type: "mock-dsm-ready";
}

const isMessage = (value: unknown, type: string, id?: number) =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === type &&
  (id === undefined || (value as { id?: unknown }).id === id);

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      if (child.connected) child.send("stop");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
}

function request<T>(
  child: ChildProcess,
  type: "snapshot" | "reset",
  reply: "mock-dsm-snapshot" | "mock-dsm-reset",
  id: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown) => {
      if (!isMessage(message, reply, id)) return;
      cleanup();
      resolve(message as T);
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`[mock-dsm] server exited before ${type} reply`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`[mock-dsm] no ${type} reply within 10s`));
    }, 10_000);
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.send({ type, id });
  });
}

/**
 * Fork the mock DSM server and resolve once it reports its bound port. Rejects
 * (after cleaning the child up) on a startup failure — most often a stale
 * process still holding the fixed port.
 */
export async function startMockDsm(
  options: {
    port?: number;
    host?: string;
    uiConfig?: MockDsmUiConfig;
    wire?: MockDsmWire;
    /** Base32 seed for `otp-seed`; defaults to `MOCK_DSM_TOTP_SEED` or the synthetic default. */
    totpSeed?: string;
    /** Refuse a second sign-in with a code from the same TOTP step. */
    rejectReusedStep?: boolean;
  } = {},
): Promise<MockDsmHandle> {
  const child = fork(MOCK_DSM_SERVER_PATH, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      MOCK_DSM_PORT: String(options.port ?? MOCK_DSM_PORT),
      MOCK_DSM_HOST: options.host ?? MOCK_DSM_HOST,
      MOCK_DSM_UI_CONFIG: options.uiConfig ?? "absent",
      MOCK_DSM_WIRE: options.wire ?? MOCK_DSM_WIRE,
      MOCK_DSM_TOTP_SEED:
        options.totpSeed ??
        process.env.MOCK_DSM_TOTP_SEED ??
        DEFAULT_MOCK_DSM_TOTP_SEED,
      MOCK_DSM_REJECT_REUSED_STEP:
        (options.rejectReusedStep ??
        process.env.MOCK_DSM_REJECT_REUSED_STEP === "1")
          ? "1"
          : "0",
    },
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout?.on("data", () => {
    /* drained so the pipe never blocks the fixture */
  });

  const info = await new Promise<MockDsmInfo>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[mock-dsm] server did not become ready within 20s. stderr:\n${stderr}`,
        ),
      );
    }, 20_000);
    timer.unref?.();

    child.once("message", (message) => {
      clearTimeout(timer);
      if (!isMessage(message, "mock-dsm-ready")) {
        reject(new Error("[mock-dsm] unexpected ready message"));
        return;
      }
      const { type: _type, ...rest } = message as ReadyMessage;
      resolve(rest);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`[mock-dsm] server exited early (code ${code}).\n${stderr}`),
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

  let nextId = 0;
  return {
    ...info,
    snapshot: async () =>
      (
        await request<{ snapshot: MockDsmSnapshot }>(
          child,
          "snapshot",
          "mock-dsm-snapshot",
          ++nextId,
        )
      ).snapshot,
    reset: async () => {
      await request(child, "reset", "mock-dsm-reset", ++nextId);
    },
    stop: () => stopChild(child),
  };
}
