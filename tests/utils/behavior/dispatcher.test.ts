import { describe, expect, it, vi } from "vitest";
import type {
  ConnectionBehaviorAutomationV1,
  ConnectionBehaviorEventContextInput,
} from "../../../src/types/connection/behavior";
import {
  ConnectionBehaviorDispatcher,
  type ConnectionBehaviorActionHandlerMap,
} from "../../../src/utils/behavior/dispatcher";

const behaviorConfig = (
  rules: ConnectionBehaviorAutomationV1["rules"],
): ConnectionBehaviorAutomationV1 => ({ version: 1, rules });

const behaviorContext = (
  overrides: Partial<ConnectionBehaviorEventContextInput> = {},
): ConnectionBehaviorEventContextInput => ({
  eventId: "event-1",
  type: "session.disconnected",
  timestamp: 1000,
  source: "session-manager",
  reason: "network",
  connection: {
    id: "connection-1",
    name: "Production",
    protocol: "ssh",
    hostname: "host.example.test",
    ...overrides.connection,
  },
  session: {
    id: "session-1",
    name: "Shell",
    status: "disconnected",
    ...overrides.session,
  },
  window: {
    id: "main",
    kind: "main",
    activeSessionId: "session-1",
    ...overrides.window,
  },
  ...overrides,
});

