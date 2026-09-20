import React, { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type { WebAutomationDocument } from "../../src/types/recording/webAutomation";
const mock = vi.hoisted(() => ({
  compute: vi.fn(),
  read: vi.fn(),
  verify: vi.fn(),
  owner: "db",
  accessible: true,
  lock: () => {},
  access: (_: { databaseId: string; status: string }) => {},
  current: () => {},
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
  listen: vi.fn(async (_: string, cb: () => void) => {
    mock.lock = cb;
    return () => {};
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (cb: typeof mock.access) => {
    mock.access = cb;
    return () => {};
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: mock.owner }),
      onCurrentDatabaseChange: (cb: () => void) => {
        mock.current = cb;
        return () => {};
      },
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: mock.owner,
        assertAccessible: () => {
          if (!mock.accessible) throw Error("synthetic-secret");
        },
        verifyCurrent: mock.verify,
        readCurrent: mock.read,
      }),
    }),
  },
}));
import { useWebAutoMfa } from "../../src/hooks/protocol/useWebAutoMfa";
import type { RuntimeVaultTotpController } from "../../src/hooks/security/useRuntimeVaultTotp";
import {
  captureSynologyFormLoginLease,
  createSynologyMfaCapability,
  type SynologyMfaCapability,
} from "../../src/utils/protocol/synologyFormLoginLease";
let synologyMfa: SynologyMfaCapability | undefined;
let vaultTotp: RuntimeVaultTotpController | undefined;
let conn: Connection,
  saved: Connection,
  availability: DatabaseAvailability,
  doc: WebAutomationDocument | null;
let api: ReturnType<typeof useWebAutoMfa>,
  ready: boolean,
  blocked: boolean,
  currentUrl: string;
const post = vi.fn();
const frame = { postMessage: post } as unknown as Window;
function Fixture() {
  const iframe = useRef({ contentWindow: frame } as HTMLIFrameElement);
  api = useWebAutoMfa({
    connection: conn,
    ownerDatabaseId: "db",
    availability,
    settingsReady: ready,
    blocked,
    currentUrl,
    navigationKey: `${doc?.generation}:${doc?.token}`,
    iframe,
    getDocument: () => doc,
    vaultTotp,
    synologyMfa,
  });
  return null;
}
async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<Fixture />);
  });
  return view;
}
const requests = (action: string) =>
  post.mock.calls
    .filter(([data]) => data.action === action)
    .map(([data]) => data);
