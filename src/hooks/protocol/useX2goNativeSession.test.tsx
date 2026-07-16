import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  buildX2goNativeConfig,
  getUnsupportedX2goRouteReason,
  useX2goNativeSession,
  x2goNativeErrorMessage,
} from "./useX2goNativeSession";

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

const password = "saved-password-must-not-cross-ipc";
const connection = {
  id: "x2go-connection-1",
  name: "Linux desktop",
  protocol: "x2go",
  hostname: "x2go.example.test",
  port: 22,
  username: "alice",
  password,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  x2goSessionType: "Xfce",
  x2goWidth: 1440,
  x2goHeight: 900,
} as unknown as Connection;

const session: ConnectionSession = {
  id: "x2go-session-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "x2go",
  hostname: connection.hostname,
};

const info = {
  id: session.id,
  host: connection.hostname,
  username: connection.username,
  state: "Running",
  native_client_pid: 123,
  runtime_mode: "native-x2goclient-handoff",
  remote_authentication_confirmed: false,
  last_activity: "2026-01-01T00:00:00Z",
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
    if (command === "get_x2go_session_info") return Promise.resolve(info);
    return Promise.resolve(undefined);
  });
});

describe("useX2goNativeSession", () => {
  it("builds a native profile config without the saved password", () => {
    const config = buildX2goNativeConfig(connection, session);
    expect(config.ssh.auth).toEqual({ Password: { password: "" } });
    expect(JSON.stringify(config)).not.toContain(password);
    expect(config.display).toEqual({ Window: { width: 1440, height: 900 } });
  });

  it("tracks only the native process and never dispatches a credential", async () => {
    const { result, unmount } = renderHook(() => useX2goNativeSession(session));
    await waitFor(() =>
      expect(result.current.status).toBe("native-client-running"),
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "connect_x2go",
      expect.objectContaining({ sessionId: session.id }),
    );
    const calls = JSON.stringify(mocks.invoke.mock.calls);
    const dispatched = JSON.stringify(mocks.dispatch.mock.calls);
    expect(calls).not.toContain(password);
    expect(dispatched).not.toContain(password);
    expect(dispatched).toContain(session.id);

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_x2go", {
      sessionId: session.id,
    });
  });

  it("fails closed for app-level routes and redacts echoed secrets", () => {
    expect(
      getUnsupportedX2goRouteReason({
        ...connection,
        proxyChainId: "proxy-chain",
      }),
    ).toMatch(/cannot consume/i);
    expect(x2goNativeErrorMessage(`failure ${password}`, connection)).toBe(
      "failure [redacted]",
    );
  });

  it("does not claim connected when X2Go exits during the info race", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_x2go_session_info") {
        return Promise.resolve({
          ...info,
          state: "Ended",
          native_client_pid: null,
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useX2goNativeSession(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_x2go", {
      sessionId: session.id,
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"connected"',
    );
  });
});
