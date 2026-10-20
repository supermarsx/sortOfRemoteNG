/**
 * What an AUTOMATIC one-time-code caller does when less than 3 s of the
 * current time step is left (the rule a copied or typed code follows,
 * `TOTP_MIN_REMAINING_MS` in `src/utils/security/totpCode.ts`).
 *
 * - Connection-local seed (`useWebAutoMfa.ts`, local branch): it WAITS for
 *   the next step, once, then submits a fresh code.
 * - Vault-linked seed (`useWebAutoMfa.ts` -> `useRuntimeVaultTotp.generate`
 *   -> `generateTotpCode` with its default 3 s margin): it does NOT wait. The
 *   attempt stops with the generic "Automatic 2FA stopped" status and offers
 *   Retry; nothing is retried by itself.
 * - Synology (redirected DSM sign-in, local or vault seed) waits; that is
 *   pinned in `useWebAutoMfa.test.tsx` ("waits for a fresh redirected TOTP
 *   period") and `tests/synology/synologyAuthenticator.test.ts`.
 *
 * Fixture values only; no clipboard, network or real seed is involved.
 */
import React, { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type { WebAutomationDocument } from "../../src/types/recording/webAutomation";
const mock = vi.hoisted(() => ({
  compute: vi.fn(),
  read: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../../src/hooks/totp/useTOTP", () => ({
  totpApi: { computeCode: mock.compute },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (
    _command: string,
    args: { secret: string; algorithm: string; digits: number; period: number },
  ) => mock.compute(args.secret, args.algorithm, args.digits, args.period),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: () => () => {},
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db" }),
      onCurrentDatabaseChange: () => () => {},
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "db",
        assertAccessible: () => {},
        verifyCurrent: mock.verify,
        readCurrent: mock.read,
      }),
    }),
  },
}));
import { useWebAutoMfa } from "../../src/hooks/protocol/useWebAutoMfa";
import type { RuntimeVaultTotpController } from "../../src/hooks/security/useRuntimeVaultTotp";
import { generateTotpCode } from "../../src/utils/security/totpCode";

const failure =
  "Automatic 2FA stopped. Use Credentials & 2FA manually or review the saved Authentication settings.";
const at = (iso: string) => new Date(`2026-09-10T${iso}Z`).getTime();

let vaultTotp: RuntimeVaultTotpController | undefined;
let conn: Connection, saved: Connection, availability: DatabaseAvailability;
let doc: WebAutomationDocument;
let api: ReturnType<typeof useWebAutoMfa>;
const post = vi.fn();
const frame = { postMessage: post } as unknown as Window;
function Fixture() {
  const iframe = useRef({ contentWindow: frame } as HTMLIFrameElement);
  api = useWebAutoMfa({
    connection: conn,
    ownerDatabaseId: "db",
    availability,
    settingsReady: true,
    blocked: false,
    currentUrl:
      conn.hostname === "dash.cloudflare.com"
        ? "https://dash.cloudflare.com/login"
        : "https://nas.example/wp-login.php",
    navigationKey: `${doc.generation}:${doc.token}:0`,
    iframe,
    getDocument: () => doc,
    vaultTotp,
  });
  return null;
}
const mount = () =>
  act(async () => {
    render(<Fixture />);
  });
const requests = (action: string) =>
  post.mock.calls
    .filter(([data]) => data.action === action)
    .map(([data]) => data);
