import { useEffect, useRef } from "react";
import type { PendingExecution } from "../../types/ssh/sshScripts";
import { useScriptExecutor } from "../ssh/useScriptExecutor";

/**
 * Watches a list of pending executions and automatically dispatches each one
 * to the SSH backend via execute_script. Records results back to the
 * script engine history.
 *
 * Typical usage:
 *   const { pendingExecutions } = useSshScripts();
 *   useScriptExecutionConsumer(pendingExecutions);
 */
export function useScriptExecutionConsumer(
  pendingExecutions: PendingExecution[],
) {
  const { executePending } = useScriptExecutor();
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const pending of pendingExecutions) {
      if (processedRef.current.has(pending.executionId)) continue;
      // Mark as processed immediately to avoid duplicate dispatches
      processedRef.current.add(pending.executionId);

      executePending(pending).catch((err) => {
        console.error(`Script execution failed for ${pending.scriptName}:`, err);
      });
    }

    // Prevent memory leak: trim processed set if it grows too large
    if (processedRef.current.size > 1000) {
      const recentIds = new Set(pendingExecutions.map((p) => p.executionId));
      processedRef.current = recentIds;
    }
  }, [pendingExecutions, executePending]);
}
