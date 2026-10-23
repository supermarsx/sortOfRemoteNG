import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionAdmission,
  MEMORY_PRESSURE,
  MEMORY_UNAVAILABLE,
  normalizeConnectionAdmissionSettings,
} from "../../src/utils/session/connectionAdmission";

const GiB = 1024 ** 3,
  MiB = 1024 ** 2;
const ample = { total_bytes: 32 * GiB, available_bytes: 24 * GiB };
const owner = Symbol("fixture-manager");
const automatic = {
  connectionAdmissionMode: "automatic" as const,
  maxConcurrentConnections: 10,
};
const fixed = {
  connectionAdmissionMode: "fixed" as const,
  maxConcurrentConnections: 1,
};
afterEach(() => vi.useRealTimers());

describe("memory-based connection admission", () => {
  it("uses actual free memory rather than charging hundreds of established light web tabs again", async () => {
    const gate = new ConnectionAdmission(
      async () => ({ total_bytes: 8 * GiB, available_bytes: 6 * GiB }),
      () => 5000,
    );
    const sessions = Array.from({ length: 400 }, (_, index) => ({
      id: `established-${index}`,
      protocol: "https",
      status: "connected",
      startTime: new Date(0),
    }));
    const held = await gate.acquire(owner, "https", () => ({
      settings: automatic,
      sessions,
    }));
    held.release();
    expect(gate.pendingCount).toBe(0);
  });
  it("retains opening estimates until a newer OS sample covers their establishment", async () => {
    let now = 1000;
    const gate = new ConnectionAdmission(
      async () => ({ total_bytes: 8 * GiB, available_bytes: 2 * GiB }),
      () => now,
    );
    await gate.warm();
    now = 1001;
    const sessions = [0, 1].map((id) => ({
      id: String(id),
      protocol: "https",
      status: "connected",
      startTime: new Date(now),
    }));
    const current = () => ({ settings: automatic, sessions });
    await expect(gate.acquire(owner, "https", current)).rejects.toThrow(
      MEMORY_PRESSURE,
    );
    now = 2002;
    const afterSample = await gate.acquire(owner, "https", current);
    afterSample.release();
    expect(gate.pendingCount).toBe(0);
  });
  it("rejects owner revocation while the native memory read is pending", async () => {
    let finish!: (value: typeof ample) => void;
    const gate = new ConnectionAdmission(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let currentOwner = true;
    const opening = expect(
      gate.acquire(
        owner,
        "https",
        () => ({ settings: automatic, sessions: [] }),
        () => {
          if (!currentOwner) throw Error("fixture-owner-revoked");
        },
      ),
    ).rejects.toThrow("fixture-owner-revoked");
    await Promise.resolve();
    currentOwner = false;
    finish(ample);
    await opening;
    expect(gate.pendingCount).toBe(0);
  });
  it("revalidates a fixed-to-automatic flip before publication and allows a fresh retry", async () => {
    const gate = new ConnectionAdmission(async () => ample);
    let settings: typeof automatic | typeof fixed = fixed;
    const current = () => ({ settings, sessions: [] });
    const held = await gate.acquire(owner, "ssh", current);
    settings = automatic;
    expect(() => held.revalidate()).toThrow(MEMORY_UNAVAILABLE);
    held.release();
    const fresh = await gate.acquire(owner, "ssh", current);
    fresh.release();
    expect(gate.pendingCount).toBe(0);
  });
  it.each([
    [{}, "automatic"],
    [{ maxConcurrentConnections: 10 }, "automatic"],
    [{ maxConcurrentConnections: 3 }, "fixed"],
    [{ maxConcurrentConnections: 0 }, "fixed"],
    [
      { connectionAdmissionMode: "fixed", maxConcurrentConnections: 10 },
      "fixed",
    ],
    [
      { connectionAdmissionMode: "automatic", maxConcurrentConnections: 3 },
      "automatic",
    ],
    [
      { connectionAdmissionMode: "malformed", maxConcurrentConnections: 10 },
      "fixed",
    ],
  ])("normalizes saved policy %j to %s", (input, mode) => {
    expect(
      normalizeConnectionAdmissionSettings(input as never)
        .connectionAdmissionMode,
    ).toBe(mode);
  });

  it("admits more than ten SSH sessions with ample OS memory and one fresh probe", async () => {
    const read = vi.fn(async () => ample);
    const gate = new ConnectionAdmission(read);
    const current = () => ({ settings: automatic, sessions: [] });
    const slots = await Promise.all(
      Array.from({ length: 24 }, () => gate.acquire(owner, "ssh", current)),
    );
    expect(read).toHaveBeenCalledOnce();
    expect(gate.pendingCount).toBe(24);
    for (const slot of slots) slot.release();
    expect(gate.pendingCount).toBe(0);
  });

  it("shares pending memory across managers, rejects over-budget bursts, and releases failures", async () => {
    const gate = new ConnectionAdmission(async () => ({
      total_bytes: 4 * GiB,
      available_bytes: GiB + 128 * MiB,
    }));
    const current = () => ({ settings: automatic, sessions: [] });
    const first = await gate.acquire(owner, "ssh", current);
    const second = await gate.acquire(Symbol("other-manager"), "ssh", current);
    await expect(gate.acquire(owner, "ssh", current)).rejects.toThrow(
      MEMORY_PRESSURE,
    );
    first.release();
    const replacement = await gate.acquire(owner, "ssh", current);
    second.release();
    replacement.release();
    expect(gate.pendingCount).toBe(0);
  });

  it("retains fixed count restrictions and accounts for parallel unpublished rows without probing", async () => {
    const read = vi.fn();
    const gate = new ConnectionAdmission(read);
    const current = () => ({ settings: fixed, sessions: [] });
    const first = await gate.acquire(owner, "ssh", current);
    first.commit("one");
    first.release();
    await expect(gate.acquire(owner, "ssh", current)).rejects.toThrow(
      "Maximum concurrent connections (1)",
    );
    expect(read).not.toHaveBeenCalled();
    gate.reconcile(owner, [{ id: "one", protocol: "ssh" }]);
    expect(gate.pendingCount).toBe(0);
  });

  it("open and immediate close in the same render batch cannot strand a committed reservation", async () => {
    const gate = new ConnectionAdmission(async () => ample);
    const current = () => ({ settings: fixed, sessions: [] });
    const first = await gate.acquire(owner, "ssh", current);
    first.commit("never-observed-row");
    first.release();
    gate.releaseSession("never-observed-row");
    const next = await gate.acquire(owner, "ssh", current);
    next.commit("failed-dispatch");
    next.abort();
    expect(gate.pendingCount).toBe(0);
    const last = await gate.acquire(owner, "ssh", current);
    last.release();
    expect(gate.pendingCount).toBe(0);
  });

  it.each([
    null,
    {},
    { total_bytes: 5, available_bytes: 10 },
    { total_bytes: Infinity, available_bytes: 1 },
  ])("refuses invalid OS evidence %j", async (sample) => {
    const gate = new ConnectionAdmission(async () => sample);
    await expect(
      gate.acquire(owner, "ssh", () => ({ settings: automatic, sessions: [] })),
    ).rejects.toThrow(MEMORY_UNAVAILABLE);
    expect(gate.pendingCount).toBe(0);
  });

  it("times out a hung probe without starting overlapping probes or adopting late evidence", async () => {
    vi.useFakeTimers();
    let done!: (sample: typeof ample) => void;
    const read = vi.fn(
      () =>
        new Promise<typeof ample>((resolve) => {
          done = resolve;
        }),
    );
    const gate = new ConnectionAdmission(read);
    const current = () => ({ settings: automatic, sessions: [] });
    const opening = expect(gate.acquire(owner, "ssh", current)).rejects.toThrow(
      MEMORY_UNAVAILABLE,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await opening;
    const retry = expect(gate.acquire(owner, "ssh", current)).rejects.toThrow(
      MEMORY_UNAVAILABLE,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await retry;
    expect(read).toHaveBeenCalledOnce();
    done(ample);
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.pendingCount).toBe(0);
  });

  it("refreshes stale samples and applies latest fixed mode and owner checks after awaiting", async () => {
    let now = 0;
    let done!: (sample: typeof ample) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce(ample)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            done = resolve;
          }),
      );
    const gate = new ConnectionAdmission(read, () => now);
    await gate.warm();
    now = 1001;
    let settings = automatic as {
      connectionAdmissionMode: "automatic" | "fixed";
      maxConcurrentConnections: number;
    };
    const current = () => ({
      settings,
      sessions: [{ id: "existing", protocol: "ssh" }],
    });
    const rejected = expect(
      gate.acquire(owner, "ssh", current),
    ).rejects.toThrow("Maximum concurrent connections (1)");
    await Promise.resolve();
    settings = fixed;
    done(ample);
    await rejected;
    expect(read).toHaveBeenCalledTimes(2);
    await expect(
      gate.acquire(owner, "ssh", current, () => {
        throw Error("fixture-owner-lost");
      }),
    ).rejects.toThrow("fixture-owner-lost");
    expect(gate.pendingCount).toBe(0);
  });
});
