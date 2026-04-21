import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface RDPSessionInfo {
  id: string;
  connection_id?: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  desktop_width: number;
  desktop_height: number;
  server_cert_fingerprint?: string;
}

interface RDPStats {
  session_id: string;
  uptime_secs: number;
  bytes_received: number;
  bytes_sent: number;
  pdus_received: number;
  pdus_sent: number;
  frame_count: number;
  fps: number;
  input_events: number;
  errors_recovered: number;
  reactivations: number;
  phase: string;
  last_error?: string;
}

export type { RDPSessionInfo, RDPStats };

export function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function useRDPSessionManager(isOpen: boolean) {
  const [sessions, setSessions] = useState<RDPSessionInfo[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RDPStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await invoke<RDPSessionInfo[]>('list_rdp_sessions');
      setSessions(list);

      const newStats: Record<string, RDPStats> = {};
      for (const s of list) {
        try {
          const st = await invoke<RDPStats>('get_rdp_stats', {
            sessionId: s.id,
          });
          newStats[s.id] = st;
        } catch {
          // Session may have ended between list and stats fetch
        }
      }
      setStatsMap(newStats);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isOpen) return;
    fetchData();
    const timer = setInterval(() => {
      if (autoRefreshRef.current) fetchData();
    }, 3000);
    return () => clearInterval(timer);
  }, [isOpen, fetchData]);

  const handleDisconnect = useCallback(async (sessionId: string) => {
    try {
      await invoke('disconnect_rdp', { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      setError(`Disconnect failed: ${String(e)}`);
    }
  }, []);

  const handleDetach = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('detach_rdp_session', { sessionId });
        fetchData();
      } catch (e) {
        setError(`Detach failed: ${String(e)}`);
      }
    },
    [fetchData],
  );

  const handleDisconnectAll = useCallback(async () => {
    for (const s of sessions) {
      try {
        await invoke('disconnect_rdp', { sessionId: s.id });
      } catch {
        // best-effort
      }
    }
    setSessions([]);
    setStatsMap({});
  }, [sessions]);

  const clearError = useCallback(() => setError(''), []);

  const totalTraffic = Object.values(statsMap).reduce(
    (sum, s) => sum + s.bytes_received + s.bytes_sent,
    0,
  );

  return {
    sessions,
    statsMap,
    isLoading,
    error,
    autoRefresh,
    setAutoRefresh,
    handleRefresh,
    handleDisconnect,
    handleDetach,
    handleDisconnectAll,
    clearError,
    totalTraffic,
  };
}
