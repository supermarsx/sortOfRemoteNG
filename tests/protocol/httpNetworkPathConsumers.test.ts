import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { certificateInfoFixture } from "../fixtures/certificateInspection";
import { RuntimeNetworkPathError } from "../../src/utils/network/networkPathError";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  resolve: vi.fn(),
  assertRoute: vi.fn(),
  verify: vi.fn(),
  dispatch: vi.fn(),
  connection: {} as Connection,
  global: undefined as string | undefined,
  redirectOptions: undefined as
    { route?: string; currentRoute: () => string | undefined } | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    mocks.invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [mocks.connection], sessions: [] },
    dispatch: mocks.dispatch,
    databaseAvailability: {
      status: "ready",
      databaseId: "owner",
      generation: 1,
    },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { httpsTrustPolicy: "tofu", httpsCaTrustMode: "system" },
    settingsReady: false,
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => () => {},
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => mocks.global,
}));
vi.mock("../../src/utils/network/resolveRuntimeNetworkPath", () => ({
  resolveRuntimeNetworkPath: mocks.resolve,
}));
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: mocks.verify,
}));
vi.mock("../../src/hooks/protocol/useHttpRedirectReview", () => ({
  useHttpRedirectReview: (options: typeof mocks.redirectOptions) => {
    mocks.redirectOptions = options;
    return {
      offer: vi.fn(),
      invalidate: vi.fn(),
      cancel: vi.fn(),
      abort: vi.fn(),
    };
  },
}));

import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";

const upstream = "http://proxy-user:proxy-secret@proxy.test:8080/";
const session: ConnectionSession = {
  id: "web",
  connectionId: "target",
  name: "Site",
  protocol: "https",
  hostname: "dashboard.example.test",
  status: "connected",
  startTime: new Date(),
  ownerDatabaseId: "owner",
};
const response = {
  session_id: "proxy",
  local_port: 9000,
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:9000/",
};
const starts = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === "start_basic_auth_proxy",
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.global = undefined;
  mocks.connection = {
    id: "target",
    name: "Site",
    protocol: "https",
    hostname: session.hostname,
    port: 443,
    proxyProfileId: "upstream",
  } as Connection;
  mocks.assertRoute.mockReset();
  mocks.resolve.mockReset().mockImplementation(async () => ({
    httpUpstreamProxyUrl: upstream,
    assertCurrent: mocks.assertRoute,
    redactionSecrets: ["proxy-user", "proxy-secret"],
  }));
  mocks.verify.mockResolvedValue({ status: "trusted" });
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "web_network_guard_status")
      return {
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: false,
      };
    if (command === "get_tls_certificate_info") return certificateInfoFixture;
    if (command === "start_basic_auth_proxy") return response;
    if (command === "diagnose_http_connection") return { status: "ok" };
    return undefined;
  });
});
afterEach(cleanup);

