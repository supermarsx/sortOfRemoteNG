import { describe, expect, it, vi } from "vitest";
import {
  SSH_ROUTED_EVENT_NAMES,
  SshEventRouter,
  type SshEventListen,
} from "../../src/services/session/sshEventRouter";

type Handler = (event: { payload: any }) => void;

const createEventHarness = () => {
  const handlers = new Map<string, Set<Handler>>();
  const listenCalls = new Map<string, number>();
  const unlistenCalls = new Map<string, number>();
  let maximumBackendListeners = 0;

  const listen: SshEventListen = async (eventName, handler) => {
    listenCalls.set(eventName, (listenCalls.get(eventName) ?? 0) + 1);
    const eventHandlers = handlers.get(eventName) ?? new Set<Handler>();
    eventHandlers.add(handler as Handler);
    handlers.set(eventName, eventHandlers);
    maximumBackendListeners = Math.max(
      maximumBackendListeners,
      [...handlers.values()].reduce((sum, entries) => sum + entries.size, 0),
    );
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      eventHandlers.delete(handler as Handler);
      unlistenCalls.set(eventName, (unlistenCalls.get(eventName) ?? 0) + 1);
    };
  };

  return {
    listen,
    listenCalls,
    unlistenCalls,
    handlers,
    emit: (eventName: string, payload: unknown) => {
      for (const handler of [...(handlers.get(eventName) ?? [])]) {
        handler({ payload });
      }
    },
    maximumBackendListeners: () => maximumBackendListeners,
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("SshEventRouter", () => {
  for (const sessionCount of [100, 500, 1000]) {
    it(`keeps one backend listener per event at ${sessionCount} subscribers`, async () => {
      const events = createEventHarness();
      const router = new SshEventRouter(events.listen);
      const outputCounts = new Uint16Array(sessionCount);
      const removers: Array<() => void> = [];

      for (let index = 0; index < sessionCount; index++) {
        const sessionId = `backend-${index}`;
        removers.push(
          router.subscribeActor(sessionId, {
            onOutput: () => outputCounts[index]++,
            onError: vi.fn(),
            onClosed: vi.fn(),
          }),
          router.subscribeBufferRequests(`frontend-${index}`, vi.fn()),
        );
      }
      await flushPromises();

      expect(events.maximumBackendListeners()).toBe(4);
      expect([...events.listenCalls.values()].reduce((a, b) => a + b, 0)).toBe(
        4,
      );
      expect(router.diagnostics()).toMatchObject({
        backendListeners: 4,
        pendingBackendListeners: 0,
        subscribers: sessionCount * 4,
      });

      for (let event = 0; event < 1000; event++) {
        events.emit(SSH_ROUTED_EVENT_NAMES.output, {
          session_id: "backend-7",
          data: `${event}`,
        });
      }
      expect(outputCounts[7]).toBe(1000);
      expect([...outputCounts].reduce((sum, count) => sum + count, 0)).toBe(
        1000,
      );

      removers.forEach((remove) => remove());
      expect(router.diagnostics()).toMatchObject({
        backendListeners: 0,
        subscribers: 0,
      });
      expect(
        [...events.unlistenCalls.values()].reduce((a, b) => a + b, 0),
      ).toBe(4);
      expect(
        [...events.handlers.values()].reduce(
          (sum, eventHandlers) => sum + eventHandlers.size,
          0,
        ),
      ).toBe(0);
    });
  }

  it("accepts legacy payloads while rejecting an explicit stale generation", async () => {
    const events = createEventHarness();
    const router = new SshEventRouter(events.listen);
    const received: string[] = [];
    const unsubscribe = router.subscribeActor("backend-1", {
      generation: 4,
      onOutput: (payload) => received.push(payload.data),
    });
    await flushPromises();

    events.emit(SSH_ROUTED_EVENT_NAMES.output, {
      session_id: "backend-1",
      data: "stale",
      generation: 3,
    });
    events.emit(SSH_ROUTED_EVENT_NAMES.output, {
      session_id: "backend-1",
      data: "legacy",
    });
    events.emit(SSH_ROUTED_EVENT_NAMES.output, {
      session_id: "backend-1",
      data: "current",
      generation: 4,
      sequence_start: 0,
      sequence_end: 7,
    });

    expect(received).toEqual(["legacy", "current"]);
    unsubscribe();
  });

  it("reuses pending listeners across a StrictMode-style cleanup/remount", async () => {
    const pending: Array<{
      eventName: string;
      handler: Handler;
      resolve: (unlisten: () => void) => void;
    }> = [];
    const unlisten = vi.fn();
    const listen: SshEventListen = (eventName, handler) =>
      new Promise((resolve) => {
        pending.push({
          eventName,
          handler: handler as Handler,
          resolve,
        });
      });
    const router = new SshEventRouter(listen);

    const firstCleanup = router.subscribeActor("backend-1", {
      onOutput: vi.fn(),
      onError: vi.fn(),
      onClosed: vi.fn(),
    });
    firstCleanup();
    const secondOutput = vi.fn();
    const secondCleanup = router.subscribeActor("backend-1", {
      onOutput: secondOutput,
      onError: vi.fn(),
      onClosed: vi.fn(),
    });

    expect(pending).toHaveLength(3);
    pending.forEach((entry) => entry.resolve(unlisten));
    await flushPromises();
    expect(router.diagnostics()).toMatchObject({
      backendListeners: 3,
      subscribers: 3,
    });

    pending
      .find((entry) => entry.eventName === SSH_ROUTED_EVENT_NAMES.output)
      ?.handler({ payload: { session_id: "backend-1", data: "ok" } });
    expect(secondOutput).toHaveBeenCalledTimes(1);

    secondCleanup();
    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(router.diagnostics()).toMatchObject({
      backendListeners: 0,
      subscribers: 0,
    });
  });

  it("reinstalls a listener after a transient installation rejection", async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const unlisten = vi.fn();
    let attempts = 0;
    const installed: { handler: Handler | null } = { handler: null };
    const listen: SshEventListen = async (_eventName, nextHandler) => {
      attempts++;
      if (attempts === 1) throw new Error("transient listener failure");
      installed.handler = nextHandler as Handler;
      return unlisten;
    };
    const onListenerError = vi.fn();
    const router = new SshEventRouter(listen, onListenerError);
    const cleanup = router.subscribeActor("backend-1", { onOutput: handler });

    await flushPromises();
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(router.diagnostics()).toMatchObject({
      backendListeners: 0,
      subscribers: 1,
    });

    await vi.advanceTimersByTimeAsync(25);
    await flushPromises();
    expect(attempts).toBe(2);
    expect(router.diagnostics()).toMatchObject({
      backendListeners: 1,
      subscribers: 1,
    });
    expect(installed.handler).not.toBeNull();
    installed.handler!({
      payload: { session_id: "backend-1", data: "recovered" },
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ data: "recovered" }),
    );

    cleanup();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
