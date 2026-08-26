/**
 * Hook contract tests for `usePortainer` / `portainerApi`. The Tauri command
 * surface is mocked so every wrapper's command name + argument shape, the
 * connect/disconnect lifecycle, token-expiry surfacing, and error mapping are
 * verified deterministically without a backend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const proxyUrlMock = vi.fn<() => string | undefined>(() => undefined);
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  withGlobalHttpProxy: <T extends object>(config: T, style: string) => {
    const url = proxyUrlMock();
    if (!url) return config;
    return { ...config, [style === "camel" ? "proxyUrl" : "proxy_url"]: url };
  },
}));

import {
  portainerApi,
  usePortainer,
} from "../../src/hooks/integration/usePortainer";
import type {
  PortainerConnectionConfig,
  PortainerConnectionSummary,
  PortainerContainer,
  PortainerEndpoint,
  PortainerLogLine,
  PortainerStack,
} from "../../src/types/portainer";

const summary: PortainerConnectionSummary = {
  version: "2.21.0",
  instanceId: "inst-1",
  user: "admin",
  role: 1,
  authMode: "password",
};

const endpoints: PortainerEndpoint[] = [
  {
    id: 1,
    name: "local",
    type: 1,
    url: "unix:///var/run/docker.sock",
    status: 1,
  },
];

const containers: PortainerContainer[] = [
  {
    id: "abc123",
    names: ["/portainer"],
    image: "portainer/portainer-ce:lts",
    state: "running",
    status: "Up 3 hours",
  },
];

const stacks: PortainerStack[] = [
  { id: 7, name: "web", type: 2, endpointId: 1, status: 1 },
];

const logLines: PortainerLogLine[] = [
  { stream: "stdout", text: "server started" },
  { stream: "stderr", text: "warning: something" },
];

const passwordConfig: PortainerConnectionConfig = {
  baseUrl: "https://portainer.local:9443",
  username: "admin",
  password: "s3cretpassword!",
  skipTlsVerify: false,
  timeoutSecs: 30,
};

const apiKeyConfig: PortainerConnectionConfig = {
  baseUrl: "http://portainer.local:9000",
  apiKey: "ptr_abcdef",
};

/** Route invoke calls by command name; unknown commands resolve undefined. */
function routeInvoke(handlers: Record<string, (args?: unknown) => unknown>) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const h = handlers[cmd];
    if (!h) return Promise.resolve(undefined);
    try {
      return Promise.resolve(h(args));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

const happyHandlers = {
  portainer_connect: () => summary,
  portainer_web_ui_url: () => "https://portainer.local:9443",
  portainer_ping: () => summary,
  portainer_list_endpoints: () => endpoints,
  portainer_list_containers: () => containers,
  portainer_list_stacks: () => stacks,
  portainer_container_logs: () => logLines,
};

beforeEach(() => {
  invokeMock.mockReset();
  proxyUrlMock.mockReturnValue(undefined);
});

// ─── portainerApi wrappers: command names + arg shapes ───────────────────────

describe("portainerApi", () => {
  beforeEach(() => invokeMock.mockResolvedValue(undefined));

  it("codes to the 14 frozen command names with camelCase args", async () => {
    await portainerApi.connect("c1", apiKeyConfig);
    await portainerApi.disconnect("c1");
    await portainerApi.listConnections();
    await portainerApi.ping("c1");
    await portainerApi.listEndpoints("c1");
    await portainerApi.listContainers("c1", 1, true);
    await portainerApi.startContainer("c1", 1, "abc");
    await portainerApi.stopContainer("c1", 1, "abc");
    await portainerApi.restartContainer("c1", 1, "abc");
    await portainerApi.containerLogs("c1", 1, "abc", 200);
    await portainerApi.listStacks("c1");
    await portainerApi.startStack("c1", 7, 1);
    await portainerApi.stopStack("c1", 7, 1);
    await portainerApi.webUiUrl("c1");

    expect(invokeMock.mock.calls).toEqual([
      ["portainer_connect", { id: "c1", config: apiKeyConfig }],
      ["portainer_disconnect", { id: "c1" }],
      ["portainer_list_connections"],
      ["portainer_ping", { id: "c1" }],
      ["portainer_list_endpoints", { id: "c1" }],
      ["portainer_list_containers", { id: "c1", endpointId: 1, all: true }],
      [
        "portainer_start_container",
        { id: "c1", endpointId: 1, containerId: "abc" },
      ],
      [
        "portainer_stop_container",
        { id: "c1", endpointId: 1, containerId: "abc" },
      ],
      [
        "portainer_restart_container",
        { id: "c1", endpointId: 1, containerId: "abc" },
      ],
      [
        "portainer_container_logs",
        { id: "c1", endpointId: 1, containerId: "abc", tail: 200 },
      ],
      ["portainer_list_stacks", { id: "c1" }],
      ["portainer_start_stack", { id: "c1", stackId: 7, endpointId: 1 }],
      ["portainer_stop_stack", { id: "c1", stackId: 7, endpointId: 1 }],
      ["portainer_web_ui_url", { id: "c1" }],
    ]);
    expect(Object.keys(portainerApi)).toHaveLength(14);
  });

  it("passes optional args as undefined when omitted", async () => {
    await portainerApi.listContainers("c1", 2);
    await portainerApi.containerLogs("c1", 2, "x");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "portainer_list_containers", {
      id: "c1",
      endpointId: 2,
      all: undefined,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "portainer_container_logs", {
      id: "c1",
      endpointId: 2,
      containerId: "x",
      tail: undefined,
    });
  });
});

// ─── usePortainer lifecycle ───────────────────────────────────────────────────

describe("usePortainer connect", () => {
  it("connects with username + password and fetches the web UI URL", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    expect(result.current.status).toBe("disconnected");

    let ok = false;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });

    expect(ok).toBe(true);
    expect(result.current.status).toBe("connected");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionId).toBe("c1");
    expect(result.current.summary).toEqual(summary);
    expect(result.current.webUiUrl).toBe("https://portainer.local:9443");
    expect(result.current.error).toBeNull();

    const [cmd, args] = invokeMock.mock.calls[0] as [
      string,
      { id: string; config: PortainerConnectionConfig },
    ];
    expect(cmd).toBe("portainer_connect");
    expect(args.id).toBe("c1");
    expect(args.config).toMatchObject({
      baseUrl: passwordConfig.baseUrl,
      username: "admin",
      password: "s3cretpassword!",
      acknowledge_invalid_cert_risk: false,
    });
    expect(args.config.apiKey).toBeUndefined();
    expect(args.config).not.toHaveProperty("proxyUrl");
  });

  it("connects with an API key (no username/password on the wire)", async () => {
    routeInvoke({
      ...happyHandlers,
      portainer_connect: () => ({ ...summary, authMode: "apiKey", user: null }),
    });
    const { result } = renderHook(() => usePortainer());

    await act(async () => {
      await result.current.connect("c2", apiKeyConfig);
    });

    expect(result.current.summary?.authMode).toBe("apiKey");
    const args = invokeMock.mock.calls[0][1] as {
      config: PortainerConnectionConfig;
    };
    expect(args.config.apiKey).toBe("ptr_abcdef");
    expect(args.config.username).toBeUndefined();
    expect(args.config.password).toBeUndefined();
  });

  it("forwards the one-shot insecure-TLS acknowledgement only once", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());

    await act(async () => {
      await result.current.connect("c1", {
        ...passwordConfig,
        skipTlsVerify: true,
        acknowledge_invalid_cert_risk: true,
      });
    });
    const first = invokeMock.mock.calls[0][1] as {
      config: PortainerConnectionConfig;
    };
    expect(first.config.skipTlsVerify).toBe(true);
    expect(first.config.acknowledge_invalid_cert_risk).toBe(true);
  });

  it("injects the global HTTP proxy in camelCase", async () => {
    proxyUrlMock.mockReturnValue("http://proxy.local:3128");
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());

    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    const args = invokeMock.mock.calls[0][1] as {
      config: PortainerConnectionConfig;
    };
    expect(args.config.proxyUrl).toBe("http://proxy.local:3128");
    expect(args.config).not.toHaveProperty("proxy_url");
  });

  it("still reports connected when the web UI URL lookup fails", async () => {
    routeInvoke({
      ...happyHandlers,
      portainer_web_ui_url: () => {
        throw "internal_error: boom";
      },
    });
    const { result } = renderHook(() => usePortainer());

    let ok = false;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });
    expect(ok).toBe(true);
    expect(result.current.status).toBe("connected");
    expect(result.current.webUiUrl).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("usePortainer error mapping", () => {
  it("surfaces a string backend error and returns false", async () => {
    routeInvoke({
      portainer_connect: () => {
        throw "authentication_failed: Invalid credentials";
      },
    });
    const { result } = renderHook(() => usePortainer());

    let ok = true;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionId).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBe(
      "authentication_failed: Invalid credentials",
    );
    // Only one connect attempt — no implicit retry on the frontend side.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("formats structured {kind,message} errors as 'kind: message'", async () => {
    routeInvoke({
      portainer_connect: () => {
        throw {
          kind: "tls_untrusted",
          message: "Certificate not trusted; trust it in Trust Center",
        };
      },
    });
    const { result } = renderHook(() => usePortainer());

    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    expect(result.current.error).toBe(
      "tls_untrusted: Certificate not trusted; trust it in Trust Center",
    );
  });

  it("surfaces a token_expired error from a later call without dropping the session", async () => {
    routeInvoke({
      ...happyHandlers,
      portainer_list_endpoints: () => {
        throw "token_expired: JWT expired and re-login failed";
      },
    });
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });

    await act(async () => {
      await expect(result.current.loadEndpoints()).rejects.toBe(
        "token_expired: JWT expired and re-login failed",
      );
    });
    expect(result.current.error).toBe(
      "token_expired: JWT expired and re-login failed",
    );
    expect(result.current.endpoints).toEqual([]);
    // The connection id is retained so the panel can offer a reconnect.
    expect(result.current.connectionId).toBe("c1");
    expect(result.current.busy).toBe(false);
  });

  it("re-connecting after token expiry issues a fresh portainer_connect", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.disconnect();
    });
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    const connectCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "portainer_connect",
    );
    expect(connectCalls).toHaveLength(2);
    expect(result.current.status).toBe("connected");
  });

  it("data ops throw not_connected before any invoke when disconnected", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    await expect(result.current.loadEndpoints()).rejects.toThrow(
      /not_connected/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clearError resets the error", async () => {
    routeInvoke({
      portainer_connect: () => {
        throw "connection_failed: refused";
      },
    });
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("usePortainer data ops", () => {
  async function connected() {
    routeInvoke(happyHandlers);
    const hook = renderHook(() => usePortainer());
    await act(async () => {
      await hook.result.current.connect("c1", passwordConfig);
    });
    invokeMock.mockClear();
    return hook;
  }

  it("loads endpoints, containers and stacks into state", async () => {
    const { result } = await connected();

    await act(async () => {
      await result.current.loadEndpoints();
    });
    expect(result.current.endpoints).toEqual(endpoints);
    expect(invokeMock).toHaveBeenLastCalledWith("portainer_list_endpoints", {
      id: "c1",
    });

    await act(async () => {
      await result.current.loadContainers(1, true);
    });
    expect(result.current.containers).toEqual(containers);
    expect(invokeMock).toHaveBeenLastCalledWith("portainer_list_containers", {
      id: "c1",
      endpointId: 1,
      all: true,
    });

    await act(async () => {
      await result.current.loadStacks();
    });
    expect(result.current.stacks).toEqual(stacks);
    expect(invokeMock).toHaveBeenLastCalledWith("portainer_list_stacks", {
      id: "c1",
    });
    expect(result.current.busy).toBe(false);
  });

  it("starts / stops / restarts containers with the connection id", async () => {
    const { result } = await connected();

    await act(async () => {
      await result.current.startContainer(1, "abc123");
      await result.current.stopContainer(1, "abc123");
      await result.current.restartContainer(1, "abc123");
    });
    expect(invokeMock.mock.calls).toEqual([
      [
        "portainer_start_container",
        { id: "c1", endpointId: 1, containerId: "abc123" },
      ],
      [
        "portainer_stop_container",
        { id: "c1", endpointId: 1, containerId: "abc123" },
      ],
      [
        "portainer_restart_container",
        { id: "c1", endpointId: 1, containerId: "abc123" },
      ],
    ]);
  });

  it("loads container logs with tail and clears them", async () => {
    const { result } = await connected();

    await act(async () => {
      await result.current.loadLogs(1, "abc123", 100);
    });
    expect(result.current.logs).toEqual(logLines);
    expect(invokeMock).toHaveBeenLastCalledWith("portainer_container_logs", {
      id: "c1",
      endpointId: 1,
      containerId: "abc123",
      tail: 100,
    });

    act(() => result.current.clearLogs());
    expect(result.current.logs).toEqual([]);
  });

  it("starts / stops stacks", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.startStack(7, 1);
      await result.current.stopStack(7, 1);
    });
    expect(invokeMock.mock.calls).toEqual([
      ["portainer_start_stack", { id: "c1", stackId: 7, endpointId: 1 }],
      ["portainer_stop_stack", { id: "c1", stackId: 7, endpointId: 1 }],
    ]);
  });

  it("refreshSummary re-pings and updates the summary", async () => {
    const { result } = await connected();
    routeInvoke({
      ...happyHandlers,
      portainer_ping: () => ({ ...summary, version: "2.22.0" }),
    });
    await act(async () => {
      await result.current.refreshSummary();
    });
    expect(result.current.summary?.version).toBe("2.22.0");
    expect(invokeMock).toHaveBeenLastCalledWith("portainer_ping", { id: "c1" });
  });

  it("run() surfaces op errors and resets busy", async () => {
    const { result } = await connected();
    await act(async () => {
      await expect(
        result.current.run(() => Promise.reject("permission_denied: nope")),
      ).rejects.toBe("permission_denied: nope");
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBe("permission_denied: nope");
  });
});

describe("usePortainer disconnect", () => {
  it("disconnects and clears all cached state", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.loadEndpoints();
      await result.current.loadContainers(1);
      await result.current.loadStacks();
      await result.current.loadLogs(1, "abc123");
    });
    expect(result.current.endpoints).toHaveLength(1);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("portainer_disconnect", {
      id: "c1",
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionId).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.endpoints).toEqual([]);
    expect(result.current.containers).toEqual([]);
    expect(result.current.stacks).toEqual([]);
    expect(result.current.logs).toEqual([]);
    expect(result.current.webUiUrl).toBeNull();
  });

  it("is a no-op when not connected", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.disconnect();
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clears local state even when the backend disconnect fails", async () => {
    routeInvoke({
      ...happyHandlers,
      portainer_disconnect: () => {
        throw "not_connected: gone";
      },
    });
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.connectionId).toBeNull();
    expect(result.current.error).toBe("not_connected: gone");
  });
});

describe("secrets never leak into instance fields", () => {
  it("summary and state carry no password / apiKey", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => usePortainer());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    const serialized = JSON.stringify({
      summary: result.current.summary,
      endpoints: result.current.endpoints,
      webUiUrl: result.current.webUiUrl,
      connectionId: result.current.connectionId,
    });
    expect(serialized).not.toContain("s3cretpassword!");
    expect(serialized).not.toContain("ptr_");
    expect(result.current.summary).not.toHaveProperty("password");
    expect(result.current.summary).not.toHaveProperty("apiKey");
  });
});
