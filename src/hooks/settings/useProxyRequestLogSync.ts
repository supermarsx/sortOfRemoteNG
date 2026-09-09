import { useCallback, useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";
import { validateProxyRequestLogLimit } from "../../utils/settings/proxyRequestLog";

export interface ProxyRequestLogSyncState {
  pending: boolean;
  error: string | null;
  appliedLimit: number | null;
  managedByMainWindow?: boolean;
  retry: () => void;
}

/** The sole startup/settings bridge; serialize changes so an older IPC cannot win. */
export function useProxyRequestLogSync(
  limit: number,
  ready: boolean,
): ProxyRequestLogSyncState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    pending: false,
    error: null as string | null,
    appliedLimit: null as number | null,
    managedByMainWindow: false,
  });
  const queue = useRef(Promise.resolve());
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!ready) {
      setState({
        pending: false,
        error: null,
        appliedLimit: null,
        managedByMainWindow: false,
      });
      return;
    }
    setState((previous) => ({ ...previous, pending: true, error: null }));
    queue.current = queue.current.then(async () => {
      if (cancelled) return;
      try {
        const capacity = validateProxyRequestLogLimit(limit);
        const invoke = await getInvoke();
        if (cancelled) return;
        if (!invoke) throw new Error("Native proxy logging is unavailable.");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        const windowLabel = getCurrentWindow().label;
        if (typeof windowLabel !== "string" || !windowLabel)
          throw new Error("Native window identity is unavailable.");
        if (windowLabel !== "main") {
          setState({
            pending: false,
            error: null,
            appliedLimit: null,
            managedByMainWindow: true,
          });
          return;
        }
        const response = await invoke<{ capacity: number; retained: number }>(
          "set_proxy_request_log_capacity",
          { capacity },
        );
        if (
          !response ||
          response.capacity !== capacity ||
          !Number.isInteger(response.retained) ||
          response.retained < 0 ||
          response.retained > capacity
        )
          throw new Error("Invalid proxy log capacity response.");
        if (!cancelled)
          setState({
            pending: false,
            error: null,
            appliedLimit: capacity,
            managedByMainWindow: false,
          });
      } catch {
        if (!cancelled)
          setState((previous) => ({
            ...previous,
            pending: false,
            error:
              "The saved request log limit could not be applied to the running proxy. Retry in the main application window to apply it.",
          }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [limit, ready, attempt]);

  return { ...state, retry };
}
