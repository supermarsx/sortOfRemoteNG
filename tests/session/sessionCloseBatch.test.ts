import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoundedSessionCloseBatch,
  DEFAULT_SESSION_CLOSE_CONCURRENCY,
  SessionCloseTimeoutError,
  normalizeSessionCloseConcurrency,
  type SessionCloseProgress,
} from "../../src/components/session/sessionManager/sessionCloseBatch";

interface CloseTarget {
  id: string;
}

const makeTargets = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    value: { id: `session-${index}` },
  }));

const flushMicrotasks = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("BoundedSessionCloseBatch", () => {
  it("normalizes the worker width to a safe bounded range", () => {
    expect(normalizeSessionCloseConcurrency(undefined)).toBe(
      DEFAULT_SESSION_CLOSE_CONCURRENCY,
    );
    expect(normalizeSessionCloseConcurrency(Number.NaN)).toBe(
      DEFAULT_SESSION_CLOSE_CONCURRENCY,
    );
    expect(normalizeSessionCloseConcurrency(0)).toBe(1);
    expect(normalizeSessionCloseConcurrency(8.9)).toBe(8);
    expect(normalizeSessionCloseConcurrency(10_000)).toBe(64);
  });

  for (const count of [100, 500, 1_000]) {
    it(`closes ${count} captured targets fairly within the default worker budget`, async () => {
      vi.useFakeTimers();
      const batch = new BoundedSessionCloseBatch<CloseTarget>(
        makeTargets(count),
      );
      const calls = new Map<string, number>();
      const claimedOrder: string[] = [];
      const progress: SessionCloseProgress[] = [];
      const abortController = new AbortController();
      const addAbortListener = vi.spyOn(
        abortController.signal,
        "addEventListener",
      );
      const removeAbortListener = vi.spyOn(
        abortController.signal,
        "removeEventListener",
      );
      let inFlight = 0;
      let observedMaximum = 0;
      let yields = 0;

      const result = await batch.run(
        async (target) => {
          calls.set(target.id, (calls.get(target.id) ?? 0) + 1);
          claimedOrder.push(target.id);
          inFlight++;
          observedMaximum = Math.max(observedMaximum, inFlight);
          await Promise.resolve();
          inFlight--;
        },
        {
          signal: abortController.signal,
          onProgress: (snapshot) => progress.push(snapshot),
          yieldControl: async () => {
            yields++;
            await Promise.resolve();
          },
        },
      );

      expect(observedMaximum).toBe(DEFAULT_SESSION_CLOSE_CONCURRENCY);
      expect(result.maximumInFlight).toBe(DEFAULT_SESSION_CLOSE_CONCURRENCY);
      expect(result).toMatchObject({
        total: count,
        completed: count,
        failed: 0,
        pending: 0,
        inFlight: 0,
        attempted: count,
        attemptCount: count,
        cancelled: false,
      });
      expect(claimedOrder).toEqual(
        Array.from({ length: count }, (_, index) => `session-${index}`),
      );
      expect([...calls.values()].every((attempts) => attempts === 1)).toBe(
        true,
      );
      expect(progress.some((snapshot) => snapshot.inFlight > 0)).toBe(true);
      expect(progress[progress.length - 1]).toMatchObject({
        completed: count,
        inFlight: 0,
      });
      expect(yields).toBeGreaterThan(0);
      expect(addAbortListener).not.toHaveBeenCalled();
      expect(removeAbortListener).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("uses a macrotask yield by default instead of monopolizing the event loop", async () => {
    vi.useFakeTimers();
    const batch = new BoundedSessionCloseBatch<CloseTarget>(makeTargets(8));
    let resolved = false;
    const run = batch
      .run(async () => Promise.resolve(), { concurrency: 8 })
      .then(() => {
        resolved = true;
      });

    for (let turn = 0; turn < 100 && vi.getTimerCount() !== 1; turn++) {
      await Promise.resolve();
    }
    expect(resolved).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.runAllTimersAsync();
    await run;
    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps failures retryable without closing completed targets twice", async () => {
    vi.useFakeTimers();
    const batch = new BoundedSessionCloseBatch<CloseTarget>(makeTargets(12));
    const attempts = new Map<string, number>();
    const failOnce = new Set(["session-3", "session-8"]);
    const close = vi.fn(async (target: CloseTarget) => {
      const attempt = (attempts.get(target.id) ?? 0) + 1;
      attempts.set(target.id, attempt);
      if (failOnce.has(target.id) && attempt === 1) {
        throw new Error(`cleanup failed for ${target.id}`);
      }
    });
    const options = { yieldControl: async () => Promise.resolve() };

    const first = await batch.run(close, options);
    expect(first).toMatchObject({
      completed: 10,
      failed: 2,
      pending: 0,
      attemptCount: 12,
    });
    expect(first.failures.map((failure) => failure.id)).toEqual([
      "session-3",
      "session-8",
    ]);

    const retry = await batch.run(close, options);
    expect(retry).toMatchObject({
      completed: 12,
      failed: 0,
      pending: 0,
      attempted: 12,
      attemptCount: 14,
    });
    expect(attempts.get("session-3")).toBe(2);
    expect(attempts.get("session-8")).toBe(2);
    for (const [id, count] of attempts) {
      if (!failOnce.has(id)) expect(count).toBe(1);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels queued work without corrupting in-flight entries and resumes safely", async () => {
    vi.useFakeTimers();
    const batch = new BoundedSessionCloseBatch<CloseTarget>(makeTargets(20));
    const attempts = new Map<string, number>();
    const releases: Array<() => void> = [];
    const firstRun = batch.run(
      async (target) => {
        attempts.set(target.id, (attempts.get(target.id) ?? 0) + 1);
        await new Promise<void>((resolve) => releases.push(resolve));
      },
      { concurrency: 4, yieldControl: async () => Promise.resolve() },
    );

    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
    expect(releases).toHaveLength(4);
    expect(batch.cancel()).toMatchObject({
      cancelled: true,
      inFlight: 4,
      pending: 16,
      attempted: 4,
    });
    releases.splice(0).forEach((release) => release());

    const cancelled = await firstRun;
    expect(cancelled).toMatchObject({
      completed: 4,
      failed: 0,
      pending: 16,
      inFlight: 0,
      attempted: 4,
      attemptCount: 4,
      cancelled: true,
    });

    const resumed = await batch.run(
      async (target) => {
        attempts.set(target.id, (attempts.get(target.id) ?? 0) + 1);
      },
      { concurrency: 4, yieldControl: async () => Promise.resolve() },
    );
    expect(resumed).toMatchObject({
      completed: 20,
      failed: 0,
      pending: 0,
      inFlight: 0,
      attempted: 20,
      attemptCount: 20,
      cancelled: false,
    });
    expect([...attempts.values()].every((count) => count === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a timed-out close admitted until the underlying operation settles", async () => {
    vi.useFakeTimers();
    const batch = new BoundedSessionCloseBatch<CloseTarget>(makeTargets(1));
    let release: (() => void) | undefined;
    const firstRun = batch.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      {
        concurrency: 1,
        timeoutMs: 25,
        yieldControl: async () => Promise.resolve(),
      },
    );

    await vi.advanceTimersByTimeAsync(25);
    const timedOut = await firstRun;
    expect(timedOut).toMatchObject({
      completed: 0,
      failed: 0,
      pending: 0,
      inFlight: 1,
      timedOut: 1,
      attemptCount: 1,
    });
    expect(timedOut.failures[0]).toMatchObject({
      id: "session-0",
      timedOut: true,
      attempts: 1,
    });
    expect(timedOut.failures[0].error).toBe(
      new SessionCloseTimeoutError("session-0", 25).message,
    );
    expect(vi.getTimerCount()).toBe(0);

    const blockedRetry = await batch.run(async () => undefined, {
      concurrency: 1,
      timeoutMs: 25,
      yieldControl: async () => Promise.resolve(),
    });
    expect(blockedRetry).toMatchObject({
      completed: 0,
      inFlight: 1,
      timedOut: 1,
      attemptCount: 1,
    });

    release?.();
    await flushMicrotasks();
    expect(batch.progress()).toMatchObject({
      completed: 1,
      failed: 0,
      inFlight: 0,
      timedOut: 0,
      attemptCount: 1,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never overlaps a target or exceeds admission across repeated timeouts", async () => {
    vi.useFakeTimers();
    const batch = new BoundedSessionCloseBatch<CloseTarget>(makeTargets(4));
    const attempts = new Map<string, number>();
    const activeTargets = new Set<string>();
    const pendingAttempts: Array<{
      id: string;
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    let actualOutstanding = 0;
    let maximumActualOutstanding = 0;
    let overlapDetected = false;

    const close = async (target: CloseTarget) => {
      attempts.set(target.id, (attempts.get(target.id) ?? 0) + 1);
      if (activeTargets.has(target.id)) overlapDetected = true;
      activeTargets.add(target.id);
      actualOutstanding++;
      maximumActualOutstanding = Math.max(
        maximumActualOutstanding,
        actualOutstanding,
      );
      try {
        await new Promise<void>((resolve, reject) => {
          pendingAttempts.push({ id: target.id, resolve, reject });
        });
      } finally {
        actualOutstanding--;
        activeTargets.delete(target.id);
      }
    };
    const options = {
      concurrency: 2,
      timeoutMs: 10,
      yieldControl: async () => Promise.resolve(),
    };

    const firstRun = batch.run(close, options);
    await vi.advanceTimersByTimeAsync(10);
    expect(await firstRun).toMatchObject({
      pending: 2,
      inFlight: 2,
      timedOut: 2,
      attemptCount: 2,
    });
    expect(pendingAttempts.map(({ id }) => id)).toEqual([
      "session-0",
      "session-1",
    ]);

    for (let retry = 0; retry < 3; retry++) {
      expect(await batch.run(close, options)).toMatchObject({
        pending: 2,
        inFlight: 2,
        timedOut: 2,
        attemptCount: 2,
      });
    }
    expect(attempts).toEqual(
      new Map([
        ["session-0", 1],
        ["session-1", 1],
      ]),
    );

    pendingAttempts
      .splice(0)
      .forEach(({ reject }) => reject(new Error("late close failure")));
    await flushMicrotasks();
    expect(batch.progress()).toMatchObject({
      failed: 2,
      pending: 2,
      inFlight: 0,
      timedOut: 0,
    });

    const secondRun = batch.run(close, options);
    await vi.advanceTimersByTimeAsync(10);
    expect(await secondRun).toMatchObject({
      failed: 0,
      pending: 2,
      inFlight: 2,
      timedOut: 2,
      attemptCount: 4,
    });
    expect(await batch.run(close, options)).toMatchObject({ attemptCount: 4 });
    expect(attempts.get("session-0")).toBe(2);
    expect(attempts.get("session-1")).toBe(2);
    expect(overlapDetected).toBe(false);
    expect(maximumActualOutstanding).toBe(2);
    expect(batch.progress().maximumInFlight).toBe(2);

    pendingAttempts.splice(0).forEach(({ resolve }) => resolve());
    await flushMicrotasks();
    expect(actualOutstanding).toBe(0);
    expect(batch.progress()).toMatchObject({
      completed: 2,
      pending: 2,
      inFlight: 0,
      timedOut: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures and deduplicates the target set before work starts", () => {
    const source = makeTargets(2);
    const batch = new BoundedSessionCloseBatch<CloseTarget>([
      ...source,
      source[0],
    ]);
    source.push({ id: "late", value: { id: "late" } });

    expect(batch.targets.map((target) => target.id)).toEqual([
      "session-0",
      "session-1",
    ]);
    expect(Object.isFrozen(batch.targets)).toBe(true);
    expect(batch.progress()).toMatchObject({ total: 2, pending: 2 });
  });
});
