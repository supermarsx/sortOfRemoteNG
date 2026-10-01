import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import { clearRuntimeConnectionsForTests } from "../../src/utils/session/runtimeConnectionRegistry";
import { normalizeWebsiteDarkModeSettings } from "../../src/utils/connection/websiteDarkMode";
import claudeRoutes from "../../src/utils/protocol/claudeHostedRoutes.json";

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  connections: [] as Connection[],
  vault: undefined as DatabaseCredentialVaultApi | undefined,
  locked: false,
  availability: {
    status: "ready",
    databaseId: "cloudflare-owner",
    generation: 1,
  },
  settings: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => fixture.invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => fixture.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: fixture.connections, sessions: [] },
    dispatch: fixture.dispatch,
    dispatchAndFlush: fixture.dispatch,
    credentialVault: fixture.vault,
    databaseAvailability: fixture.availability,
    recycleBin: {
      snapshot: { scope: { databaseId: "cloudflare-owner", generation: 1 } },
    },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => ({
  ...(await original<typeof import("../../src/contexts/SettingsContext")>()),
  useSettings: () => ({ settings: fixture.settings, settingsReady: true }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => undefined,
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const assertAccessible = () => {
    if (fixture.locked) throw new Error("locked");
  };
  const manager = {
    getCurrentDatabase: () => ({ id: "cloudflare-owner" }),
    onCurrentDatabaseChange: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "cloudflare-owner",
      assertAccessible,
      verifyCurrent: async () => assertAccessible(),
      readCurrent: async () => ({ connections: fixture.connections }),
    }),
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onCurrentDatabaseChange: () => () => {},
    onDatabaseAccessChange: () => () => {},
  };
});
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: vi.fn(async () => ({ status: "trusted" })),
  trustIdentity: vi.fn(),
}));
import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";

const session: ConnectionSession = {
  id: "cloudflare-session",
  connectionId: "cloudflare-connection",
  ownerDatabaseId: "cloudflare-owner",
  name: "Cloudflare",
  hostname: "dash.cloudflare.com",
  protocol: "https",
  status: "connected",
  startTime: new Date(),
};
const proxy = {
  session_id: "cloudflare-proxy",
  local_port: 43081,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43081/",
};
beforeEach(() => {
  clearRuntimeConnectionsForTests();
  fixture.locked = false;
  fixture.vault = undefined;
  fixture.dispatch.mockReset();
  fixture.connections = [
    {
      id: session.connectionId,
      name: session.name,
      hostname: session.hostname,
      protocol: "https",
      port: 443,
      isGroup: false,
      createdAt: "2026-09-29",
      updatedAt: "2026-09-29",
      username: "local@example.test",
      password: "local-password",
      httpApplication: { version: 1, id: "cloudflare", loginMode: "form" },
    },
  ];
  fixture.settings = {
    websiteDarkMode: normalizeWebsiteDarkModeSettings(undefined),
    proxyKeepaliveEnabled: false,
    webRecording: { autoRecordWebSessions: false },
    sessionQuickActions: { httpEnabled: true, sshEnabled: true },
    macros: { confirmBeforeReplay: true },
  };
  fixture.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "get_tls_certificate_info")
      return {
        fingerprint: "AA:BB:CC",
        subject: null,
        issuer: null,
        san: [],
        chain: [],
      };
    if (command === "start_basic_auth_proxy") return proxy;
    if (
      ["stop_basic_auth_proxy", "update_proxy_website_dark_mode"].includes(
        command,
      )
    )
      return;
    if (command === "web_network_guard_status")
      return {
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: false,
      };
    if (command === "activate_proxy_network_document") return true;
    if (command === "read_macro_library")
      return JSON.stringify({ version: 1, scripts: [], macros: [] });
    throw new Error(`Unexpected native command ${command}`);
  });
});
afterEach(() => {
  cleanup();
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
});
const starts = () =>
  fixture.invoke.mock.calls.filter(
    ([command]) => command === "start_basic_auth_proxy",
  );
