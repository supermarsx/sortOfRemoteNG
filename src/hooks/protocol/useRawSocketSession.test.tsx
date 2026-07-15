import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { createDefaultRawSocketSettings } from "../../types/protocols/rawSocket";
import type {
  RawSocketBackendSession,
  RawSocketEvent,
} from "./rawSocketRuntime";

const mocks = vi.hoisted(() => {
  class MockChannel<T> {
    readonly id: number;

    constructor(private readonly callback: (message: T) => void) {
      this.id = channelInstances.length;
      channelInstances.push(this as MockChannel<unknown>);
    }

    emit(message: T): void {
      this.callback(message);
    }

    toJSON(): string {
      return `channel:${this.id}`;
    }
  }

  const channelInstances: MockChannel<unknown>[] = [];
  return {
    MockChannel,
    channelInstances,
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

import { useRawSocketSession } from "./useRawSocketSession";

const connection: Connection = {
  id: "connection-raw-1",
  name: "Raw endpoint",
  protocol: "raw",
  hostname: "127.0.0.1",
  port: 9000,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  connectionCount: 3,
  rawSocketSettings: createDefaultRawSocketSettings("tcp"),
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-raw-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "raw",
  hostname: connection.hostname,
  ...patch,
});

const backendSession = (id = "backend-raw-1"): RawSocketBackendSession => ({
  id,
  connectionId: connection.id,
  host: connection.hostname,
  port: connection.port,
  transport: "tcp",
  status: "connected",
  localAddress: "127.0.0.1:41000",
  remoteAddress: "127.0.0.1:9000",
  stats: {
    bytesSent: 0,
    bytesReceived: 0,
    framesSent: 0,
    framesReceived: 0,
    datagramsSent: 0,
    datagramsReceived: 0,
    deliveryFailures: 0,
    replayEvictions: 0,
    connectedAtMs: 1,
    lastActivityAtMs: 1,
  },
});

const runtimePath = {
  protocol: "raw-tcp",
  transport: {
    jump_hosts: [],
    proxy_config: null,
    proxy_chain: null,
    mixed_chain: null,
    openvpn_config: null,
    vpnPreSteps: [],
  },
  rdpTunnel: null,
  snapshot: {
    version: 1 as const,
    transports: ["direct"],
    connectionIds: [connection.id],
  },
  redactionSecrets: [],
};

const channelAt = <T,>(index: number) =>
  mocks.channelInstances[index] as { emit(message: T): void };

beforeEach(() => {
  mocks.channelInstances.length = 0;
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.resolveRuntimeNetworkPath.mockReset();
  mocks.resolveRuntimeNetworkPath.mockResolvedValue(runtimePath);
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "connect_raw_socket")
      return Promise.resolve("backend-raw-1");
    return Promise.resolve(undefined);
  });
});

describe("useRawSocketSession", () => {
  it("opens a real backend session, preserves binary frames, sends exact bytes, and has no fake metrics", async () => {
    const { result, unmount } = renderHook(() =>
      useRawSocketSession(createSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "connect_raw_socket",
      expect.objectContaining({
        options: expect.objectContaining({
          host: connection.hostname,
          port: connection.port,
          route: { kind: "direct" },
        }),
        dataChannel: expect.any(mocks.MockChannel),
        eventChannel: expect.any(mocks.MockChannel),
      }),
    );
    expect(result.current.stats).toBeNull();

    const dataChannel = channelAt<ArrayBuffer>(0);
    const eventChannel = channelAt<RawSocketEvent>(1);
    await act(async () => {
      dataChannel.emit(Uint8Array.of(0x00, 0xff, 0x80).buffer);
      eventChannel.emit({
        type: "data",
        frame: {
          sessionId: "backend-raw-1",
          sequence: 1,
          timestampMs: 22,
          direction: "inbound",
          datagram: false,
          byteLength: 3,
          replayed: false,
        },
      });
    });

    expect([...result.current.transcript.entries[0].data]).toEqual([
      0, 255, 128,
    ]);
    await act(async () => {
      await result.current.send(Uint8Array.of(0x00, 0xfe));
    });
    expect(mocks.invoke).toHaveBeenCalledWith("send_raw_socket_data", {
      sessionId: "backend-raw-1",
      data: [0, 254],
    });

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_raw_socket", {
      sessionId: "backend-raw-1",
    });
  });

  it("reattaches a detached backend, deduplicates replay, and does not count a new connection", async () => {
    mocks.invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) => {
        if (command === "get_raw_socket_session_info") {
          return Promise.resolve(backendSession());
        }
        if (command === "attach_raw_socket") {
          const dataChannel = args.dataChannel as {
            emit(message: ArrayBuffer): void;
          };
          const eventChannel = args.eventChannel as {
            emit(message: RawSocketEvent): void;
          };
          dataChannel.emit(Uint8Array.of(0x10, 0x00).buffer);
          eventChannel.emit({
            type: "data",
            frame: {
              sessionId: "backend-raw-1",
              sequence: 1,
              timestampMs: 30,
              direction: "inbound",
              datagram: false,
              byteLength: 2,
              replayed: true,
            },
          });
          return Promise.resolve({
            sessionId: "backend-raw-1",
            frames: [
              {
                sequence: 1,
                timestampMs: 30,
                direction: "inbound",
                datagram: false,
                data: [0x10, 0x00],
              },
            ],
            evictedFrames: 0,
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() =>
      useRawSocketSession(
        createSession({
          status: "connected",
          backendSessionId: "backend-raw-1",
        }),
      ),
    );

    await waitFor(() =>
      expect(result.current.transcript.entries).toHaveLength(1),
    );
    expect([...result.current.transcript.entries[0].data]).toEqual([16, 0]);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === "UPDATE_CONNECTION",
      ),
    ).toBe(false);
  });

  it("performs exactly one new backend connection for each central reconnect attempt", async () => {
    let connectionNumber = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_raw_socket") {
        connectionNumber += 1;
        return Promise.resolve(`backend-raw-${connectionNumber}`);
      }
      return Promise.resolve(undefined);
    });
    const firstSession = createSession();
    const { result, rerender } = renderHook(
      ({ session }) => useRawSocketSession(session),
      { initialProps: { session: firstSession } },
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.dispatch.mockClear();

    rerender({
      session: createSession({ status: "reconnecting", reconnectAttempts: 1 }),
    });

    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-raw-2"),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "connect_raw_socket",
      ),
    ).toHaveLength(2);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_raw_socket",
      ),
    ).toHaveLength(1);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.payload?.status === "disconnected",
      ),
    ).toBe(false);
  });

  it("preserves the backend when the detach coordinator signals before unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useRawSocketSession(createSession()),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    window.dispatchEvent(
      new CustomEvent("sorng:session-will-detach", {
        detail: { sessionId: "frontend-raw-1" },
      }),
    );
    unmount();
    await act(async () => Promise.resolve());

    expect(mocks.invoke).toHaveBeenCalledWith("detach_raw_socket", {
      sessionId: "backend-raw-1",
    });
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "disconnect_raw_socket",
      ),
    ).toBe(false);
  });
});
