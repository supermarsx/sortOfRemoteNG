import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  XdmcpConfig,
  XdmcpDiscoveredHost,
  XdmcpSessionInfo,
  XdmcpSessionStats,
} from '../../types/protocols/xdmcp';

/** Minimal XDMCP client hook backed by sorng-xdmcp. */
export function useXdmcpClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (id: string, config: XdmcpConfig) => {
    setError(null);
    try {
      await invoke('connect_xdmcp', { sessionId: id, config });
      setSessionId(id);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
      throw e;
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    await invoke('disconnect_xdmcp', { sessionId }).catch(() => {});
    setSessionId(null);
  }, [sessionId]);

  const discover = useCallback(
    (host: string, port?: number, timeoutMs?: number) =>
      invoke<XdmcpDiscoveredHost[]>('discover_xdmcp', { host, port, timeoutMs }),
    [],
  );

  const listSessions = useCallback(() => invoke<XdmcpSessionInfo[]>('list_xdmcp_sessions'), []);
  const getStats = useCallback(
    (id: string) => invoke<XdmcpSessionStats>('get_xdmcp_session_stats', { sessionId: id }),
    [],
  );

  return { sessionId, error, connect, disconnect, discover, listSessions, getStats };
}
