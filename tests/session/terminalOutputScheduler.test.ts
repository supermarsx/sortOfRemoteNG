import { describe, expect, it, vi } from "vitest";
import {
  TerminalOutputScheduler,
  formatTerminalOutputGap,
  type TerminalOutputRegistration,
  type TerminalOutputSchedulerClock,
  type TerminalReplaySnapshot,
} from "../../src/services/session/terminalOutputScheduler";

class ManualClock implements TerminalOutputSchedulerClock {
  private nextHandle = 1;
  private time = 0;
  private readonly callbacks = new Map<number, () => void>();
  maximumPending = 0;

  constructor(private readonly nowStep = 0) {}

  now = () => {
    const value = this.time;
    this.time += this.nowStep;
    return value;
  };

  schedule = (callback: () => void) => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.maximumPending = Math.max(this.maximumPending, this.callbacks.size);
    return handle;
  };

  cancel = (handle: unknown) => {
    this.callbacks.delete(handle as number);
  };

  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();

  scheduleAfter = (ms: number, callback: () => void) => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.time + ms, callback });
    return () => {
      this.timers.delete(handle);
    };
  };

  get pendingTimers() {
    return this.timers.size;
  }

  /** Fire every timer whose deadline has passed, in deadline order. */
  runDueTimers(): void {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.time)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [handle, timer] of due) {
      this.timers.delete(handle);
      timer.callback();
    }
  }

  get pending() {
    return this.callbacks.size;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
    this.runDueTimers();
  }

  runOne(): void {
    const entry = this.callbacks.entries().next().value as
      [number, () => void] | undefined;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1]();
  }

  runAll(limit = 100_000): void {
    let turns = 0;
    while (this.callbacks.size > 0) {
      if (++turns > limit) throw new Error("scheduler did not become idle");
      this.runOne();
    }
  }
}

const callbacks = (writes: string[] = []) => ({
  write: (data: string) => {
    writes.push(data);
  },
  onGap: vi.fn(),
  onReset: vi.fn(),
});

const replayPage = (
  data: string,
  start = 0,
  extra: Partial<TerminalReplaySnapshot> = {},
): TerminalReplaySnapshot => ({
  sessionId: "session",
  data,
  generation: 1,
  sequenceStart: start,
  sequenceEnd: start + new TextEncoder().encode(data).length,
  retainedStart: 0,
  droppedBytes: 0,
  gap: false,
  generationChanged: false,
  ...extra,
});

const settle = async (clock: ManualClock, turns = 12) => {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve();
    clock.runAll();
  }
};

