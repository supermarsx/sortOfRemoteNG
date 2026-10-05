import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  getCurrentWindow: vi.fn(),
  getMemoryWatchdog: vi.fn(),
  startMemoryWatchdog: vi.fn(),
  stopMemoryWatchdog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));
vi.mock("../../src/utils/debug/memoryWatchdog", () => ({
  getMemoryWatchdog: mocks.getMemoryWatchdog,
  startMemoryWatchdog: mocks.startMemoryWatchdog,
  stopMemoryWatchdog: mocks.stopMemoryWatchdog,
}));

import { TerminalBufferController } from "../../src/components/app/TerminalBufferController";
import {
  defaultTerminalBufferingSettings,
  type TerminalBufferingSettings,
} from "../../src/types/ssh/terminalBuffering";
import type { MemoryWatchdogSnapshot } from "../../src/utils/debug/memoryWatchdog";

const COMMAND = "configure_terminal_buffering";

function settings(
  overrides: Partial<TerminalBufferingSettings> = {},
): TerminalBufferingSettings {
  return { ...defaultTerminalBufferingSettings, ...overrides };
}

function mockWatchdog(
  severity: MemoryWatchdogSnapshot["severity"],
  running = true,
) {
  // The bridge consumes only status, never stats or a separate memory probe.
  const state: Pick<MemoryWatchdogSnapshot, "running" | "severity"> = {
    running,
    severity,
  };
  const getSnapshot = vi.fn(() => state);
  mocks.getMemoryWatchdog.mockReturnValue({ getSnapshot });
  return { state, getSnapshot };
}

