import { act, render, renderHook, waitFor } from "@testing-library/react";
import { startTransition, Suspense, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRenderActivityProvider } from "../../components/session/SessionRenderActivity";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { createDefaultRloginSettings } from "../../utils/rlogin/rloginSettings";
import type {
  RloginBackendSession,
  RloginDeliveredOutput,
  RloginEvent,
  RloginReplaySnapshot,
} from "./rloginRuntime";

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

import {
  appendBoundedRloginOutputBatch,
  useRloginSession,
} from "./useRloginSession";
import {
  RLOGIN_POLL_INTERVAL_MS,
  rloginPollingScheduler,
} from "./rloginPollingScheduler";

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

const flushAsyncWork = async (turns = 16): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) {
      await Promise.resolve();
    }
  });
};

const emitLiveOutput = async (
  sequence: number,
  data: Uint8Array,
): Promise<void> => {
  const dataChannel = mocks.channels[0] as { emit(data: ArrayBuffer): void };
  const eventChannel = mocks.channels[1] as {
    emit(event: RloginEvent): void;
  };
  const copiedData = new ArrayBuffer(data.byteLength);
  new Uint8Array(copiedData).set(data);
  await act(async () => {
    dataChannel.emit(copiedData);
    eventChannel.emit({
      type: "output",
      frame: {
        sessionId: "backend-rlogin-1",
        sequence,
        byteLength: data.byteLength,
        prefixTruncated: false,
        replayed: false,
      },
    });
  });
};

const createActivityHarness = (initialActive: boolean) => {
  let update: ((active: boolean) => void) | null = null;
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const [isActive, setIsActive] = useState(initialActive);
    update = setIsActive;
    return (
      <SessionRenderActivityProvider isActive={isActive}>
        {children}
      </SessionRenderActivityProvider>
    );
  };
  return {
    Wrapper,
    async setActive(active: boolean): Promise<void> {
      if (!update) throw new Error("activity harness is not mounted");
      await act(async () => update?.(active));
    },
  };
};

const deferredSnapshot = () => {
  let resolvePromise: ((snapshot: RloginReplaySnapshot) => void) | null = null;
  const promise = new Promise<RloginReplaySnapshot>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(snapshot: RloginReplaySnapshot): void {
      if (!resolvePromise) throw new Error("snapshot promise is unavailable");
      resolvePromise(snapshot);
    },
  };
};