const reply = (request: Record<string, unknown>) =>
  act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame,
        origin: new URL(doc.url).origin,
        data: { ...request, type: "proxy_web_automation", status: "ok" },
      }),
    ),
  );
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  post.mockReset();
  mock.compute.mockReset().mockResolvedValue("123456");
  mock.verify.mockReset().mockResolvedValue(undefined);
  vaultTotp = undefined;
  availability = { status: "ready", databaseId: "db", generation: 1 };
  doc = {
    generation: 1,
    sessionId: "proxy",
    token: "d".repeat(32),
    sequence: 1,
    navigationToken: null,
    url: "http://127.0.0.1:41000/wp-login.php",
  };
  conn = {
    id: "web",
    name: "Fixture",
    protocol: "https",
    hostname: "nas.example",
    port: 443,
    isGroup: false,
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
    httpApplication: { version: 1, id: "wordpress", loginMode: "manual" },
    httpAutoMfa: {
      version: 1,
      enabled: true,
      origin: "https://nas.example",
      challengeId: "wordpress-two-factor-totp",
      totpConfigId: "auth",
    },
    totpConfigs: [
      {
        id: "auth",
        secret: "SYNTHETIC-SEED",
        issuer: "Fixture",
        account: "Demo",
        algorithm: "sha1",
        digits: 6,
        period: 30,
      },
    ],
  };
  saved = structuredClone(conn);
  mock.read
    .mockReset()
    .mockImplementation(async () => ({ connections: [saved] }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("automatic 2FA with a connection-local seed", () => {
  it("waits for the next time step when under 3 s are left, then submits one fresh code", async () => {
    vi.setSystemTime(at("00:00:28.500"));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(mock.compute).not.toHaveBeenCalled();
    // The wait is the rest of the step plus 25 ms: 1525 ms here.
    await advance(1500);
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")).toHaveLength(0);
    await advance(100);
    expect(mock.compute).toHaveBeenCalledOnce();
    await reply(requests("totpProbe")[1]);
    expect(requests("totpSubmit")).toHaveLength(1);
    expect(requests("totpSubmit")[0].payload).toMatchObject({
      code: "123456",
      expires: at("00:01:00"),
    });
    expect(api.status).not.toBe(failure);
  });

  it("does not wait when exactly 3 s are left", async () => {
    vi.setSystemTime(at("00:00:27"));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(mock.compute).toHaveBeenCalledOnce();
    await reply(requests("totpProbe")[1]);
    expect(requests("totpSubmit")[0].payload).toMatchObject({
      code: "123456",
      expires: at("00:00:30"),
    });
  });
});

describe("automatic 2FA with a vault-linked seed", () => {
  beforeEach(() => {
    conn.hostname = "dash.cloudflare.com";
    conn.httpApplication = { version: 1, id: "cloudflare", loginMode: "form" };
    conn.httpAutoMfa!.origin = "https://dash.cloudflare.com";
    conn.httpAutoMfa!.challengeId = "cloudflare-totp";
    conn.credentialSource = {
      kind: "vault",
      credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      totpId: "auth",
    };
    doc.url = "http://127.0.0.1:41000/login";
    saved = structuredClone(conn);
    // As `useRuntimeVaultTotp.generate` does (useRuntimeVaultTotp.ts:105):
    // the shared generator with its default 3 s margin, no wait.
    vaultTotp = {
      scopeKey: "owning-vault",
      available: true,
      unavailableReason: "",
      load: vi.fn(),
      generate: vi.fn(() =>
        generateTotpCode({
          secret: "VAULT-SEED",
          algorithm: "sha1",
          digits: 6,
          period: 30,
        }),
      ),
    };
  });

  it("stops instead of waiting when under 3 s are left, and offers Retry", async () => {
    vi.setSystemTime(at("00:00:28.500"));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(vaultTotp!.generate).toHaveBeenCalledOnce();
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")).toHaveLength(0);
    expect(api.status).toBe(failure);
    expect(api.canRetry).toBe(true);
    // Nothing happens by itself, not even after the next step begins.
    const probes = requests("totpProbe").length;
    await advance(35_000);
    expect(vaultTotp!.generate).toHaveBeenCalledOnce();
    expect(requests("totpProbe")).toHaveLength(probes);
    expect(requests("totpSubmit")).toHaveLength(0);
  });

  it("submits a fresh code when the user presses Retry in a new time step", async () => {
    vi.setSystemTime(at("00:00:28.500"));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(api.canRetry).toBe(true);
    await advance(2_000);
    act(() => api.retry());
    const probes = requests("totpProbe");
    await reply(probes[probes.length - 1]);
    expect(vaultTotp!.generate).toHaveBeenCalledTimes(2);
    expect(mock.compute).toHaveBeenCalledOnce();
    const again = requests("totpProbe");
    await reply(again[again.length - 1]);
    expect(requests("totpSubmit")).toHaveLength(1);
    expect(requests("totpSubmit")[0].payload).toMatchObject({
      code: "123456",
      expires: at("00:01:00"),
    });
    expect(JSON.stringify(post.mock.calls)).not.toMatch(
      /VAULT-SEED|SYNTHETIC-SEED/,
    );
  });
});