function BrowserHarness() {
  const activeSession = React.useMemo(
    () => ({ ...session, hostname: fixture.connections[0].hostname }),
    [],
  );
  const browser = useWebBrowser(activeSession);
  return (
    <>
      <output>{JSON.stringify(browser.navigationFailure)}</output>
      {browser.shouldMountIframe && (
        <iframe title="Cloudflare" ref={browser.attachIframe} />
      )}
    </>
  );
}
function ViewerHarness() {
  const viewer = useHTTPViewer(session);
  return viewer.proxyUrl ? (
    <iframe
      title="Legacy Cloudflare"
      ref={viewer.iframeRef}
      src={viewer.proxyUrl}
    />
  ) : null;
}
function configureVault() {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  fixture.connections[0].credentialSource = { kind: "vault", credentialId: id };
  fixture.connections[0].basicAuthUsername = "stale-basic-user";
  fixture.connections[0].basicAuthPassword = "stale-basic-password";
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "cloudflare-owner", generation: 1 },
    changeRevision: 1,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { databaseId: "cloudflare-owner", generation: 1 },
      revision: 1,
      receipt: "review",
      entries: [
        {
          id,
          name: "Cloudflare login",
          createdAt: "2026-09-29",
          updatedAt: "2026-09-29",
          availableFacets: ["username", "password"],
        },
      ],
    })),
    resolve: vi.fn(async () => ({
      username: "vault@example.test",
      password: "vault-password",
    })),
    compareAndSwap: vi.fn(),
  };
  fixture.vault = api;
  return api;
}

