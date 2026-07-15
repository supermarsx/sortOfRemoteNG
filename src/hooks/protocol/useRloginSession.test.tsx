import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { createDefaultRloginSettings } from "../../utils/rlogin/rloginSettings";
import type { RloginBackendSession, RloginEvent } from "./rloginRuntime";

const mocks = vi.hoisted(() => {
  class MockChannel<T> {
    readonly id: number;
    constructor(private readonly callback: (message: T) => void) {
      this.id = channels.length;
      channels.push(this as MockChannel<unknown>);
    }
    emit(message: T): void {
      this.callback(message);
    }
    toJSON(): string {
      return `channel:${this.id}`;
    }
  }
  const channels: MockChannel<unknown>[] = [];
  return {
    MockChannel,
    channels,
    invoke: vi.fn(),
    dispatch: vi.fn(),
    useConnections: vi.fn(),
    resolveRuntimeNetworkPath: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: mocks.MockChannel,
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));
vi.mock(
  "../../utils/network/resolveRuntimeNetworkPath",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      resolveRuntimeNetworkPath: (...args: unknown[]) =>
        mocks.resolveRuntimeNetworkPath(...args),
    };
  },
);

import { useRloginSession } from "./useRloginSession";

const rloginSettings = createDefaultRloginSettings();
rloginSettings.localUsername = "local-user";
rloginSettings.remoteUsername = "remote-user";
rloginSettings.plaintextAcknowledgement = {
  version: 1,
  scope: "rlogin-plaintext-v1",
  acknowledged: true,
  acknowledgedAt: "2026-01-01T00:00:00.000Z",
};

const connection: Connection = {
  id: "connection-rlogin-1",
  name: "Legacy host",
  protocol: "rlogin",
  hostname: "legacy.example.test",
  port: 513,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  connectionCount: 2,
  rloginSettings,
};

const session = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-rlogin-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "rlogin",
  hostname: connection.hostname,
  ...patch,
});

const capabilities = {
  directRoute: true,
  proxyRoutes: false,
  reservedSourcePort: false,
  outOfBandControl: false,
  limitationMessages: [],
};

const backend = (id: string): RloginBackendSession => ({
  id,
  connectionId: connection.id,
  host: connection.hostname,
  port: 513,
  localUsername: "local-user",
  remoteUsername: "remote-user",
  terminalType: "xterm-256color",
  terminalSpeed: 38_400,
  connected: true,
  lifecycle: "connected",
  terminalMode: "cooked",
  windowUpdatesEnabled: true,
  localAddress: "127.0.0.1:42000",
  remoteAddress: "127.0.0.1:513",
  sourcePortFallback: false,
  capabilities,
  stats: {
    handshakeBytesSent: 32,
    terminalBytesSent: 0,
    terminalBytesReceived: 0,
    protocolBytesSent: 0,
    resizeFramesSent: 0,
    urgentControlsReceived: 0,
    discardedOutputBytes: 0,
  },
  connectedAtMs: 1,
});

beforeEach(() => {
  mocks.channels.length = 0;
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.resolveRuntimeNetworkPath.mockReset();
  mocks.resolveRuntimeNetworkPath.mockResolvedValue({
    protocol: "rlogin",
    transport: {},
    rdpTunnel: null,
    snapshot: {
      version: 1,
      transports: ["direct"],
      connectionIds: [connection.id],
    },
    redactionSecrets: [],
  });
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation(
    (command: string, args?: Record<string, unknown>) => {
      if (command === "diagnose_rlogin_connection") {
        return Promise.resolve({
          compatible: true,
          requestedRoute: "direct",
          sourcePortMode: "ephemeral",
          capabilities,
          blockers: [],
          warnings: [],
        });
      }
      if (command === "connect_rlogin")
        return Promise.resolve("backend-rlogin-1");
      if (command === "get_rlogin_session_info") {
        return Promise.resolve(backend(String(args?.sessionId)));
      }
      if (command === "get_rlogin_output_snapshot") {
        return Promise.resolve({
          frames: [],
          firstAvailableSequence: null,
          nextSequence: 1,
          truncated: false,
        });
      }
      return Promise.resolve(undefined);
    },
  );
});

