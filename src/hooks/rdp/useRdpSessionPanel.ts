import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Connection } from '../../types/connection';
import { useSessionThumbnails } from './useSessionThumbnails';

export interface RdpSessionInfo {
  id: string;
  connection_id?: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  desktop_width: number;
  desktop_height: number;
  server_cert_fingerprint?: string;
  viewer_attached?: boolean;
}

export interface RdpStats {
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

export type PanelTab = 'sessions' | 'logs';

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

interface UseRdpSessionPanelParams {
  isVisible: boolean;
  connections: Connection[];
  activeBackendSessionIds?: string[];
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: 'realtime' | 'on-blur' | 'on-detach' | 'manual';
  thumbnailInterval?: number;
}

export function useRdpSessionPanel({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  thumbnailsEnabled = true,
  thumbnailPolicy = 'realtime',
  thumbnailInterval = 5,
}: UseRdpSessionPanelParams) {
  const [sessions, setSessions] = useState<RdpSessionInfo[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RdpStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  const [activeTab, setActiveTab] = useState<PanelTab>('sessions');
  const [rebootConfirmSessionId, setRebootConfirmSessionId] = useState<
    string | null
  >(null);
  const [logSessionFilter, setLogSessionFilter] = useState<string | null>(null);

  const thumbnails = useSessionThumbnails(
    sessions,
    thumbnailInterval * 1000,
    isVisible &&
      activeTab === 'sessions' &&
      thumbnailsEnabled &&
      thumbnailPolicy === 'realtime',
  );

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await invoke<RdpSessionInfo[]>('list_rdp_sessions');
      setSessions(list);
      const newStats: Record<string, RdpStats> = {};
      for (const s of list) {
        try {
          const st = await invoke<RdpStats>('get_rdp_stats', {
            sessionId: s.id,
          });
          newStats[s.id] = st;
        } catch {
          // Session may have ended
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
    if (!isVisible) return;
    fetchData();
    const timer = setInterval(() => {
      if (autoRefreshRef.current) fetchData();
    }, 3000);
    return () => clearInterval(timer);
  }, [isVisible, fetchData]);

  const handleDisconnect = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('disconnect_rdp', { sessionId });
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      } catch (e) {
        setError(`Disconnect failed: ${String(e)}`);
      }
    },
    [],
  );

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

  const handleSignOut = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('rdp_sign_out', { sessionId });
        fetchData();
      } catch (e) {
        setError(`Sign out failed: ${String(e)}`);
      }
    },
    [fetchData],
  );

  const handleForceReboot = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('rdp_force_reboot', { sessionId });
        fetchData();
      } catch (e) {
        setError(`Force reboot failed: ${String(e)}`);
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

  const getSessionDisplayName = useCallback(
    (
      session: RdpSessionInfo,
    ): { name: string; subtitle: string } => {
      let conn = session.connection_id
        ? connections.find((c) => c.id === session.connection_id)
        : undefined;
      if (!conn) {
        conn = connections.find(
          (c) =>
            c.hostname === session.host &&
            (c.port || 3389) === session.port &&
            c.protocol === 'rdp',
        );
      }
      if (conn) {
        return {
          name: conn.name,
          subtitle: `${session.host}:${session.port}${session.username ? ` (${session.username})` : ''}`,
        };
      }
      return {
        name: `${session.host}:${session.port}`,
        subtitle: session.username || '',
      };
    },
    [connections],
  );

  const isSessionDetached = useCallback(
    (session: RdpSessionInfo): boolean => {
      const hasFrontendViewer =
        activeBackendSessionIds.includes(session.id) ||
        (session.connection_id != null &&
          activeBackendSessionIds.includes(session.connection_id));
      return !hasFrontendViewer;
    },
    [activeBackendSessionIds],
  );

  const totalTraffic = Object.values(statsMap).reduce(
    (sum, s) => sum + s.bytes_received + s.bytes_sent,
    0,
  );

  return {
    sessions,
    statsMap,
    isLoading,
    error,
    setError,
    autoRefresh,
    setAutoRefresh,
    activeTab,
    setActiveTab,
    rebootConfirmSessionId,
    setRebootConfirmSessionId,
    logSessionFilter,
    setLogSessionFilter,
    thumbnails,
    handleRefresh,
    handleDisconnect,
    handleDetach,
    handleSignOut,
    handleForceReboot,
    handleDisconnectAll,
    getSessionDisplayName,
    isSessionDetached,
    totalTraffic,
  };
}
