import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  buildNxNativeConnectArgs,
  getUnsupportedNxRouteReason,
  nxSessionTypeWireValue,
  nxNativeErrorMessage,
  useNxNativeSession,
} from "./useNxNativeSession";

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

const password = "nomachine-password-must-not-cross-ipc";
const connection = {
  id: "nx-connection-1",
  name: "NoMachine desktop",
  protocol: "nx",
  hostname: "nx.example.test",
  port: 4000,
  username: "alice",
  password,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  nxConnectionService: "nx",
  nxSessionType: "UnixDesktop",
} as unknown as Connection;

const session: ConnectionSession = {
  id: "nx-frontend-session-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "nx",
  hostname: connection.hostname,
};

const info = {
  id: "nx-backend-session-1",
  host: connection.hostname,
  port: 4000,
  username: connection.username,
  label: connection.name,
  state: "Running",
  native_client_pid: 456,
  server_session_id: null,
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
    if (command === "connect_nx") return Promise.resolve(info.id);
    if (command === "get_nx_session_info") return Promise.resolve(info);
    return Promise.resolve(undefined);
  });
});

describe("useNxNativeSession", () => {
  it("builds nxplayer arguments without the saved password", () => {
    const args = buildNxNativeConnectArgs(connection, session);
    expect(args.password).toBeNull();
    expect(JSON.stringify(args)).not.toContain(password);
    expect(args.connectionService).toBe("nx");
  });

  it("pins imported clipboard-off values to the portable enabled contract", () => {
    expect(
      buildNxNativeConnectArgs(
        { ...connection, nxClipboardEnabled: false },
        session,
      ).clipboard,
    ).toBe(true);
  });

  it("maps every advertised session type to the exact wire value", () => {
    expect(
      [
        "UnixDesktop",
        "UnixGnome",
        "UnixKde",
        "UnixXfce",
        "UnixCustom",
        "Shadow",
        "Windows",
        "Vnc",
        "Application",
        "Console",
      ].map((value) =>
        nxSessionTypeWireValue(
          value as Parameters<typeof nxSessionTypeWireValue>[0],
        ),
      ),
    ).toEqual([
      "unix-desktop",
      "unix-gnome",
      "unix-kde",
      "unix-xfce",
      "unix-custom",
      "shadow",
      "windows",
      "vnc",
      "application",
      "console",
    ]);
  });

  it("tracks only the nxplayer process and does not disconnect on viewer remount", async () => {
    const { result, unmount } = renderHook(() => useNxNativeSession(session));
    await waitFor(() =>
      expect(result.current.status).toBe("native-client-running"),
    );

    const calls = JSON.stringify(mocks.invoke.mock.calls);
    const dispatched = JSON.stringify(mocks.dispatch.mock.calls);
    expect(calls).not.toContain(password);
    expect(dispatched).not.toContain(password);
    expect(dispatched).toContain(info.id);

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_nx", {
      sessionId: info.id,
    });
  });

  it("fails closed for app-level routes and redacts echoed secrets", () => {
    expect(
      getUnsupportedNxRouteReason({
        ...connection,
        tunnelChainId: "tunnel-chain",
      }),
    ).toMatch(/cannot consume/i);
    expect(nxNativeErrorMessage(`failure ${password}`, connection)).toBe(
      "failure [redacted]",
    );
  });

  it("does not claim connected when nxplayer exits during the info race", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_nx") return Promise.resolve(info.id);
      if (command === "get_nx_session_info") {
        return Promise.resolve({
          ...info,
          state: "Terminated",
          native_client_pid: null,
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNxNativeSession(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_nx", {
      sessionId: info.id,
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"connected"',
    );
  });

  it("disconnects the launched client when its info probe rejects", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_nx") return Promise.resolve(info.id);
      if (command === "get_nx_session_info") {
        return Promise.reject(new Error("info probe failed"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNxNativeSession(session));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_nx", {
      sessionId: info.id,
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"connected"',
    );
  });

  it("disconnects a launch that becomes stale while info is pending", async () => {
    let resolveInfo!: (value: typeof info) => void;
    const pendingInfo = new Promise<typeof info>((resolve) => {
      resolveInfo = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_nx") return Promise.resolve(info.id);
      if (command === "get_nx_session_info") return pendingInfo;
      return Promise.resolve(undefined);
    });

    const { unmount } = renderHook(() => useNxNativeSession(session));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "get_nx_session_info",
        expect.any(Object),
      ),
    );
    unmount();

    await act(async () => {
      resolveInfo(info);
      await pendingInfo;
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("disconnect_nx", {
        sessionId: info.id,
      }),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"connected"',
    );
  });
});
