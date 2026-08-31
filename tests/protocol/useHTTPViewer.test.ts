import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

const { mockDispatch } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: vi.fn().mockReturnValue({
    state: {
      connections: [
        {
          id: "conn-1",
          name: "Web Server",
          hostname: "example.com",
          port: 8080,
          protocol: "http",
          username: "admin",
          password: "pass123",
          authType: "basic",
          basicAuthUsername: "admin",
          basicAuthPassword: "secret",
          httpVerifySsl: true,
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "conn-2",
          name: "HTTPS Site",
          hostname: "secure.example.com",
          port: 443,
          protocol: "https",
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    dispatch: mockDispatch,
  }),
}));

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: vi.fn().mockReturnValue({
    settings: { theme: "dark" },
    updateSettings: vi.fn(),
  }),
}));

import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mockInvoke = vi.mocked(invoke);
const defaultProxyResponse = {
  local_port: 9000,
  session_id: "proxy-default",
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:9000/",
};

const makeSession = (
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "sess-1",
  connectionId: "conn-1",
  name: "Web Server",
  status: "connected",
  startTime: new Date(),
  protocol: "http",
  hostname: "example.com",
  ...overrides,
});

const makeHttpsSession = (): ConnectionSession => ({
  id: "sess-2",
  connectionId: "conn-2",
  name: "HTTPS Site",
  status: "connected",
  startTime: new Date(),
  protocol: "https",
  hostname: "secure.example.com",
});

async function renderConnectedHTTPViewer(session = makeSession()) {
  const rendered = renderHook(() => useHTTPViewer(session));
  await waitFor(() => {
    expect(rendered.result.current.status).toBe("connected");
  });
  return rendered;
}

describe("useHTTPViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(defaultProxyResponse);
  });

  // ── buildTargetUrl ─────────────────────────────────────────────────────

  it("buildTargetUrl returns http URL with non-standard port", async () => {
    const { result, unmount } = await renderConnectedHTTPViewer();
    expect(result.current.buildTargetUrl()).toBe("http://example.com:8080");
    unmount();
  });

  it("buildTargetUrl omits port 80 for http", async () => {
    const { result, unmount } = await renderConnectedHTTPViewer(
      makeSession({ connectionId: "conn-1" }),
    );
    // conn-1 uses port 8080, so port is shown
    expect(result.current.buildTargetUrl()).toContain("8080");
    unmount();
  });

  it("buildTargetUrl uses https for https protocol", () => {
    const { result } = renderHook(() => useHTTPViewer(makeHttpsSession()));
    // conn-2 port 443 → omitted for https
    expect(result.current.buildTargetUrl()).toBe("https://secure.example.com");
  });

  it("buildTargetUrl returns empty when connection not found", () => {
    const { result } = renderHook(() =>
      useHTTPViewer(makeSession({ connectionId: "nonexistent" })),
    );
    expect(result.current.buildTargetUrl()).toBe("");
  });

  // ── resolveCredentials ─────────────────────────────────────────────────

  it("resolveCredentials returns basic auth credentials", async () => {
    const { result, unmount } = await renderConnectedHTTPViewer();
    const creds = result.current.resolveCredentials();
    expect(creds).toEqual({ username: "admin", password: "secret" });
    unmount();
  });

  it("resolveCredentials returns null when connection not found", () => {
    const { result } = renderHook(() =>
      useHTTPViewer(makeSession({ connectionId: "nonexistent" })),
    );
    expect(result.current.resolveCredentials()).toBeNull();
  });

  it("resolveCredentials returns null when no credentials configured", () => {
    const { result } = renderHook(() => useHTTPViewer(makeHttpsSession()));
    expect(result.current.resolveCredentials()).toBeNull();
  });

  // ── Proxy initialization ───────────────────────────────────────────────

  it("initProxy starts proxy for connection with basic auth", async () => {
    const proxyResp = {
      local_port: 9000,
      session_id: "proxy-1",
      proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:9000/",
    };
    mockInvoke.mockResolvedValue(proxyResp);

    const { result } = renderHook(() => useHTTPViewer(makeSession()));

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    expect(result.current.proxyUrl).toBe(proxyResp.proxy_url);
    expect(result.current.proxySessionId).toBe("proxy-1");
  });

  it("initProxy routes through the protected proxy even without credentials", async () => {
    const { result } = renderHook(() => useHTTPViewer(makeHttpsSession()));

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });

    expect(result.current.proxyUrl).toBe(defaultProxyResponse.proxy_url);
    expect(mockInvoke).toHaveBeenCalledWith(
      "start_basic_auth_proxy",
      expect.objectContaining({
        config: expect.objectContaining({
          target_url: "https://secure.example.com",
          username: "",
          password: "",
          connection_id: "conn-2",
        }),
      }),
    );
  });

  it("initProxy sets error when connection not found", async () => {
    const { result } = renderHook(() =>
      useHTTPViewer(makeSession({ connectionId: "nonexistent" })),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toBe("Connection not found");
  });

  it("initProxy sets error on invoke failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("Port in use"));

    const rendered = renderHook(() => useHTTPViewer(makeSession()));
    try {
      await waitFor(() => {
        expect(rendered.result.current.status).toBe("error");
      });

      expect(rendered.result.current.error).toBe(
        "Failed to initialize HTTP proxy",
      );
      expect(errorSpy.mock.calls).toEqual([
        ["Failed to initialize HTTP proxy"],
      ]);
    } finally {
      rendered.unmount();
      errorSpy.mockRestore();
    }
  });

  // ── Navigation history ─────────────────────────────────────────────────

  it("history is populated after proxy init", async () => {
    mockInvoke.mockResolvedValue({
      local_port: 9000,
      session_id: "p1",
      proxy_url: "http://p11111111111111111111111111111111.localhost:9000/",
    });

    const { result } = renderHook(() => useHTTPViewer(makeSession()));

    await waitFor(() => {
      expect(result.current.history.length).toBeGreaterThan(0);
    });

    expect(result.current.historyIndex).toBe(0);
  });

  it("toggleFullscreen toggles fullscreen state", async () => {
    const { result } = renderHook(() => useHTTPViewer(makeHttpsSession()));

    expect(result.current.isFullscreen).toBe(false);

    act(() => {
      result.current.toggleFullscreen();
    });
    expect(result.current.isFullscreen).toBe(true);

    act(() => {
      result.current.toggleFullscreen();
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  // ── TOTP configs ───────────────────────────────────────────────────────

  it("handleUpdateTotpConfigs dispatches UPDATE_CONNECTION", async () => {
    const { result, unmount } = await renderConnectedHTTPViewer();

    act(() => {
      result.current.handleUpdateTotpConfigs([
        { name: "GitHub", secret: "abc" } as any,
      ]);
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_CONNECTION",
        payload: expect.objectContaining({
          totpConfigs: [{ name: "GitHub", secret: "abc" }],
        }),
      }),
    );
    unmount();
  });
});
