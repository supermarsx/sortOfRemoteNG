import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  ArdInputAction,
  ArdLogEntry,
  ArdSessionInfo,
  ArdSessionStats,
} from '../../types/protocols/ard';

/** Minimal Apple Remote Desktop (ARD) client hook backed by sorng-ard. */
export function useArdClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (args: {
      host: string;
      port?: number;
      username: string;
      password: string;
      connectionId?: string;
      autoReconnect?: boolean;
      curtainOnConnect?: boolean;
    }) => {
      setError(null);
      try {
        const id = await invoke<string>('connect_ard', args);
        setSessionId(id);
        return id;
      } catch (e) {
        setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
        throw e;
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    await invoke('disconnect_ard', { sessionId }).catch(() => {});
    setSessionId(null);
  }, [sessionId]);

  const sendInput = useCallback(
    (id: string, action: ArdInputAction) =>
      invoke('send_ard_input', { sessionId: id, action }),
    [],
  );

  const listSessions = useCallback(() => invoke<ArdSessionInfo[]>('list_ard_sessions'), []);
  const getStats = useCallback(
    (id: string) => invoke<ArdSessionStats>('get_ard_stats', { sessionId: id }),
    [],
  );
  const getLogs = useCallback(
    (id: string) => invoke<ArdLogEntry[]>('get_ard_logs', { sessionId: id }),
    [],
  );

  return {
    sessionId,
    error,
    connect,
    disconnect,
    sendInput,
    listSessions,
    getStats,
    getLogs,
  };
}
