import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreloadScheduler, type SchedulerEnv } from "../preloadScheduler";

function makeEnv(over: Partial<SchedulerEnv> = {}): SchedulerEnv {
  return {
    now: () => performance.now(),
    idle: (fn) => {
      const id = setTimeout(fn, 10);
      return () => clearTimeout(id);
    },
    isBusy: () => false,
    isHidden: () => false,
    isUnlocked: () => true,
    ...over,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("preload scheduler", () => {
  it("runs by priority then FIFO and replaces same id", async () => {
    const order: string[] = [];
    const s = createPreloadScheduler(makeEnv(), { frameBudgetMs: 1000 });
    s.schedule({ id: "c", priority: 3, run: () => void order.push("c") });
    s.schedule({ id: "a", priority: 1, run: () => void order.push("a1") });
    s.schedule({ id: "a", priority: 1, run: () => void order.push("a2") });
    s.schedule({ id: "b", priority: 1, run: () => void order.push("b") });
    s.schedule({ id: "z", priority: 0, run: () => void order.push("z") });
    await vi.advanceTimersByTimeAsync(50);
    expect(order[0]).toBe("z");
    expect(order.indexOf("a2")).toBeLessThan(order.indexOf("b"));
    expect(order[order.length - 1]).toBe("c");
    expect(order).not.toContain("a1");
  });

  it("respects the frame budget: splits work across idle slices", async () => {
    let t = 0;
    const slices: number[] = [];
    const env = makeEnv({
      now: () => t,
      idle: (fn) => {
        const id = setTimeout(() => {
          slices.push(t);
          fn();
        }, 10);
        return () => clearTimeout(id);
      },
    });
    const s = createPreloadScheduler(env, { frameBudgetMs: 8 });
    const ran: string[] = [];
    for (const id of ["a", "b", "c", "d"])
      s.schedule({
        id,
        priority: 2,
        run: () => {
          t += 5; // each task burns 5 ms
          ran.push(id);
        },
      });
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(["a", "b"]); // 5 + 5 >= 8 -> slice ends
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(["a", "b", "c", "d"]);
  });

  it("limits concurrent async tasks", async () => {
    const s = createPreloadScheduler(makeEnv(), {
      frameBudgetMs: 1000,
      maxConcurrent: 2,
    });
    const releases: Array<() => void> = [];
    const started: string[] = [];
    for (const id of ["a", "b", "c"])
      s.schedule({
        id,
        run: () =>
          new Promise<void>((r) => {
            started.push(id);
            releases.push(r);
          }),
      });
    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual(["a", "b"]);
    releases[0]();
    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("defers while busy or hidden (except priority 0) and runs after", async () => {
    let busy = true;
    const s = createPreloadScheduler(makeEnv({ isBusy: () => busy }), {
      frameBudgetMs: 1000,
      busyRetryMs: 100,
    });
    const ran: string[] = [];
    s.schedule({ id: "low", priority: 3, run: () => void ran.push("low") });
    s.schedule({ id: "crit", priority: 0, run: () => void ran.push("crit") });
    await vi.advanceTimersByTimeAsync(500);
    expect(ran).toEqual(["crit"]);
    expect(s.pendingIds()).toEqual(["low"]);
    busy = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(ran).toEqual(["crit", "low"]);
  });

  it("cancel removes a pending task", async () => {
    const s = createPreloadScheduler(makeEnv());
    const run = vi.fn();
    const cancel = s.schedule({ id: "x", run });
    cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).not.toHaveBeenCalled();
    const run2 = vi.fn();
    s.schedule({ id: "y", run: run2 });
    expect(s.cancel("y")).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(run2).not.toHaveBeenCalled();
  });

  it("never runs unlock-requiring tasks while locked, runs after kick when unlocked", async () => {
    let unlocked = false;
    const s = createPreloadScheduler(makeEnv({ isUnlocked: () => unlocked }));
    const run = vi.fn();
    s.schedule({ id: "docs", requires: "unlocked", run });
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); // no polling while only locked tasks remain
    unlocked = true;
    s.kick();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dropUnlocked discards pending unlock-requiring tasks (lock event)", async () => {
    const s = createPreloadScheduler(makeEnv({ isUnlocked: () => true }));
    const a = vi.fn();
    const b = vi.fn();
    s.schedule({ id: "a", requires: "unlocked", run: a });
    s.schedule({ id: "b", run: b });
    s.dropUnlocked();
    await vi.advanceTimersByTimeAsync(100);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it("rejects secret tasks at registration", () => {
    const s = createPreloadScheduler(makeEnv());
    expect(() =>
      s.schedule({ id: "s", secret: true as unknown as false, run: () => {} }),
    ).toThrow(/secret/);
  });

  it("a throwing task does not stop the queue", async () => {
    const s = createPreloadScheduler(makeEnv(), { frameBudgetMs: 1000 });
    const ok = vi.fn();
    s.schedule({
      id: "bad",
      priority: 1,
      run: () => {
        throw new Error("x");
      },
    });
    s.schedule({ id: "ok", priority: 2, run: ok });
    await vi.advanceTimersByTimeAsync(100);
    expect(ok).toHaveBeenCalled();
  });
});
