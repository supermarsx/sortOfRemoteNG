import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  PendingExecution,
  ExecutionRecord,
  ExecutionStatus,
} from "../../types/ssh/sshScripts";

/** Matches the Rust `ScriptExecutionResult` returned by the `execute_script` command. */
export interface BackendScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  remotePath: string;
}

export interface ScriptExecutionResult {
  executionId: string;
  scriptId: string;
  scriptName: string;
  status: ExecutionStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Maps a PendingExecution.language to the interpreter string expected by the
 * `execute_script` backend command.
 */
function languageToInterpreter(language: string): string | undefined {
  switch (language) {
    case "bash":
      return "bash";
    case "sh":
      return "sh";
    case "powershell":
      return "powershell";
    case "python":
      return "python3";
    case "perl":
      return "perl";
    case "raw":
      return undefined; // raw means send the content as-is to execute_command
    default:
      return "bash";
  }
}

/**
 * Hook that bridges PendingExecution objects from the SSH script engine
 * to actual remote execution via the SSH backend, then records the result.
 */
export function useScriptExecutor() {
  const runningRef = useRef<Set<string>>(new Set());

  /**
   * Execute a single PendingExecution on the remote server.
   * Uses `execute_script` (opens a new channel, captures stdout) for exec mode,
   * or `send_ssh_input` (pipes into the live shell) for shell mode.
   */
  const executePending = useCallback(
    async (pending: PendingExecution): Promise<ScriptExecutionResult> => {
      // Prevent duplicate concurrent runs of the same execution
      if (runningRef.current.has(pending.executionId)) {
        return {
          executionId: pending.executionId,
          scriptId: pending.scriptId,
          scriptName: pending.scriptName,
          status: "skipped",
          stdout: "",
          stderr: "Already running",
          durationMs: 0,
        };
      }

      runningRef.current.add(pending.executionId);
      const startTime = Date.now();

      try {
        let stdout = "";
        let stderr = "";
        let exitCode: number | undefined;
        let status: ExecutionStatus = "success";

        if (pending.executionMode === "shell") {
          // Shell mode: pipe the content into the active shell session
          const lines = pending.content.split("\n").filter((l) => !l.startsWith("#!"));
          const command = lines.join("\n");
          await invoke("send_ssh_input", {
            sessionId: pending.sessionId,
            data: command + "\n",
          });
          stdout = "(executed in shell — output visible in terminal)";
          exitCode = 0;
        } else {
          // Exec mode: upload as temp file, execute, capture output, clean up
          const interpreter = languageToInterpreter(pending.language);
          const result = await invoke<BackendScriptResult>("execute_script", {
            sessionId: pending.sessionId,
            script: pending.content,
            interpreter: interpreter ?? null,
          });
          stdout = result.stdout;
          stderr = result.stderr;
          exitCode = result.exitCode;
          status = result.exitCode === 0 ? "success" : "failed";
        }

        const durationMs = Date.now() - startTime;

        // Record the execution in the script engine history
        const record: ExecutionRecord = {
          id: pending.executionId,
          scriptId: pending.scriptId,
          scriptName: pending.scriptName,
          sessionId: pending.sessionId,
          connectionId: pending.connectionId,
          triggerType: pending.triggerType,
          status,
          exitCode,
          stdout,
          stderr,
          startedAt: new Date(startTime).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs,
          attempt: 1,
          variables: pending.resolvedVariables,
          environment: pending.environment,
        };

        await invoke("ssh_scripts_record_execution", { record }).catch(() => {});

        return {
          executionId: pending.executionId,
          scriptId: pending.scriptId,
          scriptName: pending.scriptName,
          status,
          exitCode,
          stdout,
          stderr,
          durationMs,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMsg = typeof err === "string" ? err : String(err);

        const record: ExecutionRecord = {
          id: pending.executionId,
          scriptId: pending.scriptId,
          scriptName: pending.scriptName,
          sessionId: pending.sessionId,
          connectionId: pending.connectionId,
          triggerType: pending.triggerType,
          status: "failed",
          exitCode: -1,
          stdout: "",
          stderr: errorMsg,
          startedAt: new Date(startTime).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs,
          attempt: 1,
          variables: pending.resolvedVariables,
          environment: pending.environment,
        };

        await invoke("ssh_scripts_record_execution", { record }).catch(() => {});

        return {
          executionId: pending.executionId,
          scriptId: pending.scriptId,
          scriptName: pending.scriptName,
          status: "failed" as ExecutionStatus,
          exitCode: -1,
          stdout: "",
          stderr: errorMsg,
          durationMs,
        };
      } finally {
        runningRef.current.delete(pending.executionId);
      }
    },
    [],
  );

  /**
   * Execute a list of PendingExecution objects sequentially.
   * Used for chain execution where order matters.
   */
  const executeChain = useCallback(
    async (
      executions: PendingExecution[],
      abortOnFailure = true,
    ): Promise<ScriptExecutionResult[]> => {
      const results: ScriptExecutionResult[] = [];

      for (const pending of executions) {
        const result = await executePending(pending);
        results.push(result);

        if (abortOnFailure && result.status === "failed") {
          // Mark remaining as skipped
          for (const remaining of executions.slice(results.length)) {
            results.push({
              executionId: remaining.executionId,
              scriptId: remaining.scriptId,
              scriptName: remaining.scriptName,
              status: "skipped",
              stdout: "",
              stderr: "Skipped due to earlier failure in chain",
              durationMs: 0,
            });
          }
          break;
        }
      }

      return results;
    },
    [executePending],
  );

  /**
   * Execute a ManagedScript (from the local ScriptManager) directly on an
   * SSH session. This creates an ad-hoc execution without going through
   * the event engine. Uploads as a temp file, runs, captures output.
   */
  const executeManaged = useCallback(
    async (
      sessionId: string,
      scriptContent: string,
      language: string,
      connectionId?: string,
    ): Promise<BackendScriptResult & { error?: string }> => {
      try {
        const interpreter = languageToInterpreter(language);
        const result = await invoke<BackendScriptResult>("execute_script", {
          sessionId,
          script: scriptContent,
          interpreter: interpreter ?? null,
        });
        return result;
      } catch (err) {
        return {
          stdout: "",
          stderr: typeof err === "string" ? err : String(err),
          exitCode: -1,
          remotePath: "",
          error: typeof err === "string" ? err : String(err),
        };
      }
    },
    [],
  );

  return {
    executePending,
    executeChain,
    executeManaged,
  };
}