describe("SSH replay history and delivery resilience", () => {
  it("cancels a truncated terminal control sequence before displaying a real gap", () => {
    expect(
      formatTerminalOutputGap({
        reason: "replay",
        droppedBytes: 3,
        droppedChunks: 0,
      }),
    ).toBe("\x18\r\n\x1b[33m[terminal output gap; 3 bytes dropped]\x1b[0m\r\n");
  });
  it("never reports the 71/82/82 history evictions as live loss", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({}, clock);
    const writes: string[] = [];
    const sink = callbacks(writes);
    const registration = scheduler.register("session", sink);
    let sequence = 0;
    for (const size of [...Array<number>(16).fill(65536), 71, 82, 82]) {
      const data = "x".repeat(size);
      registration.enqueue({
        data,
        generation: 1,
        sequenceStart: sequence,
        sequenceEnd: sequence + size,
        retainedStart: Math.max(0, sequence + size - 1048576),
        droppedBytes: Math.max(0, sequence + size - 1048576),
      });
      sequence += size;
      clock.runAll();
    }
    expect(writes.join("")).toBe("x".repeat(1048811));
    expect(sink.onGap).not.toHaveBeenCalled();
    expect(registration.cursor().afterSequence).toBe(1048811);
  });

  it("reports an actual sequence gap once even when history also shrank", () => {
    const clock = new ManualClock();
    const sink = callbacks();
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      sink,
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
      droppedBytes: 0,
    });
    clock.runAll();
    registration.enqueue({
      data: "z",
      generation: 1,
      sequenceStart: 10,
      sequenceEnd: 11,
      retainedStart: 10,
      droppedBytes: 10,
    });
    clock.runAll();
    expect(sink.onGap).toHaveBeenCalledOnce();
    expect(sink.onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        droppedBytes: 9,
        fromSequence: 1,
        throughSequence: 10,
      }),
    );
  });

  it("automatically repairs missing live events without printing a gap or duplicating output", async () => {
    const clock = new ManualClock();
    const writes: string[] = [];
    const sink = callbacks(writes);
    const replay = vi.fn(async () => replayPage("bc", 1));
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    clock.runAll();
    registration.enqueue({
      data: "c",
      generation: 1,
      sequenceStart: 2,
      sequenceEnd: 3,
    });
    await settle(clock);
    expect(replay).toHaveBeenCalledWith({ generation: 1, afterSequence: 1 });
    expect(writes.join("")).toBe("abc");
    expect(sink.onGap).not.toHaveBeenCalled();
  });

  it("counts only unread bytes when the cursor has expired, preserving existing display", async () => {
    const clock = new ManualClock();
    const sink = callbacks();
    const replay = vi.fn(async () =>
      replayPage("z", 10, { retainedStart: 10, droppedBytes: 10, gap: true }),
    );
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.enqueue({
      data: "abcde",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 5,
    });
    clock.runAll();
    registration.enqueue({
      data: "z",
      generation: 1,
      sequenceStart: 10,
      sequenceEnd: 11,
    });
    await settle(clock);
    expect(sink.onGap).toHaveBeenCalledOnce();
    expect(sink.onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        droppedBytes: 5,
        fromSequence: 5,
        throughSequence: 10,
      }),
    );
    expect(sink.onReset).not.toHaveBeenCalled();
  });

  it("waits for renderer completion before advancing the cursor or sending more", async () => {
    const clock = new ManualClock();
    const completions: (() => void)[] = [];
    const write = vi.fn(
      () => new Promise<void>((resolve) => completions.push(resolve)),
    );
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { write, onGap: vi.fn() },
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    registration.enqueue({
      data: "b",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    clock.runAll();
    expect(write).toHaveBeenCalledTimes(1);
    expect(registration.cursor().afterSequence).toBeUndefined();
    expect(clock.pending).toBe(0);
    completions.shift()!();
    await settle(clock);
    expect(registration.cursor().afterSequence).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    completions.shift()!();
    await settle(clock);
    expect(registration.cursor().afterSequence).toBe(2);
  });

  it("replays 100 MiB in bounded pages, never retaining the whole history in the frontend", async () => {
    const clock = new ManualClock();
    const total = 100 * 1024 * 1024;
    const pageSize = 256 * 1024;
    let received = 0;
    const replay = vi.fn(async (cursor: { afterSequence?: number }) => {
      const start = cursor.afterSequence ?? 0;
      return replayPage("x".repeat(Math.min(pageSize, total - start)), start, {
        hasMore: start + pageSize < total,
      });
    });
    const scheduler = new TerminalOutputScheduler({}, clock);
    const registration = scheduler.register("session", {
      replay,
      write: (data) => {
        received += data.length;
      },
      onGap: vi.fn(),
    });
    registration.synchronize();
    for (let turn = 0; turn < 4000 && received < total; turn++) {
      await settle(clock, 1);
      expect(scheduler.diagnostics().queuedBytes).toBeLessThanOrEqual(pageSize);
    }
    await settle(clock);
    expect(received).toBe(total);
    expect(replay).toHaveBeenCalledTimes(total / pageSize);
    expect(registration.cursor().afterSequence).toBe(total);
    expect(clock.pending).toBe(0);
  });

  it("does not duplicate hidden-session data in JS and catches an event racing the final page", async () => {
    const clock = new ManualClock();
    const sink = callbacks();
    let resolvePage!: (value: TerminalReplaySnapshot) => void;
    const replay = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TerminalReplaySnapshot>((resolve) => {
            resolvePage = resolve;
          }),
      )
      .mockResolvedValueOnce(replayPage("b", 1));
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
      { paused: true },
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    expect(registration.diagnostics().queuedBytes).toBe(0);
    expect(replay).not.toHaveBeenCalled();
    registration.resume();
    await settle(clock);
    registration.enqueue({
      data: "b",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    resolvePage(replayPage("a"));
    await settle(clock, 24);
    expect(replay).toHaveBeenCalledTimes(2);
    expect(registration.cursor().afterSequence).toBe(2);
    expect(sink.onGap).not.toHaveBeenCalled();
  });

  it.each(["", "tail"])(
    "preserves synchronization requested during a deferred final replay page (%j)",
    async (finalPage) => {
      const clock = new ManualClock();
      const writes: string[] = [];
      const sink = callbacks(writes);
      let resolvePage!: (value: TerminalReplaySnapshot) => void;
      const replay = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<TerminalReplaySnapshot>((resolve) => {
              resolvePage = resolve;
            }),
        )
        .mockResolvedValueOnce(
          replayPage("new", 0, {
            generation: 2,
            generationChanged: true,
            gap: true,
          }),
        );
      const registration = new TerminalOutputScheduler({}, clock).register(
        "session",
        { ...sink, replay },
      );
      registration.enqueue({
        data: "old",
        generation: 1,
        sequenceStart: 0,
        sequenceEnd: 3,
      });
      clock.runAll();
      registration.synchronize();
      await settle(clock);
      expect(replay).toHaveBeenCalledOnce();

      // The hook requests synchronization when a newer-generation event arrives
      // while the old generation's final replay response is still in flight.
      registration.synchronize();
      resolvePage(replayPage(finalPage, 3, { hasMore: false }));
      await settle(clock, 24);

      expect(replay).toHaveBeenCalledTimes(2);
      expect(replay).toHaveBeenNthCalledWith(2, {
        generation: 1,
        afterSequence: 3 + finalPage.length,
      });
      expect(writes).toEqual(["old", ...(finalPage ? [finalPage] : []), "new"]);
      expect(sink.onReset).toHaveBeenCalledOnce();
      expect(registration.cursor()).toEqual({
        generation: 2,
        afterSequence: 3,
      });
      expect(clock.pending).toBe(0);
      expect(clock.pendingTimers).toBe(0);
    },
  );

  it("retries replay failures with backoff and cancels pending recovery on disposal", async () => {
    const clock = new ManualClock();
    const replay = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(replayPage("a"));
    const sink = callbacks();
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.synchronize();
    await settle(clock);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
    expect(clock.pendingTimers).toBe(1);
    clock.advance(500);
    await settle(clock);
    expect(replay).toHaveBeenCalledTimes(2);
    expect(registration.cursor().afterSequence).toBe(1);
    registration.dispose();
    expect(clock.pendingTimers).toBe(0);
  });

  it("ignores a replay response after the registration was disposed", async () => {
    const clock = new ManualClock();
    let resolvePage!: (value: TerminalReplaySnapshot) => void;
    const replay = vi.fn(
      () =>
        new Promise<TerminalReplaySnapshot>((resolve) => {
          resolvePage = resolve;
        }),
    );
    const sink = { write: vi.fn(), onGap: vi.fn() };
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.synchronize();
    await settle(clock);
    registration.dispose();
    resolvePage(replayPage("stale"));
    await settle(clock);
    expect(sink.write).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
  });

  it("recovers overflow after a slow write completes without dropping the in-flight bytes", async () => {
    const clock = new ManualClock();
    let finishWrite!: () => void;
    const writes: string[] = [];
    const onGap = vi.fn();
    const replay = vi.fn(async () => replayPage("bc", 1));
    const scheduler = new TerminalOutputScheduler(
      { perSessionMaxChunks: 1 },
      clock,
    );
    const registration = scheduler.register("session", {
      write: (data) => {
        writes.push(data);
        if (writes.length === 1)
          return new Promise<void>((resolve) => {
            finishWrite = resolve;
          });
      },
      onGap,
      replay,
    });
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    clock.runAll();
    registration.enqueue({
      data: "b",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    registration.enqueue({
      data: "c",
      generation: 1,
      sequenceStart: 2,
      sequenceEnd: 3,
    });
    expect(registration.diagnostics().queuedChunks).toBe(1);
    expect(replay).not.toHaveBeenCalled();
    finishWrite();
    await settle(clock);
    expect(replay).toHaveBeenCalledWith({ generation: 1, afterSequence: 1 });
    expect(writes.join("")).toBe("abc");
    expect(onGap).not.toHaveBeenCalled();
  });

  it("drains an intact queued prefix before recovering a later missing interval", async () => {
    const clock = new ManualClock();
    const writes: string[] = [];
    const sink = callbacks(writes);
    const replay = vi.fn(async () =>
      replayPage("cde", 2, { retainedStart: 2, droppedBytes: 2 }),
    );
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    clock.runAll();
    registration.enqueue({
      data: "b",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    registration.enqueue({
      data: "e",
      generation: 1,
      sequenceStart: 4,
      sequenceEnd: 5,
    });
    await settle(clock);
    expect(replay).toHaveBeenCalledWith({ generation: 1, afterSequence: 2 });
    expect(writes.join("")).toBe("abcde");
    expect(sink.onGap).not.toHaveBeenCalled();
  });

  it("pauses page fetching while hidden, resuming from the acknowledged cursor", async () => {
    const clock = new ManualClock();
    const sink = callbacks();
    const replay = vi.fn(async (cursor: { afterSequence?: number }) =>
      cursor.afterSequence === 1
        ? replayPage("b", 1)
        : replayPage("a", 0, { hasMore: true }),
    );
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.synchronize();
    clock.runAll();
    registration.pause();
    await settle(clock);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(registration.cursor().afterSequence).toBeUndefined();
    expect(clock.pending).toBe(0);
    registration.resume();
    await settle(clock, 24);
    expect(registration.cursor().afterSequence).toBe(2);
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("preserves intact queued output during resume even if native history expired", async () => {
    const clock = new ManualClock();
    const writes: string[] = [];
    const sink = callbacks(writes);
    const replay = vi.fn(async (cursor: { afterSequence?: number }) =>
      replayPage("c", 2, {
        retainedStart: 2,
        droppedBytes: 2,
        gap: (cursor.afterSequence ?? 0) < 2,
      }),
    );
    const registration = new TerminalOutputScheduler({}, clock).register(
      "session",
      { ...sink, replay },
    );
    registration.enqueue({
      data: "a",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    clock.runAll();
    registration.enqueue({
      data: "b",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    registration.pause();
    registration.synchronize();
    registration.resume();
    await settle(clock);
    expect(replay).toHaveBeenCalledWith({ generation: 1, afterSequence: 2 });
    expect(writes.join("")).toBe("abc");
    expect(sink.onGap).not.toHaveBeenCalled();
  });

  it("recovers a final replay page evicted by another session before it was acknowledged", async () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({ globalMaxBytes: 4 }, clock);
    const aWrites: string[] = [];
    const bWrites: string[] = [];
    const aSink = callbacks(aWrites);
    const bSink = callbacks(bWrites);
    const aReplay = vi.fn(async () =>
      replayPage("aaaa", 0, { sessionId: "a" }),
    );
    const bReplay = vi.fn(async () =>
      replayPage("bbbb", 0, { sessionId: "b" }),
    );
    const a = scheduler.register("a", { ...aSink, replay: aReplay });
    const b = scheduler.register("b", { ...bSink, replay: bReplay });
    a.synchronize();
    b.synchronize();
    await settle(clock, 48);
    expect(aWrites.join("")).toBe("aaaa");
    expect(bWrites.join("")).toBe("bbbb");
    expect(a.cursor().afterSequence).toBe(4);
    expect(b.cursor().afterSequence).toBe(4);
    expect(aSink.onGap).not.toHaveBeenCalled();
    expect(bSink.onGap).not.toHaveBeenCalled();
  });

  it("bounds replay IPC fan-out across many sessions without idle spinning", async () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({}, clock);
    const pending: (() => void)[] = [];
    let inFlight = 0;
    let maximum = 0;
    let delivered = 0;
    const registrations = Array.from({ length: 100 }, (_, index) => {
      const id = `session-${index}`;
      const registration = scheduler.register(id, {
        write: () => {
          delivered++;
        },
        onGap: vi.fn(),
        replay: () =>
          new Promise<TerminalReplaySnapshot>((resolve) => {
            inFlight++;
            maximum = Math.max(maximum, inFlight);
            pending.push(() => {
              inFlight--;
              resolve(replayPage("x", 0, { sessionId: id }));
            });
          }),
      });
      registration.synchronize();
      return registration;
    });
    await settle(clock);
    expect(inFlight).toBe(4);
    expect(clock.pending).toBe(0);
    for (let round = 0; round < 30 && delivered < 100; round++) {
      for (const complete of pending.splice(0)) complete();
      await settle(clock);
    }
    expect(delivered).toBe(100);
    expect(maximum).toBe(4);
    expect(inFlight).toBe(0);
    expect(clock.pending).toBe(0);
    registrations.forEach((registration) => registration.dispose());
  });

  for (const action of ["pause", "dispose"] as const) {
    it(`does not strand replay waiters when awakened views ${action} before their tick`, async () => {
      const clock = new ManualClock();
      const scheduler = new TerminalOutputScheduler({}, clock);
      const pending = new Map<number, () => void>();
      const started: number[] = [];
      const delivered: number[] = [];
      const registrations = Array.from({ length: 9 }, (_, index) => {
        const id = `session-${index}`;
        const registration = scheduler.register(id, {
          write: () => {
            delivered.push(index);
          },
          onGap: vi.fn(),
          replay: () =>
            new Promise<TerminalReplaySnapshot>((resolve) => {
              started.push(index);
              pending.set(index, () => {
                pending.delete(index);
                resolve(replayPage("x", 0, { sessionId: id }));
              });
            }),
        });
        registration.synchronize();
        return registration;
      });
      await settle(clock);
      expect(started).toEqual([0, 1, 2, 3]);
      for (const complete of [...pending.values()]) complete();
      // Release every IPC slot, but do not run the newly scheduled tick yet.
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
      for (const registration of registrations.slice(4, 8))
        registration[action]();
      await settle(clock);
      expect(started).toEqual([0, 1, 2, 3, 8]);
      pending.get(8)!();
      await settle(clock);
      expect(delivered).toEqual([0, 1, 2, 3, 8]);
      expect(clock.pending).toBe(0);
      registrations.forEach((registration) => registration.dispose());
    });
  }
});

describe("TerminalOutputScheduler", () => {
  for (const sessionCount of [100, 500, 1000]) {
    it(`uses one scheduled tick source for ${sessionCount} busy sessions`, () => {
      const clock = new ManualClock();
      const scheduler = new TerminalOutputScheduler(
        {
          perSessionMaxBytes: 4096,
          perSessionMaxChunks: 32,
          globalMaxBytes: 4 * 1024 * 1024,
          maxChunksPerSessionTurn: 2,
        },
        clock,
      );
      const registrations: TerminalOutputRegistration[] = [];
      const writes = Array.from({ length: sessionCount }, () => [] as string[]);

      for (let session = 0; session < sessionCount; session++) {
        const registration = scheduler.register(
          `session-${session}`,
          callbacks(writes[session]),
        );
        registrations.push(registration);
        for (let chunk = 0; chunk < 10; chunk++) {
          registration.enqueue({ data: `${session}:${chunk}\n` });
        }
      }

      expect(clock.pending).toBe(1);
      expect(clock.maximumPending).toBe(1);
      expect(scheduler.diagnostics()).toMatchObject({
        registrations: sessionCount,
        queuedChunks: sessionCount * 10,
        scheduled: true,
      });

      clock.runAll();
      expect(clock.maximumPending).toBe(1);
      expect(writes.every((sessionWrites) => sessionWrites.length === 10)).toBe(
        true,
      );
      expect(scheduler.diagnostics()).toMatchObject({
        registrations: sessionCount,
        queuedBytes: 0,
        queuedChunks: 0,
        scheduled: false,
      });

      registrations.forEach((registration) => registration.dispose());
      expect(scheduler.diagnostics()).toMatchObject({
        registrations: 0,
        queuedBytes: 0,
        queuedChunks: 0,
        scheduled: false,
      });
      expect(clock.pending).toBe(0);
    });
  }

  it("enforces per-session chunk/byte caps and the global byte cap", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler(
      {
        perSessionMaxBytes: 64,
        perSessionMaxChunks: 4,
        globalMaxBytes: 128,
      },
      clock,
    );
    const gapSpies: ReturnType<typeof vi.fn>[] = [];
    const registrations = Array.from({ length: 20 }, (_, session) => {
      const onGap = vi.fn();
      gapSpies.push(onGap);
      const registration = scheduler.register(
        `session-${session}`,
        { write: vi.fn(), onGap },
        { paused: true },
      );
      for (let chunk = 0; chunk < 20; chunk++) {
        registration.enqueue({ data: "éééé" }); // 8 UTF-8 bytes
      }
      return registration;
    });

    expect(clock.pending).toBe(0);
    expect(scheduler.diagnostics().queuedBytes).toBeLessThanOrEqual(128);
    for (const registration of registrations) {
      expect(registration.diagnostics().queuedBytes).toBeLessThanOrEqual(64);
      expect(registration.diagnostics().queuedChunks).toBeLessThanOrEqual(4);
    }

    registrations.forEach((registration) => registration.resume());
    expect(clock.pending).toBe(1);
    clock.runAll();
    expect(
      gapSpies.reduce((count, spy) => count + spy.mock.calls.length, 0),
    ).toBeGreaterThan(0);
    expect(scheduler.diagnostics()).toMatchObject({
      queuedBytes: 0,
      queuedChunks: 0,
    });
  });

  it("services a cold session before returning to a hot session", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler(
      {
        maxChunksPerSessionTurn: 1,
        maxBytesPerSessionTurn: 1024,
      },
      clock,
    );
    const order: string[] = [];
    const hot = scheduler.register("hot", {
      write: (data) => {
        order.push(`hot:${data}`);
      },
      onGap: vi.fn(),
    });
    const cold = scheduler.register("cold", {
      write: (data) => {
        order.push(`cold:${data}`);
      },
      onGap: vi.fn(),
    });

    for (let index = 0; index < 100; index++) {
      hot.enqueue({ data: String(index) });
    }
    cold.enqueue({ data: "only" });
    clock.runAll();

    expect(order.slice(0, 2)).toEqual(["hot:0", "cold:only"]);
    expect(order).toHaveLength(101);
  });

  it("yields after the <=8ms tick budget and continues on one timer source", () => {
    const clock = new ManualClock(9);
    const scheduler = new TerminalOutputScheduler(
      { tickBudgetMs: 100, maxChunksPerSessionTurn: 1 },
      clock,
    );
    const writes = vi.fn();
    const registrations = Array.from({ length: 5 }, (_, index) => {
      const registration = scheduler.register(`session-${index}`, {
        write: writes,
        onGap: vi.fn(),
      });
      registration.enqueue({ data: `${index}` });
      return registration;
    });

    clock.runOne();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(1);
    clock.runAll();
    expect(writes).toHaveBeenCalledTimes(5);
    expect(clock.maximumPending).toBe(1);
    registrations.forEach((registration) => registration.dispose());
  });

  it("slices a 1 MiB replay at UTF-8 boundaries within the byte and time budgets", () => {
    const clock = new ManualClock();
    const writes: string[] = [];
    const scheduler = new TerminalOutputScheduler({}, clock);
    const registration = scheduler.register("large-replay", {
      write: (data) => {
        writes.push(data);
        clock.advance(4);
      },
      onGap: vi.fn(),
    });
    const replay = `x${"🙂".repeat(262_143)}abc`;
    const replayBytes = new TextEncoder().encode(replay).byteLength;
    expect(replayBytes).toBe(1024 * 1024);

    registration.applyReplay({
      sessionId: "large-replay",
      data: replay,
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: replayBytes,
      retainedStart: 0,
      droppedBytes: 0,
      gap: false,
      generationChanged: false,
    });

    clock.runOne();
    expect(writes).toHaveLength(2);
    expect(
      writes.every(
        (data) => new TextEncoder().encode(data).byteLength <= 64 * 1024,
      ),
    ).toBe(true);
    expect(clock.pending).toBe(1);

    clock.runAll();
    expect(writes.join("")).toBe(replay);
    expect(
      writes.every(
        (data) => new TextEncoder().encode(data).byteLength <= 64 * 1024,
      ),
    ).toBe(true);
    expect(registration.cursor()).toEqual({
      generation: 1,
      afterSequence: replayBytes,
    });
    expect(clock.maximumPending).toBe(1);
  });

  it("performs zero writes while paused and resumes in sequence order without duplicates", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({}, clock);
    const events: string[] = [];
    const registration = scheduler.register(
      "backend-1",
      {
        write: (data) => {
          events.push(`write:${data}`);
        },
        onGap: (gap) => {
          events.push(`gap:${gap.reason}`);
        },
        onReset: () => {
          events.push("reset");
        },
      },
      { paused: true },
    );

    registration.enqueue({
      data: "A",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 1,
    });
    registration.enqueue({
      data: "B",
      generation: 1,
      sequenceStart: 1,
      sequenceEnd: 2,
    });
    expect(clock.pending).toBe(0);
    expect(events).toEqual([]);

    registration.applyReplay({
      sessionId: "backend-1",
      data: "AB",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 2,
      retainedStart: 0,
      droppedBytes: 0,
      gap: false,
      generationChanged: false,
    });
    registration.enqueue({
      data: "C",
      generation: 1,
      sequenceStart: 2,
      sequenceEnd: 3,
    });
    registration.resume();
    clock.runAll();

    expect(events).toEqual(["write:AB", "write:C"]);
    expect(registration.cursor()).toEqual({
      generation: 1,
      afterSequence: 3,
    });
  });

  it("marks and resets a changed-generation replay before writing it", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({}, clock);
    const events: string[] = [];
    const gapBytes: number[] = [];
    const registration = scheduler.register(
      "backend-1",
      {
        write: (data) => {
          events.push(`write:${data}`);
        },
        onGap: (gap) => {
          events.push(`gap:${gap.reason}`);
          gapBytes.push(gap.droppedBytes);
        },
        onReset: () => {
          events.push("reset");
        },
      },
      { generation: 1, paused: true },
    );
    registration.enqueue({
      data: "old",
      generation: 1,
      sequenceStart: 0,
      sequenceEnd: 3,
    });
    registration.applyReplay({
      sessionId: "backend-1",
      data: "new",
      generation: 2,
      sequenceStart: 5,
      sequenceEnd: 8,
      retainedStart: 5,
      droppedBytes: 5,
      gap: true,
      generationChanged: true,
    });
    registration.resume();
    clock.runAll();

    expect(events).toEqual(["reset", "gap:generation", "write:new"]);
    expect(gapBytes).toEqual([5]);
    expect(registration.cursor()).toEqual({
      generation: 2,
      afterSequence: 8,
    });
  });

  it("cancels scheduled work and returns to baseline across StrictMode-style remount", () => {
    const clock = new ManualClock();
    const scheduler = new TerminalOutputScheduler({}, clock);
    const firstWrite = vi.fn();
    const first = scheduler.register("backend-1", {
      write: firstWrite,
      onGap: vi.fn(),
    });
    first.enqueue({ data: "discarded" });
    expect(clock.pending).toBe(1);
    first.dispose();
    expect(clock.pending).toBe(0);
    expect(scheduler.diagnostics()).toMatchObject({
      registrations: 0,
      queuedBytes: 0,
      queuedChunks: 0,
      scheduled: false,
    });

    const secondWrite = vi.fn();
    const second = scheduler.register("backend-1", {
      write: secondWrite,
      onGap: vi.fn(),
    });
    second.enqueue({ data: "kept" });
    clock.runAll();
    expect(firstWrite).not.toHaveBeenCalled();
    expect(secondWrite).toHaveBeenCalledWith("kept");
    second.dispose();
    expect(clock.pending).toBe(0);
  });

  describe("bounded write retry", () => {
    const setup = (
      config: { writeRetryDelayMs?: number; maxWriteRetries?: number } = {},
    ) => {
      const clock = new ManualClock();
      const scheduler = new TerminalOutputScheduler(
        { writeRetryDelayMs: 50, maxWriteRetries: 3, ...config },
        clock,
      );
      let accept = false;
      const write = vi.fn((_data: string) => accept);
      const registration = scheduler.register("session", {
        write,
        onGap: vi.fn(),
        onReset: vi.fn(),
      });
      return {
        clock,
        scheduler,
        write,
        registration,
        setAccept: (value: boolean) => {
          accept = value;
        },
      };
    };

    it("retries after the delay and delivers once write returns true", () => {
      const { clock, write, registration, setAccept } = setup();
      registration.enqueue({ data: "hello" });
      clock.runAll();

      expect(write).toHaveBeenCalledTimes(1);
      expect(registration.diagnostics()).toMatchObject({
        paused: false,
        writeRetries: 1,
        queuedChunks: 1,
      });
      expect(clock.pending).toBe(0);
      expect(clock.pendingTimers).toBe(1);

      clock.advance(49);
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(1);

      setAccept(true);
      clock.advance(1);
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenLastCalledWith("hello");
      expect(registration.diagnostics()).toMatchObject({
        paused: false,
        writeRetries: 0,
        queuedChunks: 0,
      });
      expect(clock.pendingTimers).toBe(0);
    });

    it("does not spin: new enqueues while a retry is pending wait for it", () => {
      const { clock, write, registration, setAccept } = setup();
      registration.enqueue({ data: "a" });
      clock.runAll();
      registration.enqueue({ data: "b" });
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(1);
      expect(clock.pendingTimers).toBe(1);

      setAccept(true);
      clock.advance(50);
      clock.runAll();
      expect(write.mock.calls.map(([data]) => data)).toEqual(["a", "a", "b"]);
    });

    it("gives up after maxWriteRetries and stays paused until resume()", () => {
      const { clock, write, registration, setAccept } = setup({
        maxWriteRetries: 3,
      });
      registration.enqueue({ data: "x" });
      clock.runAll();
      for (let attempt = 0; attempt < 3; attempt++) {
        clock.advance(50);
        clock.runAll();
      }
      // initial attempt + 3 retries, then paused with nothing pending
      expect(write).toHaveBeenCalledTimes(4);
      expect(registration.diagnostics()).toMatchObject({
        paused: true,
        writeRetries: 3,
        queuedChunks: 1,
      });
      expect(clock.pendingTimers).toBe(0);
      expect(clock.pending).toBe(0);

      clock.advance(10_000);
      clock.runAll();
      registration.enqueue({ data: "y" });
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(4);

      setAccept(true);
      registration.resume();
      clock.runAll();
      expect(write.mock.calls.slice(4).map(([data]) => data)).toEqual([
        "x",
        "y",
      ]);
      expect(registration.diagnostics()).toMatchObject({
        paused: false,
        writeRetries: 0,
        queuedChunks: 0,
      });
    });

    it("explicit pause() cancels a pending retry and resets the counter", () => {
      const { clock, write, registration, setAccept } = setup();
      registration.enqueue({ data: "x" });
      clock.runAll();
      expect(clock.pendingTimers).toBe(1);

      registration.pause();
      expect(clock.pendingTimers).toBe(0);
      expect(registration.diagnostics()).toMatchObject({
        paused: true,
        writeRetries: 0,
      });
      clock.advance(500);
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(1);

      setAccept(true);
      registration.resume();
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenLastCalledWith("x");
    });

    it("dispose() cancels a pending retry", () => {
      const { clock, write, registration } = setup();
      registration.enqueue({ data: "x" });
      clock.runAll();
      expect(clock.pendingTimers).toBe(1);

      registration.dispose();
      expect(clock.pendingTimers).toBe(0);
      expect(clock.pending).toBe(0);
      clock.advance(500);
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(1);
    });

    it("maxWriteRetries: 0 pauses immediately on the first rejected write", () => {
      const { clock, write, registration } = setup({ maxWriteRetries: 0 });
      registration.enqueue({ data: "x" });
      clock.runAll();
      expect(write).toHaveBeenCalledTimes(1);
      expect(clock.pendingTimers).toBe(0);
      expect(registration.diagnostics()).toMatchObject({
        paused: true,
        writeRetries: 0,
      });
    });
  });
});
