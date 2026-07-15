import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifySessionLifecycleTransition,
  useSessionLifecycleEvents,
  type SessionBehaviorScriptRuntime,
  type SessionBehaviorSettingsRuntime,
} from "../../src/hooks/session/useSessionLifecycleEvents";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorEventType,
  ConnectionBehaviorRuleV1,
} from "../../src/types/connection/behavior";
import type { CustomScript } from "../../src/types/settings/settings";

function makeSession(
  overrides: Partial<ConnectionSession> = {},
): ConnectionSession {
  return {
    id: "session-1",
    connectionId: "connection-1",
    name: "Production shell",
    status: "connecting",
    startTime: new Date("2026-07-15T12:00:00.000Z"),
    protocol: "ssh",
    hostname: "prod.example.test",
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    ...overrides,
  };
}

function makeRule(
  event: ConnectionBehaviorEventType,
  actions: ConnectionBehaviorActionV1[] = [
    { type: "writeLog", message: "{{event.type}}/{{event.reason}}" },
  ],
  overrides: Partial<ConnectionBehaviorRuleV1> = {},
): ConnectionBehaviorRuleV1 {
  return {
    id: `rule-${event}`,
    name: event,
    event,
    actions,
    ...overrides,
  };
}

function makeConnection(
  rules: ConnectionBehaviorRuleV1[],
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id: "connection-1",
    name: "Production",
    protocol: "ssh",
    hostname: "prod.example.test",
    port: 22,
    isGroup: false,
    behaviorAutomation: { version: 1, rules },
    ...overrides,
  } as Connection;
}

