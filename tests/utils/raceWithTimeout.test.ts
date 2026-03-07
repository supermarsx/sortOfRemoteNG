import { describe, it, expect } from "vitest";
import { raceWithTimeout } from "../../src/utils/core/raceWithTimeout";

describe("raceWithTimeout", () => {
  it("resolves when the promise wins the race", async () => {
    const fast = Promise.resolve("done");
    const { promise } = raceWithTimeout(fast, 5000);
    await expect(promise).resolves.toBe("done");
  });

  it("returns a clearable timer handle", () => {
    const slow = new Promise(() => {});
    const { timer, promise } = raceWithTimeout(slow, 5000);
    expect(timer).toBeDefined();
    clearTimeout(timer);
    // Attach catch to prevent unhandled rejection if timer somehow fires
    promise.catch(() => {});
  });

  it("provides both promise and timer in the result", () => {
    const p = new Promise<string>(() => {});
    const result = raceWithTimeout(p, 1000);
    expect(result).toHaveProperty("promise");
    expect(result).toHaveProperty("timer");
    clearTimeout(result.timer);
    result.promise.catch(() => {});
  });
});
