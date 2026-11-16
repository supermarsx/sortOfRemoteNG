import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useServerStats } from "../../src/hooks/ssh/useServerStats";
import {
  MIN_POLL_GAP_MS,
  backoffMs,
  endPoll,
  resetPollGates,
  tryBeginPoll,
} from "../../src/utils/ssh/serverStatsPollGate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const dispatch = vi.fn();
const sessions = [
  {
    id: "s1",
    name: "A",
    protocol: "ssh",
    hostname: "a",
    status: "connected",
    backendSessionId: "b1",
  },
];
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { sessions, connections: [] }, dispatch }),
}));

const mockInvoke = vi.mocked(invoke);

describe("server stats isolation from the interactive terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    resetPollGates();
    mockInvoke.mockReset();
    dispatch.mockReset();
    (window as any).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("only runs the exec command and never touches shell/terminal commands", async () => {
    mockInvoke.mockResolvedValue("");
    const { result } = renderHook(() => useServerStats(true));
    await act(async () => {
      await result.current.collectStats();
    });
    const names = mockInvoke.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["execute_command"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("isolates failures: surfaces an error, never mutates session state", async () => {
    mockInvoke.mockRejectedValue("channel open failed");
    const { result } = renderHook(() => useServerStats(true));
    await act(async () => {
      await result.current.collectStats();
    });
    expect(result.current.error).toContain("channel open failed");
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(["execute_command"]);
  });

  it("auto polls respect the minimum gap and back off after failures", async () => {
    mockInvoke.mockRejectedValue("boom");
    const { result } = renderHook(() => useServerStats(true));
    await act(async () => {
      await result.current.collectStats(true);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // Inside the backoff window: skipped.
    vi.setSystemTime(1_000_000 + MIN_POLL_GAP_MS + 1);
    await act(async () => {
      await result.current.collectStats(true);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // After the backoff elapses: polls again.
    vi.setSystemTime(1_000_000 + backoffMs(1) + 1);
    await act(async () => {
      await result.current.collectStats(true);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("skips a cycle while a previous poll of the same host is in flight", async () => {
    let release!: (v: string) => void;
    mockInvoke.mockImplementation(
      () => new Promise<string>((r) => (release = r)),
    );
    const { result } = renderHook(() => useServerStats(true));
    let first!: Promise<void>;
    act(() => {
      first = result.current.collectAll(true);
    });
    await act(async () => {
      await result.current.collectAll(true);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      release("");
      await first;
    });
  });
});

describe("serverStatsPollGate", () => {
  beforeEach(() => resetPollGates());

  it("serializes per host and lets manual polls bypass gap and backoff", () => {
    const T = 100_000;
    expect(tryBeginPoll("h", "auto", T)).toBe(true);
    expect(tryBeginPoll("h", "manual", T + 1)).toBe(false);
    endPoll("h", false, T + 10);
    expect(tryBeginPoll("h", "auto", T + 10 + MIN_POLL_GAP_MS)).toBe(false);
    expect(tryBeginPoll("h", "manual", T + 11)).toBe(true);
    endPoll("h", true, T + 12);
    expect(tryBeginPoll("h", "auto", T + 13)).toBe(false);
    expect(tryBeginPoll("h", "auto", T + 11 + MIN_POLL_GAP_MS)).toBe(true);
  });

  it("caps the backoff", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(50)).toBe(120_000);
  });
});