describe("useRloginSession", () => {
  it("connects, accepts remote binary output, sends input and resizes without local echo", async () => {
    const { result, unmount } = renderHook(() => useRloginSession(session()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "connect_rlogin",
      expect.objectContaining({
        options: expect.objectContaining({
          route: { kind: "direct" },
          plaintextAcknowledged: true,
        }),
      }),
    );

    const dataChannel = mocks.channels[0] as { emit(data: ArrayBuffer): void };
    const eventChannel = mocks.channels[1] as {
      emit(event: RloginEvent): void;
    };
    await act(async () => {
      dataChannel.emit(Uint8Array.of(0x00, 0xff, 0x80).buffer);
      eventChannel.emit({
        type: "output",
        frame: {
          sessionId: "backend-rlogin-1",
          sequence: 1,
          byteLength: 3,
          prefixTruncated: false,
          replayed: false,
        },
      });
    });
    expect([...result.current.outputFrames[0].data]).toEqual([0, 255, 128]);

    await act(async () => {
      await result.current.sendInput("ls\r");
      await result.current.resize(100, 30, 800, 600);
    });
    expect(result.current.outputFrames).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledWith("send_rlogin_input", {
      sessionId: "backend-rlogin-1",
      data: [108, 115, 13],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("resize_rlogin", {
      sessionId: "backend-rlogin-1",
      size: { rows: 30, columns: 100, widthPixels: 800, heightPixels: 600 },
    });

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_rlogin", {
      sessionId: "backend-rlogin-1",
    });
  });

  it("restores retained output by polling and preserves detached backend state", async () => {
    mocks.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "get_rlogin_session_info") {
          return Promise.resolve(backend(String(args?.sessionId)));
        }
        if (command === "get_rlogin_output_snapshot") {
          return Promise.resolve({
            frames: [
              { sequence: 4, data: [65, 0, 66], prefixTruncated: false },
            ],
            firstAvailableSequence: 4,
            nextSequence: 5,
            truncated: true,
          });
        }
        return Promise.resolve(undefined);
      },
    );
    const detached = session({
      status: "connected",
      backendSessionId: "backend-rlogin-detached",
      layout: {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
        isDetached: true,
      },
    });
    const { result, unmount } = renderHook(() => useRloginSession(detached));
    await waitFor(() => expect(result.current.outputFrames).toHaveLength(1));
    expect([...result.current.outputFrames[0].data]).toEqual([65, 0, 66]);
    expect(result.current.replayTruncated).toBe(true);

    unmount();
    await act(async () => Promise.resolve());
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "disconnect_rlogin",
      ),
    ).toBe(false);
  });

  it("creates exactly one replacement backend for a central reconnect attempt", async () => {
    let connects = 0;
    const baseImplementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "connect_rlogin") {
          connects += 1;
          return Promise.resolve(`backend-rlogin-${connects}`);
        }
        return baseImplementation(command, args);
      },
    );
    const { result, rerender } = renderHook(
      ({ value }) => useRloginSession(value),
      { initialProps: { value: session() } },
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    rerender({
      value: session({ status: "reconnecting", reconnectAttempts: 1 }),
    });
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-rlogin-2"),
    );
    expect(connects).toBe(2);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_rlogin",
      ),
    ).toHaveLength(1);
  });

  it("preserves a live backend when main signals an imminent detach", async () => {
    const { result, unmount } = renderHook(() => useRloginSession(session()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    window.dispatchEvent(
      new CustomEvent("sorng:session-will-detach", {
        detail: { sessionId: "frontend-rlogin-1" },
      }),
    );
    unmount();
    await act(async () => Promise.resolve());

    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "disconnect_rlogin",
      ),
    ).toBe(false);
  });
});
