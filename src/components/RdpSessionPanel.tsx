import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  RefreshCw,
  Activity,
  AlertCircle,
  Monitor,
  Power,
  PowerOff,
  Clock,
  XCircle,
  Server,
  ArrowDownToLine,
  Unplug,
  PlugZap,
  LogOut,
  RotateCcw,
  ExternalLink,
  ScrollText,
  PanelRightClose,
} from 'lucide-react';
import { Connection } from '../types/connection';
import { ConfirmDialog } from './ConfirmDialog';
import { useSessionThumbnails } from '../hooks/useSessionThumbnails';
import { RdpLogViewer } from './RdpLogViewer';

interface RdpSessionPanelProps {
  isVisible: boolean;
  connections: Connection[];
  /** Backend session IDs that currently have an active frontend viewer tab/window. */
  activeBackendSessionIds?: string[];
  onClose: () => void;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: 'realtime' | 'on-blur' | 'on-detach' | 'manual';
  thumbnailInterval?: number;
}

interface RdpSessionInfo {
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

interface RdpStats {
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

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type PanelTab = 'sessions' | 'logs';

export const RdpSessionPanel: React.FC<RdpSessionPanelProps> = ({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  onClose,
  onReattachSession,
  onDetachToWindow,
  thumbnailsEnabled = true,
  thumbnailPolicy = 'realtime',
  thumbnailInterval = 5,
}) => {
  const [sessions, setSessions] = useState<RdpSessionInfo[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RdpStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  const [activeTab, setActiveTab] = useState<PanelTab>('sessions');
  const [rebootConfirmSessionId, setRebootConfirmSessionId] = useState<string | null>(null);
  const [logSessionFilter, setLogSessionFilter] = useState<string | null>(null);

  const thumbnails = useSessionThumbnails(
    sessions,
    thumbnailInterval * 1000,
    isVisible && activeTab === 'sessions' && thumbnailsEnabled && thumbnailPolicy === 'realtime',
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
          const st = await invoke<RdpStats>('get_rdp_stats', { sessionId: s.id });
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
    if (!isVisible) return;
    fetchData();
    const timer = setInterval(() => {
      if (autoRefreshRef.current) fetchData();
    }, 3000);
    return () => clearInterval(timer);
  }, [isVisible, fetchData]);

  const handleDisconnect = useCallback(async (sessionId: string) => {
    try {
      await invoke('disconnect_rdp', { sessionId });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (e) {
      setError(`Disconnect failed: ${String(e)}`);
    }
  }, []);

  const handleDetach = useCallback(async (sessionId: string) => {
    try {
      await invoke('detach_rdp_session', { sessionId });
      fetchData();
    } catch (e) {
      setError(`Detach failed: ${String(e)}`);
    }
  }, [fetchData]);

  const handleSignOut = useCallback(async (sessionId: string) => {
    try {
      await invoke('rdp_sign_out', { sessionId });
      fetchData();
    } catch (e) {
      setError(`Sign out failed: ${String(e)}`);
    }
  }, [fetchData]);

  const handleForceReboot = useCallback(async (sessionId: string) => {
    try {
      await invoke('rdp_force_reboot', { sessionId });
      fetchData();
    } catch (e) {
      setError(`Force reboot failed: ${String(e)}`);
    }
  }, [fetchData]);

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

  const getSessionDisplayName = useCallback((session: RdpSessionInfo): { name: string; subtitle: string } => {
    // Try matching by connection_id first, then fall back to host+port matching
    let conn = session.connection_id
      ? connections.find(c => c.id === session.connection_id)
      : undefined;
    if (!conn) {
      conn = connections.find(c =>
        c.hostname === session.host &&
        (c.port || 3389) === session.port &&
        c.protocol === 'rdp'
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
  }, [connections]);

  if (!isVisible) return null;

  return (
    <>
      <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 flex items-center justify-center">
              <Monitor size={14} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white leading-tight">RDP Sessions</h2>
              <p className="text-[10px] text-gray-500">
                {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <label className="flex items-center space-x-1 text-[10px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-indigo-600 w-3 h-3"
              />
              <span>Auto</span>
            </label>
            <button
              onClick={handleRefresh}
              className={`p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-white ${isLoading ? 'animate-spin' : ''}`}
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-white"
              title="Close panel"
            >
              <PanelRightClose size={14} />
            </button>
          </div>
        </div>

        {/* Internal tab bar */}
        <div className="flex border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => { setActiveTab('sessions'); setLogSessionFilter(null); }}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'sessions'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'logs'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Logs
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-3 mt-2 px-2.5 py-1.5 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-xs flex items-center justify-between flex-shrink-0">
            <div className="flex items-center space-x-1.5">
              <AlertCircle size={12} />
              <span className="truncate">{error}</span>
            </div>
            <button onClick={() => setError('')} className="hover:text-red-300 flex-shrink-0">
              <XCircle size={12} />
            </button>
          </div>
        )}

        {/* Tab content */}
        {activeTab === 'sessions' ? (
          <>
            {/* Session list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <Server size={32} className="mb-2 opacity-40" />
                  <p className="text-xs">No active RDP sessions</p>
                  <p className="text-[10px] mt-1">Sessions appear when RDP connections are established</p>
                </div>
              ) : (
                sessions.map(session => {
                  const stats = statsMap[session.id];
                  const display = getSessionDisplayName(session);
                  const hasFrontendViewer = activeBackendSessionIds.includes(session.id)
                    || (session.connection_id != null && activeBackendSessionIds.includes(session.connection_id));
                  const isDetached = !hasFrontendViewer;
                  return (
                    <div
                      key={session.id}
                      className="bg-gray-800/60 border border-gray-700 rounded-lg p-2.5 overflow-hidden"
                    >
                      <div className="flex gap-2.5">
                        {/* Thumbnail column - small on the left */}
                        {thumbnailsEnabled && (
                          <div className="flex-shrink-0 w-[120px] h-[68px] rounded overflow-hidden bg-gray-900">
                            {thumbnails[session.id] ? (
                              <img
                                src={thumbnails[session.id]}
                                alt="Session preview"
                                className="w-full h-full object-cover"
                                draggable={false}
                              />
                            ) : session.connected ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Monitor size={16} className="text-gray-700" />
                              </div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Monitor size={16} className="text-gray-600 opacity-50" />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Right column - all session info */}
                        <div className="flex-1 min-w-0">
                          {/* Title row */}
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              session.connected
                                ? isDetached ? 'bg-yellow-400' : 'bg-green-400'
                                : 'bg-red-400'
                            }`} />
                            <div className="min-w-0">
                              <span className="text-xs font-medium text-white block truncate">
                                {display.name}
                              </span>
                              {display.subtitle && (
                                <span className="text-[10px] text-gray-500 block truncate">
                                  {display.subtitle}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center space-x-0.5 mt-1">
                            {isDetached && onReattachSession && (
                              <button
                                onClick={() => onReattachSession(session.id, session.connection_id)}
                                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-green-400 transition-colors"
                                title="Reattach viewer"
                              >
                                <PlugZap size={12} />
                              </button>
                            )}
                            {onDetachToWindow && (
                              <button
                                onClick={() => onDetachToWindow(session.id)}
                                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                                title="Open in separate window"
                              >
                                <ExternalLink size={12} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDetach(session.id)}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-yellow-400 transition-colors"
                              title="Detach viewer (keep session running)"
                            >
                              <Unplug size={12} />
                            </button>
                            <button
                              onClick={() => handleSignOut(session.id)}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                              title="Sign out remote session"
                            >
                              <LogOut size={12} />
                            </button>
                            <button
                              onClick={() => setRebootConfirmSessionId(session.id)}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400 transition-colors"
                              title="Force reboot remote machine"
                            >
                              <RotateCcw size={12} />
                            </button>
                            <button
                              onClick={() => {
                                setLogSessionFilter(session.id);
                                setActiveTab('logs');
                              }}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-indigo-400 transition-colors"
                              title="View logs for this session"
                            >
                              <ScrollText size={12} />
                            </button>
                            <button
                              onClick={() => handleDisconnect(session.id)}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400 transition-colors"
                              title="Disconnect session"
                            >
                              <PowerOff size={12} />
                            </button>
                          </div>

                          {/* Info grid */}
                          <div className="grid grid-cols-2 gap-1 mt-1.5 text-[10px]">
                            <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                              <span className="text-gray-500">Res </span>
                              <span className="text-gray-300 font-mono">
                                {session.desktop_width}&times;{session.desktop_height}
                              </span>
                            </div>
                            <div className="bg-gray-900/50 rounded px-1.5 py-0.5" title={session.id}>
                              <span className="text-gray-500">ID </span>
                              <span className="text-gray-300 font-mono truncate">
                                {display.name !== `${session.host}:${session.port}` ? display.name : session.id.slice(0, 8)}
                              </span>
                            </div>
                            {stats && (
                              <>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className="text-gray-500">Up </span>
                                  <span className="text-gray-300 font-mono">
                                    {formatUptime(stats.uptime_secs)}
                                  </span>
                                </div>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className="text-gray-500">FPS </span>
                                  <span className="text-gray-300 font-mono">
                                    {stats.fps.toFixed(1)}
                                  </span>
                                </div>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className="text-gray-500">Rx </span>
                                  <span className="text-gray-300 font-mono">
                                    {formatBytes(stats.bytes_received)}
                                  </span>
                                </div>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className="text-gray-500">Tx </span>
                                  <span className="text-gray-300 font-mono">
                                    {formatBytes(stats.bytes_sent)}
                                  </span>
                                </div>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className="text-gray-500">Frames </span>
                                  <span className="text-gray-300 font-mono">
                                    {stats.frame_count.toLocaleString()}
                                  </span>
                                </div>
                                <div className="bg-gray-900/50 rounded px-1.5 py-0.5">
                                  <span className={`font-mono ${stats.phase === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {stats.phase}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Error indicator */}
                          {stats?.last_error && (
                            <div className="mt-1 px-1.5 py-0.5 bg-red-900/20 border border-red-800/50 rounded text-[10px] text-red-400 flex items-center gap-1">
                              <AlertCircle size={10} />
                              <span className="truncate">{stats.last_error}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {sessions.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-700 flex items-center justify-between flex-shrink-0">
                <div className="text-[10px] text-gray-500">
                  <ArrowDownToLine size={10} className="inline mr-1" />
                  {formatBytes(
                    Object.values(statsMap).reduce((sum, s) => sum + s.bytes_received + s.bytes_sent, 0)
                  )}
                </div>
                <button
                  onClick={handleDisconnectAll}
                  className="flex items-center gap-1 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 rounded text-red-400 text-[10px] transition-colors"
                >
                  <Power size={10} />
                  Disconnect All
                </button>
              </div>
            )}
          </>
        ) : (
          <RdpLogViewer isVisible={activeTab === 'logs'} sessionFilter={logSessionFilter} />
        )}
      </div>

      {/* Force Reboot Confirmation */}
      <ConfirmDialog
        isOpen={rebootConfirmSessionId !== null}
        title="Force Reboot Remote Machine"
        message="This will immediately restart the remote machine. All unsaved work on the remote machine will be lost. Are you sure you want to proceed?"
        confirmText="Force Reboot"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          if (rebootConfirmSessionId) {
            handleForceReboot(rebootConfirmSessionId);
          }
          setRebootConfirmSessionId(null);
        }}
        onCancel={() => setRebootConfirmSessionId(null)}
      />
    </>
  );
};

export default RdpSessionPanel;
