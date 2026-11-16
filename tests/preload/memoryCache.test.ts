import { describe, expect, it, vi } from "vitest";
import {
  clearAllPreloadCaches,
  createMemoryCache,
} from "../../src/utils/preload/memoryCache";

describe("memory cache", () => {
  it("is bounded and evicts least recently used", () => {
    const cache = createMemoryCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);
  });

  it("dedupes concurrent loads of one key", async () => {
    const cache = createMemoryCache<number>(2);
    const loader = vi.fn(async () => 7);
    const [x, y] = await Promise.all([
      cache.load("k", loader),
      cache.load("k", loader),
    ]);
    expect([x, y]).toEqual([7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBe(7);
  });

  it("discards a load that was invalidated or cleared while in flight", async () => {
    const cache = createMemoryCache<number>(2);
    let release!: (value: number) => void;
    const pending = cache.load(
      "k",
      () => new Promise<number>((resolve) => (release = resolve)),
    );
    cache.invalidate("k");
    release(1);
    await pending;
    expect(cache.has("k")).toBe(false);
    const second = cache.load("j", async () => 2);
    cache.clear();
    await second;
    expect(cache.has("j")).toBe(false);
  });

  it("notifies subscribers and clears through the global registry", () => {
    const cache = createMemoryCache<number>(2);
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.set("a", 1);
    clearAllPreloadCaches();
    expect(cache.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
