import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useScriptExecutor } from "../../src/hooks/ssh/useScriptExecutor";
import type { BackendScriptResult } from "../../src/hooks/ssh/useScriptExecutor";
import type { PendingExecution } from "../../src/types/ssh/sshScripts";

// ── Helpers ────────────────────────────────────────────────────────

function makePending(overrides: Partial<PendingExecution> = {}): PendingExecution {
  return {
    executionId: "exec-1",
    scriptId: "script-1",
    scriptName: "Test Script",
    sessionId: "session-1",
    connectionId: "conn-1",
    triggerType: "manual",
    content: "echo hello\necho world",
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

const successResult: BackendScriptResult = {
  stdout: "hello\nworld",
  stderr: "",
  exitCode: 0,
  remotePath: "/tmp/.sorng_script_abc123",
};

const failedResult: BackendScriptResult = {
  stdout: "",
  stderr: "Permission denied",
  exitCode: 126,
  remotePath: "/tmp/.sorng_script_abc123",
};

function setupMock(results: Record<string, unknown> = {}) {
  (invoke as Mock).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "execute_script":
        return Promise.resolve(results["execute_script"] ?? successResult);
      case "send_ssh_input":
        return Promise.resolve(results["send_ssh_input"] ?? undefined);
      case "ssh_scripts_record_execution":
        return Promise.resolve(results["ssh_scripts_record_execution"] ?? undefined);
      default:
        return Promise.resolve(undefined);
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useScriptExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
  });

  // ── executePending (exec mode) ──────────────────────────────────

  describe("executePending – exec mode", () => {
    it("should call execute_script with correct args and return success", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executePending>>;
      await act(async () => {
        res = await result.current.executePending(makePending());
      });

      expect(invoke).toHaveBeenCalledWith("execute_script", {
        sessionId: "session-1",
        script: "echo hello\necho world",
        interpreter: "bash",
      });
      expect(res!.status).toBe("success");
      expect(res!.exitCode).toBe(0);
      expect(res!.stdout).toBe("hello\nworld");
      expect(res!.stderr).toBe("");
      expect(res!.executionId).toBe("exec-1");
      expect(res!.scriptId).toBe("script-1");
      expect(res!.scriptName).toBe("Test Script");
      expect(res!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should return status=failed when exit code is non-zero", async () => {
      setupMock({ execute_script: failedResult });
      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executePending>>;
      await act(async () => {
        res = await result.current.executePending(makePending());
      });

      expect(res!.status).toBe("failed");
      expect(res!.exitCode).toBe(126);
      expect(res!.stderr).toBe("Permission denied");
    });

    it("should record execution via ssh_scripts_record_execution on success", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      await act(async () => {
        await result.current.executePending(makePending());
      });

      expect(invoke).toHaveBeenCalledWith(
        "ssh_scripts_record_execution",
        expect.objectContaining({
          record: expect.objectContaining({
            id: "exec-1",
            scriptId: "script-1",
            scriptName: "Test Script",
            sessionId: "session-1",
            connectionId: "conn-1",
            status: "success",
            exitCode: 0,
            stdout: "hello\nworld",
          }),
        }),
      );
    });

    it("should record execution via ssh_scripts_record_execution on failure", async () => {
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") return Promise.reject("Connection lost");
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executePending>>;
      await act(async () => {
        res = await result.current.executePending(makePending());
      });

      expect(res!.status).toBe("failed");
      expect(res!.exitCode).toBe(-1);
      expect(res!.stderr).toBe("Connection lost");

      expect(invoke).toHaveBeenCalledWith(
        "ssh_scripts_record_execution",
        expect.objectContaining({
          record: expect.objectContaining({
            status: "failed",
            exitCode: -1,
            stderr: "Connection lost",
          }),
        }),
      );
    });

    it("should still succeed even if record_execution fails", async () => {
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") return Promise.resolve(successResult);
        if (cmd === "ssh_scripts_record_execution") return Promise.reject("DB error");
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executePending>>;
      await act(async () => {
        res = await result.current.executePending(makePending());
      });

      // Should still return a successful result despite recording failure
      expect(res!.status).toBe("success");
      expect(res!.exitCode).toBe(0);
    });

    it("should prevent duplicate concurrent execution of the same ID", async () => {
      // Make execute_script slow so the first call is still pending
      let resolveFirst: (v: BackendScriptResult) => void;
      let callCount = 0;
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") {
          callCount++;
          if (callCount === 1) {
            return new Promise<BackendScriptResult>((r) => { resolveFirst = r; });
          }
          return Promise.resolve(successResult);
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());

      const pending = makePending();
      let firstPromise: Promise<unknown>;
      let secondResult: Awaited<ReturnType<typeof result.current.executePending>>;

      await act(async () => {
        firstPromise = result.current.executePending(pending);
        secondResult = await result.current.executePending(pending);
      });

      // Second call should be skipped
      expect(secondResult!.status).toBe("skipped");
      expect(secondResult!.stderr).toBe("Already running");

      // Resolve first call for cleanup
      resolveFirst!(successResult);
      await act(async () => { await firstPromise; });
    });
  });

  // ── executePending (shell mode) ─────────────────────────────────

  describe("executePending – shell mode", () => {
    it("should pipe content via send_ssh_input and strip shebang lines", async () => {
      const { result } = renderHook(() => useScriptExecutor());
      const pending = makePending({
        executionMode: "shell",
        content: "#!/bin/bash\necho hello\necho world",
      });

      let res: Awaited<ReturnType<typeof result.current.executePending>>;
      await act(async () => {
        res = await result.current.executePending(pending);
      });

      expect(invoke).toHaveBeenCalledWith("send_ssh_input", {
        sessionId: "session-1",
        data: "echo hello\necho world\n",
      });
      expect(res!.stdout).toContain("executed in shell");
      expect(res!.exitCode).toBe(0);
    });

    it("should NOT call execute_script in shell mode", async () => {
      const { result } = renderHook(() => useScriptExecutor());
      const pending = makePending({ executionMode: "shell" });

      await act(async () => {
        await result.current.executePending(pending);
      });

      expect(invoke).not.toHaveBeenCalledWith("execute_script", expect.anything());
    });
  });

  // ── Language interpreter mapping ────────────────────────────────

  describe("interpreter mapping via language", () => {
    const languageCases: [string, string | null][] = [
      ["bash", "bash"],
      ["sh", "sh"],
      ["python", "python3"],
      ["perl", "perl"],
      ["powershell", "powershell"],
      ["raw", null],
    ];

    it.each(languageCases)(
      "should map language '%s' to interpreter %s",
      async (language, expectedInterpreter) => {
        const { result } = renderHook(() => useScriptExecutor());
        const pending = makePending({ language: language as PendingExecution["language"] });

        await act(async () => {
          await result.current.executePending(pending);
        });

        if (expectedInterpreter === null) {
          // raw → interpreter is null
          expect(invoke).toHaveBeenCalledWith("execute_script", {
            sessionId: "session-1",
            script: expect.any(String),
            interpreter: null,
          });
        } else {
          expect(invoke).toHaveBeenCalledWith("execute_script", {
            sessionId: "session-1",
            script: expect.any(String),
            interpreter: expectedInterpreter,
          });
        }
      },
    );

    it("should default unknown language to bash", async () => {
      const { result } = renderHook(() => useScriptExecutor());
      const pending = makePending({ language: "ruby" as PendingExecution["language"] });

      await act(async () => {
        await result.current.executePending(pending);
      });

      expect(invoke).toHaveBeenCalledWith("execute_script", {
        sessionId: "session-1",
        script: expect.any(String),
        interpreter: "bash",
      });
    });
  });

  // ── executeChain ────────────────────────────────────────────────

  describe("executeChain", () => {
    it("should execute all pending items sequentially", async () => {
      const { result } = renderHook(() => useScriptExecutor());
      const chain = [
        makePending({ executionId: "e1", scriptName: "Step 1" }),
        makePending({ executionId: "e2", scriptName: "Step 2" }),
        makePending({ executionId: "e3", scriptName: "Step 3" }),
      ];

      let results: Awaited<ReturnType<typeof result.current.executeChain>>;
      await act(async () => {
        results = await result.current.executeChain(chain);
      });

      expect(results!).toHaveLength(3);
      expect(results![0].scriptName).toBe("Step 1");
      expect(results![1].scriptName).toBe("Step 2");
      expect(results![2].scriptName).toBe("Step 3");
      results!.forEach((r) => expect(r.status).toBe("success"));
    });

    it("should abort on failure and mark remaining as skipped (abortOnFailure=true)", async () => {
      let callNum = 0;
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") {
          callNum++;
          if (callNum === 2) return Promise.resolve(failedResult);
          return Promise.resolve(successResult);
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());
      const chain = [
        makePending({ executionId: "e1", scriptName: "Step 1" }),
        makePending({ executionId: "e2", scriptName: "Step 2" }),
        makePending({ executionId: "e3", scriptName: "Step 3" }),
      ];

      let results: Awaited<ReturnType<typeof result.current.executeChain>>;
      await act(async () => {
        results = await result.current.executeChain(chain, true);
      });

      expect(results!).toHaveLength(3);
      expect(results![0].status).toBe("success");
      expect(results![1].status).toBe("failed");
      expect(results![2].status).toBe("skipped");
      expect(results![2].stderr).toContain("earlier failure");
    });

    it("should continue on failure when abortOnFailure=false", async () => {
      let callNum = 0;
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") {
          callNum++;
          if (callNum === 2) return Promise.resolve(failedResult);
          return Promise.resolve(successResult);
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());
      const chain = [
        makePending({ executionId: "e1", scriptName: "Step 1" }),
        makePending({ executionId: "e2", scriptName: "Step 2" }),
        makePending({ executionId: "e3", scriptName: "Step 3" }),
      ];

      let results: Awaited<ReturnType<typeof result.current.executeChain>>;
      await act(async () => {
        results = await result.current.executeChain(chain, false);
      });

      expect(results!).toHaveLength(3);
      expect(results![0].status).toBe("success");
      expect(results![1].status).toBe("failed");
      expect(results![2].status).toBe("success"); // Continued despite failure
    });

    it("should handle empty chain", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      let results: Awaited<ReturnType<typeof result.current.executeChain>>;
      await act(async () => {
        results = await result.current.executeChain([]);
      });

      expect(results!).toHaveLength(0);
    });
  });

  // ── executeManaged ──────────────────────────────────────────────

  describe("executeManaged", () => {
    it("should call execute_script with the given content and language", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executeManaged>>;
      await act(async () => {
        res = await result.current.executeManaged(
          "sid-1",
          "uptime\nwhoami",
          "bash",
        );
      });

      expect(invoke).toHaveBeenCalledWith("execute_script", {
        sessionId: "sid-1",
        script: "uptime\nwhoami",
        interpreter: "bash",
      });
      expect(res!.stdout).toBe("hello\nworld");
      expect(res!.exitCode).toBe(0);
    });

    it("should use python3 for python language", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      await act(async () => {
        await result.current.executeManaged("sid-1", "print('hi')", "python");
      });

      expect(invoke).toHaveBeenCalledWith("execute_script", {
        sessionId: "sid-1",
        script: "print('hi')",
        interpreter: "python3",
      });
    });

    it("should pass null interpreter for raw language", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      await act(async () => {
        await result.current.executeManaged("sid-1", "raw-command", "raw");
      });

      expect(invoke).toHaveBeenCalledWith("execute_script", {
        sessionId: "sid-1",
        script: "raw-command",
        interpreter: null,
      });
    });

    it("should return error object when invoke throws", async () => {
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "execute_script") return Promise.reject("SSH timeout");
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useScriptExecutor());

      let res: Awaited<ReturnType<typeof result.current.executeManaged>>;
      await act(async () => {
        res = await result.current.executeManaged("sid-1", "fail", "bash");
      });

      expect(res!.exitCode).toBe(-1);
      expect(res!.error).toBe("SSH timeout");
      expect(res!.stderr).toBe("SSH timeout");
      expect(res!.stdout).toBe("");
      expect(res!.remotePath).toBe("");
    });

    it("should NOT call ssh_scripts_record_execution (unlike executePending)", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      await act(async () => {
        await result.current.executeManaged("sid-1", "echo hi", "bash");
      });

      expect(invoke).not.toHaveBeenCalledWith(
        "ssh_scripts_record_execution",
        expect.anything(),
      );
    });
  });

  // ── Execution record fields ─────────────────────────────────────

  describe("execution record timestamps", () => {
    it("should include valid ISO timestamps in the recorded execution", async () => {
      const { result } = renderHook(() => useScriptExecutor());

      await act(async () => {
        await result.current.executePending(makePending());
      });

      const recordCall = (invoke as Mock).mock.calls.find(
        (c: unknown[]) => c[0] === "ssh_scripts_record_execution",
      );
      expect(recordCall).toBeDefined();

      const record = (recordCall![1] as { record: Record<string, unknown> }).record;
      expect(record.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record.attempt).toBe(1);
      expect(record.triggerType).toBe("manual");
      expect(record.variables).toEqual({});
      expect(record.environment).toEqual({});
    });
  });
});
