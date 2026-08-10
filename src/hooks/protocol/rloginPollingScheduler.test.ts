import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RLOGIN_POLL_INTERVAL_MS,
  RLOGIN_POLL_MAX_CALLS_PER_TICK,
  RLOGIN_POLL_MAX_CONCURRENCY,
  RloginPollingScheduler,
  type RloginPollingRegistration,
} from "./rloginPollingScheduler";

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("RloginPollingScheduler", () => {
  it.each([100, 500, 1_000])(
    "keeps %i registrations on one bounded, fair timer and cleans up",
    async (registrationCount) => {
      vi.useFakeTimers();
      const scheduler = new RloginPollingScheduler();
      const calls = Array.from({ length: registrationCount }, () => 0);
      const callsByTick = new Map<number, number>();
      let maxConcurrentCalls = 0;
      const registrations = calls.map((_, index) =>
        scheduler.register(async () => {
          calls[index] += 1;
          const diagnostics = scheduler.diagnostics();
          const tick = diagnostics.tick;
          maxConcurrentCalls = Math.max(
            maxConcurrentCalls,
            diagnostics.inFlight,
          );
          callsByTick.set(tick, (callsByTick.get(tick) ?? 0) + 1);
        }, true),
      );

      await flushMicrotasks();
      expect(scheduler.diagnostics()).toMatchObject({
        registrations: registrationCount,
        activeRegistrations: registrationCount,
        timerCount: 1,
      });
      expect(vi.getTimerCount()).toBe(1);

      const fairSweepTicks = Math.ceil(
        registrationCount / RLOGIN_POLL_MAX_CALLS_PER_TICK,
      );
      await vi.advanceTimersByTimeAsync(
        fairSweepTicks * RLOGIN_POLL_INTERVAL_MS,
      );
      await flushMicrotasks();

      expect(
        [...callsByTick.values()].every(
          (count) => count <= RLOGIN_POLL_MAX_CALLS_PER_TICK,
        ),
      ).toBe(true);
      expect(maxConcurrentCalls).toBeLessThanOrEqual(
        RLOGIN_POLL_MAX_CONCURRENCY,
      );
      expect(calls.every((count) => count > 0)).toBe(true);
      expect(Math.max(...calls) - Math.min(...calls)).toBeLessThanOrEqual(1);

      for (const registration of registrations) registration.unregister();
      await flushMicrotasks();
      expect(scheduler.diagnostics()).toMatchObject({
        registrations: 0,
        activeRegistrations: 0,
        timerCount: 0,
        inFlight: 0,
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("enforces global concurrency while spending at most one cycle budget", async () => {
    vi.useFakeTimers();
    const scheduler = new RloginPollingScheduler();
    const pending: Array<() => void> = [];
    const registrations: RloginPollingRegistration[] = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;
    let totalCalls = 0;

    for (let index = 0; index < 12; index += 1) {
      registrations.push(
        scheduler.register(
          () =>
            new Promise<void>((resolve) => {
              totalCalls += 1;
              activeCalls += 1;
              maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
              pending.push(() => {
                activeCalls -= 1;
                resolve();
              });
            }),
          true,
        ),
      );
    }

    expect(totalCalls).toBe(RLOGIN_POLL_MAX_CONCURRENCY);
    for (
      let completed = 0;
      completed < RLOGIN_POLL_MAX_CALLS_PER_TICK;
      completed += 1
    ) {
      const resolve = pending.shift();
      expect(resolve).toBeDefined();
      if (!resolve) throw new Error("expected an in-flight polling call");
      resolve();
      await flushMicrotasks();
    }
    expect(totalCalls).toBe(RLOGIN_POLL_MAX_CALLS_PER_TICK);
    expect(maxActiveCalls).toBe(RLOGIN_POLL_MAX_CONCURRENCY);
    expect(scheduler.diagnostics().inFlight).toBe(0);

    for (const registration of registrations) registration.unregister();
    expect(scheduler.diagnostics()).toMatchObject({
      registrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
  });

  it("keeps background registrations silent and polls immediately on activation", async () => {
    vi.useFakeTimers();
    const scheduler = new RloginPollingScheduler();
    const order: number[] = [];
    const registration = scheduler.register(async () => {
      order.push(order.length + 1);
    }, false);

    await vi.advanceTimersByTimeAsync(RLOGIN_POLL_INTERVAL_MS * 3);
    expect(order).toEqual([]);
    registration.setActive(true);
    await flushMicrotasks();
    expect(order).toEqual([1]);

    registration.setActive(false);
    await vi.advanceTimersByTimeAsync(RLOGIN_POLL_INTERVAL_MS * 3);
    expect(order).toEqual([1]);
    registration.setActive(true);
    await flushMicrotasks();
    expect(order).toEqual([1, 2]);

    registration.unregister();
    expect(scheduler.diagnostics()).toMatchObject({
      registrations: 0,
      activeRegistrations: 0,
      timerCount: 0,
      inFlight: 0,
    });
  });
});