// Reuse the real viewer/vault owner harness to exercise the passwordless caller
// boundary as well as the normal Cloudflare password path below.
describe.each(["browser", "viewer"] as const)(
  "Claude %s vault startup",
  (runtime) => {
    it.each(["manual", "form"] as const)(
      "%s never reads or forwards the password facet",
      async (loginMode) => {
        fixture.connections[0].hostname = "claude.ai";
        fixture.connections[0].httpApplication = {
          version: 1,
          id: "claude",
          loginMode,
        };
        const originalInvoke = fixture.invoke.getMockImplementation()!;
        fixture.invoke.mockImplementation(async (command, ...args) => {
          if (command === "start_basic_auth_proxy")
            return {
              ...proxy,
              google_routes: [
                {
                  upstreamOrigin: claudeRoutes.profiles.claude,
                  proxyOrigin: new URL(proxy.proxy_url).origin,
                  documents: true,
                },
                ...claudeRoutes.loginOrigins.map((upstreamOrigin, index) => ({
                  upstreamOrigin,
                  proxyOrigin: `http://p${(index + 10).toString(16).padStart(32, "0")}.localhost:43081`,
                  documents: true,
                })),
              ],
            };
          return originalInvoke(command, ...args);
        });
        const api = configureVault();
        const passwordRead = vi.fn(() => {
          throw new Error("Claude read a password facet");
        });
        vi.mocked(api.resolve).mockImplementation(
          async (_snapshot, _id, requested) => {
            expect(requested).toEqual(["username"]);
            return {
              username: "email@example.test",
              get password(): string {
                return passwordRead();
              },
            };
          },
        );
        if (runtime === "browser") render(<BrowserHarness />);
        else {
          const viewer = renderHook(() =>
            useHTTPViewer({ ...session, hostname: "claude.ai" }),
          );
          await waitFor(() => {
            expect(viewer.result.current.status).toBe("connected");
            expect(viewer.result.current.error).toBe("");
            const url = new URL(viewer.result.current.proxyUrl);
            expect(url.origin).toBe(new URL(proxy.proxy_url).origin);
            expect(viewer.result.current.buildTargetUrl()).toBe(
              "https://claude.ai/login",
            );
            expect(url.pathname).toBe("/login");
            expect(url.search).toBe("");
            expect(viewer.result.current.proxySessionId).toBe(proxy.session_id);
          });
        }
        if (runtime === "browser") {
          await waitFor(() => {
            const frame = screen.getByTitle("Cloudflare") as HTMLIFrameElement;
            const url = new URL(frame.src);
            expect(url.origin).toBe(new URL(proxy.proxy_url).origin);
            expect(url.pathname).toBe("/login");
            expect([...url.searchParams.keys()]).toEqual([
              "__sorng_navigation_v1",
            ]);
            expect(url.searchParams.get("__sorng_navigation_v1")).toMatch(
              /^[0-9a-f]{32}$/,
            );
            expect(screen.getByRole("status")).toHaveTextContent("null");
          });
        }
        await waitFor(() => expect(starts()).toHaveLength(1));
        expect(starts()[0][1].config).toMatchObject({
          username: loginMode === "form" ? "email@example.test" : "",
          password: "",
          http_auto_login: loginMode === "form",
          upstream_auth_mode: loginMode === "form" ? "claude-form" : "none",
        });
        expect(passwordRead).not.toHaveBeenCalled();
        if (loginMode === "manual") expect(api.resolve).not.toHaveBeenCalled();
        else expect(api.resolve).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(starts())).not.toContain("stale-basic-password");
        expect(JSON.stringify(starts())).not.toContain("local-password");
      },
    );
  },
);
describe.each(["browser", "viewer"] as const)(
  "Cloudflare %s runtime",
  (runtime) => {
    const nativeFormTarget =
      runtime === "browser"
        ? "https://dash.cloudflare.com/"
        : "https://dash.cloudflare.com/login";
    async function expectBrowserPath(path: string) {
      if (runtime !== "browser") return;
      await waitFor(() => {
        const frame = screen.getByTitle("Cloudflare") as HTMLIFrameElement;
        const url = new URL(frame.src);
        expect(url.origin).toBe(new URL(proxy.proxy_url).origin);
        expect(url.pathname).toBe(path);
      });
    }
    function mount() {
      return runtime === "browser"
        ? render(<BrowserHarness />)
        : renderHook(() => useHTTPViewer(session));
    }
    it("starts local form login at /login with the reviewed marker and closed upstream mode", async () => {
      mount();
      await waitFor(() => expect(starts()).toHaveLength(1));
      expect(starts()[0][1].config).toMatchObject({
        target_url: nativeFormTarget,
        reviewed_application_profile: "cloudflare",
        upstream_auth_mode: "cloudflare-form",
        http_auto_login: true,
        username: "local@example.test",
        password: "local-password",
      });
      await expectBrowserPath("/login");
    });
    it("keeps manual mode at the root without credentials or vault resolution", async () => {
      const api = configureVault();
      fixture.connections[0].httpApplication!.loginMode = "manual";
      mount();
      await waitFor(() => expect(starts()).toHaveLength(1));
      const config = starts()[0][1].config;
      expect(new URL(config.target_url).href).toBe(
        "https://dash.cloudflare.com/",
      );
      expect(config).toMatchObject({
        reviewed_application_profile: "cloudflare",
        upstream_auth_mode: "none",
        http_auto_login: false,
        username: "",
        password: "",
      });
      expect(api.resolve).not.toHaveBeenCalled();
      await expectBrowserPath("/");
    });
    it("uses vault credentials only for the native attempt without reviving local credentials", async () => {
      const api = configureVault();
      mount();
      await waitFor(() => expect(starts()).toHaveLength(1));
      expect(api.resolve).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        ["username", "password"],
      );
      expect(starts()[0][1].config).toMatchObject({
        target_url: nativeFormTarget,
        reviewed_application_profile: "cloudflare",
        upstream_auth_mode: "cloudflare-form",
        username: "vault@example.test",
        password: "vault-password",
      });
      expect(JSON.stringify(fixture.dispatch.mock.calls)).not.toContain(
        "vault-password",
      );
      expect(fixture.connections[0].password).toBe("local-password");
      await expectBrowserPath("/login");
    });
    it.each(["basic", "digest"] as const)(
      "refuses imported %s before native startup",
      async (loginMode) => {
        fixture.connections[0].httpApplication!.loginMode = loginMode;
        mount();
        await act(async () => {});
        expect(starts()).toHaveLength(0);
      },
    );
    it.each(["other.example.test", "dash.cloudflare.com.evil.test"])(
      "rejects the off-origin host %s before native startup",
      async (hostname) => {
        fixture.connections[0].hostname = hostname;
        mount();
        await act(async () => {});
        expect(starts()).toHaveLength(0);
      },
    );
  },
);

