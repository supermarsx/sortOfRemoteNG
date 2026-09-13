import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), backend: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: () => native.backend(),
}));

import { AppDataJsonStore } from "../../src/utils/storage/appDataJsonStore";
import { automationLibraryDiagnostic } from "../../src/utils/recording/automationLibraryAccess";

// Exact pre-read RecordingError::StorageError from capture_storage_guard.
const busy =
  "Storage error: encryption storage transition in progress; retry after it completes";
const appBusy =
  "encryption storage transition in progress; retry after it completes";
const raw = JSON.stringify({ items: ["Existing item"] });
let key = 0;
const store = (backend: "macro-library" | "app-data" = "macro-library") =>
  new AppDataJsonStore({
    key: `test.read-recovery.${++key}`,
    backend,
    sanitize: (value) => ({ value, changed: false }),
  });
const access = () => ({
  signal: new AbortController().signal,
  assertCurrent: vi.fn(),
});
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  native.invoke.mockReset().mockResolvedValue(raw);
  native.backend.mockReset().mockResolvedValue(native.invoke);
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("bounded native macro-library pre-read recovery", () => {
  it("uses the app-data backend's exact bare pre-read error and rejects crossed backend spellings", async () => {
    native.invoke.mockRejectedValueOnce(appBusy);
    const result = settled(store("app-data").load(access()));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeUndefined();
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_app_data",
      "read_app_data",
    ]);
    native.invoke.mockClear().mockRejectedValue(appBusy);
    await expect(store().load(access())).rejects.toBe(appBusy);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    native.invoke.mockClear().mockRejectedValue(busy);
    await expect(store("app-data").load(access())).rejects.toBe(busy);
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["macro-library", "app-data"] as const)(
    "can retain lease checks without retrying a later %s verification read",
    async (backend) => {
      const guard = access();
      native.invoke.mockRejectedValue(
        backend === "macro-library" ? busy : appBusy,
      );
      await expect(
        store(backend).load(guard, { recoverPreReadBusy: false }),
      ).rejects.toBe(backend === "macro-library" ? busy : appBusy);
      expect(native.invoke).toHaveBeenCalledOnce();
      expect(guard.assertCurrent).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([2, 4])(
    "recovers at read %i without any mutation or empty fallback",
    async (attempts) => {
      for (let attempt = 1; attempt < attempts; attempt++)
        native.invoke.mockRejectedValueOnce(busy);
      const result = settled(store().load(access()));
      await vi.runAllTimersAsync();
      expect(await result).toEqual({
        value: { value: { items: ["Existing item"] }, sanitized: false },
        error: undefined,
      });
      expect(native.invoke).toHaveBeenCalledTimes(attempts);
      expect(
        native.invoke.mock.calls.every(
          ([command]) => command === "read_macro_library",
        ),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("exhausts four reads, retains the refusal and provides fixed busy guidance", async () => {
    native.invoke.mockRejectedValue(busy);
    const result = settled(store().load(access()));
    await vi.runAllTimersAsync();
    expect((await result).error).toBe(busy);
    expect(native.invoke).toHaveBeenCalledTimes(4);
    expect(automationLibraryDiagnostic(busy).message).toMatch(
      /encryption.*transition.*Reload/i,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the read pending for only the fixed 100/250/500ms delays", async () => {
    native.invoke.mockRejectedValue(busy);
    const result = settled(store().load(access()));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    for (const [delay, count] of [
      [100, 2],
      [250, 3],
      [500, 4],
    ]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(native.invoke).toHaveBeenCalledTimes(count - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(native.invoke).toHaveBeenCalledTimes(count);
    }
    expect((await result).error).toBe(busy);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "Encryption required: app macros encryption key unavailable",
    "Stored library is corrupt",
    "Storage error: conflicting storage variants require recovery",
    "I/O error: unable to read PRIVATE_PATH",
    "Library write could not be verified",
    "Storage error: encryption key transition in progress",
    `${busy}: unexpected suffix`,
  ])("does not retry an unknown or permanent refusal: %s", async (error) => {
    native.invoke.mockRejectedValue(error);
    await expect(store().load(access())).rejects.toBe(error);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(automationLibraryDiagnostic(error).message).not.toContain(
      "PRIVATE_PATH",
    );
  });

  it("supports the exact Error message, but does not retry app-data or an unrequested macro read", async () => {
    native.invoke.mockRejectedValueOnce(new Error(busy));
    const result = settled(store().load(access()));
    await vi.runAllTimersAsync();
    expect((await result).error).toBeUndefined();
    native.invoke.mockClear().mockRejectedValue(busy);
    await expect(store("app-data").load(access())).rejects.toBe(busy);
    await expect(store().load()).rejects.toBe(busy);
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["write", "reread"])(
    "never retries a normalization %s refusal",
    async (stage) => {
      native.invoke.mockResolvedValueOnce(` ${raw}`);
      if (stage === "reread") native.invoke.mockResolvedValueOnce(false);
      native.invoke.mockRejectedValue(busy);
      await expect(store().load(access())).rejects.toBe(busy);
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        "read_macro_library",
        "compare_and_swap_macro_library",
        ...(stage === "reread" ? ["read_macro_library"] : []),
      ]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("never replays a migration write or removes its legacy copy after a refusal", async () => {
    const legacy = `test.legacy.${++key}`;
    localStorage.setItem(legacy, raw);
    // jsdom queues its own storage-event task; it is not a recovery timer.
    await vi.advanceTimersByTimeAsync(0);
    const migrating = new AppDataJsonStore({
      key: `test.migration.${key}`,
      legacyLocalStorageKey: legacy,
      backend: "macro-library",
      sanitize: (value) => ({ value, changed: false }),
    });
    native.invoke.mockResolvedValueOnce(null).mockRejectedValue(busy);
    await expect(migrating.load(access())).rejects.toBe(busy);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_macro_library",
      "compare_and_swap_macro_library",
    ]);
    expect(localStorage.getItem(legacy)).toBe(raw);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replay a user edit after a postcommit readback failure", async () => {
    native.invoke
      .mockResolvedValueOnce(raw)
      .mockResolvedValueOnce(true)
      .mockRejectedValue(busy);
    const edit = vi.fn(() => ({ items: ["Reviewed edit"] }));
    await expect(store().update(edit)).rejects.toBe(busy);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_macro_library",
      "compare_and_swap_macro_library",
      "read_macro_library",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a queued read before it can dispatch or normalize", async () => {
    const held = deferred<string>(),
      shared = store();
    native.invoke.mockReturnValueOnce(held.promise);
    const first = shared.load();
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const second = settled(
      shared.load({ ...access(), signal: controller.signal }),
    );
    controller.abort();
    held.resolve(raw);
    await first;
    expect((await second).error).toMatchObject({
      message: expect.stringMatching(/access changed/),
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["backend", "read"])(
    "rechecks an aborted owner after the %s await",
    async (stage) => {
      const held = deferred<never>();
      if (stage === "backend") native.backend.mockReturnValueOnce(held.promise);
      else native.invoke.mockReturnValueOnce(held.promise);
      const controller = new AbortController();
      const result = settled(
        store().load({ ...access(), signal: controller.signal }),
      );
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      // A noncanonical result would normally trigger normalization/CAS.
      held.resolve((stage === "backend" ? native.invoke : ` ${raw}`) as never);
      expect((await result).error).toMatchObject({
        message: expect.stringMatching(/access changed/),
      });
      expect(native.invoke).toHaveBeenCalledTimes(stage === "backend" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("clears a waiting retry immediately on abort", async () => {
    native.invoke.mockRejectedValue(busy);
    const controller = new AbortController();
    const result = settled(
      store().load({ ...access(), signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect((await result).error).toMatchObject({
      message: expect.stringMatching(/access changed/),
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects a regained same-owner ID with a different captured lease before retry", async () => {
    native.invoke.mockRejectedValue(busy);
    let lease = 1;
    const captured = lease;
    const result = settled(
      store().load({
        ...access(),
        assertCurrent: () => {
          if (lease !== captured) throw new Error("Owner lease changed");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    lease++; // close + reopen the same database, now unlocked again
    await vi.runAllTimersAsync();
    expect((await result).error).toMatchObject({
      message: "Owner lease changed",
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
