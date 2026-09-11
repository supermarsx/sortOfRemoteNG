import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";

const { invoke, settings, getProxyUrl } = vi.hoisted(() => ({
  invoke: vi.fn(),
  settings: { theme: "dark" } as Record<string, unknown>,
  getProxyUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) =>
    command === "web_network_guard_status"
      ? Promise.resolve({
          platform: "windows",
          frameNavigation: "enforced",
          allNetworkRequestsMediated: false,
        })
      : command === "activate_proxy_network_document"
        ? Promise.resolve(false)
        : invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] }, dispatch: vi.fn() }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: { success: vi.fn() } }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ startRecording: vi.fn(), stopRecording: vi.fn() }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({}),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: vi.fn().mockResolvedValue({ status: "trusted" }),
  trustIdentity: vi.fn(),
  resolveEffectiveTrustPolicy: () => "tofu",
}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: getProxyUrl,
}));

import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";

const session: ConnectionSession = {
  id: "web-tab-a",
  connectionId: "saved-web-connection",
  name: "Local fixture",
  protocol: "http",
  hostname: "fixture.invalid",
  status: "connected",
  startTime: new Date(0),
};
const response = {
  local_port: 43123,
  session_id: "proxy-a",
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  invoke.mockReset();
  getProxyUrl.mockReset();
  for (const key of Object.keys(settings)) delete settings[key];
  settings.theme = "dark";
  invoke.mockImplementation(async (command: string) =>
    command === "start_basic_auth_proxy" ? response : undefined,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("embedded browser proxy lifecycle", () => {
  it("keeps double-slash document and route paths on the saved authority", async () => {
    const { result, unmount } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    act(() => result.current.attachIframe(iframe));
    const navigation = new URL(iframe.src);
    const report = {
      version: 1,
      sessionId: response.session_id,
      documentSequence: 1,
      documentToken: "a".repeat(32),
      navigationToken: navigation.searchParams.get("__sorng_navigation_v1"),
      url: response.proxy_url,
    };
    const emit = (data: Record<string, unknown>) =>
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            origin: navigation.origin,
            data,
          }),
        ),
      );
    emit({ ...report, type: "proxy_document_start" });
    emit({ ...report, type: "proxy_dom_ready" });
    emit({
      type: "proxy_navigate",
      url: `${navigation.origin}//not-the-target.example/path?x=a%20b+~#hash`,
    });
    expect(result.current.currentUrl).toBe(
      "http://fixture.invalid//not-the-target.example/path?x=a%20b+~#hash",
    );
    emit({
      ...report,
      type: "proxy_document_start",
      documentSequence: 2,
      documentToken: "b".repeat(32),
      navigationToken: null,
      url: `${navigation.origin}//still-not-the-target.example/new`,
    });
    expect(result.current.currentUrl).toBe(
      "http://fixture.invalid//still-not-the-target.example/new",
    );
    expect(result.current.backHistory.map((entry) => entry.url)).toContain(
      "http://fixture.invalid//not-the-target.example/path?x=a%20b+~#hash",
    );
    unmount();
    iframe.remove();
  });
  it("jumps multiple history entries without truncating Forward until a genuine new navigation", async () => {
    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    for (const path of ["one", "two", "three"]) {
      await act(async () =>
        result.current.navigateToUrl(`http://fixture.invalid/${path}`),
      );
    }
    expect(result.current.backHistory.map((entry) => entry.url)).toEqual([
      "http://fixture.invalid/two",
      "http://fixture.invalid/one",
      "http://fixture.invalid/",
    ]);
    await act(async () => result.current.handleHistoryJump(1));
    expect(result.current.currentUrl).toBe("http://fixture.invalid/one");
    expect(result.current.forwardHistory.map((entry) => entry.url)).toEqual([
      "http://fixture.invalid/two",
      "http://fixture.invalid/three",
    ]);
    await act(async () => result.current.handleRefresh());
    expect(result.current.forwardHistory).toHaveLength(2);
    await act(async () => result.current.handleHistoryJump(3));
    expect(result.current.currentUrl).toBe("http://fixture.invalid/three");
    expect(result.current.backHistory).toHaveLength(3);
    await act(async () => result.current.handleHistoryJump(1));
    await act(async () =>
      result.current.navigateToUrl("http://fixture.invalid/new"),
    );
    expect(result.current.forwardHistory).toHaveLength(0);
    expect(result.current.backHistory.map((entry) => entry.url)).toEqual([
      "http://fixture.invalid/one",
      "http://fixture.invalid/",
    ]);
    await act(async () => result.current.handleHistoryJump(999));
    expect(result.current.currentUrl).toBe("http://fixture.invalid/new");
  });
  it("hands a pending navigation to a late-mounted frame without rewriting encoded query bytes", async () => {
    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    const query = "?signed=a%20b+c~&empty=&encoded=%2f%2F&flag";
    await act(async () =>
      result.current.navigateToUrl(`http://fixture.invalid/login${query}#view`),
    );
    const iframe = document.createElement("iframe");
    act(() => result.current.attachIframe(iframe));
    expect(iframe.src).toMatch(
      new RegExp("__sorng_navigation_v1=[0-9a-f]{32}#view$"),
    );
    expect(iframe.src).toBe(
      `${response.proxy_url}login${query}&__sorng_navigation_v1=${new URL(iframe.src).searchParams.get("__sorng_navigation_v1")}#view`,
    );
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toHaveLength(1);
    expect(result.current.currentUrl).toBe(
      `http://fixture.invalid/login${query}#view`,
    );
  });
  it.each(["http", "https"] as const)(
    "mediates unauthenticated %s through the protected loopback iframe",
    async (protocol) => {
      const proxyUrl = "http://user%26name:secret%2Bword@proxy.invalid:8080";
      getProxyUrl.mockReturnValue(proxyUrl);
      invoke.mockImplementation(async (command: string) => {
        if (command === "get_tls_certificate_info") {
          return { fingerprint: "fixture-fingerprint", san: [], chain: [] };
        }
        if (command === "start_basic_auth_proxy") return response;
      });
      const { result } = renderHook(() =>
        useWebBrowser({ ...session, protocol }),
      );
      const iframe = document.createElement("iframe");
      (
        result.current.iframeRef as { current: HTMLIFrameElement | null }
      ).current = iframe;
      await act(async () => {});
      const navigationUrl = new URL(iframe.src);
      expect(navigationUrl.searchParams.get("__sorng_navigation_v1")).toMatch(
        /^[0-9a-f]{32}$/,
      );
      navigationUrl.searchParams.delete("__sorng_navigation_v1");
      expect(navigationUrl.toString()).toBe(response.proxy_url);
      expect(invoke).toHaveBeenCalledWith("start_basic_auth_proxy", {
        config: expect.objectContaining({
          target_url: `${protocol}://fixture.invalid/`,
          username: "",
          password: "",
          upstream_proxy_url: proxyUrl,
        }),
      });
      if (protocol === "https") {
        expect(invoke).toHaveBeenCalledWith("get_tls_certificate_info", {
          host: "fixture.invalid",
          port: 443,
          proxyUrl,
        });
      }
    },
  );

  it("fails closed on TLS inspection rejection without creating or automatically retrying a proxy", async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValue(
      new Error("Certificate proxy authentication was rejected (HTTP 407)"),
    );
    const { result, unmount } = renderHook(() =>
      useWebBrowser({ ...session, protocol: "https" }),
    );
    await act(async () => {});
    expect(result.current.navigationFailure?.kind).toBe("tls_failure");
    expect(result.current.isLoading).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "get_tls_certificate_info",
      ),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toBe(false);
    unmount();
  });

  it("keeps two tabs for the same saved connection independently owned", async () => {
    let count = 0;
    invoke.mockImplementation(async (command: string) =>
      command === "start_basic_auth_proxy"
        ? { ...response, session_id: `proxy-${++count}` }
        : undefined,
    );
    const first = renderHook(() => useWebBrowser(session));
    const second = renderHook(() =>
      useWebBrowser({ ...session, id: "web-tab-b" }),
    );
    await act(async () => {});
    expect(first.result.current.proxySessionIdRef.current).toBe("proxy-1");
    expect(second.result.current.proxySessionIdRef.current).toBe("proxy-2");
    first.unmount();
    expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-1",
    });
    expect(invoke).not.toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-2",
    });
    expect(second.result.current.proxySessionIdRef.current).toBe("proxy-2");
  });

  it("releases a proxy whose creation finishes after its tab unmounts", async () => {
    const pending = deferred<typeof response>();
    invoke.mockImplementation(async (command: string) =>
      command === "start_basic_auth_proxy" ? pending.promise : undefined,
    );
    const { unmount } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith(
      "start_basic_auth_proxy",
      expect.anything(),
    );
    unmount();
    await act(async () => pending.resolve(response));
    expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: response.session_id,
    });
  });

  it("does not install a pending proxy after the user cancels navigation", async () => {
    const pending = deferred<typeof response>();
    invoke.mockImplementation(async (command: string) =>
      command === "start_basic_auth_proxy" ? pending.promise : undefined,
    );
    const { result } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    act(() => result.current.handleCancelLoading());
    await act(async () => pending.resolve(response));
    expect(result.current.proxySessionIdRef.current).toBe("");
    expect(result.current.navigationFailure?.title).toBe("Loading cancelled");
    expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: response.session_id,
    });
  });

  it("counts failed automatic restart attempts against the configured limit", async () => {
    vi.useFakeTimers();
    Object.assign(settings, {
      proxyKeepaliveEnabled: true,
      proxyKeepaliveIntervalSeconds: 1,
      proxyAutoRestart: true,
      proxyMaxAutoRestarts: 2,
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "start_basic_auth_proxy") return response;
      if (command === "check_proxy_health") {
        return [{ session_id: response.session_id, alive: false }];
      }
      if (command === "restart_proxy_session") {
        throw new Error("Fixture proxy could not restart");
      }
    });
    const { unmount } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "restart_proxy_session",
      ),
    ).toHaveLength(2);
    unmount();
  });

  it("coalesces health/manual restarts and releases a restart that finishes after unmount", async () => {
    vi.useFakeTimers();
    Object.assign(settings, {
      proxyKeepaliveEnabled: true,
      proxyKeepaliveIntervalSeconds: 1,
      proxyAutoRestart: true,
      proxyMaxAutoRestarts: 2,
    });
    const pendingRestart = deferred<typeof response>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "start_basic_auth_proxy") return response;
      if (command === "check_proxy_health") {
        return [{ session_id: response.session_id, alive: false }];
      }
      if (command === "restart_proxy_session") return pendingRestart.promise;
    });
    const { result, unmount } = renderHook(() => useWebBrowser(session));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    await act(async () => result.current.handleRestartProxy());
    expect(
      invoke.mock.calls.filter(([command]) => command === "check_proxy_health"),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "restart_proxy_session",
      ),
    ).toHaveLength(1);
    unmount();
    await act(async () =>
      pendingRestart.resolve({ ...response, session_id: "late-restart" }),
    );
    expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "late-restart",
    });
  });

  it("bounds the initial TLS wait and cannot navigate after a late inspection result", async () => {
    vi.useFakeTimers();
    const pendingCert = deferred<{
      fingerprint: string;
      san: string[];
      chain: unknown[];
    }>();
    invoke.mockImplementation(async (command: string) =>
      command === "get_tls_certificate_info" ? pendingCert.promise : response,
    );
    const { result } = renderHook(() =>
      useWebBrowser({ ...session, protocol: "https" }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current.navigationFailure?.kind).toBe("page_load_timeout");
    expect(result.current.isLoading).toBe(false);
    await act(async () =>
      pendingCert.resolve({ fingerprint: "late-cert", san: [], chain: [] }),
    );
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "start_basic_auth_proxy",
      ),
    ).toBe(false);
  });
});