beforeEach(() => {
  rloginPollingScheduler.dispose();
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

afterEach(() => {
  rloginPollingScheduler.dispose();
  vi.useRealTimers();
});

describe("useRloginSession", () => {
  it("bounds a bulk output merge in one linear pass", () => {
    const incoming: RloginDeliveredOutput[] = Array.from(
      { length: 4_096 },
      (_, index) => ({
        sessionId: "bulk",
        sequence: index + 1,
        byteLength: 512,
        prefixTruncated: false,
        replayed: true,
        data: new Uint8Array(512),
      }),
    );
    const bounded = appendBoundedRloginOutputBatch([], 0, incoming);

    expect(bounded.frames).toHaveLength(2_048);
    expect(bounded.frames[0].sequence).toBe(2_049);
    expect(bounded.frames[bounded.frames.length - 1].sequence).toBe(4_096);
    expect(bounded.byteLength).toBe(1024 * 1024);
    expect(bounded.truncated).toBe(true);
    expect(bounded.examinedFrames).toBe(6_144);
    expect(bounded.examinedFrames).toBeLessThanOrEqual(incoming.length * 2);
  });

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

  it("keeps hidden live output off React, retries a failed activation replay, and merges in order", async () => {
    vi.useFakeTimers();
    const activity = createActivityHarness(true);
    const { result, unmount } = renderHook(() => useRloginSession(session()), {
      wrapper: activity.Wrapper,
    });
    await flushAsyncWork();
    expect(result.current.status).toBe("connected");

    await emitLiveOutput(10, Uint8Array.of(10));
    expect(result.current.outputFrames.map((frame) => frame.sequence)).toEqual([
      10,
    ]);

    await activity.setActive(false);
    await emitLiveOutput(13, Uint8Array.of(130));
    const outputBeforeFailedReplay = result.current.outputFrames;
    expect(outputBeforeFailedReplay.map((frame) => frame.sequence)).toEqual([
      10,
    ]);

    let activationReplayAttempts = 0;
    const baseImplementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "get_rlogin_output_snapshot") {
          activationReplayAttempts += 1;
          if (activationReplayAttempts === 1) {
            return Promise.reject(new Error("temporary replay failure"));
          }
          return Promise.resolve({
            frames: [11, 12, 13].map((sequence) => ({
              sequence,
              data: [sequence],
              prefixTruncated: false,
            })),
            firstAvailableSequence: 11,
            nextSequence: 14,
            truncated: false,
          });
        }
        return baseImplementation(command, args);
      },
    );

    await activity.setActive(true);
    await flushAsyncWork();
    expect(activationReplayAttempts).toBe(1);
    expect(result.current.outputFrames).toBe(outputBeforeFailedReplay);
    expect(result.current.outputFrames.map((frame) => frame.sequence)).toEqual([
      10,
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RLOGIN_POLL_INTERVAL_MS);
    });
    await flushAsyncWork();
    expect(activationReplayAttempts).toBe(2);
    const activationCalls = mocks.invoke.mock.calls.filter(
      ([command]) => command === "get_rlogin_output_snapshot",
    );
    expect(activationCalls.slice(-2).map(([, args]) => args)).toEqual([
      { sessionId: "backend-rlogin-1", afterSequence: 10 },
      { sessionId: "backend-rlogin-1", afterSequence: 10 },
    ]);
    expect(
      result.current.outputFrames.slice(1).map((frame) => frame.sequence),
    ).toEqual([11, 12, 13]);
    expect(
      result.current.outputFrames.filter((frame) => frame.sequence === 13),
    ).toHaveLength(1);

    unmount();
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
  });

  it("does not apply activity gating from an interrupted render", async () => {
    vi.useFakeTimers();
    type Phase = { isActive: boolean; suspend: boolean };
    const neverResolves = new Promise<void>(() => undefined);
    const phaseController: { update?: (phase: Phase) => void } = {};
    let suspendedRenders = 0;
    let committedOutput: readonly RloginDeliveredOutput[] = [];

    const Probe = ({ suspend }: { suspend: boolean }) => {
      const model = useRloginSession(session());
      if (suspend) {
        suspendedRenders += 1;
        throw neverResolves;
      }
      committedOutput = model.outputFrames;
      return null;
    };
    const Harness = () => {
      const [phase, setPhase] = useState<Phase>({
        isActive: true,
        suspend: false,
      });
      phaseController.update = setPhase;
      return (
        <SessionRenderActivityProvider isActive={phase.isActive}>
          <Suspense fallback={null}>
            <Probe suspend={phase.suspend} />
          </Suspense>
        </SessionRenderActivityProvider>
      );
    };

    const view = render(<Harness />);
    await flushAsyncWork();
    await emitLiveOutput(10, Uint8Array.of(10));
    expect(committedOutput.map((frame) => frame.sequence)).toEqual([10]);
    const snapshotCallsBeforeInterrupt = mocks.invoke.mock.calls.filter(
      ([command]) => command === "get_rlogin_output_snapshot",
    ).length;

    const setPhase = phaseController.update;
    if (!setPhase) throw new Error("phase harness is not mounted");
    await act(async () => {
      startTransition(() => setPhase({ isActive: false, suspend: true }));
      await Promise.resolve();
    });
    expect(suspendedRenders).toBeGreaterThan(0);
    expect(rloginPollingScheduler.diagnostics().activeRegistrations).toBe(1);

    await emitLiveOutput(11, Uint8Array.of(11));
    await flushAsyncWork();
    expect(committedOutput.map((frame) => frame.sequence)).toEqual([10, 11]);
    expect(rloginPollingScheduler.diagnostics().activeRegistrations).toBe(1);

    await act(async () => {
      startTransition(() => setPhase({ isActive: true, suspend: false }));
      await Promise.resolve();
    });
    await flushAsyncWork();
    expect(committedOutput.map((frame) => frame.sequence)).toEqual([10, 11]);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "get_rlogin_output_snapshot",
      ),
    ).toHaveLength(snapshotCallsBeforeInterrupt);

    view.unmount();
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
  });

  it("bounds hidden live output at 2048 frames and 1 MiB, then propagates truncation", async () => {
    vi.useFakeTimers();
    const activity = createActivityHarness(false);
    const { result, unmount } = renderHook(() => useRloginSession(session()), {
      wrapper: activity.Wrapper,
    });
    await flushAsyncWork();
    expect(result.current.status).toBe("connected");
    const initialOutput = result.current.outputFrames;
    const initialInfoCalls = mocks.invoke.mock.calls.filter(
      ([command]) => command === "get_rlogin_session_info",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RLOGIN_POLL_INTERVAL_MS * 10);
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "get_rlogin_output_snapshot",
      ),
    ).toHaveLength(0);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "get_rlogin_session_info",
      ),
    ).toHaveLength(initialInfoCalls);

    const dataChannel = mocks.channels[0] as { emit(data: ArrayBuffer): void };
    const eventChannel = mocks.channels[1] as {
      emit(event: RloginEvent): void;
    };
    const payload = new Uint8Array(512);
    await act(async () => {
      for (let sequence = 1; sequence <= 2_050; sequence += 1) {
        dataChannel.emit(payload.buffer);
        eventChannel.emit({
          type: "output",
          frame: {
            sessionId: "backend-rlogin-1",
            sequence,
            byteLength: payload.byteLength,
            prefixTruncated: false,
            replayed: false,
          },
        });
      }
    });
    expect(result.current.outputFrames).toBe(initialOutput);
    expect(result.current.outputFrames).toHaveLength(0);
    expect(result.current.replayTruncated).toBe(false);

    await activity.setActive(true);
    await flushAsyncWork();
    expect(result.current.outputFrames).toHaveLength(2_048);
    expect(result.current.outputFrames[0].sequence).toBe(3);
    expect(
      result.current.outputFrames[result.current.outputFrames.length - 1]
        ?.sequence,
    ).toBe(2_050);
    expect(
      result.current.outputFrames.reduce(
        (bytes, frame) => bytes + frame.data.byteLength,
        0,
      ),
    ).toBe(1024 * 1024);
    expect(result.current.replayTruncated).toBe(true);

    unmount();
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
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

  it("starts a reconnect poll while the old generation remains unresolved", async () => {
    vi.useFakeTimers();
    const oldSnapshot = deferredSnapshot();
    const newSnapshot = deferredSnapshot();
    let connects = 0;
    const baseImplementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "connect_rlogin") {
          connects += 1;
          return Promise.resolve(`backend-rlogin-${connects}`);
        }
        if (command === "get_rlogin_output_snapshot") {
          return args?.sessionId === "backend-rlogin-1"
            ? oldSnapshot.promise
            : newSnapshot.promise;
        }
        return baseImplementation(command, args);
      },
    );

    const { result, rerender, unmount } = renderHook(
      ({ value }) => useRloginSession(value),
      { initialProps: { value: session() } },
    );
    await flushAsyncWork();
    expect(result.current.backendSessionId).toBe("backend-rlogin-1");
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 1,
      inFlight: 1,
      totalCalls: 1,
    });

    rerender({
      value: session({ status: "reconnecting", reconnectAttempts: 1 }),
    });
    await flushAsyncWork(32);
    expect(result.current.backendSessionId).toBe("backend-rlogin-2");
    const snapshotSessionIds = mocks.invoke.mock.calls
      .filter(([command]) => command === "get_rlogin_output_snapshot")
      .map(([, args]) => (args as { sessionId: string }).sessionId);
    expect(snapshotSessionIds).toEqual([
      "backend-rlogin-1",
      "backend-rlogin-2",
    ]);
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 1,
      timerCount: 1,
      inFlight: 2,
      totalCalls: 2,
    });

    newSnapshot.resolve({
      frames: [],
      firstAvailableSequence: null,
      nextSequence: 1,
      truncated: false,
    });
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics().inFlight).toBe(1);

    oldSnapshot.resolve({
      frames: [{ sequence: 99, data: [99], prefixTruncated: false }],
      firstAvailableSequence: 99,
      nextSequence: 100,
      truncated: false,
    });
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics().inFlight).toBe(0);
    expect(result.current.outputFrames).toHaveLength(0);

    unmount();
    await flushAsyncWork();
    expect(rloginPollingScheduler.diagnostics()).toMatchObject({
      registrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
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
