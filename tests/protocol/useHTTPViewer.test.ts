import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import chatgptRoutes from "../../src/utils/protocol/chatgptHostedRoutes.json";
import claudeRoutes from "../../src/utils/protocol/claudeHostedRoutes.json";

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
        {
          id: "conn-google-blank",
          name: "Imported Google Analytics",
          hostname: "",
          port: 0,
          protocol: "https",
          httpApplication: {
            version: 1,
            id: "google-analytics",
            loginMode: "manual",
          },
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "conn-google-custom",
          name: "Custom Google entry",
          hostname: "custom.example.com",
          port: 8443,
          protocol: "https",
          httpApplication: {
            version: 1,
            id: "google-account",
            loginMode: "manual",
          },
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "conn-google-canonical-legacy",
          name: "Legacy Gmail",
          hostname: "mail.google.com",
          port: 80,
          protocol: "http",
          httpApplication: {
            version: 1,
            id: "gmail",
            loginMode: "manual",
          },
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
import { useConnections } from "../../src/contexts/useConnections";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mockInvoke = vi.mocked(invoke);
const defaultProxyResponse = {
  local_port: 9000,
  session_id: "proxy-default",
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:9000/",
};
const googleAccountsProxy =
  "http://paaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:9000";

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

  it("buildTargetUrl resolves an imported blank Google profile from its built-in destination", () => {
    const { result } = renderHook(() =>
      useHTTPViewer(
        makeSession({
          connectionId: "conn-google-blank",
          protocol: "https",
          hostname: "",
        }),
      ),
    );
    expect(result.current.buildTargetUrl()).toBe(
      "https://analytics.google.com/analytics/web/",
    );
  });

  it("buildTargetUrl preserves an explicit custom destination on a Google profile", () => {
    const { result } = renderHook(() =>
      useHTTPViewer(
        makeSession({
          connectionId: "conn-google-custom",
          protocol: "https",
          hostname: "custom.example.com",
        }),
      ),
    );
    expect(result.current.buildTargetUrl()).toBe(
      "https://custom.example.com:8443",
    );
  });

  it("repairs legacy protocol and port data for a canonical Google host", () => {
    const { result } = renderHook(() =>
      useHTTPViewer(
        makeSession({
          connectionId: "conn-google-canonical-legacy",
          protocol: "http",
          hostname: "mail.google.com",
        }),
      ),
    );
    expect(result.current.buildTargetUrl()).toBe("https://mail.google.com/");
  });

  // ── resolveCredentials ─────────────────────────────────────────────────

  it.each([
    ["chatgpt", "chatgpt.com", "https://chatgpt.com/auth/login"],
    ["claude", "claude.ai", "https://claude.ai/login"],
    [
      "chatgpt",
      "https://chatgpt.com/custom?return=%2Fhome#stage",
      "https://chatgpt.com/custom?return=%2Fhome#stage",
    ],
    [
      "claude",
      "https://claude.ai/?return=%2Fhome#stage",
      "https://claude.ai/?return=%2Fhome#stage",
    ],
    ["chatgpt", "https://chatgpt.com/", "https://chatgpt.com/"],
    ["chatgpt", "chatgpt.com.evil.test", ""],
    ["claude", "claude.ai:8443", ""],
    ["claude", "http://claude.ai/login", ""],
    ["chatgpt", "https://user:secret@chatgpt.com/", ""],
  ])(
    "uses only validated AI preset defaults: %s / %s",
    async (id, hostname, expected) => {
      const connection = useConnections().state.connections[1];
      const original = { ...connection };
      connection.hostname = hostname;
      connection.httpApplication = { version: 1, id, loginMode: "manual" };
      const catalog = id === "chatgpt" ? chatgptRoutes : claudeRoutes;
      mockInvoke.mockResolvedValue({
        ...defaultProxyResponse,
        google_routes: [
          {
            upstreamOrigin: Object.values(catalog.profiles)[0],
            proxyOrigin: new URL(defaultProxyResponse.proxy_url).origin,
            documents: true,
          },
          ...catalog.loginOrigins.map((upstreamOrigin, index) => ({
            upstreamOrigin,
            proxyOrigin: `http://p${(index + 10).toString(16).padStart(32, "0")}.localhost:9000`,
            documents: true,
          })),
        ],
      });
      const hook = renderHook(() => useHTTPViewer(makeHttpsSession()));
      try {
        expect(hook.result.current.buildTargetUrl()).toBe(expected);
        await act(async () => {});
        if (expected)
          await waitFor(() => {
            expect(hook.result.current.status).toBe("connected");
            const target = new URL(expected);
            const mapped = new URL(hook.result.current.proxyUrl);
            expect(mapped.origin).toBe(
              new URL(defaultProxyResponse.proxy_url).origin,
            );
            expect(mapped.pathname + mapped.search + mapped.hash).toBe(
              target.pathname + target.search + target.hash,
            );
          });
        if (!expected)
          expect(mockInvoke).not.toHaveBeenCalledWith(
            "start_basic_auth_proxy",
            expect.anything(),
          );
      } finally {
        hook.unmount();
        Object.assign(connection, original);
        if (original.httpApplication === undefined)
          delete connection.httpApplication;
      }
    },
  );

  it.each([
    "/pt/Account/Login",
    "/pt/Account/Login?return=%2Fdashboard#signin",
    "//other.example.test/login?return=%2F#signin",
  ])("keeps a full saved URL path on the protected proxy: %s", async (path) => {
    const context = useConnections();
    const connection = context.state.connections[1];
    const original = connection.hostname;
    connection.hostname = `https://secure.example.com${path}`;
    try {
      const { result, unmount } =
        await renderConnectedHTTPViewer(makeHttpsSession());
      expect(result.current.buildTargetUrl()).toBe(connection.hostname);
      expect(result.current.currentUrl).toBe(connection.hostname);
      const mapped = new URL(result.current.proxyUrl);
      const expected = new URL(connection.hostname);
      expect(mapped.origin).toBe(
        new URL(defaultProxyResponse.proxy_url).origin,
      );
      expect(mapped.pathname).toBe(expected.pathname);
      expect(mapped.search).toBe(expected.search);
      expect(mapped.hash).toBe(expected.hash);
      unmount();
    } finally {
      connection.hostname = original;
    }
  });

  it.each([
    "http://secure.example.com/login",
    "https://secure.example.com:8443/login",
    "https://user:password@secure.example.com/login",
  ])(
    "refuses full URL authority conflicts before native startup: %s",
    async (hostname) => {
      const connection = useConnections().state.connections[1];
      const original = connection.hostname;
      connection.hostname = hostname;
      try {
        const { result, unmount } = renderHook(() =>
          useHTTPViewer(makeHttpsSession()),
        );
        await waitFor(() => expect(result.current.status).toBe("error"));
        expect(result.current.buildTargetUrl()).toBe("");
        expect(mockInvoke).not.toHaveBeenCalledWith(
          "start_basic_auth_proxy",
          expect.anything(),
        );
        unmount();
      } finally {
        connection.hostname = original;
      }
    },
  );

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

  it("starts reviewed Google profiles at Accounts and returns to the selected service", async () => {
    mockInvoke.mockResolvedValue({
      ...defaultProxyResponse,
      session_id: "google-proxy",
      google_routes: [
        {
          upstreamOrigin: "https://analytics.google.com",
          proxyOrigin: defaultProxyResponse.proxy_url.replace(/\/$/, ""),
          documents: true,
        },
        {
          upstreamOrigin: "https://accounts.google.com",
          proxyOrigin: googleAccountsProxy,
          documents: true,
        },
        {
          upstreamOrigin: "https://www.google.com",
          proxyOrigin:
            "http://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost:9000",
          documents: true,
        },
        ...[
          "www.gstatic.com",
          "ssl.gstatic.com",
          "fonts.gstatic.com",
          "fonts.googleapis.com",
          "apis.google.com",
          "analyticsadmin.googleapis.com",
          "analyticsdata.googleapis.com",
        ].map((host, index) => ({
          upstreamOrigin: `https://${host}`,
          proxyOrigin: `http://p${(index + 12).toString(16).padStart(32, "0")}.localhost:9000`,
          documents: false,
        })),
      ],
    });
    const { result } = renderHook(() =>
      useHTTPViewer(
        makeSession({
          connectionId: "conn-google-blank",
          protocol: "https",
          hostname: "",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));

    const entry = new URL(result.current.proxyUrl);
    expect(entry.origin).toBe(googleAccountsProxy);
    expect(entry.pathname).toBe("/ServiceLogin");
    expect(entry.searchParams.get("continue")).toBe(
      "https://analytics.google.com/analytics/web/",
    );
    expect(entry.searchParams.get("followup")).toBe(
      "https://analytics.google.com/analytics/web/",
    );
    expect(result.current.history).toEqual([entry.href]);
  });

  it("fails closed when the backend omits the reviewed Google Accounts route", async () => {
    mockInvoke.mockResolvedValue({
      ...defaultProxyResponse,
      session_id: "google-proxy-invalid",
      google_routes: [],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useHTTPViewer(
        makeSession({
          connectionId: "conn-google-blank",
          protocol: "https",
          hostname: "",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.proxyUrl).toBe("");
    expect(mockInvoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "google-proxy-invalid",
    });
    errorSpy.mockRestore();
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
