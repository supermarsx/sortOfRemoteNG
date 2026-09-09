import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayMacro } from "../../src/utils/recording/macroService";
import type { TerminalMacro } from "../../src/types/recording/macroTypes";
const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
const macro: TerminalMacro = {
  id: "fixture",
  name: "Fixture",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  steps: [
    { command: "first", delayMs: 3_600_000, sendNewline: true },
    { command: "second", delayMs: 0, sendNewline: true },
  ],
};
beforeEach(() => {
  vi.useFakeTimers();
  native.mockReset();
  native.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("terminal macro cancellation", () => {
  it("does not wait an hour when cancellation happens during pending native input", async () => {
    let finish!: () => void;
    native.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const running = replayMacro(
      "exact-actor",
      macro,
      undefined,
      controller.signal,
    );
    controller.abort();
    finish();
    await running;
    expect(native).toHaveBeenCalledExactlyOnceWith("send_ssh_input", {
      sessionId: "exact-actor",
      data: "first\n",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removes abort listeners on ordinary delay completion", async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const running = replayMacro(
      "exact-actor",
      { ...macro, steps: macro.steps.map((step) => ({ ...step, delayMs: 5 })) },
      undefined,
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(5);
    await running;
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("checks the caller's current actor/access guard before every step", async () => {
    const guard = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("Actor changed");
      });
    const running = replayMacro(
      "exact-actor",
      { ...macro, steps: macro.steps.map((step) => ({ ...step, delayMs: 0 })) },
      guard,
    );
    await expect(running).rejects.toThrow("Actor changed");
    expect(native).toHaveBeenCalledOnce();
  });
});
