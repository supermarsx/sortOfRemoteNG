import { describe, expect, it, vi } from "vitest";
import {
  TerminalOutputScheduler,
  type TerminalOutputRegistration,
  type TerminalOutputSchedulerClock,
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

  get pending() {
    return this.callbacks.size;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }

  runOne(): void {
    const entry = this.callbacks.entries().next().value as
      | [number, () => void]
      | undefined;
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
});
