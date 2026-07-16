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

const info = {
  id: `${session.id}-xdmcp`,
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

  it("launches a real backend handle and preserves it across remount", async () => {
    const { result, unmount } = renderHook(() => useXdmcpClient(session));
    await waitFor(() => expect(result.current.status).toBe("x-server-running"));
    expect(mocks.invoke).toHaveBeenCalledWith("connect_xdmcp", {
      sessionId: `${session.id}-xdmcp`,
      config: expect.objectContaining({
        acknowledge_insecure_transport: true,
        auth_data: null,
      }),
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).toContain(
      `${session.id}-xdmcp`,
    );

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
});