describe("HTTP path consumers", () => {
  it("reloads a same-ID edited profile by stopping the old listener before TLS and startup", async () => {
    let endpoint = upstream;
    mocks.resolve.mockImplementation(async () => {
      const captured = endpoint;
      return {
        httpUpstreamProxyUrl: captured,
        redactionSecrets: [],
        assertCurrent: () => {
          if (endpoint !== captured) throw new Error("catalog changed");
        },
      };
    });
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(starts()).toHaveLength(1));
    const beforeReload = mocks.invoke.mock.calls.length;
    endpoint = "https://new-proxy.test:8443/";
    act(() => hook.result.current.handleRefresh());
    await waitFor(() => expect(starts()).toHaveLength(2));
    const calls = mocks.invoke.mock.calls.slice(beforeReload);
    const stopIndex = calls.findIndex(
      ([command]) => command === "stop_basic_auth_proxy",
    );
    const tlsIndex = calls.findIndex(
      ([command]) => command === "get_tls_certificate_info",
    );
    const startIndex = calls.findIndex(
      ([command]) => command === "start_basic_auth_proxy",
    );
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(tlsIndex).toBeGreaterThan(stopIndex);
    expect(startIndex).toBeGreaterThan(tlsIndex);
    expect(calls[tlsIndex][1].proxyUrl).toBe(endpoint);
    expect(calls[startIndex][1].config.upstream_proxy_url).toBe(endpoint);
    expect(mocks.redirectOptions?.currentRoute()).toBe(endpoint);
  });
  it("reuses the native listener on ordinary unchanged-route reload", async () => {
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(starts()).toHaveLength(1));
    mocks.invoke.mockClear();
    act(() => hook.result.current.handleRefresh());
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "get_tls_certificate_info",
        expect.objectContaining({ proxyUrl: upstream }),
      ),
    );
    expect(starts()).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "stop_basic_auth_proxy",
      expect.anything(),
    );
  });
  it("does not open a new route until stale listener teardown is confirmed", async () => {
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(starts()).toHaveLength(1));
    mocks.global = "http://changed.test:8080";
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      async (command: string, ...args: unknown[]) => {
        if (command === "stop_basic_auth_proxy") throw new Error("stop failed");
        return invoke(command, ...args);
      },
    );
    act(() => hook.result.current.handleRefresh());
    await waitFor(() =>
      expect(hook.result.current.loadError).toContain("could not be stopped"),
    );
    expect(starts()).toHaveLength(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    mocks.global = undefined;
    mocks.invoke.mockImplementation(invoke);
    act(() => hook.result.current.handleRefresh());
    await waitFor(() => expect(starts()).toHaveLength(2));
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "stop_basic_auth_proxy",
      ),
    ).toHaveLength(2);
  });
  it("uses one resolved upstream for TLS, startup, redirects and diagnostics", async () => {
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(starts()).toHaveLength(1));
    expect(mocks.resolve).toHaveBeenCalledWith(
      mocks.connection,
      [mocks.connection],
      "http",
      expect.any(Function),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "get_tls_certificate_info",
      expect.objectContaining({ proxyUrl: upstream }),
    );
    expect(starts()[0][1].config.upstream_proxy_url).toBe(upstream);
    expect(mocks.redirectOptions?.route).toBe(upstream);
    expect(mocks.redirectOptions?.currentRoute()).toBe(upstream);
    act(() => {
      void hook.result.current.runDeepDiagnostics();
    });
    await waitFor(() =>
      expect(hook.result.current.diagnosticReport).toEqual({ status: "ok" }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "diagnose_http_connection",
      expect.objectContaining({ proxyUrl: upstream }),
    );
    expect(mocks.assertRoute).toHaveBeenCalled();
    mocks.assertRoute.mockImplementation(() => {
      throw new Error("profile deleted");
    });
    expect(() => mocks.redirectOptions?.currentRoute()).toThrow(
      "profile deleted",
    );
    mocks.invoke.mockClear();
    // The invalid route rejects synchronously, before any IPC/async work.
    act(() => {
      void hook.result.current.runDeepDiagnostics();
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "diagnose_http_connection",
      expect.anything(),
    );
  });
  it("blocks TLS and startup on a distinct enabled global proxy", async () => {
    mocks.global = "https://global.test:8443";
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() =>
      expect(hook.result.current.loadError).toContain("cannot chain"),
    );
    expect(starts()).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "get_tls_certificate_info",
      expect.anything(),
    );
  });
  it("rechecks the route after TLS and before startup", async () => {
    mocks.verify.mockImplementationOnce(async () => {
      mocks.global = "http://changed.test:8080";
      return { status: "trusted" };
    });
    const hook = renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(hook.result.current.loadError).toBeTruthy());
    expect(starts()).toHaveLength(0);
  });
  it("leaves direct/global-only startup free of catalog resolution", async () => {
    delete mocks.connection.proxyProfileId;
    mocks.global = "http://global.test:8080";
    renderHook(() => useWebBrowser(session));
    await waitFor(() => expect(starts()).toHaveLength(1));
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(starts()[0][1].config.upstream_proxy_url).toBe(mocks.global);
  });
  it("passes the upstream to the legacy viewer and deduplicates an identical global", async () => {
    mocks.global = upstream;
    const hook = renderHook(() => useHTTPViewer(session));
    await waitFor(() => expect(hook.result.current.status).toBe("connected"));
    expect(starts()[0][1].config.upstream_proxy_url).toBe(upstream);
    expect(mocks.assertRoute).toHaveBeenCalled();
  });
  it("shows the explicit conflict in the legacy viewer without sending credentials", async () => {
    mocks.global = "http://global.test:8080";
    const hook = renderHook(() => useHTTPViewer(session));
    await waitFor(() =>
      expect(hook.result.current.error).toContain("cannot chain"),
    );
    expect(starts()).toHaveLength(0);
    expect(hook.result.current.error).not.toContain("proxy-secret");
  });
  it("shows typed safe unsupported-route errors but hides arbitrary resolver errors", async () => {
    mocks.resolve.mockRejectedValueOnce(
      new RuntimeNetworkPathError(
        "unsupported-layer",
        "The HTTP proxy backend cannot execute this SSH path.",
      ),
    );
    const hook = renderHook(() => useHTTPViewer(session));
    await waitFor(() =>
      expect(hook.result.current.error).toContain("SSH path"),
    );
    hook.unmount();
    mocks.resolve.mockRejectedValueOnce(
      new Error("backend leaked proxy-secret"),
    );
    const next = renderHook(() => useHTTPViewer(session));
    await waitFor(() => expect(next.result.current.status).toBe("error"));
    expect(next.result.current.error).not.toContain("proxy-secret");
    expect(starts()).toHaveLength(0);
  });
});
