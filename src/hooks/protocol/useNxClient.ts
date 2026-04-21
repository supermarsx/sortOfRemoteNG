import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  NxConfig,
  NxSessionInfo,
  NxSessionStats,
} from '../../types/protocols/nx';

/** Minimal NX/NoMachine client hook backed by sorng-nx. */
export function useNxClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (cfg: NxConfig) => {
    setError(null);
    try {
      const id = await invoke<string>('connect_nx', {
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        privateKey: cfg.privateKey,
        label: cfg.label,
        sessionType: cfg.sessionType,
        resolutionWidth: cfg.resolutionWidth,
        resolutionHeight: cfg.resolutionHeight,
        fullscreen: cfg.fullscreen,
        clipboard: cfg.clipboard,
        audioEnabled: cfg.audioEnabled,
        resumeSessionId: cfg.resumeSessionId,
      });
      setSessionId(id);
      return id;
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
      throw e;
    }
  }, []);

  const suspend = useCallback(async (id: string) => invoke('suspend_nx', { sessionId: id }), []);
  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    await invoke('disconnect_nx', { sessionId }).catch(() => {});
    setSessionId(null);
  }, [sessionId]);

  const listSessions = useCallback(() => invoke<NxSessionInfo[]>('list_nx_sessions'), []);
  const getStats = useCallback(
    (id: string) => invoke<NxSessionStats>('get_nx_session_stats', { sessionId: id }),
    [],
  );

  return { sessionId, error, connect, suspend, disconnect, listSessions, getStats };
}
