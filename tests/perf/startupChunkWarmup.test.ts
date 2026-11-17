import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreloadScheduler,
  prefetchChunksInSequence,
  shouldWarmChunksAtIdle,
} from "../../src/utils/perf/preloadScheduler";
import {
  IDLE_WARMUP_PANELS,
  panelWarmSteps,
  warmPanelsWhenIdle,
} from "../../src/utils/perf/preloadPlan";

/**
 * Regression guard for "app hangs / starts very slowly" (2026-11-17): the idle
 * warm-up imported ~9 heavy panel chunks within seconds of boot. Under
 * `next dev` each import is an on-demand compile of a whole module graph, and
 * in any build the chunk evaluations landed back to back on the UI thread.
 */
describe("startup chunk warm-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getPreloadScheduler().cancelAll();
  });
  afterEach(() => {
    getPreloadScheduler().cancelAll();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("does not warm chunks at idle under next dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldWarmChunksAtIdle()).toBe(false);
    warmPanelsWhenIdle();
    expect(getPreloadScheduler().pending).toBe(0);
  });

  it("warms chunks strictly one at a time with a gap in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldWarmChunksAtIdle()).toBe(true);
    let inFlight = 0;
    let maxInFlight = 0;
    const startedAt: number[] = [];
    const steps = panelWarmSteps().map((step) => ({
      ...step,
      importer: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        startedAt.push(Date.now());
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
      },
    }));
    expect(steps.length).toBe(IDLE_WARMUP_PANELS.length);
    prefetchChunksInSequence(steps, 400);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(startedAt.length).toBe(steps.length);
    expect(maxInFlight).toBe(1);
    for (let i = 1; i < startedAt.length; i++)
      expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(400);
  });

  it("cancel stops the remaining steps", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const ran: string[] = [];
    const cancel = prefetchChunksInSequence(
      ["a", "b", "c"].map((id) => ({
        id,
        importer: async () => {
          ran.push(id);
        },
      })),
      100,
    );
    await vi.advanceTimersByTimeAsync(150);
    cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ran.length).toBeLessThan(3);
  });
});