async function reply(
  request: Record<string, unknown>,
  status = "ok",
  event = {},
) {
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame,
        origin: "http://127.0.0.1:41000",
        data: { ...request, type: "proxy_web_automation", status },
        ...event,
      }),
    ),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T00:00:01Z"));
  post.mockReset();
  mock.compute.mockReset().mockResolvedValue("123456");
  mock.verify.mockReset().mockResolvedValue(undefined);
  mock.owner = "db";
  mock.accessible = true;
  ready = true;
  vaultTotp = undefined;
  synologyMfa = undefined;
  blocked = false;
  currentUrl = "https://nas.example/wp-login.php";
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
describe("explicit origin-bound automatic website 2FA", () => {
  function redirectedSynology(vault = false) {
    const totpId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    saved = {
      ...conn,
      hostname: "nas.fr3.quickconnect.to",
      httpApplication: { version: 1, id: "synology-dsm", loginMode: "form" },
      basicAuthUsername: "user",
      basicAuthPassword: "password",
      httpAutoMfa: {
        ...conn.httpAutoMfa!,
        origin: "https://nas.fr3.quickconnect.to",
        challengeId: "synology-dsm-otp",
        totpConfigId: totpId,
      },
      totpConfigs: [{ ...conn.totpConfigs![0], id: totpId }],
      ...(vault
        ? {
            credentialSource: {
              kind: "vault" as const,
              credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              totpId,
            },
          }
        : {}),
    };
    currentUrl = "https://nas.de2.quickconnect.to/webman/index.cgi";
    doc = { ...doc!, url: "http://127.0.0.1:41000/webman/index.cgi" };
    const vaultApi = vault
      ? {
          scope: { databaseId: "db", generation: 1 },
          changeRevision: 1,
          list: vi.fn(async () => ({
            scope: { databaseId: "db", generation: 1 },
            revision: 1,
            receipt: "receipt",
            entries: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                name: "fixture",
                createdAt: "",
                updatedAt: "",
                availableFacets: ["totp" as const],
              },
            ],
          })),
          resolve: vi.fn(async () => ({
            totp: [
              {
                id: totpId,
                label: "DSM",
                secret: "VAULT-SEED",
                algorithm: "sha1" as const,
                digits: 6 as const,
                period: 30,
              },
            ],
          })),
          compareAndSwap: vi.fn(),
        }
      : undefined;
    const lease = captureSynologyFormLoginLease(saved, vaultApi)!;
    conn = {
      id: "redirect",
      name: "Redirect",
      protocol: "https",
      hostname: "nas.de2.quickconnect.to",
      port: 443,
      isGroup: false,
      createdAt: "",
      updatedAt: "",
    };
    let active = true;
    synologyMfa = createSynologyMfaCapability(
      {
        runtimeConnectionId: conn.id,
        proxySessionId: "proxy",
        origin: new URL(currentUrl).origin,
        proxyOrigin: "http://127.0.0.1:41000",
        assertCurrent: () => {
          if (!active) throw Error("inactive");
        },
      },
      {
        originalOrigin: saved.httpAutoMfa!.origin!,
        databaseId: "db",
        databaseGeneration: 1,
        enabled: true,
        savedConnectionId: saved.id,
        formLogin: lease,
        assertOwner: () => {
          if (mock.owner !== "db" || !mock.accessible) throw Error("revoked");
        },
        assertIdentity: () => {},
      },
      () => saved,
      () => vaultApi,
    );
    return {
      capability: synologyMfa,
      vaultApi,
      deactivate: () => {
        active = false;
      },
    };
  }
  it.each([false, true])(
    "generates original TOTP through the redeemed MFA-only capability (vault=%s)",
    async (vault) => {
      const { capability, vaultApi } = redirectedSynology(vault);
      const view = await mount();
      await reply(requests("totpProbe")[0]);
      expect(requests("totpSubmit")).toHaveLength(1);
      expect(requests("totpSubmit")[0].payload.code).toBe("123456");
      expect(mock.compute).toHaveBeenCalledWith(
        vault ? "VAULT-SEED" : "SYNTHETIC-SEED",
        "SHA1",
        6,
        30,
      );
      if (vault)
        expect(vaultApi!.resolve).toHaveBeenCalledWith(
          expect.anything(),
          saved.credentialSource!.kind === "vault"
            ? saved.credentialSource!.credentialId
            : "",
          ["totp"],
        );
      expect(mock.read).toHaveBeenCalledTimes(2);
      expect(JSON.stringify([conn, capability, post.mock.calls])).not.toMatch(
        /SYNTHETIC-SEED|VAULT-SEED/,
      );
      expect(capability.attempted()).toBe(true);
      view.unmount();
      await mount();
      expect(requests("totpProbe")).toHaveLength(1);
      expect(requests("totpSubmit")).toHaveLength(1);
    },
  );
  it.each([
    "missing",
    "revoked",
    "inactive",
    "foreign",
    "http",
    "path",
    "proxy-path",
    "proxy-session",
    "proxy-origin",
    "runtime-id",
    "consent-origin",
    "challenge",
  ])(
    "does not probe or generate for %s redirect proof/context",
    async (mode) => {
      const { capability, deactivate } = redirectedSynology();
      if (mode === "missing") synologyMfa = undefined;
      if (mode === "revoked") capability.revoke();
      if (mode === "inactive") deactivate();
      if (mode === "foreign")
        currentUrl = "https://unapproved.example/webman/index.cgi";
      if (mode === "http")
        currentUrl = "http://nas.de2.quickconnect.to/webman/index.cgi";
      if (mode === "path") {
        currentUrl = "https://nas.de2.quickconnect.to/other";
        doc!.url = "http://127.0.0.1:41000/other";
      }
      if (mode === "proxy-path") doc!.url = "http://127.0.0.1:41000/";
      if (mode === "proxy-session") doc!.sessionId = "different-proxy";
      if (mode === "proxy-origin")
        doc!.url = "http://127.0.0.1:42000/webman/index.cgi";
      if (mode === "runtime-id") conn = { ...conn, id: "other" };
      if (mode === "consent-origin")
        saved.httpAutoMfa!.origin = new URL(currentUrl).origin;
      if (mode === "challenge")
        saved.httpAutoMfa!.challengeId = "wordpress-two-factor-totp";
      await mount();
      expect(requests("totpProbe")).toHaveLength(0);
      expect(mock.compute).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "discards pending redirected OTP on permanent revocation (vault=%s)",
    async (vault) => {
      const { capability } = redirectedSynology(vault);
      let finish!: (code: string) => void;
      mock.compute.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      await mount();
      await reply(requests("totpProbe")[0]);
      expect(mock.compute).toHaveBeenCalledOnce();
      capability.revoke();
      await act(async () => finish("123456"));
      expect(requests("totpSubmit")).toHaveLength(0);
    },
  );
  it("never falls back to a preserved local seed when the owning vault refuses disclosure", async () => {
    const { vaultApi } = redirectedSynology(true);
    vaultApi!.resolve.mockRejectedValueOnce(new Error("private error"));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")).toHaveLength(0);
    expect(api.status ?? "").not.toContain("private error");
  });
  it("revokes the shared capability when persisted consent disappears", async () => {
    const { capability } = redirectedSynology();
    await mount();
    mock.read.mockResolvedValue({ connections: [] });
    await reply(requests("totpProbe")[0]);
    expect(() =>
      capability.assertCurrent({
        runtimeConnectionId: conn.id,
        currentUrl,
        document: doc!,
      }),
    ).toThrow();
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")).toHaveLength(0);
  });
  it("generates only the explicitly linked vault code after probe acknowledgement, never a preserved local seed", async () => {
    conn.credentialSource = {
      kind: "vault",
      credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      totpId: "auth",
    };
    saved = structuredClone(conn);
    const assertCurrent = vi.fn();
    vaultTotp = {
      scopeKey: "owning-vault",
      available: true,
      unavailableReason: "",
      load: vi.fn(),
      generate: vi.fn(async () => ({
        code: "87654321",
        expires: Date.now() + 30000,
        assertCurrent,
      })),
    };
    await mount();
    expect(vaultTotp.generate).not.toHaveBeenCalled();
    await reply(requests("totpProbe")[0]);
    expect(vaultTotp.generate).toHaveBeenCalledWith("auth");
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")[0].payload.code).toBe("87654321");
    expect(assertCurrent).toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).not.toContain("SYNTHETIC-SEED");
  });
  it("refuses a different vault authenticator reference and revocation during generated-code handoff", async () => {
    conn.credentialSource = {
      kind: "vault",
      credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      totpId: "other",
    };
    saved = structuredClone(conn);
    vaultTotp = {
      scopeKey: "owning-vault",
      available: true,
      unavailableReason: "",
      load: vi.fn(),
      generate: vi.fn(),
    };
    const view = await mount();
    expect(requests("totpProbe")).toHaveLength(0);
    view.unmount();
    conn.credentialSource.totpId = "auth";
    saved = structuredClone(conn);
    vaultTotp.generate = vi.fn(async () => ({
      code: "123456",
      expires: Date.now() + 30000,
      assertCurrent: () => {
        throw new Error("revoked");
      },
    }));
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(requests("totpSubmit")).toHaveLength(0);
    expect(mock.compute).not.toHaveBeenCalled();
  });
  it.each(["owner-change", "generation-failure"])(
    "does not submit or use local seeds after vault %s",
    async (reason) => {
      conn.credentialSource = {
        kind: "vault",
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        totpId: "auth",
      };
      saved = structuredClone(conn);
      vaultTotp = {
        scopeKey: "owning-vault",
        available: true,
        unavailableReason: "",
        load: vi.fn(),
        generate: vi.fn(async () => {
          if (reason === "generation-failure")
            throw new Error("VAULT_SECRET_ERROR");
          mock.owner = "other-db";
          return {
            code: "123456",
            expires: Date.now() + 30000,
            assertCurrent: () => {},
          };
        }),
      };
      await mount();
      await reply(requests("totpProbe")[0]);
      expect(requests("totpSubmit")).toHaveLength(0);
      expect(mock.compute).not.toHaveBeenCalled();
      expect(api.status).not.toContain("VAULT_SECRET_ERROR");
    },
  );
  it("waits for native lock observation before probing the page", async () => {
    let registered!: (unlisten: () => void) => void;
    vi.mocked(listen).mockImplementationOnce(
      () => new Promise((resolve) => (registered = resolve)),
    );
    await mount();
    expect(requests("totpProbe")).toHaveLength(0);
    expect(mock.compute).not.toHaveBeenCalled();
    await act(async () => registered(() => {}));
    expect(requests("totpProbe")).toHaveLength(1);
  });
  it("refuses automation when native lock observation cannot be installed", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("synthetic-secret"));
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(35000));
    expect(requests("totpProbe")).toHaveLength(0);
    expect(mock.compute).not.toHaveBeenCalled();
    expect(api.canRetry).toBe(false);
    expect(api.status).not.toContain("synthetic-secret");
  });
  it("waits for an asynchronous SPA challenge, then sends only the transient code once", async () => {
    await mount();
    expect(mock.compute).not.toHaveBeenCalled();
    await reply(requests("totpProbe")[0], "failed");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await reply(requests("totpProbe")[1]);
    expect(mock.compute).toHaveBeenCalledOnce();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(requests("totpSubmit")).toHaveLength(1);
    expect(requests("totpSubmit")[0].payload.code).toBe("123456");
    expect(JSON.stringify(post.mock.calls)).not.toContain("SYNTHETIC-SEED");
    await reply(requests("totpSubmit")[0]);
    act(() => api.retry());
    await act(async () => vi.advanceTimersByTimeAsync(35000));
    expect(requests("totpSubmit")).toHaveLength(1);
    expect(api.canRetry).toBe(false);
  });
  it("ignores unsolicited and forged probe replies", async () => {
    await mount();
    const probe = requests("totpProbe")[0];
    await reply({ ...probe, requestId: "f".repeat(32) });
    await reply(probe, "ok", { origin: "https://attacker.example" });
    await reply(probe, "ok", { source: window });
    await reply({ ...probe, documentToken: "e".repeat(32) });
    expect(mock.compute).not.toHaveBeenCalled();
  });
  it("does not repeat across document navigation but permits a new proxy session", async () => {
    const view = await mount();
    await reply(requests("totpProbe")[0]);
    await reply(requests("totpSubmit")[0]);
    doc = { ...doc!, generation: 2, token: "e".repeat(32) };
    view.rerender(<Fixture />);
    expect(requests("totpProbe")).toHaveLength(1);
    doc = {
      ...doc,
      generation: 3,
      sessionId: "new-proxy",
      token: "f".repeat(32),
    };
    view.rerender(<Fixture />);
    await reply(requests("totpProbe")[1]);
    expect(requests("totpSubmit")).toHaveLength(2);
  });
  it("offers an explicit pre-submission retry after the bounded observation window", async () => {
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    // Missing agent acknowledgement expires without any code computation.
    expect(api.canRetry).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(api.canRetry).toBe(true);
    expect(mock.compute).not.toHaveBeenCalled();
    const previous = requests("totpProbe").length;
    act(() => api.retry());
    expect(requests("totpProbe")).toHaveLength(previous + 1);
  });
  it.each([
    "lock",
    "navigation",
    "settings",
    "profile",
    "stored-consent",
    "expiry",
  ])("discards computed codes after %s changes", async (change) => {
    let finish!: (code: string) => void;
    mock.compute.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mount();
    await reply(requests("totpProbe")[0]);
    expect(mock.compute).toHaveBeenCalledOnce();
    if (change === "lock") act(() => mock.lock());
    if (change === "navigation")
      doc = { ...doc!, generation: 2, token: "e".repeat(32) };
    if (change === "settings") ready = false;
    if (change === "profile")
      conn = {
        ...conn,
        httpApplication: { version: 1, id: "custom", loginMode: "manual" },
      };
    if (change === "stored-consent") saved.httpAutoMfa!.enabled = false;
    if (change === "expiry") vi.setSystemTime(new Date("2026-09-10T00:00:31Z"));
    if (["navigation", "settings", "profile"].includes(change))
      view.rerender(<Fixture />);
    await act(async () => finish("123456"));
    expect(requests("totpSubmit")).toHaveLength(0);
    expect(api.status ?? "").not.toMatch(/SYNTHETIC|123456/);
  });
  it("does not authorize optimistic unsaved consent", async () => {
    saved.httpAutoMfa!.enabled = false;
    await mount();
    await reply(requests("totpProbe")[0]);
    expect(mock.compute).not.toHaveBeenCalled();
    expect(requests("totpSubmit")).toHaveLength(0);
  });
  it.each([
    "http",
    "foreign",
    "duplicate",
    "disabled",
    "blocked",
    "unknown-profile",
  ])("fails closed for %s", async (mode) => {
    if (mode === "http") conn.protocol = "http";
    if (mode === "foreign") currentUrl = "https://another.example/wp-login.php";
    if (mode === "duplicate")
      conn.totpConfigs!.push({ ...conn.totpConfigs![0] });
    if (mode === "disabled") conn.httpAutoMfa!.enabled = false;
    if (mode === "blocked") blocked = true;
    if (mode === "unknown-profile") conn.httpApplication!.id = "custom";
    await mount();
    await act(async () => {});
    expect(requests("totpProbe")).toHaveLength(0);
    expect(mock.compute).not.toHaveBeenCalled();
  });
});
