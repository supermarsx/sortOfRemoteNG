import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  SpiceConfig,
  SpiceSessionInfo,
  SpiceSessionStats,
} from '../../types/protocols/spice';

/**
 * Minimal SPICE client hook backed by the sorng-spice Rust crate.
 * Exposes connect/disconnect + a few session-query helpers. Extend as UI needs grow.
 */
export function useSpiceClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async (cfg: SpiceConfig): Promise<string> => {
    setIsConnecting(true);
    setError(null);
    try {
      const id = await invoke<string>('connect_spice', {
        host: cfg.host,
        port: cfg.port,
        tlsPort: cfg.tlsPort,
        password: cfg.password,
        label: cfg.label,
        viewOnly: cfg.viewOnly,
        shareClipboard: cfg.shareClipboard,
        usbRedirection: cfg.usbRedirection,
        audioPlayback: cfg.audioPlayback,
        preferredWidth: cfg.preferredWidth,
        preferredHeight: cfg.preferredHeight,
      });
      setSessionId(id);
      return id;
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
      throw e;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    await invoke('disconnect_spice', { sessionId }).catch(() => {});
    setSessionId(null);
  }, [sessionId]);

  const listSessions = useCallback(
    () => invoke<SpiceSessionInfo[]>('list_spice_sessions'),
    [],
  );
  const getStats = useCallback(
    (id: string) => invoke<SpiceSessionStats>('get_spice_session_stats', { sessionId: id }),
    [],
  );

  return { sessionId, error, isConnecting, connect, disconnect, listSessions, getStats };
}