describe("ConnectionBehaviorDispatcher", () => {
  it("matches rules and executes materialized actions in declared order", async () => {
    const calls: string[] = [];
    const handlers: Partial<ConnectionBehaviorActionHandlerMap> = {
      notify: vi.fn(async (action) => {
        calls.push(`notify:${action.title}:${action.message}`);
      }),
      writeLog: vi.fn((action) => {
        calls.push(`log:${action.message}`);
      }),
    };
    const dispatcher = new ConnectionBehaviorDispatcher({ handlers });
    const config = behaviorConfig([
      {
        id: "ordered",
        name: "Ordered",
        event: "session.disconnected",
        actions: [
          {
            type: "notify",
            title: "{{connection.name}} disconnected",
            message: "{{event.reason}}",
          },
          { type: "writeLog", message: "{{session.name}} ended" },
          { type: "notify", title: "Last" },
        ],
      },
    ]);

    const result = await dispatcher.dispatch(config, behaviorContext());

    expect(result).toMatchObject({
      status: "completed",
      matchedRules: 1,
      executedActions: 3,
      errors: [],
    });
    expect(calls).toEqual([
      "notify:Production disconnected:network",
      "log:Shell ended",
      "notify:Last:",
    ]);
  });

  it("applies enabled, event, reason, and window-kind filters", async () => {
    const writeLog = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
    });
    const config = behaviorConfig([
      {
        id: "disabled",
        name: "Disabled",
        enabled: false,
        event: "session.disconnected",
        actions: [{ type: "writeLog" }],
      },
      {
        id: "event",
        name: "Other event",
        event: "session.connected",
        actions: [{ type: "writeLog" }],
      },
      {
        id: "reason",
        name: "Other reason",
        event: "session.disconnected",
        when: { reasons: ["user"] },
        actions: [{ type: "writeLog" }],
      },
      {
        id: "window",
        name: "Other window",
        event: "session.disconnected",
        when: { windowKinds: ["detached"] },
        actions: [{ type: "writeLog" }],
      },
      {
        id: "match",
        name: "Match",
        event: "session.disconnected",
        when: { reasons: ["network"], windowKinds: ["main"] },
        actions: [{ type: "writeLog" }],
      },
    ]);

    const result = await dispatcher.dispatch(config, behaviorContext());

    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(result.matchedRules).toBe(1);
    expect(result.rules.map((rule) => [rule.ruleId, rule.reason])).toEqual([
      ["disabled", "disabled"],
      ["event", "filter"],
      ["reason", "filter"],
      ["window", "filter"],
      ["match", undefined],
    ]);
  });

  it("continues after action errors by default and stops when configured", async () => {
    const notify = vi.fn();
    const onActionError = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: {
        writeLog: vi.fn(() => {
          throw new Error("token=do-not-leak");
        }),
        notify,
      },
      onActionError,
    });
    const config = behaviorConfig([
      {
        id: "continue",
        name: "Continue",
        event: "session.disconnected",
        actions: [{ type: "writeLog" }, { type: "notify" }],
      },
      {
        id: "stop",
        name: "Stop",
        event: "session.disconnected",
        options: { stopOnActionError: true },
        actions: [{ type: "writeLog" }, { type: "notify" }],
      },
    ]);

    const result = await dispatcher.dispatch(config, behaviorContext());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].message).toBe("token=[redacted]");
    expect(onActionError).toHaveBeenCalledTimes(2);
  });

  it("enforces cooldown and once-per-session ledgers per rule scope", async () => {
    let now = 1000;
    const writeLog = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
      now: () => now,
    });
    const config = behaviorConfig([
      {
        id: "once",
        name: "Once",
        event: "session.disconnected",
        options: { oncePerSession: true },
        actions: [{ type: "writeLog" }],
      },
      {
        id: "cooldown",
        name: "Cooldown",
        event: "session.disconnected",
        options: { cooldownMs: 100 },
        actions: [{ type: "writeLog" }],
      },
    ]);

    await dispatcher.dispatch(config, behaviorContext({ eventId: "event-1" }));
    const second = await dispatcher.dispatch(
      config,
      behaviorContext({ eventId: "event-2" }),
    );
    expect(second.rules.map((rule) => rule.reason)).toEqual([
      "once",
      "cooldown",
    ]);

    now += 101;
    const third = await dispatcher.dispatch(
      config,
      behaviorContext({ eventId: "event-3" }),
    );
    expect(third.rules.map((rule) => rule.reason)).toEqual(["once", undefined]);

    const otherSession = await dispatcher.dispatch(
      config,
      behaviorContext({
        eventId: "event-4",
        session: { id: "session-2", name: "Second", status: "disconnected" },
      }),
    );
    expect(otherSession.executedActions).toBe(2);
    expect(writeLog).toHaveBeenCalledTimes(5);
  });

  it("deduplicates event ids and bounds remembered-event history", async () => {
    const writeLog = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
      maxRememberedEvents: 2,
    });
    const config = behaviorConfig([
      {
        id: "log",
        name: "Log",
        event: "session.disconnected",
        actions: [{ type: "writeLog" }],
      },
    ]);

    await dispatcher.dispatch(config, behaviorContext({ eventId: "one" }));
    expect(
      await dispatcher.dispatch(config, behaviorContext({ eventId: "one" })),
    ).toMatchObject({ status: "duplicate" });
    await dispatcher.dispatch(config, behaviorContext({ eventId: "two" }));
    await dispatcher.dispatch(config, behaviorContext({ eventId: "three" }));
    expect(
      await dispatcher.dispatch(config, behaviorContext({ eventId: "one" })),
    ).toMatchObject({ status: "completed" });
  });

  it("blocks concurrent execution of the same session/rule scope", async () => {
    let releaseSleep!: () => void;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve;
        }),
    );
    const writeLog = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
      sleep,
    });
    const config = behaviorConfig([
      {
        id: "slow",
        name: "Slow",
        event: "session.disconnected",
        options: { delayMs: 10 },
        actions: [{ type: "writeLog" }],
      },
    ]);

    const firstPromise = dispatcher.dispatch(
      config,
      behaviorContext({ eventId: "slow-1" }),
    );
    const second = await dispatcher.dispatch(
      config,
      behaviorContext({ eventId: "slow-2" }),
    );
    expect(second.rules[0]).toMatchObject({
      status: "skipped",
      reason: "in-flight",
    });

    releaseSleep();
    expect(await firstPromise).toMatchObject({
      status: "completed",
      executedActions: 1,
    });
  });

  it("cancels delayed work by session and clears once-per-session state", async () => {
    const sleep = (_delay: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    const writeLog = vi.fn();
    const delayedDispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
      sleep,
    });
    const delayedConfig = behaviorConfig([
      {
        id: "delayed",
        name: "Delayed",
        event: "session.disconnected",
        options: { delayMs: 10 },
        actions: [{ type: "writeLog" }],
      },
    ]);

    const pending = delayedDispatcher.dispatch(
      delayedConfig,
      behaviorContext(),
    );
    expect(delayedDispatcher.cancelSession("session-1")).toBe(1);
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(writeLog).not.toHaveBeenCalled();

    const onceDispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
    });
    const onceConfig = behaviorConfig([
      {
        id: "once",
        name: "Once",
        event: "session.disconnected",
        options: { oncePerSession: true },
        actions: [{ type: "writeLog" }],
      },
    ]);
    await onceDispatcher.dispatch(
      onceConfig,
      behaviorContext({ eventId: "once-1" }),
    );
    onceDispatcher.cancelSession("session-1", true);
    expect(
      await onceDispatcher.dispatch(
        onceConfig,
        behaviorContext({ eventId: "once-2" }),
      ),
    ).toMatchObject({ executedActions: 1 });
  });

  it("uses parent event depth to block runaway recursive dispatch", async () => {
    const nestedStatuses: string[] = [];
    let invocation = 0;
    const config = behaviorConfig([
      {
        id: "recursive",
        name: "Recursive",
        event: "session.disconnected",
        actions: [{ type: "writeLog" }],
      },
    ]);
    const dispatcher = new ConnectionBehaviorDispatcher({
      maxRecursionDepth: 2,
      handlers: {
        writeLog: async (_action, execution) => {
          invocation += 1;
          const nested = await dispatcher.dispatch(
            config,
            behaviorContext({
              eventId: `nested-${invocation}`,
              parentEventId: execution.event.eventId,
              session: {
                id: `recursive-session-${invocation}`,
                name: "Recursive",
                status: "disconnected",
              },
            }),
          );
          nestedStatuses.push(nested.status);
        },
      },
    });

    const result = await dispatcher.dispatch(
      config,
      behaviorContext({ eventId: "root" }),
    );

    expect(result.status).toBe("completed");
    expect(invocation).toBe(2);
    expect(nestedStatuses).toContain("recursion-blocked");
  });

  it("does not execute absent, malformed, or future-version configurations", async () => {
    const writeLog = vi.fn();
    const dispatcher = new ConnectionBehaviorDispatcher({
      handlers: { writeLog },
    });

    expect(
      await dispatcher.dispatch(undefined, behaviorContext()),
    ).toMatchObject({
      status: "no-config",
    });
    expect(
      await dispatcher.dispatch({ version: 1, rules: {} }, behaviorContext()),
    ).toMatchObject({ status: "invalid-config" });
    expect(
      await dispatcher.dispatch(
        { version: 2, rules: [] },
        behaviorContext({ eventId: "future" }),
      ),
    ).toMatchObject({ status: "unsupported-version" });
    expect(writeLog).not.toHaveBeenCalled();
  });

  it("reports missing injected handlers without exposing unsafe context", async () => {
    const dispatcher = new ConnectionBehaviorDispatcher();
    const config = behaviorConfig([
      {
        id: "missing",
        name: "Missing",
        event: "session.disconnected",
        actions: [{ type: "runCustomScript", scriptId: "script-1" }],
      },
    ]);

    const result = await dispatcher.dispatch(config, behaviorContext());

    expect(result.status).toBe("completed");
    expect(result.executedActions).toBe(0);
    expect(result.errors[0]).toMatchObject({
      ruleId: "missing",
      actionType: "runCustomScript",
    });
  });
});