it.each(["browser", "viewer"] as const)(
  "does not start a Cloudflare %s attempt after vault access is revoked",
  async (runtime) => {
    const api = configureVault();
    let resolve!: (value: { username: string; password: string }) => void;
    vi.mocked(api.resolve).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    if (runtime === "browser") render(<BrowserHarness />);
    else renderHook(() => useHTTPViewer(session));
    await waitFor(() => expect(api.resolve).toHaveBeenCalled());
    fixture.locked = true;
    await act(async () =>
      resolve({ username: "vault@example.test", password: "vault-password" }),
    );
    expect(starts()).toHaveLength(0);
    expect(JSON.stringify(fixture.dispatch.mock.calls)).not.toContain(
      "vault-password",
    );
  },
);

describe("Cloudflare HTTPViewer protected-document activation", () => {
  const activations = () =>
    fixture.invoke.mock.calls.filter(
      ([command]) => command === "activate_proxy_network_document",
    );
  async function mountedFrame() {
    render(<ViewerHarness />);
    const frame = (await screen.findByTitle(
      "Legacy Cloudflare",
    )) as HTMLIFrameElement;
    await waitFor(() =>
      expect(new URL(frame.src).origin).toBe(new URL(proxy.proxy_url).origin),
    );
    expect(new URL(frame.src).pathname).toBe("/login");
    return frame;
  }
  async function emit(
    frame: HTMLIFrameElement,
    patch: Record<string, unknown> = {},
    eventPatch: MessageEventInit = {},
  ) {
    const url = new URL(frame.src);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: url.origin,
          data: {
            type: "proxy_document_start",
            version: 1,
            sessionId: proxy.session_id,
            documentToken: "d".repeat(32),
            documentSequence: 1,
            url: frame.src,
            navigationToken: url.searchParams.get("__sorng_navigation_v1"),
            ...patch,
          },
          ...eventPatch,
        }),
      );
    });
  }
  it("activates a valid document from the attached protected iframe", async () => {
    const frame = await mountedFrame();
    await emit(frame);
    expect(activations()).toEqual([
      [
        "activate_proxy_network_document",
        {
          sessionId: proxy.session_id,
          documentSequence: 1,
        },
      ],
    ]);
  });
  it.each([
    "foreign-frame",
    "foreign-origin",
    "foreign-session",
    "invalid-token",
    "invalid-sequence",
  ])(
    "rejects %s without consuming the valid document sequence",
    async (kind) => {
      const frame = await mountedFrame();
      const patch =
        kind === "foreign-session"
          ? { sessionId: "foreign-proxy" }
          : kind === "invalid-token"
            ? { documentToken: "invalid" }
            : kind === "invalid-sequence"
              ? { documentSequence: 0 }
              : {};
      const eventPatch =
        kind === "foreign-frame"
          ? { source: window }
          : kind === "foreign-origin"
            ? { origin: "https://foreign.example.test" }
            : {};
      await emit(frame, patch, eventPatch);
      expect(activations()).toHaveLength(0);
      await emit(frame);
      expect(activations()).toHaveLength(1);
    },
  );
  it("rejects duplicate and stale sequences after a newer document activates", async () => {
    const frame = await mountedFrame();
    await emit(frame, { documentSequence: 2 });
    expect(activations()).toHaveLength(1);
    await emit(frame, { documentSequence: 2 });
    await emit(frame, { documentSequence: 1, documentToken: "e".repeat(32) });
    expect(activations()).toHaveLength(1);
    await emit(frame, { documentSequence: 3, documentToken: "f".repeat(32) });
    expect(activations()).toHaveLength(2);
  });
  it("does not stop a newer active document when an older activation returns false", async () => {
    const frame = await mountedFrame();
    let finishOld!: (accepted: boolean) => void;
    fixture.invoke.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishOld = resolve;
        }),
    );
    await emit(frame);
    await emit(frame, { documentSequence: 2, documentToken: "e".repeat(32) });
    expect(activations()).toHaveLength(2);
    await act(async () => finishOld(false));
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_basic_auth_proxy",
      ),
    ).toHaveLength(0);
    await emit(frame, { documentSequence: 3, documentToken: "f".repeat(32) });
    expect(activations()).toHaveLength(3);
  });
  it("stops the proxy when the current document activation is rejected", async () => {
    const frame = await mountedFrame();
    fixture.invoke.mockResolvedValueOnce(false);
    await emit(frame);
    expect(fixture.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: proxy.session_id,
    });
  });
});
