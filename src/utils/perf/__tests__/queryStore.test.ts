import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryStore } from "../queryStore";
import { mergeById, structuralShare } from "../reconcile";
import {
  __resetSafetyForTests,
  assertNoSecretFields,
  clearAllCaches,
  setLockState,
} from "../safety";

let n = 0;
const fresh = () => createQueryStore({ name: `qs-test-${n++}` });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  __resetSafetyForTests();
});

describe("queryStore", () => {
  it("dedupes concurrent fetches to one invoke", async () => {
    const s = fresh();
    const f = vi.fn(async () => ({ a: 1 }));
    const [x, y, z] = await Promise.all([
      s.get("ns:k", f),
      s.get("ns:k", f),
      s.get("ns:k", f),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
    expect(y).toBe(z);
  });

  it("serves fresh values without fetching, then SWR, then refetches after stale window", async () => {
    const s = fresh();
    let v = 0;
    const f = vi.fn(async () => ({ v: ++v }));
    const o = { ttlMs: 1000, staleMs: 5000 };
    expect((await s.get("ns:k", f, o)).v).toBe(1);
    vi.advanceTimersByTime(500);
    expect((await s.get("ns:k", f, o)).v).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000); // stale window: serve old, revalidate in background
    expect((await s.get("ns:k", f, o)).v).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.peek<{ v: number }>("ns:k")?.v).toBe(2);

    vi.advanceTimersByTime(10_000); // beyond stale: blocking fetch
    expect((await s.get("ns:k", f, o)).v).toBe(3);
  });

  it("failed fetch does not poison the key", async () => {
    const s = fresh();
    const f = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(7);
    await expect(s.get("ns:k", f)).rejects.toThrow("boom");
    expect(s.size).toBe(0);
    await expect(s.get("ns:k", f)).resolves.toBe(7);
  });

  it("bounds a namespace with LRU eviction", async () => {
    const s = fresh();
    for (let i = 0; i < 10; i++)
      await s.get(`ns:${i}`, async () => i, { maxEntries: 3 });
    expect(s.namespaceSize("ns")).toBe(3);
    expect(s.keys()).toEqual(["ns:7", "ns:8", "ns:9"]);
    await s.get("ns:7", async () => 7, { maxEntries: 3 }); // touch
    await s.get("ns:10", async () => 10, { maxEntries: 3 });
    expect(s.keys()).toContain("ns:7");
    expect(s.keys()).not.toContain("ns:8");
    await s.get("other:1", async () => 1);
    expect(s.namespaceSize("ns")).toBe(3);
  });

  it("keeps identity of unchanged subtrees across refetches", async () => {
    const s = fresh();
    let call = 0;
    const f = async () => {
      call++;
      return {
        rows: [
          { id: "a", n: 1 },
          { id: "b", n: call === 1 ? 2 : 3 },
        ],
      };
    };
    const first = await s.get("ns:k", f, { ttlMs: 0, staleMs: 0 });
    const second = await s.get("ns:k", f, { ttlMs: 0, staleMs: 0 });
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    const third = await s.get(
      "ns:k",
      async () => ({
        rows: [
          { id: "a", n: 1 },
          { id: "b", n: 3 },
        ],
      }),
      { ttlMs: 0, staleMs: 0 },
    );
    expect(third).toBe(second);
  });

  it("invalidates by key, tag and prefix and refetches subscribed entries", async () => {
    const s = fresh();
    let v = 0;
    const f = async () => ++v;
    await s.get("ns:a", f, { tags: ["t"], ttlMs: 60_000 });
    await s.get("ns:b", f, { ttlMs: 60_000 });
    const cb = vi.fn();
    const off = s.subscribe("ns:a", cb);
    expect(s.invalidate({ tag: "t" })).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.peek("ns:a")).toBe(3); // refetched because it has a subscriber
    expect(cb).toHaveBeenCalled();
    off();
    expect(s.invalidate({ prefix: "ns:" })).toBe(2);
    expect(s.getSnapshot("ns:b").status).toBe("stale");
    expect(await s.get("ns:b", f, { ttlMs: 60_000 })).toBe(4);
  });

  it("discards an in-flight result that was invalidated meanwhile", async () => {
    const s = fresh();
    let release!: (v: number) => void;
    const p = s.get("ns:k", () => new Promise<number>((r) => (release = r)));
    s.invalidate("ns:k");
    release(1);
    await p;
    expect(s.peek("ns:k")).toBeUndefined();
  });

  it("optimistic mutate applies, then rolls back on failure", async () => {
    const s = fresh();
    await s.get("ns:list", async () => [1, 2, 3], { ttlMs: 60_000 });
    const seen: unknown[] = [];
    s.subscribe("ns:list", () => seen.push(s.peek("ns:list")));
    await expect(
      s.mutate<number[]>("ns:list", {
        apply: (p) => [...(p ?? []), 4],
        run: async () => {
          expect(s.peek("ns:list")).toEqual([1, 2, 3, 4]);
          throw new Error("denied");
        },
      }),
    ).rejects.toThrow("denied");
    expect(s.peek("ns:list")).toEqual([1, 2, 3]);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("optimistic mutate commits server value and invalidates on success", async () => {
    const s = fresh();
    await s.get("ns:list", async () => [1], { ttlMs: 60_000 });
    await s.get("ns:other", async () => 1, { ttlMs: 60_000, tags: ["x"] });
    await s.mutate<number[], number>("ns:list", {
      apply: (p) => [...(p ?? []), 2],
      run: async () => 99,
      commit: (r, cur) => [...(cur ?? []).slice(0, -1), r],
      invalidate: [{ tag: "x" }],
    });
    expect(s.peek("ns:list")).toEqual([1, 99]);
    expect(s.getSnapshot("ns:other").status).toBe("stale");
  });

  it("clearAll empties the store, notifies subscribers and drops in-flight results", async () => {
    const s = fresh();
    await s.get("ns:a", async () => 1);
    const cb = vi.fn();
    s.subscribe("ns:a", cb);
    let release!: (v: number) => void;
    const p = s.get("ns:b", () => new Promise<number>((r) => (release = r)));
    s.clearAll();
    release(5);
    await p;
    expect(s.size).toBe(0);
    expect(cb).toHaveBeenCalled();
    expect(s.getSnapshot("ns:a").data).toBeUndefined();
  });

  it("is cleared by the lock transition", async () => {
    const s = fresh();
    await s.get("ns:a", async () => 1);
    expect(s.size).toBe(1);
    setLockState("unlocked");
    expect(s.size).toBe(1);
    setLockState("locked");
    expect(s.size).toBe(0);
    await s.get("ns:a", async () => 2);
    clearAllCaches();
    expect(s.size).toBe(0);
  });

  it("refuses secret caching and secret-named fields", async () => {
    const s = fresh();
    await expect(
      s.get("ns:k", async () => 1, { secret: true as unknown as false }),
    ).rejects.toThrow(/secret/);
    expect(() => assertNoSecretFields({ rows: [{ password: "x" }] })).toThrow();
    expect(() => assertNoSecretFields({ hasPassword: true })).not.toThrow();
    await expect(s.get("ns:p", async () => ({ token: "abc" }))).rejects.toThrow(
      /secret field/,
    );
  });
});

describe("reconcile", () => {
  it("structuralShare returns prev when deep-equal", () => {
    const prev = { a: [1, { b: 2 }], c: "x" };
    expect(structuralShare(prev, { a: [1, { b: 2 }], c: "x" })).toBe(prev);
    const next = structuralShare(prev, { a: [1, { b: 3 }], c: "x" });
    expect(next).not.toBe(prev);
    expect(next.a[0]).toBe(1);
  });

  it("mergeById keeps row identity and takes order from next", () => {
    const a = { id: "a", v: 1 };
    const b = { id: "b", v: 2 };
    const prev = [a, b];
    const next = [
      { id: "b", v: 2 },
      { id: "a", v: 1 },
      { id: "c", v: 3 },
    ];
    const out = mergeById(prev, next, (r) => r.id);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
    const same = mergeById(
      prev,
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
      (r) => r.id,
    );
    expect(same).toBe(prev);
  });
});
