import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRenderActivityProvider } from "../../src/components/session/SessionRenderActivity";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  debugLog: vi.fn(),
  dispatch: vi.fn(),
  invoke: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));
vi.mock("../../src/utils/core/debugLogger", () => ({
  debugLog: (...args: unknown[]) => mocks.debugLog(...args),
}));

import {
  useVNCClient,
  VNC_ACTIVITY_MAX_CONCURRENCY,
  VNC_CONNECT_MAX_CONCURRENCY,
} from "../../src/hooks/protocol/useVNCClient";

type VncClient = ReturnType<typeof useVNCClient>;

interface ActivityAuthority {
  active: boolean;
  activityGeneration: number;
  deliveryEpoch: number;
}

interface InvokeArgs {
  sessionId?: string;
  active?: boolean;
  down?: boolean;
  key?: number;
  buttonMask?: number;
  x?: number;
  y?: number;
  activityGeneration?: number;
  deliveryEpoch?: number;
  frameToken?: number;
}

interface VncEvent {
  kind: string;
  [key: string]: unknown;
}

interface PollPayload {
  stats: {
    framebuffer_width: number;
    framebuffer_height: number;
    frame_count: number;
    bytes_received: number;
  };
  events: VncEvent[];
}

type CommandResponder = (args: InvokeArgs) => unknown;

const clients = new Map<string, VncClient>();
const authorities = new Map<string, ActivityAuthority>();
const responders = new Map<string, CommandResponder[]>();
const commandOrder: string[] = [];
const canvasContext = {
  clearRect: vi.fn(() => commandOrder.push("canvas:clear")),
  getImageData: vi.fn(
    (_x: number, _y: number, width: number, height: number) =>
      new ImageData(width, height),
  ),
  putImageData: vi.fn(() => commandOrder.push("canvas:draw")),
};

let connections: Connection[] = [];
let backendSequence = 0;
let visibilityState: DocumentVisibilityState = "visible";
let originalVisibilityDescriptor: PropertyDescriptor | undefined;
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalImageData: typeof ImageData | undefined;

const deliveryCommands = new Set([
  "acknowledge_vnc_frame",
  "get_vnc_session_stats",
  "request_vnc_update",
]);

const flushAsyncWork = async (turns = 24): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) {
      await Promise.resolve();
    }
  });
};

const deferred = <T,>() => {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T): void {
      resolvePromise?.(value);
    },
    reject(reason?: unknown): void {
      rejectPromise?.(reason);
    },
  };
};

