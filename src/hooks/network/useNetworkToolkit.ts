import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ToolkitReport,
  ToolkitRequest,
} from "../../types/network/networkToolkit";

export function useNetworkToolkit() {
  const [report, setReport] = useState<ToolkitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const active = useRef<string | null>(null);
  const cancelling = useRef<{ jobId: string; promise: Promise<void> } | null>(
    null,
  );
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    const jobId = active.current;
    if (!jobId) return Promise.resolve();
    if (cancelling.current?.jobId === jobId) return cancelling.current.promise;
    if (mounted.current) setError("Cancellation requested…");
    const cancellation = { jobId, promise: Promise.resolve() };
    cancelling.current = cancellation;
    cancellation.promise = (async () => {
      try {
        // Both true (registered job aborted) and false (early cancellation
        // recorded) acknowledge cancellation. Keep ownership until that reply
        // or the run terminates, so a failed IPC call can be retried safely.
        await invoke<boolean>("network_toolkit_cancel", { jobId });
        if (active.current !== jobId) return;
        active.current = null;
        if (mounted.current) {
          setRunning(false);
          setError("Diagnostic cancelled.");
        }
      } catch {
        if (mounted.current && active.current === jobId)
          setError(
            "Cancellation could not be confirmed. The diagnostic may still be running; try Cancel again.",
          );
      } finally {
        if (cancelling.current?.jobId === jobId) cancelling.current = null;
      }
    })();
    return cancellation.promise;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void cancel();
    };
  }, [cancel]);

  const run = useCallback(async (request: Omit<ToolkitRequest, "jobId">) => {
    if (active.current) return;
    if (!isTauri()) {
      setError(
        "Network Toolkit requires the desktop app. No network request was made.",
      );
      return;
    }
    const jobId = crypto.randomUUID();
    active.current = jobId;
    setReport(null);
    setError(null);
    setRunning(true);
    try {
      const result = await invoke<ToolkitReport>("network_toolkit_run", {
        request: { ...request, jobId },
      });
      if (mounted.current && active.current === jobId) {
        setReport(result);
        setError(null);
      }
    } catch (failure) {
      if (mounted.current && active.current === jobId)
        setError(
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "Diagnostic failed. Review the route, target and required system tools.",
        );
    } finally {
      if (active.current === jobId) {
        active.current = null;
        if (mounted.current) setRunning(false);
      }
    }
  }, []);

  const clear = useCallback(() => {
    void cancel();
    setReport(null);
    setError(null);
  }, [cancel]);
  return { report, error, running, run, cancel, clear };
}
