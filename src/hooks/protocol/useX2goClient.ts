import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  X2goConfig,
  X2goSessionInfo,
  X2goSessionStats,
} from '../../types/protocols/x2go';

/** Minimal X2Go client hook backed by sorng-x2go. */
export function useX2goClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (id: string, config: X2goConfig) => {
    setError(null);
    try {
      await invoke('connect_x2go', { sessionId: id, config });
      setSessionId(id);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
      throw e;
    }
  }, []);

  const suspend = useCallback(async (id: string) => invoke('suspend_x2go', { sessionId: id }), []);
  const terminate = useCallback(
    async (id: string) => invoke('terminate_x2go', { sessionId: id }),
    [],
  );
  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    await invoke('disconnect_x2go', { sessionId }).catch(() => {});
    setSessionId(null);
  }, [sessionId]);

  const listSessions = useCallback(
    () => invoke<X2goSessionInfo[]>('list_x2go_sessions'),
    [],
  );
  const getStats = useCallback(
    (id: string) => invoke<X2goSessionStats>('get_x2go_session_stats', { sessionId: id }),
    [],
  );

  return { sessionId, error, connect, suspend, terminate, disconnect, listSessions, getStats };
}
