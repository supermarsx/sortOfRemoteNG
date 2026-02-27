import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
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
} from "lucide-react";
import { Modal } from "./ui/Modal";

interface RdpSessionManagerProps {
  isOpen: boolean;
  onClose: () => void;
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
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const RdpSessionManager: React.FC<RdpSessionManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const [sessions, setSessions] = useState<RdpSessionInfo[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RdpStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await invoke<RdpSessionInfo[]>("list_rdp_sessions");
      setSessions(list);

      // Fetch stats for each session
      const newStats: Record<string, RdpStats> = {};
      for (const s of list) {
        try {
          const st = await invoke<RdpStats>("get_rdp_stats", {
            sessionId: s.id,
          });
          newStats[s.id] = st;
        } catch {
          // Session may have ended between list and stats fetch
        }
      }
      setStatsMap(newStats);
      setError("");
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
      await invoke("disconnect_rdp", { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      setError(`Disconnect failed: ${String(e)}`);
    }
  }, []);

  const handleDetach = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("detach_rdp_session", { sessionId });
        // Refresh to show updated state
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
        await invoke("disconnect_rdp", { sessionId: s.id });
      } catch {
        // best-effort
      }
    }
    setSessions([]);
    setStatsMap({});
  }, [sessions]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/60 backdrop-blur-sm p-4"
      panelClassName="max-w-3xl max-h-[80vh] rounded-xl overflow-hidden"
      contentClassName="bg-[var(--color-background)]"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
              <Monitor size={16} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                RDP Sessions
              </h2>
              <p className="text-xs text-gray-500">
                {sessions.length} active session
                {sessions.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-1.5 text-xs text-[var(--color-textSecondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-indigo-600 w-3.5 h-3.5"
              />
              <span>Auto-refresh</span>
            </label>
            <button
              onClick={handleRefresh}
              className={`p-2 hover:bg-[var(--color-surface)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] ${isLoading ? "animate-spin" : ""}`}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surface)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
            <button onClick={() => setError("")} className="hover:text-red-300">
              <XCircle size={14} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Server size={40} className="mb-3 opacity-40" />
              <p className="text-sm">No active RDP sessions</p>
              <p className="text-xs mt-1">
                Sessions will appear here when RDP connections are established
              </p>
            </div>
          ) : (
            <div className="sor-selection-list">
              {sessions.map((session) => {
                const stats = statsMap[session.id];
                return (
                  <div
                    key={session.id}
                    className="sor-selection-row p-4 cursor-default"
                  >
                    {/* Session header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div
                          className={`w-2 h-2 rounded-full ${session.connected ? "bg-green-400" : "bg-red-400"}`}
                        />
                        <span className="text-sm font-medium text-[var(--color-text)]">
                          {session.host}:{session.port}
                        </span>
                        {session.username && (
                          <span className="text-xs text-gray-500">
                            ({session.username})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleDetach(session.id)}
                          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-yellow-400 transition-colors"
                          title="Detach viewer (keep session running)"
                        >
                          <Unplug size={14} />
                        </button>
                        <button
                          onClick={() => handleDisconnect(session.id)}
                          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
                          title="Disconnect session"
                        >
                          <PowerOff size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Info grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                        <span className="text-gray-500 block">Resolution</span>
                        <span className="text-[var(--color-textSecondary)] font-mono">
                          {session.desktop_width}&times;{session.desktop_height}
                        </span>
                      </div>
                      <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                        <span className="text-gray-500 block">Session ID</span>
                        <span
                          className="text-[var(--color-textSecondary)] font-mono truncate block"
                          title={session.id}
                        >
                          {session.id.slice(0, 8)}
                        </span>
                      </div>
                      {stats && (
                        <>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 flex items-center gap-1">
                              <Clock size={10} /> Uptime
                            </span>
                            <span className="text-[var(--color-textSecondary)] font-mono">
                              {formatUptime(stats.uptime_secs)}
                            </span>
                          </div>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 flex items-center gap-1">
                              <Activity size={10} /> FPS
                            </span>
                            <span className="text-[var(--color-textSecondary)] font-mono">
                              {stats.fps.toFixed(1)}
                            </span>
                          </div>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 block">
                              Received
                            </span>
                            <span className="text-[var(--color-textSecondary)] font-mono">
                              {formatBytes(stats.bytes_received)}
                            </span>
                          </div>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 block">Sent</span>
                            <span className="text-[var(--color-textSecondary)] font-mono">
                              {formatBytes(stats.bytes_sent)}
                            </span>
                          </div>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 block">Frames</span>
                            <span className="text-[var(--color-textSecondary)] font-mono">
                              {stats.frame_count.toLocaleString()}
                            </span>
                          </div>
                          <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5">
                            <span className="text-gray-500 block">Phase</span>
                            <span
                              className={`font-mono ${stats.phase === "active" ? "text-green-400" : "text-yellow-400"}`}
                            >
                              {stats.phase}
                            </span>
                          </div>
                        </>
                      )}
                      {session.connection_id && (
                        <div className="bg-[var(--color-background)]/50 rounded px-2.5 py-1.5 col-span-2">
                          <span className="text-gray-500 block">
                            Connection ID
                          </span>
                          <span
                            className="text-[var(--color-textSecondary)] font-mono truncate block"
                            title={session.connection_id}
                          >
                            {session.connection_id}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Error indicator */}
                    {stats?.last_error && (
                      <div className="mt-2 px-2.5 py-1.5 bg-red-900/20 border border-red-800/50 rounded text-xs text-red-400 flex items-center gap-1.5">
                        <AlertCircle size={12} />
                        <span className="truncate">{stats.last_error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {sessions.length > 0 && (
          <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <ArrowDownToLine size={12} className="inline mr-1" />
              Total traffic:{" "}
              {formatBytes(
                Object.values(statsMap).reduce(
                  (sum, s) => sum + s.bytes_received + s.bytes_sent,
                  0,
                ),
              )}
            </div>
            <button
              onClick={handleDisconnectAll}
              className="sor-option-chip text-xs bg-red-900/30 hover:bg-red-900/50 border-red-800/50 text-red-400"
            >
              <Power size={12} />
              Disconnect All
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