function pendingCall() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("TerminalBufferController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    vi.resetAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.getCurrentWindow.mockReturnValue({ label: "main" });
    mocks.invoke.mockResolvedValue(undefined);
    mocks.getMemoryWatchdog.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.startMemoryWatchdog).not.toHaveBeenCalled();
    expect(mocks.stopMemoryWatchdog).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends main-window defaults immediately and renews pressure every five seconds", async () => {
    const { getSnapshot } = mockWatchdog("warning");
    const { container } = render(<TerminalBufferController />);
    await advance();

    expect(container).toBeEmptyDOMElement();
    expect(mocks.getCurrentWindow).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(COMMAND, {
      config: defaultTerminalBufferingSettings,
      pressure: "warning",
    });
    await advance(4_999);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    expect(
      mocks.invoke.mock.calls.every(([command]) => command === COMMAND),
    ).toBe(true);
  });

  it.each([false, true])(
    "sends only pressure from a detached window (label override: %s)",
    async (override) => {
      mocks.getCurrentWindow.mockReturnValue({ label: "detached-terminal-7" });
      mockWatchdog("critical");
      const windowLabel = override ? "detached-explicit" : undefined;
      const view = render(
        <TerminalBufferController
          settings={settings({ mode: "fixed", fixedMiB: 80 })}
          windowLabel={windowLabel}
        />,
      );
      await advance();
      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(COMMAND, {
        pressure: "critical",
      });
      if (override) expect(mocks.getCurrentWindow).not.toHaveBeenCalled();

      view.rerender(
        <TerminalBufferController
          settings={settings({ fixedMiB: 2, totalMiB: 16 })}
          windowLabel={windowLabel}
        />,
      );
      await advance(5_000);
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      expect(mocks.invoke.mock.calls.map(([, args]) => args)).toEqual([
        { pressure: "critical" },
        { pressure: "critical" },
      ]);
    },
  );

  it("normalizes main policy and promptly sends meaningful settings changes", async () => {
    const view = render(
      <TerminalBufferController
        windowLabel="main"
        settings={settings({
          minMiB: -5,
          maxMiB: 500,
          fixedMiB: Number.NaN,
          totalMiB: 2_048,
        })}
      />,
    );
    await advance();
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      config: settings({ totalMiB: 1_024 }),
      pressure: "normal",
    });

    const updated = settings({ mode: "fixed", fixedMiB: 25, totalMiB: 64 });
    view.rerender(
      <TerminalBufferController windowLabel="main" settings={updated} />,
    );
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      config: updated,
      pressure: "normal",
    });

    view.rerender(
      <TerminalBufferController windowLabel="main" settings={{ ...updated }} />,
    );
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    view.rerender(<TerminalBufferController windowLabel="main" />);
    await advance();
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      config: defaultTerminalBufferingSettings,
      pressure: "normal",
    });
  });

  it("follows watchdog startup, pressure, recovery, stopping and replacement", async () => {
    render(<TerminalBufferController windowLabel="detached-terminal-7" />);
    await advance();
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      pressure: "normal",
    });

    const { state } = mockWatchdog("warning");
    for (const severity of [
      "warning",
      "critical",
      "pressure",
      "normal",
    ] as const) {
      state.severity = severity;
      await advance(5_000);
      expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
        pressure: severity,
      });
    }

    state.running = false;
    state.severity = "pressure";
    await advance(5_000);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      pressure: "normal",
    });
    mocks.getMemoryWatchdog.mockReturnValue(null);
    await advance(5_000);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      pressure: "normal",
    });
    mockWatchdog("critical");
    await advance(5_000);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      pressure: "critical",
    });
  });

  it("coalesces settings while invoke is pending and sends the latest pressure on completion", async () => {
    const pending = pendingCall();
    mocks.invoke.mockReturnValueOnce(pending.promise);
    const { state, getSnapshot } = mockWatchdog("warning");
    const view = render(<TerminalBufferController />);
    await advance();

    view.rerender(
      <TerminalBufferController settings={settings({ fixedMiB: 20 })} />,
    );
    view.rerender(
      <TerminalBufferController settings={settings({ fixedMiB: 30 })} />,
    );
    state.severity = "critical";
    await advance(60_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    pending.resolve();
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      config: settings({ fixedMiB: 30 }),
      pressure: "critical",
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["resolve", "reject"] as const)(
    "does not report or schedule after unmount when a pending invoke later %ss",
    async (outcome) => {
      const pending = pendingCall();
      mocks.invoke.mockReturnValueOnce(pending.promise);
      const { unmount } = render(<TerminalBufferController />);
      await advance();
      unmount();
      expect(vi.getTimerCount()).toBe(0);

      if (outcome === "resolve") pending.resolve();
      else pending.reject(new Error("native failure"));
      await advance(60_000);
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancels an initial report when immediately unmounted", async () => {
    const { unmount } = render(<TerminalBufferController />);
    unmount();
    await advance(60_000);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps a single flight and timer during Strict Mode effect replay", async () => {
    const pending = pendingCall();
    mocks.invoke.mockReturnValueOnce(pending.promise);
    const view = render(
      <StrictMode>
        <TerminalBufferController />
      </StrictMode>,
    );
    await advance();
    await advance(15_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    pending.resolve();
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    await advance(60_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("backs off failures with one bounded timer, then resumes five-second reporting", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockRejectedValue(new Error("sensitive native details"));
    const { state } = mockWatchdog("pressure");
    const view = render(<TerminalBufferController />);
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    // Changes queue the latest policy without defeating a failed-call backoff.
    const updated = settings({ fixedMiB: 35 });
    view.rerender(<TerminalBufferController settings={updated} />);
    await advance();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    let calls = 1;
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 20_000, 20_000]) {
      expect(vi.getTimerCount()).toBe(1);
      await advance(delay - 1);
      expect(mocks.invoke).toHaveBeenCalledTimes(calls);
      await advance(1);
      expect(mocks.invoke).toHaveBeenCalledTimes(++calls);
    }

    state.severity = "normal";
    mocks.invoke.mockResolvedValue(undefined);
    await advance(20_000);
    expect(mocks.invoke).toHaveBeenLastCalledWith(COMMAND, {
      config: updated,
      pressure: "normal",
    });
    await advance(4_999);
    expect(mocks.invoke).toHaveBeenCalledTimes(++calls);
    await advance(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(++calls);

    // A later failure starts again at the initial retry delay.
    mocks.invoke.mockRejectedValueOnce(new Error("native failure"));
    await advance(5_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(++calls);
    await advance(999);
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    await advance(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(++calls);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("handles synchronous invoke failures and cancels the retry on unmount", async () => {
    mocks.invoke.mockImplementation(() => {
      throw new Error("native bridge unavailable");
    });
    const { unmount } = render(<TerminalBufferController />);
    await advance();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    await advance(60_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does no native work or polling in an ordinary browser", async () => {
    mocks.isTauri.mockReturnValue(false);
    mocks.getCurrentWindow.mockImplementation(() => {
      throw new Error("not a Tauri window");
    });
    const view = render(<TerminalBufferController />);
    view.rerender(
      <TerminalBufferController settings={settings({ fixedMiB: 10 })} />,
    );
    await advance(60_000);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getMemoryWatchdog).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("omits policy if the native window cannot be identified", async () => {
    mocks.getCurrentWindow.mockImplementation(() => {
      throw new Error("window metadata unavailable");
    });
    render(<TerminalBufferController />);
    await advance();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(COMMAND, {
      pressure: "normal",
    });
  });
});