const makeConnection = (index = 1): Connection => ({
  id: `vnc-connection-${index}`,
  name: `VNC ${index}`,
  hostname: `vnc-${index}.example.test`,
  port: 5900,
  protocol: "vnc",
  password: "test-password",
  isGroup: false,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

const makeSession = (
  index = 1,
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: `vnc-frontend-${index}`,
  connectionId: `vnc-connection-${index}`,
  name: `VNC ${index}`,
  status: "connecting",
  startTime: new Date("2026-08-10T00:00:00.000Z"),
  protocol: "vnc",
  hostname: `vnc-${index}.example.test`,
  ...patch,
});

const emptyPoll = (): PollPayload => ({
  stats: {
    framebuffer_width: 2,
    framebuffer_height: 2,
    frame_count: 0,
    bytes_received: 0,
  },
  events: [],
});

const frameEvent = (
  sessionId: string,
  deliveryEpoch: number,
  frameToken: number,
): VncEvent => ({
  kind: "frame",
  frame: {
    session_id: sessionId,
    data: btoa(String.fromCharCode(1, 2, 3, 255)),
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    delivery_epoch: deliveryEpoch,
    frame_token: frameToken,
  },
});

const pollWith = (...events: VncEvent[]): PollPayload => ({
  ...emptyPoll(),
  events,
});

const queueResponse = (command: string, responder: CommandResponder): void => {
  const queue = responders.get(command) ?? [];
  queue.push(responder);
  responders.set(command, queue);
};

const commandCalls = (command: string) =>
  mocks.invoke.mock.calls.filter(
    ([calledCommand]) => calledCommand === command,
  );

const deliveryCalls = () =>
  mocks.invoke.mock.calls.filter(([command]) =>
    deliveryCommands.has(String(command)),
  );

const installRuntime = (): void => {
  mocks.invoke.mockImplementation(
    async (commandValue: unknown, argsValue?: unknown) => {
      const command = String(commandValue);
      const args = (argsValue ?? {}) as InvokeArgs;
      commandOrder.push(`invoke:${command}`);

      const queued = responders.get(command)?.shift();
      if (queued) return await queued(args);

      if (command === "connect_vnc") {
        const sessionId = `vnc-backend-${++backendSequence}`;
        authorities.set(sessionId, {
          active: true,
          activityGeneration: 0,
          deliveryEpoch: 1,
        });
        return sessionId;
      }
      if (command === "is_vnc_connected") return true;
      if (command === "get_vnc_session_info") {
        return {
          id: args.sessionId,
          connected: true,
          security_type: "VncAuth",
          server_name: "Test VNC",
          framebuffer_width: 2,
          framebuffer_height: 2,
          pixel_format: "rgba32",
        };
      }
      if (command === "set_vnc_session_activity") {
        const sessionId = String(args.sessionId);
        const requestedGeneration = Number(args.activityGeneration);
        const requestedActive = Boolean(args.active);
        const authority = authorities.get(sessionId);
        if (!authority) throw new Error("unknown VNC session");

        if (requestedGeneration > authority.activityGeneration) {
          authority.activityGeneration = requestedGeneration;
          authority.active = requestedActive;
          if (requestedActive) authority.deliveryEpoch += 1;
          return {
            sessionId,
            active: authority.active,
            activityGeneration: authority.activityGeneration,
            deliveryEpoch: authority.deliveryEpoch,
            accepted: true,
            refreshQueued: requestedActive,
          };
        }

        return {
          sessionId,
          active: authority.active,
          activityGeneration: authority.activityGeneration,
          deliveryEpoch: authority.deliveryEpoch,
          accepted: false,
          refreshQueued: false,
        };
      }
      if (command === "get_vnc_session_stats") return emptyPoll();
      if (command === "acknowledge_vnc_frame") {
        const sessionId = String(args.sessionId);
        const authority = authorities.get(sessionId);
        if (!authority) throw new Error("unknown VNC session");
        return {
          sessionId,
          accepted:
            authority.active &&
            args.deliveryEpoch === authority.deliveryEpoch &&
            Number(args.frameToken) > 0,
          active: authority.active,
          activityGeneration: authority.activityGeneration,
          deliveryEpoch: authority.deliveryEpoch,
        };
      }
      if (command === "disconnect_vnc") return undefined;
      if (
        command === "send_vnc_key_event" ||
        command === "send_vnc_pointer_event" ||
        command === "send_vnc_clipboard"
      ) {
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
};

const Probe = ({ session }: { session: ConnectionSession }) => {
  const client = useVNCClient(session);
  clients.set(session.id, client);
  return <canvas data-testid={session.id} ref={client.canvasRef} />;
};

const renderHarness = (
  sessions: ConnectionSession[],
  initialActive: boolean,
) => {
  let active = initialActive;
  const tree = () => (
    <SessionRenderActivityProvider isActive={active}>
      {sessions.map((session) => (
        <Probe key={session.id} session={session} />
      ))}
    </SessionRenderActivityProvider>
  );
  const view = render(tree());
  return {
    view,
    async setActive(nextActive: boolean): Promise<void> {
      active = nextActive;
      await act(async () => {
        view.rerender(tree());
        await Promise.resolve();
      });
    },
  };
};

const clickCanvas = (client: VncClient): void => {
  const canvas = client.canvasRef.current;
  if (!canvas) throw new Error("VNC canvas did not mount");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 2,
    height: 2,
    right: 2,
    bottom: 2,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  client.handleCanvasClick({
    clientX: 1,
    clientY: 1,
  } as React.MouseEvent<HTMLCanvasElement>);
};

const setVisibility = async (
  nextVisibility: DocumentVisibilityState,
): Promise<void> => {
  visibilityState = nextVisibility;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  clients.clear();
  authorities.clear();
  responders.clear();
  commandOrder.length = 0;
  backendSequence = 0;
  connections = [makeConnection()];
  visibilityState = "visible";
  mocks.debugLog.mockReset();
  mocks.dispatch.mockReset();
  mocks.invoke.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockImplementation(() => ({
    state: { connections, sessions: [] },
    dispatch: mocks.dispatch,
  }));
  installRuntime();
  canvasContext.clearRect.mockClear();
  canvasContext.getImageData.mockClear();
  canvasContext.putImageData.mockClear();

  originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });

  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(
      canvasContext,
    ) as typeof HTMLCanvasElement.prototype.getContext;

  originalImageData = globalThis.ImageData;
  if (!globalThis.ImageData) {
    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      value: class ImageDataMock {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;

        constructor(
          dataOrWidth: Uint8ClampedArray | number,
          widthOrHeight: number,
          height?: number,
        ) {
          if (typeof dataOrWidth === "number") {
            this.width = dataOrWidth;
            this.height = widthOrHeight;
            this.data = new Uint8ClampedArray(this.width * this.height * 4);
          } else {
            this.data = dataOrWidth;
            this.width = widthOrHeight;
            this.height = height ?? 0;
          }
        }
      },
    });
  }
});

afterEach(async () => {
  cleanup();
  await flushAsyncWork();
  vi.clearAllTimers();
  vi.useRealTimers();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  if (originalVisibilityDescriptor) {
    Object.defineProperty(
      document,
      "visibilityState",
      originalVisibilityDescriptor,
    );
  }
  if (originalImageData === undefined) {
    Reflect.deleteProperty(globalThis, "ImageData");
  } else {
    globalThis.ImageData = originalImageData;
  }
});