function makeScript(overrides: Partial<CustomScript> = {}): CustomScript {
  return {
    id: "script-1",
    name: "Health check",
    type: "javascript",
    content: "return true",
    trigger: "manual",
    enabled: true,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeRuntime(scripts: CustomScript[] = []) {
  const logAction = vi.fn();
  const executeScript = vi.fn().mockResolvedValue(undefined);
  const showNotification = vi.fn();
  const requestReconnect = vi.fn().mockResolvedValue(true);
  const onTransition = vi.fn();
  const settingsManager: SessionBehaviorSettingsRuntime = {
    getSettings: () => ({ notificationSound: false }),
    getCustomScripts: () => scripts,
    logAction,
  };
  const scriptEngine: SessionBehaviorScriptRuntime = { executeScript };
  return {
    settingsManager,
    scriptEngine,
    logAction,
    executeScript,
    showNotification,
    requestReconnect,
    onTransition,
  };
}

describe("classifySessionLifecycleTransition", () => {
  it.each([
    [
      undefined,
      makeSession({ status: "connected" }),
      false,
      "session.connected",
    ],
    [
      makeSession({ status: "connecting" }),
      makeSession({ status: "error" }),
      false,
      "session.connectFailed",
    ],
    [
      makeSession({ status: "connected" }),
      makeSession({ status: "reconnecting", reconnectAttempts: 1 }),
      false,
      "session.reconnectStarted",
    ],
    [
      makeSession({ status: "reconnecting", reconnectAttempts: 1 }),
      makeSession({ status: "connected", reconnectAttempts: 1 }),
      false,
      "session.reconnected",
    ],
    [
      makeSession({ status: "reconnecting", reconnectAttempts: 1 }),
      makeSession({ status: "error", reconnectAttempts: 1 }),
      false,
      "session.reconnectFailed",
    ],
    [
      makeSession({ status: "connected" }),
      makeSession({ status: "disconnected" }),
      false,
      "session.disconnected",
    ],
    [
      makeSession({ status: "connected" }),
      makeSession({ status: "disconnected" }),
      true,
      undefined,
    ],
  ] as const)(
    "classifies an exact reducer status edge",
    (previous, current, ending, expected) => {
      expect(
        classifySessionLifecycleTransition(previous, current, ending),
      ).toBe(expected);
    },
  );
});

describe("useSessionLifecycleEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits each connect, retry, and remote-disconnect edge once without treating removal as disconnect", async () => {
    const events: ConnectionBehaviorEventType[] = [
      "session.connected",
      "session.reconnectStarted",
      "session.reconnected",
      "session.disconnected",
    ];
    const connection = makeConnection(events.map((event) => makeRule(event)));
    const runtime = makeRuntime();
    let sessions = [makeSession()];
    const { rerender } = renderHook(() =>
      useSessionLifecycleEvents({
        sessions,
        connections: [connection],
        ...runtime,
      }),
    );

    sessions = [makeSession({ status: "connected" })];
    rerender();
    await waitFor(() => expect(runtime.logAction).toHaveBeenCalledTimes(1));
    expect(runtime.logAction.mock.calls[0][3]).toBe("session.connected/");

    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.logAction).toHaveBeenCalledTimes(1);

    sessions = [makeSession({ status: "reconnecting", reconnectAttempts: 1 })];
    rerender();
    await waitFor(() => expect(runtime.logAction).toHaveBeenCalledTimes(2));
    expect(runtime.logAction.mock.calls[1][3]).toBe(
      "session.reconnectStarted/",
    );

    sessions = [makeSession({ status: "connected", reconnectAttempts: 1 })];
    rerender();
    await waitFor(() => expect(runtime.logAction).toHaveBeenCalledTimes(3));
    expect(runtime.logAction.mock.calls[2][3]).toBe("session.reconnected/");

    sessions = [makeSession({ status: "disconnected", reconnectAttempts: 1 })];
    rerender();
    await waitFor(() => expect(runtime.logAction).toHaveBeenCalledTimes(4));
    expect(runtime.logAction.mock.calls[3][3]).toBe(
      "session.disconnected/remote",
    );
    expect(runtime.onTransition.mock.calls.map(([kind]) => kind)).toEqual([
      "connect",
      "reconnect",
      "disconnect",
    ]);

    sessions = [];
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.logAction).toHaveBeenCalledTimes(4);
    expect(runtime.onTransition).toHaveBeenCalledTimes(3);
  });

  it("preserves started-before-initial-status ordering and de-duplicates the reducer echo", async () => {
    const calls: string[] = [];
    const runtime = makeRuntime();
    runtime.logAction.mockImplementation(
      (_level, _action, _connectionId, details) => calls.push(details),
    );
    const connection = makeConnection([
      makeRule("session.started"),
      makeRule("session.connected"),
    ]);
    const session = makeSession({ status: "connected" });
    let sessions: ConnectionSession[] = [];
    const { result, rerender } = renderHook(() =>
      useSessionLifecycleEvents({
        sessions,
        connections: [connection],
        ...runtime,
      }),
    );

    await act(async () => {
      await result.current.emitStarted(session, connection, { reason: "user" });
      await result.current.emitInitialStatus(session, connection);
      await result.current.emitInitialStatus(session, connection);
    });
    expect(calls).toEqual(["session.started/user", "session.connected/"]);

    sessions = [session];
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["session.started/user", "session.connected/"]);
  });

  it("continues after one failing action unless the rule explicitly stops", async () => {
    const runtime = makeRuntime();
    const continueConnection = makeConnection([
      makeRule("session.started", [
        { type: "writeLog", message: "before" },
        { type: "runCustomScript", scriptId: "missing" },
        { type: "writeLog", message: "after" },
      ]),
    ]);
    const session = makeSession();
    const { result, rerender } = renderHook(
      ({ connection }) =>
        useSessionLifecycleEvents({
          sessions: [],
          connections: [connection],
          ...runtime,
        }),
      { initialProps: { connection: continueConnection } },
    );

    await act(async () => {
      await result.current.emitStarted(session, continueConnection);
    });
    expect(runtime.logAction.mock.calls.map((call) => call[3])).toEqual([
      "before",
      expect.stringContaining('Saved script "missing" was not found.'),
      "after",
    ]);

    runtime.logAction.mockClear();
    const stopConnection = makeConnection([
      makeRule(
        "session.started",
        [
          { type: "writeLog", message: "before" },
          { type: "runCustomScript", scriptId: "missing" },
          { type: "writeLog", message: "must-not-run" },
        ],
        { options: { stopOnActionError: true } },
      ),
    ]);
    rerender({ connection: stopConnection });
    await act(async () => {
      await result.current.emitStarted(
        makeSession({ id: "session-2" }),
        stopConnection,
      );
    });
    expect(runtime.logAction.mock.calls.map((call) => call[3])).toEqual([
      "before",
      expect.stringContaining('Saved script "missing" was not found.'),
    ]);
  });

  it("runs only the explicitly selected enabled script and forwards its timeout signal", async () => {
    const selected = makeScript();
    const runtime = makeRuntime([
      makeScript({ id: "other", name: "Other" }),
      selected,
    ]);
    const connection = makeConnection([
      makeRule("session.started", [
        { type: "runCustomScript", scriptId: selected.id, timeoutMs: 25 },
      ]),
    ]);
    const session = makeSession();
    const { result } = renderHook(() =>
      useSessionLifecycleEvents({
        sessions: [],
        connections: [connection],
        ...runtime,
      }),
    );

    await act(async () => {
      await result.current.emitStarted(session, connection);
    });
    expect(runtime.executeScript).toHaveBeenCalledTimes(1);
    expect(runtime.executeScript).toHaveBeenCalledWith(
      selected,
      { connection, session, trigger: "manual" },
      expect.any(AbortSignal),
    );
  });

  it("aborts a selected script at its configured timeout and applies the rule failure policy", async () => {
    vi.useFakeTimers();
    try {
      const selected = makeScript();
      const runtime = makeRuntime([selected]);
      runtime.executeScript.mockImplementation(
        (_script, _context, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      );
      const connection = makeConnection([
        makeRule("session.started", [
          { type: "runCustomScript", scriptId: selected.id, timeoutMs: 5 },
          { type: "writeLog", message: "continued" },
        ]),
      ]);
      const { result } = renderHook(() =>
        useSessionLifecycleEvents({
          sessions: [],
          connections: [connection],
          ...runtime,
        }),
      );

      let emission!: Promise<unknown>;
      act(() => {
        emission = result.current.emitStarted(makeSession(), connection);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5);
        await emission;
      });

      expect(runtime.logAction.mock.calls.map((call) => call[3])).toEqual([
        expect.stringContaining("timed out after 5ms"),
        "continued",
      ]);
      expect(
        runtime.executeScript.mock.calls[0][2] as AbortSignal,
      ).toHaveProperty("aborted", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports missing or disabled scripts without leaking secrets and still executes later actions", async () => {
    const disabled = makeScript({
      id: "disabled",
      name: "Disabled",
      enabled: false,
    });
    const runtime = makeRuntime([disabled]);
    const connection = makeConnection(
      [
        makeRule("session.connectFailed", [
          { type: "runCustomScript", scriptId: disabled.id },
          {
            type: "writeLog",
            message: "Failure: {{error.message}}",
          },
        ]),
      ],
      { password: "super-secret" },
    );
    let sessions = [makeSession()];
    const { rerender } = renderHook(() =>
      useSessionLifecycleEvents({
        sessions,
        connections: [connection],
        ...runtime,
      }),
    );

    sessions = [
      makeSession({
        status: "error",
        errorMessage: "password=super-secret token=abcdef",
      }),
    ];
    rerender();
    await waitFor(() => expect(runtime.logAction).toHaveBeenCalledTimes(2));
    const persisted = JSON.stringify(runtime.logAction.mock.calls);
    expect(persisted).not.toContain("super-secret");
    expect(persisted).not.toContain("abcdef");
    expect(persisted).toContain("[redacted]");
    expect(runtime.executeScript).not.toHaveBeenCalled();
  });

  it("passes explicit zero reconnect limits through without coercion", async () => {
    const runtime = makeRuntime();
    runtime.requestReconnect.mockResolvedValue(false);
    const connection = makeConnection([
      makeRule("session.started", [
        {
          type: "reconnect",
          delayMs: 0,
          maxAttempts: 0,
          backoff: "fixed",
        },
      ]),
    ]);
    const session = makeSession();
    const { result } = renderHook(() =>
      useSessionLifecycleEvents({
        sessions: [],
        connections: [connection],
        ...runtime,
      }),
    );

    await act(async () => {
      await result.current.emitStarted(session, connection);
    });
    expect(runtime.requestReconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        connection,
        action: expect.objectContaining({ delayMs: 0, maxAttempts: 0 }),
        parentEventId: expect.any(String),
      }),
    );
    expect(runtime.logAction).toHaveBeenCalledWith(
      "error",
      "Connection behavior action failed",
      connection.id,
      expect.stringContaining("reconnect request was not accepted"),
      undefined,
      connection.name,
    );
  });
});
