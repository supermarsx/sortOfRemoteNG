import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  buildXdmcpConfig,
  getUnsupportedXdmcpRouteReason,
  useXdmcpClient,
  xdmcpApi,
} from "./useXdmcpClient";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

const connection: Connection = {
  id: "xdmcp-connection-1",
  name: "Legacy display manager",
  protocol: "xdmcp" as Connection["protocol"],
  hostname: "display.example.test",
  port: 177,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  xdmcpAcknowledgeInsecureTransport: true,
  xdmcpQueryType: "Indirect",
  xdmcpResolutionWidth: 1280,
  xdmcpResolutionHeight: 720,
  xdmcpXServerType: "VcXsrv",
  xdmcpXServerPath: "C:\\Program Files\\VcXsrv\\vcxsrv.exe",
} as Connection;

const session: ConnectionSession = {
  id: "frontend-xdmcp-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "xdmcp",
  hostname: connection.hostname,
};

const firstLaunchId = `${session.id}-xdmcp-1`;

const info = {
  id: firstLaunchId,
  host: connection.hostname,
  port: 177,
  state: "Running",
  display_number: 10,
  session_id: null,
  display_manager: connection.hostname,
  display_width: 1280,
  display_height: 720,
  bytes_sent: 0,
  bytes_received: 0,
  packets_sent: 0,
  packets_received: 0,
  keepalive_count: 0,
  last_activity: "2026-01-01T00:00:00Z",
  x_server_pid: 4321,
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "get_xdmcp_session_info") return Promise.resolve(info);
    if (command === "is_xdmcp_connected") return Promise.resolve(true);
    if (command === "discover_xdmcp") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

describe("useXdmcpClient", () => {
  it("builds the exact native X server DTO with explicit risk acknowledgement", () => {
    expect(buildXdmcpConfig(connection, session)).toEqual({
      host: "display.example.test",
      port: 177,
      label: connection.name,
      acknowledge_insecure_transport: true,
      query_type: "Indirect",
      broadcast_address: null,
      auth_type: "None",
      auth_data: null,
      display_number: null,
      resolution_width: 1280,
      resolution_height: 720,
      color_depth: 24,
      fullscreen: false,
      x_server_type: "VcXsrv",
      x_server_path: "C:\\Program Files\\VcXsrv\\vcxsrv.exe",
      x_server_extra_args: null,
      connect_timeout: 30,
      keepalive_interval: 60,
      retry_count: 3,
    });
  });

  it("rejects option-like and control-bearing hosts before invoking the backend", () => {
    for (const hostname of [
      "-query",
      "--help",
      "display.example\ttest",
      "display.example\ntest",
      "display.example.test\n",
      "display.example\u0000test",
    ]) {
      expect(() =>
        buildXdmcpConfig({ ...connection, hostname }, session),
      ).toThrow(/unsafe option or control syntax/i);
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("launches a real backend handle and preserves it across remount", async () => {
    const { result, unmount } = renderHook(() => useXdmcpClient(session));
    await waitFor(() => expect(result.current.status).toBe("x-server-running"));
    expect(mocks.invoke).toHaveBeenCalledWith("connect_xdmcp", {
      sessionId: firstLaunchId,
      config: expect.objectContaining({
        acknowledge_insecure_transport: true,
        auth_data: null,
      }),
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).toContain(firstLaunchId);

    const disconnectCallsBeforeUnmount = mocks.invoke.mock.calls.filter(
      ([command]) => command === "disconnect_xdmcp",
    ).length;
    unmount();
    await act(async () => Promise.resolve());
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_xdmcp",
      ),
    ).toHaveLength(disconnectCallsBeforeUnmount);
  });

  it("uses the registered discovery argument contract", async () => {
    await xdmcpApi.discover("192.0.2.255", 1500);
    expect(mocks.invoke).toHaveBeenCalledWith("discover_xdmcp", {
      broadcastAddress: "192.0.2.255",
      timeoutMs: 1500,
    });
  });

  it("fails closed instead of bypassing a tunnel route", () => {
    expect(
      getUnsupportedXdmcpRouteReason({
        ...connection,
        tunnelChainId: "route-1",
      }),
    ).toMatch(/cannot consume an application proxy/i);
  });

  it("stops a newly launched X server when session verification fails", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_xdmcp_session_info") {
        return Promise.reject(new Error("verification failed"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useXdmcpClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    const disconnects = mocks.invoke.mock.calls.filter(
      ([command]) => command === "disconnect_xdmcp",
    );
    // One idempotent stale-handle cleanup before launch, then one guaranteed
    // cleanup after verification fails.
    expect(disconnects).toHaveLength(2);
  });

  it("cleans only its own stale launch after a newer generation succeeds", async () => {
    const firstVerification = deferred<typeof info>();
    const secondLaunchId = `${session.id}-xdmcp-2`;
    let verificationCount = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_xdmcp_session_info") {
        verificationCount += 1;
        return verificationCount === 1
          ? firstVerification.promise
          : Promise.resolve({ ...info, id: secondLaunchId });
      }
      if (command === "is_xdmcp_connected") return Promise.resolve(true);
      if (command === "discover_xdmcp") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useXdmcpClient(session));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("get_xdmcp_session_info", {
        sessionId: firstLaunchId,
      }),
    );

    await act(async () => {
      await result.current.reconnect();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("x-server-running");
      expect(result.current.backendSessionId).toBe(secondLaunchId);
    });

    const secondDisconnectCountBeforeStaleCleanup =
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "disconnect_xdmcp" &&
          (args as { sessionId?: string } | undefined)?.sessionId ===
            secondLaunchId,
      ).length;
    expect(secondDisconnectCountBeforeStaleCleanup).toBe(1);

    await act(async () => {
      firstVerification.resolve(info);
      await firstVerification.promise;
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("disconnect_xdmcp", {
        sessionId: firstLaunchId,
      }),
    );

    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "disconnect_xdmcp" &&
          (args as { sessionId?: string } | undefined)?.sessionId ===
            secondLaunchId,
      ),
    ).toHaveLength(secondDisconnectCountBeforeStaleCleanup);
    expect(result.current.backendSessionId).toBe(secondLaunchId);
  });

  it("never lets a stale initializer close an existing X server reused by its replacement", async () => {
    const existingId = "existing-xdmcp";
    const existingInfo = { ...info, id: existingId };
    const firstVerification = deferred<typeof existingInfo>();
    let verificationCount = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_xdmcp_session_info") {
        verificationCount += 1;
        return verificationCount === 1
          ? firstVerification.promise
          : Promise.resolve(existingInfo);
      }
      if (command === "is_xdmcp_connected") return Promise.resolve(true);
      if (command === "discover_xdmcp") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const attachedSession = { ...session, backendSessionId: existingId };
    const { result } = renderHook(() => useXdmcpClient(attachedSession));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("get_xdmcp_session_info", {
        sessionId: existingId,
      }),
    );

    await act(async () => {
      await result.current.reconnect();
    });
    await waitFor(() => expect(result.current.status).toBe("x-server-running"));

    await act(async () => {
      firstVerification.resolve(existingInfo);
      await firstVerification.promise;
    });

    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_xdmcp", {
      sessionId: existingId,
    });
    expect(result.current.backendSessionId).toBe(existingId);
  });
});
