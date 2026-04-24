import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@/types/connection/connection';
import type {
  CheckProgressEvent,
  CheckCompleteEvent,
  CheckRow,
  CheckRequest,
} from '@/types/probes';

export interface UseBulkConnectionCheck {
  isOpen: boolean;
  open: (connections: Connection[]) => Promise<void>;
  close: () => void;
  cancel: () => Promise<void>;
  rows: CheckRow[];
  runId: string | null;
  total: number;
  completed: number;
  cancelled: boolean;
  error: string | null;
}

/**
 * Drives a bulk reachability check against the backend `check_all_connections`
 * command, subscribing to `connection-check-progress` + `connection-check-complete`
 * Tauri events filtered by `run_id`. Cancellation calls `cancel_check_run`.
 *
 * Listeners are set up BEFORE invoking the command to avoid a race where the
 * first per-connection event fires before the listener is attached.
 */
export function useBulkConnectionCheck(): UseBulkConnectionCheck {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlistenersRef = useRef<Array<() => void>>([]);
  const runIdRef = useRef<string | null>(null);
  const pendingCancelRef = useRef(false);

  const teardown = useCallback(() => {
    for (const un of unlistenersRef.current) {
      try {
        un();
      } catch {
        // ignore — best-effort cleanup
      }
    }
    unlistenersRef.current = [];
  }, []);

  const close = useCallback(() => {
    teardown();
    setIsOpen(false);
    setRows([]);
    setRunId(null);
    runIdRef.current = null;
    pendingCancelRef.current = false;
    setTotal(0);
    setCompleted(0);
    setCancelled(false);
    setError(null);
  }, [teardown]);

  const requestCancel = useCallback(async (id: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_check_run', { runId: id });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('cancel_check_run failed', e);
    }
  }, []);

  const acceptRunId = useCallback(
    (id: string) => {
      if (runIdRef.current && runIdRef.current !== id) return false;
      if (runIdRef.current !== id) {
        runIdRef.current = id;
        setRunId(id);
      }
      if (pendingCancelRef.current) {
        pendingCancelRef.current = false;
        setCancelled(true);
        void requestCancel(id);
      }
      return true;
    },
    [requestCancel],
  );

  const cancel = useCallback(async () => {
    setCancelled(true);
    const id = runIdRef.current;
    if (!id) {
      pendingCancelRef.current = true;
      return;
    }
    pendingCancelRef.current = false;
    await requestCancel(id);
  }, [requestCancel]);

  const open = useCallback(
    async (connections: Connection[]) => {
      teardown();

      const initial: CheckRow[] = connections.map((c) => ({
        connectionId: c.id,
        name: c.name || c.hostname || c.id,
        host: c.hostname ?? '',
        port: typeof c.port === 'number' ? c.port : 0,
        protocol: c.protocol ?? 'tcp',
        state: 'pending',
      }));

      setRows(initial);
      setTotal(initial.length);
      setCompleted(0);
      setCancelled(false);
      setError(null);
      setIsOpen(true);
      pendingCancelRef.current = false;

      if (initial.length === 0) return;

      try {
        const core = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        const requests: CheckRequest[] = initial.map((r) => ({
          connection_id: r.connectionId,
          host: r.host,
          port: r.port,
          protocol: r.protocol,
        }));

        // Set up listeners BEFORE invoking to avoid a progress-before-listen race.
        const unProgress = await listen<CheckProgressEvent>(
          'connection-check-progress',
          (evt) => {
            const p = evt.payload;
            if (!acceptRunId(p.run_id)) return;
            setRows((prev) =>
              prev.map((r) =>
                r.connectionId === p.connection_id
                  ? { ...r, state: 'done', result: p.result, elapsedMs: p.elapsed_ms }
                  : r,
              ),
            );
            setCompleted((n) => n + 1);
          },
        );
        unlistenersRef.current.push(unProgress);

        const unComplete = await listen<CheckCompleteEvent>(
          'connection-check-complete',
          (evt) => {
            const p = evt.payload;
            if (!acceptRunId(p.run_id)) return;
            setCompleted(p.completed);
            setCancelled((current) => current || p.cancelled);
          },
        );
        unlistenersRef.current.push(unComplete);

        const id = await core.invoke<string>('check_all_connections', {
          connectionIds: requests,
          concurrency: 8,
          timeoutMs: 5000,
        });
        acceptRunId(id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('check_all_connections failed', e);
        setError(String(e));
        teardown();
      }
    },
    [acceptRunId, teardown],
  );

  useEffect(() => () => teardown(), [teardown]);

  return {
    isOpen,
    open,
    close,
    cancel,
    rows,
    runId,
    total,
    completed,
    cancelled,
    error,
  };
}

export default useBulkConnectionCheck;