describe("useVNCClient render activity", () => {
  it.each([100, 500, 1_000])(
    "keeps %i mounted inactive controllers at zero delivery IPC and zero timers",
    async (count) => {
      connections = Array.from({ length: count }, (_, index) =>
        makeConnection(index + 1),
      );
      const sessions = Array.from({ length: count }, (_, index) =>
        makeSession(index + 1),
      );

      renderHarness(sessions, false);
      await flushAsyncWork(40);

      expect(commandCalls("connect_vnc")).toHaveLength(count);
      expect(commandCalls("set_vnc_session_activity")).toHaveLength(count);
      expect(deliveryCalls()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
    30_000,
  );

  it("bounds connect admission and drops queued work after unmount", async () => {
    const count = VNC_CONNECT_MAX_CONCURRENCY + 6;
    connections = Array.from({ length: count }, (_, index) =>
      makeConnection(index + 1),
    );
    const sessions = Array.from({ length: count }, (_, index) =>
      makeSession(index + 1),
    );
    const pendingConnects = Array.from(
      { length: VNC_CONNECT_MAX_CONCURRENCY },
      () => deferred<string>(),
    );
    for (const pending of pendingConnects) {
      queueResponse("connect_vnc", () => pending.promise);
    }

    const harness = renderHarness(sessions, false);
    await flushAsyncWork(40);

    expect(commandCalls("connect_vnc")).toHaveLength(
      VNC_CONNECT_MAX_CONCURRENCY,
    );

    harness.view.unmount();
    pendingConnects.forEach((pending, index) => {
      pending.resolve(`late-vnc-backend-${index + 1}`);
    });
    await flushAsyncWork(100);

    expect(commandCalls("connect_vnc")).toHaveLength(
      VNC_CONNECT_MAX_CONCURRENCY,
    );
    expect(commandCalls("get_vnc_session_info")).toHaveLength(0);
    expect(commandCalls("set_vnc_session_activity")).toHaveLength(0);
    expect(commandCalls("disconnect_vnc")).toEqual(
      pendingConnects.map((_, index) => [
        "disconnect_vnc",
        { sessionId: `late-vnc-backend-${index + 1}` },
      ]),
    );
  });

  it("never invokes an explicitly disconnected queued connect before a live follower", async () => {
    connections = Array.from({ length: 4 }, (_, index) =>
      makeConnection(index + 1),
    );
    const firstConnect = deferred<string>();
    const secondConnect = deferred<string>();
    queueResponse("connect_vnc", () => firstConnect.promise);
    queueResponse("connect_vnc", () => secondConnect.promise);
    const saturated = renderHarness(
      [makeSession(1), makeSession(2), makeSession(3)],
      false,
    );
    await flushAsyncWork(40);
    expect(commandCalls("connect_vnc")).toHaveLength(2);

    const canceledClient = clients.get("vnc-frontend-3");
    if (!canceledClient) throw new Error("Queued VNC client did not mount");
    await act(async () => {
      await canceledClient.disconnect();
    });
    const live = renderHarness([makeSession(4)], false);
    await flushAsyncWork();
    expect(commandCalls("connect_vnc")).toHaveLength(2);

    authorities.set("held-vnc-backend-1", {
      active: true,
      activityGeneration: 0,
      deliveryEpoch: 1,
    });
    firstConnect.resolve("held-vnc-backend-1");
    await flushAsyncWork(60);

    expect(
      commandCalls("connect_vnc").map(
        ([, args]) => (args as { host?: string }).host,
      ),
    ).toEqual([
      "vnc-1.example.test",
      "vnc-2.example.test",
      "vnc-4.example.test",
    ]);
    expect(clients.get("vnc-frontend-3")?.connectionStatus).toBe(
      "disconnected",
    );

    authorities.set("held-vnc-backend-2", {
      active: true,
      activityGeneration: 0,
      deliveryEpoch: 1,
    });
    secondConnect.resolve("held-vnc-backend-2");
    await flushAsyncWork(60);
    saturated.view.unmount();
    live.view.unmount();
    await flushAsyncWork();
  });

  it("bounds activity admission and drops queued claims after unmount", async () => {
    const count = VNC_ACTIVITY_MAX_CONCURRENCY + 6;
    connections = Array.from({ length: count }, (_, index) =>
      makeConnection(index + 1),
    );
    const sessions = Array.from({ length: count }, (_, index) =>
      makeSession(index + 1),
    );
    const pendingClaims = Array.from(
      { length: VNC_ACTIVITY_MAX_CONCURRENCY },
      () => deferred<unknown>(),
    );
    const pendingArgs: InvokeArgs[] = [];
    for (const pending of pendingClaims) {
      queueResponse("set_vnc_session_activity", (args) => {
        pendingArgs.push(args);
        return pending.promise;
      });
    }

    const harness = renderHarness(sessions, false);
    await flushAsyncWork(80);

    expect(commandCalls("connect_vnc")).toHaveLength(count);
    expect(commandCalls("set_vnc_session_activity")).toHaveLength(
      VNC_ACTIVITY_MAX_CONCURRENCY,
    );

    harness.view.unmount();
    pendingClaims.forEach((pending, index) => {
      const args = pendingArgs[index];
      pending.resolve({
        sessionId: String(args.sessionId),
        active: false,
        activityGeneration: Number(args.activityGeneration),
        deliveryEpoch: 1,
        accepted: true,
        refreshQueued: false,
      });
    });
    await flushAsyncWork(100);

    expect(commandCalls("set_vnc_session_activity")).toHaveLength(
      VNC_ACTIVITY_MAX_CONCURRENCY,
    );
    expect(deliveryCalls()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retires a definitively dead restored backend before replacing it", async () => {
    queueResponse("is_vnc_connected", () => false);
    renderHarness(
      [
        makeSession(1, {
          backendSessionId: "restored-dead",
          status: "connected",
        }),
      ],
      false,
    );
    await flushAsyncWork(60);

    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "restored-dead" }],
    ]);
    expect(commandCalls("connect_vnc")).toHaveLength(1);
    expect(commandOrder.indexOf("invoke:disconnect_vnc")).toBeLessThan(
      commandOrder.indexOf("invoke:connect_vnc"),
    );
    const updates = mocks.dispatch.mock.calls.map(
      ([action]) =>
        action as {
          payload: Partial<ConnectionSession>;
        },
    );
    const clearedIndex = updates.findIndex(
      ({ payload }) =>
        payload.backendSessionId === undefined &&
        payload.status === "connecting",
    );
    const connectedIndex = updates.findIndex(
      ({ payload }) =>
        payload.backendSessionId === "vnc-backend-1" &&
        payload.status === "connected",
    );
    expect(clearedIndex).toBeGreaterThanOrEqual(0);
    expect(clearedIndex).toBeLessThan(connectedIndex);
    expect(clients.get("vnc-frontend-1")?.backendSessionId).toBe(
      "vnc-backend-1",
    );
  });

  it("fails closed when a restored-backend probe rejects and reconnects explicitly", async () => {
    queueResponse("is_vnc_connected", () => {
      throw new Error("restored backend probe failed");
    });
    renderHarness(
      [
        makeSession(1, {
          backendSessionId: "restored-unknown",
          status: "connected",
        }),
      ],
      false,
    );
    await flushAsyncWork();

    let client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");
    const reconnectClient = client;
    expect(client.backendSessionId).toBe("restored-unknown");
    expect(client.connectionStatus).toBe("error");
    expect(client.errorMessage).toBe("restored backend probe failed");
    expect(commandCalls("connect_vnc")).toHaveLength(0);
    expect(commandCalls("disconnect_vnc")).toHaveLength(0);

    await act(async () => {
      await reconnectClient.reconnect();
    });
    await flushAsyncWork(60);

    client = clients.get("vnc-frontend-1");
    expect(commandCalls("is_vnc_connected")).toHaveLength(1);
    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "restored-unknown" }],
    ]);
    expect(commandCalls("connect_vnc")).toHaveLength(1);
    expect(client?.backendSessionId).toBe("vnc-backend-1");
    expect(client?.connectionStatus).toBe("connected");
  });

  it("invalidates a deferred replacement when disconnect is requested", async () => {
    const replacement = deferred<string>();
    queueResponse("is_vnc_connected", () => false);
    queueResponse("connect_vnc", () => replacement.promise);
    const harness = renderHarness(
      [
        makeSession(1, {
          backendSessionId: "restored-dead",
          status: "connected",
        }),
      ],
      false,
    );
    await flushAsyncWork();

    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");
    expect(commandCalls("connect_vnc")).toHaveLength(1);
    await act(async () => {
      await client.disconnect();
    });
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe(
      "disconnected",
    );

    replacement.resolve("late-replacement");
    await flushAsyncWork(60);

    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "restored-dead" }],
      ["disconnect_vnc", { sessionId: "late-replacement" }],
    ]);
    expect(commandCalls("get_vnc_session_info")).toHaveLength(0);
    expect(commandCalls("set_vnc_session_activity")).toHaveLength(0);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) =>
          (action as { payload: Partial<ConnectionSession> }).payload
            .backendSessionId === "late-replacement",
      ),
    ).toBe(false);

    harness.view.unmount();
    await flushAsyncWork();
    expect(
      commandCalls("disconnect_vnc").filter(
        ([, args]) => (args as InvokeArgs).sessionId === "late-replacement",
      ),
    ).toHaveLength(1);
  });

  it("awaits the active ownership claim before clearing and draining", async () => {
    const claim = deferred<unknown>();
    const harness = renderHarness([makeSession()], false);
    await flushAsyncWork();
    const baselineActivityCalls = commandCalls(
      "set_vnc_session_activity",
    ).length;
    const backendId = "vnc-backend-1";

    queueResponse("set_vnc_session_activity", () => claim.promise);
    await harness.setActive(true);
    await flushAsyncWork();

    expect(commandCalls("set_vnc_session_activity")).toHaveLength(
      baselineActivityCalls + 1,
    );
    expect(canvasContext.clearRect).not.toHaveBeenCalled();
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    authorities.set(backendId, {
      active: true,
      activityGeneration: 2,
      deliveryEpoch: 2,
    });
    claim.resolve({
      sessionId: backendId,
      active: true,
      activityGeneration: 2,
      deliveryEpoch: 2,
      accepted: true,
      refreshQueued: true,
    });
    await flushAsyncWork();

    expect(canvasContext.clearRect).toHaveBeenCalledTimes(1);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(1);
    expect(commandOrder.indexOf("canvas:clear")).toBeLessThan(
      commandOrder.indexOf("invoke:get_vnc_session_stats"),
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("suspends an active controller without disconnecting its backend", async () => {
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const pollCount = commandCalls("get_vnc_session_stats").length;

    expect(pollCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await harness.setActive(false);
    await flushAsyncWork();
    await act(async () => vi.advanceTimersByTime(330));
    await flushAsyncWork();

    expect(commandCalls("get_vnc_session_stats")).toHaveLength(pollCount);
    expect(commandCalls("disconnect_vnc")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(clients.get("vnc-frontend-1")?.isConnected).toBe(true);
  });

  it("treats document visibility as render activity and resumes once visible", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const initialPolls = commandCalls("get_vnc_session_stats").length;

    await setVisibility("hidden");
    await flushAsyncWork();
    await act(async () => vi.advanceTimersByTime(330));
    await flushAsyncWork();

    expect(commandCalls("get_vnc_session_stats")).toHaveLength(initialPolls);
    expect(vi.getTimerCount()).toBe(0);
    expect(commandCalls("disconnect_vnc")).toHaveLength(0);

    await setVisibility("visible");
    await flushAsyncWork();

    expect(commandCalls("get_vnc_session_stats")).toHaveLength(
      initialPolls + 1,
    );
    expect(canvasContext.clearRect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("drops a deferred poll after suspension without drawing or React writes", async () => {
    const poll = deferred<PollPayload>();
    queueResponse("get_vnc_session_stats", () => poll.promise);
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const dispatchBeforeSuspension = mocks.dispatch.mock.calls.length;

    expect(commandCalls("get_vnc_session_stats")).toHaveLength(1);
    await harness.setActive(false);
    await flushAsyncWork();

    poll.resolve(
      pollWith(
        frameEvent("vnc-backend-1", 2, 1),
        { kind: "clipboard", text: "stale clipboard" },
        { kind: "bell" },
        { kind: "disconnected", reason: "stale terminal event" },
      ),
    );
    await flushAsyncWork();

    expect(canvasContext.putImageData).not.toHaveBeenCalled();
    expect(commandCalls("acknowledge_vnc_frame")).toHaveLength(0);
    expect(clients.get("vnc-frontend-1")?.remoteClipboardAvailable).toBe(false);
    expect(clients.get("vnc-frontend-1")?.bellCount).toBe(0);
    expect(clients.get("vnc-frontend-1")?.isConnected).toBe(true);
    expect(commandCalls("disconnect_vnc")).toHaveLength(0);
    expect(mocks.dispatch.mock.calls.length).toBe(dispatchBeforeSuspension);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers current clipboard and bell events and closes on a current terminal event", async () => {
    queueResponse("get_vnc_session_stats", () =>
      pollWith(
        { kind: "clipboard", text: "current clipboard" },
        { kind: "bell" },
      ),
    );
    queueResponse("get_vnc_session_stats", () =>
      pollWith({ kind: "disconnected", reason: "server closed" }),
    );
    renderHarness([makeSession()], true);
    await flushAsyncWork();

    expect(clients.get("vnc-frontend-1")?.remoteClipboardAvailable).toBe(true);
    expect(clients.get("vnc-frontend-1")?.bellCount).toBe(1);

    await act(async () => vi.advanceTimersByTime(33));
    await flushAsyncWork();

    expect(clients.get("vnc-frontend-1")?.isConnected).toBe(false);
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe("error");
    expect(clients.get("vnc-frontend-1")?.errorMessage).toBe("server closed");
    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "vnc-backend-1" }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects prior-epoch frames and ACKs only a matching current frame", async () => {
    queueResponse("get_vnc_session_stats", () =>
      pollWith(frameEvent("vnc-backend-1", 1, 10)),
    );
    queueResponse("get_vnc_session_stats", () =>
      pollWith(frameEvent("vnc-backend-1", 2, 11)),
    );
    renderHarness([makeSession()], true);
    await flushAsyncWork();

    expect(canvasContext.putImageData).not.toHaveBeenCalled();
    expect(commandCalls("acknowledge_vnc_frame")).toHaveLength(0);

    await act(async () => vi.advanceTimersByTime(33));
    await flushAsyncWork();

    expect(canvasContext.putImageData).toHaveBeenCalledTimes(1);
    expect(commandCalls("acknowledge_vnc_frame")).toEqual([
      [
        "acknowledge_vnc_frame",
        {
          sessionId: "vnc-backend-1",
          deliveryEpoch: 2,
          frameToken: 11,
        },
      ],
    ]);
  });

  it("does not let a stale deferred ACK restart delivery", async () => {
    const acknowledgement = deferred<unknown>();
    queueResponse("get_vnc_session_stats", () =>
      pollWith(frameEvent("vnc-backend-1", 2, 20)),
    );
    queueResponse("acknowledge_vnc_frame", () => acknowledgement.promise);
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();

    expect(canvasContext.putImageData).toHaveBeenCalledTimes(1);
    await harness.setActive(false);
    await flushAsyncWork();
    const activityCalls = commandCalls("set_vnc_session_activity").length;

    acknowledgement.resolve({
      sessionId: "vnc-backend-1",
      accepted: false,
      active: false,
      activityGeneration: 2,
      deliveryEpoch: 2,
    });
    await flushAsyncWork();

    expect(commandCalls("set_vnc_session_activity")).toHaveLength(
      activityCalls,
    );
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries rejected activity authority even when its state already matches", async () => {
    queueResponse("set_vnc_session_activity", () => ({
      sessionId: "vnc-backend-1",
      active: true,
      activityGeneration: 5,
      deliveryEpoch: 7,
      accepted: false,
      refreshQueued: false,
    }));
    queueResponse("set_vnc_session_activity", () => ({
      sessionId: "vnc-backend-1",
      active: false,
      activityGeneration: 6,
      deliveryEpoch: 7,
      accepted: false,
      refreshQueued: false,
    }));
    queueResponse("set_vnc_session_activity", () => {
      authorities.set("vnc-backend-1", {
        active: true,
        activityGeneration: 7,
        deliveryEpoch: 8,
      });
      return {
        sessionId: "vnc-backend-1",
        active: true,
        activityGeneration: 7,
        deliveryEpoch: 8,
        accepted: true,
        refreshQueued: true,
      };
    });

    renderHarness([makeSession()], true);
    await flushAsyncWork(40);

    expect(
      commandCalls("set_vnc_session_activity").map(
        ([, args]) => (args as InvokeArgs).activityGeneration,
      ),
    ).toEqual([1, 6, 7]);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("bounds repeated activity conflicts instead of spinning", async () => {
    for (const activityGeneration of [5, 6, 7]) {
      queueResponse("set_vnc_session_activity", () => ({
        sessionId: "vnc-backend-1",
        active: false,
        activityGeneration,
        deliveryEpoch: 4,
        accepted: false,
        refreshQueued: false,
      }));
    }

    renderHarness([makeSession()], true);
    await flushAsyncWork(40);

    expect(
      commandCalls("set_vnc_session_activity").map(
        ([, args]) => (args as InvokeArgs).activityGeneration,
      ),
    ).toEqual([1, 6, 7]);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(0);
    expect(commandCalls("disconnect_vnc")).toHaveLength(1);
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes rapid activity toggles into one final delivery loop", async () => {
    const claim = deferred<unknown>();
    const harness = renderHarness([makeSession()], false);
    await flushAsyncWork();
    queueResponse("set_vnc_session_activity", () => claim.promise);

    await harness.setActive(true);
    await harness.setActive(false);
    await harness.setActive(true);
    await flushAsyncWork();

    expect(commandCalls("set_vnc_session_activity")).toHaveLength(2);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(0);
    authorities.set("vnc-backend-1", {
      active: true,
      activityGeneration: 2,
      deliveryEpoch: 2,
    });
    claim.resolve({
      sessionId: "vnc-backend-1",
      active: true,
      activityGeneration: 2,
      deliveryEpoch: 2,
      accepted: true,
      refreshQueued: true,
    });
    await flushAsyncWork(40);

    expect(
      commandCalls("set_vnc_session_activity").map(([, args]) => ({
        active: (args as InvokeArgs).active,
        generation: (args as InvokeArgs).activityGeneration,
      })),
    ).toEqual([
      { active: false, generation: 1 },
      { active: true, generation: 2 },
      { active: true, generation: 2 },
      { active: true, generation: 3 },
    ]);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("blocks key, pointer, and clipboard sends while inactive", async () => {
    const readText = vi.fn().mockResolvedValue("local clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });
    renderHarness([makeSession()], false);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    await act(async () => {
      client.handleKeyDown({
        key: "a",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
      client.handleKeyUp({
        key: "a",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
      client.handleCanvasClick({
        clientX: 1,
        clientY: 1,
      } as React.MouseEvent<HTMLCanvasElement>);
      await client.sendCtrlAltDel();
      await client.sendClipboardFromSystem();
      await client.copyRemoteClipboard();
    });

    expect(readText).not.toHaveBeenCalled();
    expect(commandCalls("send_vnc_key_event")).toHaveLength(0);
    expect(commandCalls("send_vnc_pointer_event")).toHaveLength(0);
    expect(commandCalls("send_vnc_clipboard")).toHaveLength(0);
  });

  it("releases a pressed key before claiming inactivity", async () => {
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Control",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork();
    await harness.setActive(false);
    client.handleKeyUp({
      key: "Control",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffe3 },
      { down: false, key: 0xffe3 },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const inactiveIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "set_vnc_session_activity" &&
        (args as InvokeArgs).active === false,
    );
    expect(keyUpIndex).toBeGreaterThanOrEqual(0);
    expect(keyUpIndex).toBeLessThan(inactiveIndex);
  });

  it("releases a pressed key before a hidden document claims inactivity", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Alt",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork();
    await setVisibility("hidden");
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffe9 },
      { down: false, key: 0xffe9 },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const inactiveIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "set_vnc_session_activity" &&
        (args as InvokeArgs).active === false,
    );
    expect(keyUpIndex).toBeLessThan(inactiveIndex);
  });

  it("releases a pressed pointer before claiming inactivity", async () => {
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    clickCanvas(client);
    await flushAsyncWork();
    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1]);

    await harness.setActive(false);
    await flushAsyncWork();
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    const pointerUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_pointer_event" &&
        (args as InvokeArgs).buttonMask === 0,
    );
    const inactiveIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "set_vnc_session_activity" &&
        (args as InvokeArgs).active === false,
    );
    expect(pointerUpIndex).toBeLessThan(inactiveIndex);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a pressed pointer before hidden-document inactivity", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    clickCanvas(client);
    await flushAsyncWork();
    await setVisibility("hidden");
    await flushAsyncWork();
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    const pointerUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_pointer_event" &&
        (args as InvokeArgs).buttonMask === 0,
    );
    const inactiveIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "set_vnc_session_activity" &&
        (args as InvokeArgs).active === false,
    );
    expect(pointerUpIndex).toBeLessThan(inactiveIndex);
  });

  it("releases tracked key and pointer input when View only becomes authoritative", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Control",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    clickCanvas(client);
    await flushAsyncWork();
    act(() => {
      client.setSettings((current) => ({ ...current, viewOnly: true }));
    });
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_key_event").map(
        ([, args]) => (args as InvokeArgs).down,
      ),
    ).toEqual([true, false]);
    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    expect(
      commandCalls("set_vnc_session_activity").map(
        ([, args]) => (args as InvokeArgs).active,
      ),
    ).toEqual([true]);

    const steadyClient = clients.get("vnc-frontend-1");
    if (!steadyClient) throw new Error("VNC client did not rerender");
    steadyClient.handleKeyDown({
      key: "a",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    clickCanvas(steadyClient);
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();
    expect(commandCalls("send_vnc_key_event")).toHaveLength(2);
    expect(commandCalls("send_vnc_pointer_event")).toHaveLength(2);
  });

  it("fences pending input behind a View-only transition", async () => {
    const pendingKeyDown = deferred<void>();
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    queueResponse("send_vnc_key_event", () => pendingKeyDown.promise);
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Control",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    clickCanvas(client);
    await flushAsyncWork();
    act(() => {
      client.setSettings((current) => ({ ...current, viewOnly: true }));
    });
    await flushAsyncWork();

    pendingKeyDown.resolve(undefined);
    await flushAsyncWork(40);

    expect(
      commandCalls("send_vnc_key_event").map(
        ([, args]) => (args as InvokeArgs).down,
      ),
    ).toEqual([true, false]);
    expect(commandCalls("send_vnc_pointer_event")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["canvas", "window"] as const)(
    "releases tracked key and pointer input on %s blur",
    async (target) => {
      const harness = renderHarness([makeSession()], true);
      await flushAsyncWork();
      const client = clients.get("vnc-frontend-1");
      if (!client) throw new Error("VNC client did not mount");

      client.handleKeyDown({
        key: "Alt",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
      clickCanvas(client);
      await flushAsyncWork();
      if (target === "canvas") {
        harness.view
          .getByTestId("vnc-frontend-1")
          .dispatchEvent(new Event("blur"));
      } else {
        window.dispatchEvent(new Event("blur"));
      }
      await flushAsyncWork();
      await act(async () => vi.advanceTimersByTime(100));
      await flushAsyncWork();

      expect(
        commandCalls("send_vnc_key_event").map(
          ([, args]) => (args as InvokeArgs).down,
        ),
      ).toEqual([true, false]);
      expect(
        commandCalls("send_vnc_pointer_event").map(
          ([, args]) => (args as InvokeArgs).buttonMask,
        ),
      ).toEqual([1, 0]);
      expect(
        commandCalls("set_vnc_session_activity").map(
          ([, args]) => (args as InvokeArgs).active,
        ),
      ).toEqual([true]);
      expect(clients.get("vnc-frontend-1")?.isConnected).toBe(true);
    },
  );

  it("keeps Ctrl-Alt-Delete atomic when suspension interrupts the chord", async () => {
    const firstKeyDown = deferred<void>();
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    queueResponse("send_vnc_key_event", () => firstKeyDown.promise);
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    let chord: Promise<void> | undefined;
    await act(async () => {
      chord = client.sendCtrlAltDel();
      await Promise.resolve();
    });
    expect(commandCalls("send_vnc_key_event")).toHaveLength(1);

    await harness.setActive(false);
    await flushAsyncWork();
    expect(commandCalls("set_vnc_session_activity")).toHaveLength(1);

    firstKeyDown.resolve(undefined);
    await act(async () => {
      await chord;
    });
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffe3 },
      { down: false, key: 0xffe3 },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const inactiveIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "set_vnc_session_activity" &&
        (args as InvokeArgs).active === false,
    );
    expect(keyUpIndex).toBeLessThan(inactiveIndex);
  });

  it("releases a pressed key before explicit disconnect", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Shift",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork();
    await act(async () => {
      await client.disconnect();
    });

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffe1 },
      { down: false, key: 0xffe1 },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(keyUpIndex).toBeLessThan(disconnectIndex);
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe(
      "disconnected",
    );
  });

  it("releases a pressed pointer before explicit disconnect", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    clickCanvas(client);
    await flushAsyncWork();
    await act(async () => {
      await client.disconnect();
    });
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    const pointerUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_pointer_event" &&
        (args as InvokeArgs).buttonMask === 0,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(pointerUpIndex).toBeLessThan(disconnectIndex);
  });

  it("releases possibly pressed keys before closing after an input failure", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    queueResponse("send_vnc_key_event", () => {
      throw new Error("key send failed");
    });
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Control",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork(40);

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffe3 },
      { down: false, key: 0xffe3 },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(keyUpIndex).toBeLessThan(disconnectIndex);
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe("error");
    expect(clients.get("vnc-frontend-1")?.errorMessage).toBe("key send failed");
  });

  it("releases a possibly pressed pointer before closing after input failure", async () => {
    renderHarness([makeSession()], true);
    await flushAsyncWork();
    queueResponse("send_vnc_pointer_event", () => {
      throw new Error("pointer send failed");
    });
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    clickCanvas(client);
    await flushAsyncWork(40);
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    const pointerUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_pointer_event" &&
        (args as InvokeArgs).buttonMask === 0,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(pointerUpIndex).toBeLessThan(disconnectIndex);
    expect(clients.get("vnc-frontend-1")?.connectionStatus).toBe("error");
    expect(clients.get("vnc-frontend-1")?.errorMessage).toBe(
      "pointer send failed",
    );
  });

  it("releases a pressed key before unmount disconnect", async () => {
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    client.handleKeyDown({
      key: "Meta",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
    await flushAsyncWork();
    harness.view.unmount();
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_key_event").map(([, args]) => ({
        down: (args as InvokeArgs).down,
        key: (args as InvokeArgs).key,
      })),
    ).toEqual([
      { down: true, key: 0xffeb },
      { down: false, key: 0xffeb },
    ]);
    const keyUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_key_event" && (args as InvokeArgs).down === false,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(keyUpIndex).toBeLessThan(disconnectIndex);
  });

  it("releases a pressed pointer before unmount disconnect", async () => {
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");

    clickCanvas(client);
    await flushAsyncWork();
    harness.view.unmount();
    await flushAsyncWork();
    await act(async () => vi.advanceTimersByTime(100));
    await flushAsyncWork();

    expect(
      commandCalls("send_vnc_pointer_event").map(
        ([, args]) => (args as InvokeArgs).buttonMask,
      ),
    ).toEqual([1, 0]);
    const pointerUpIndex = mocks.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === "send_vnc_pointer_event" &&
        (args as InvokeArgs).buttonMask === 0,
    );
    const disconnectIndex = mocks.invoke.mock.calls.findIndex(
      ([command]) => command === "disconnect_vnc",
    );
    expect(pointerUpIndex).toBeLessThan(disconnectIndex);
  });

  it("reconnects while inactive without starting delivery", async () => {
    const harness = renderHarness([makeSession()], false);
    await flushAsyncWork();
    const firstClient = clients.get("vnc-frontend-1");
    if (!firstClient) throw new Error("VNC client did not mount");

    await act(async () => {
      await firstClient.reconnect();
    });
    await flushAsyncWork(40);

    expect(commandCalls("connect_vnc")).toHaveLength(2);
    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "vnc-backend-1" }],
    ]);
    expect(
      commandCalls("set_vnc_session_activity").map(
        ([, args]) => (args as InvokeArgs).active,
      ),
    ).toEqual([false, false]);
    expect(deliveryCalls()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    harness.view.unmount();
    await flushAsyncWork();
    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "vnc-backend-1" }],
      ["disconnect_vnc", { sessionId: "vnc-backend-2" }],
    ]);
  });

  it("does not carry a stale ownership completion into a reconnected backend", async () => {
    const oldClaim = deferred<unknown>();
    const harness = renderHarness([makeSession()], false);
    await flushAsyncWork();
    queueResponse("set_vnc_session_activity", () => oldClaim.promise);

    await harness.setActive(true);
    await flushAsyncWork();
    const client = clients.get("vnc-frontend-1");
    if (!client) throw new Error("VNC client did not mount");
    await act(async () => {
      await client.reconnect();
    });
    await flushAsyncWork();

    expect(commandCalls("connect_vnc")).toHaveLength(2);
    expect(commandCalls("get_vnc_session_stats")).toHaveLength(0);

    oldClaim.resolve({
      sessionId: "vnc-backend-1",
      active: true,
      activityGeneration: 2,
      deliveryEpoch: 2,
      accepted: true,
      refreshQueued: true,
    });
    await flushAsyncWork(40);

    expect(
      commandCalls("set_vnc_session_activity").map(([, args]) => ({
        sessionId: (args as InvokeArgs).sessionId,
        active: (args as InvokeArgs).active,
        generation: (args as InvokeArgs).activityGeneration,
      })),
    ).toEqual([
      { sessionId: "vnc-backend-1", active: false, generation: 1 },
      { sessionId: "vnc-backend-1", active: true, generation: 2 },
      { sessionId: "vnc-backend-2", active: true, generation: 1 },
    ]);
    expect(commandCalls("get_vnc_session_stats")).toEqual([
      ["get_vnc_session_stats", { sessionId: "vnc-backend-2", maxEvents: 2 }],
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("disconnects exactly once on actual unmount and ignores post-unmount polls", async () => {
    const poll = deferred<PollPayload>();
    queueResponse("get_vnc_session_stats", () => poll.promise);
    const harness = renderHarness([makeSession()], true);
    await flushAsyncWork();
    const dispatchCount = mocks.dispatch.mock.calls.length;

    harness.view.unmount();
    await flushAsyncWork();
    expect(commandCalls("disconnect_vnc")).toEqual([
      ["disconnect_vnc", { sessionId: "vnc-backend-1" }],
    ]);

    poll.resolve(
      pollWith(
        frameEvent("vnc-backend-1", 2, 30),
        { kind: "clipboard", text: "too late" },
        { kind: "bell" },
      ),
    );
    await flushAsyncWork();

    expect(commandCalls("disconnect_vnc")).toHaveLength(1);
    expect(commandCalls("acknowledge_vnc_frame")).toHaveLength(0);
    expect(canvasContext.putImageData).not.toHaveBeenCalled();
    expect(mocks.dispatch.mock.calls).toHaveLength(dispatchCount);
    expect(vi.getTimerCount()).toBe(0);
  });
});
