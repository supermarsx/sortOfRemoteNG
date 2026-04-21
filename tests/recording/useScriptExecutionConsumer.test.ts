import { describe, it, expect, beforeEach, vi, Mock, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { PendingExecution } from "../../src/types/ssh/sshScripts";

// ── Mocks ──────────────────────────────────────────────────────────

// We need to mock useScriptExecutor to control what executePending does
const mockExecutePending = vi.fn();
vi.mock("../../src/hooks/ssh/useScriptExecutor", () => ({
  useScriptExecutor: () => ({
    executePending: mockExecutePending,
    executeChain: vi.fn(),
    executeManaged: vi.fn(),
  }),
}));

// Import after mock
import { useScriptExecutionConsumer } from "../../src/hooks/recording/useScriptExecutionConsumer";

// ── Helpers ────────────────────────────────────────────────────────

function makePending(overrides: Partial<PendingExecution> = {}): PendingExecution {
  return {
    executionId: "exec-1",
    scriptId: "script-1",
    scriptName: "Test Script",
    sessionId: "session-1",
    connectionId: "conn-1",
    triggerType: "manual",
    content: "echo hello",
    language: "bash",
    executionMode: "exec",
    timeoutMs: 30000,
    environment: {},
    resolvedVariables: {},
    onFailure: "continue",
    maxRetries: 0,
    retryDelayMs: 1000,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useScriptExecutionConsumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutePending.mockResolvedValue({
      executionId: "exec-1",
      scriptId: "script-1",
      scriptName: "Test Script",
      status: "success",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 42,
    });
  });

  it("should dispatch a single pending execution", async () => {
    const pending = [makePending()];
    renderHook(() => useScriptExecutionConsumer(pending));

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(1);
      expect(mockExecutePending).toHaveBeenCalledWith(pending[0]);
    });
  });

  it("should dispatch multiple pending executions", async () => {
    const pending = [
      makePending({ executionId: "e1" }),
      makePending({ executionId: "e2" }),
      makePending({ executionId: "e3" }),
    ];
    renderHook(() => useScriptExecutionConsumer(pending));

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(3);
    });
  });

  it("should not re-dispatch already processed executions", async () => {
    const pending1 = [makePending({ executionId: "e1" })];
    const { rerender } = renderHook(
      ({ execs }) => useScriptExecutionConsumer(execs),
      { initialProps: { execs: pending1 } },
    );

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(1);
    });

    // Rerender with the same execution in the list
    rerender({ execs: pending1 });

    // Should still only have been called once (duplicate check)
    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(1);
    });
  });

  it("should process new executions added in subsequent renders", async () => {
    const pending1 = [makePending({ executionId: "e1" })];
    const { rerender } = renderHook(
      ({ execs }) => useScriptExecutionConsumer(execs),
      { initialProps: { execs: pending1 } },
    );

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(1);
    });

    // Add a new execution
    const pending2 = [
      makePending({ executionId: "e1" }),
      makePending({ executionId: "e2" }),
    ];
    rerender({ execs: pending2 });

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(2);
    });
  });

  it("should not throw when executePending rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecutePending.mockRejectedValueOnce(new Error("Script boom"));

    const pending = [makePending({ executionId: "e1" })];
    renderHook(() => useScriptExecutionConsumer(pending));

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(1);
    });

    // The error should be caught and logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Script execution failed"),
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
  });

  it("should handle empty pending list without errors", () => {
    const { result } = renderHook(() => useScriptExecutionConsumer([]));
    expect(mockExecutePending).not.toHaveBeenCalled();
  });

  it("should handle rapid sequential updates without duplicates", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const batches = ids.map((id) => [makePending({ executionId: id })]);

    const { rerender } = renderHook(
      ({ execs }) => useScriptExecutionConsumer(execs),
      { initialProps: { execs: [] as PendingExecution[] } },
    );

    // Rapidly rerender with cumulative batches
    let accumulated: PendingExecution[] = [];
    for (const batch of batches) {
      accumulated = [...accumulated, ...batch];
      rerender({ execs: accumulated });
    }

    await waitFor(() => {
      expect(mockExecutePending).toHaveBeenCalledTimes(20);
    });

    // Each execution should only be dispatched once
    const calledIds = mockExecutePending.mock.calls.map(
      (c: any[]) => (c[0] as PendingExecution).executionId,
    );
    const uniqueIds = new Set(calledIds);
    expect(uniqueIds.size).toBe(20);
  });
});
