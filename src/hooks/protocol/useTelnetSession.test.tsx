import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      mocks.listeners.set(eventName, handler);
      return mocks.unlisten;
    },
  ),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import { useTelnetSession } from "./useTelnetSession";

const connection: Connection = {
  id: "connection-telnet-1",
  name: "Legacy switch",
  protocol: "telnet",
  hostname: "switch.example.test",
  port: 2323,
  username: "operator",
  password: "secret",
  timeout: 9,
  retryAttempts: 2,
  retryDelay: 4,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-telnet-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "telnet",
  hostname: connection.hostname,
  ...patch,
});

const emit = (eventName: string, payload: unknown) => {
  const handler = mocks.listeners.get(eventName);
  if (!handler) throw new Error(`No listener registered for ${eventName}`);
  handler({ payload });
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.listeners.clear();
  mocks.unlisten.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "connect_telnet") {
      return Promise.resolve("backend-telnet-1");
    }
    return Promise.resolve(undefined);
  });
});

describe("useTelnetSession", () => {
  it("connects through the native service, streams output, and sends exact input", async () => {
    const { result } = renderHook(() => useTelnetSession(createSession()));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("connect_telnet", {
      config: expect.objectContaining({
        host: "switch.example.test",
        port: 2323,
        username: "operator",
        password: "secret",
        connect_timeout_secs: 9,
        max_reconnect_attempts: 2,
        reconnect_delay_secs: 4,
      }),
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "frontend-telnet-1",
        backendSessionId: "backend-telnet-1",
        status: "connected",
      }),
    });

    await act(async () => {
      emit("telnet-output", {
        session_id: "backend-telnet-1",
        data: "login: ",
      });
      await result.current.sendInput("A\r");
      await result.current.resize(120, 40);
      await result.current.sendAreYouThere();
      await result.current.sendBreak();
    });

    expect(result.current.outputChunks).toEqual(["login: "]);
    expect(mocks.invoke).toHaveBeenCalledWith("send_telnet_raw", {
      sessionId: "backend-telnet-1",
      hexData: "410d",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("resize_telnet", {
      sessionId: "backend-telnet-1",
      cols: 120,
      rows: 40,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("send_telnet_ayt", {
      sessionId: "backend-telnet-1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("send_telnet_break", {
      sessionId: "backend-telnet-1",
    });
  });

  it("reattaches a live backend and surfaces backend closure truthfully", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "is_telnet_connected") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    const { result, unmount } = renderHook(() =>
      useTelnetSession(
        createSession({
          status: "connected",
          backendSessionId: "backend-telnet-existing",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("is_telnet_connected", {
      sessionId: "backend-telnet-existing",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "connect_telnet",
      expect.anything(),
    );

    act(() => {
      emit("telnet-closed", {
        session_id: "backend-telnet-existing",
        reason: "remote closed",
      });
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.error).toBe("remote closed");

    unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_telnet", {
      sessionId: "backend-telnet-existing",
    });
  });
});
