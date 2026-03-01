import React from "react";
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
import {
  useRdpSessionManager,
  formatUptime,
  formatBytes,
  RdpSessionInfo,
  RdpStats,
} from "../hooks/useRdpSessionManager";

type Mgr = ReturnType<typeof useRdpSessionManager>;

/* ── sub-components ── */

const SessionManagerHeader: React.FC<{
  mgr: Mgr;
  sessionCount: number;
  onClose: () => void;
}> = ({ mgr, sessionCount, onClose }) => (
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
          {sessionCount} active session
          {sessionCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
    <div className="flex items-center space-x-2">
      <label className="flex items-center space-x-1.5 text-xs text-[var(--color-textSecondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={mgr.autoRefresh}
          onChange={(e) => mgr.setAutoRefresh(e.target.checked)}
          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-indigo-600 w-3.5 h-3.5"
        />
        <span>Auto-refresh</span>
      </label>
      <button
        onClick={mgr.handleRefresh}
        className={`p-2 hover:bg-[var(--color-surface)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] ${mgr.isLoading ? "animate-spin" : ""}`}
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
);

const ErrorBanner: React.FC<{ error: string; onClear: () => void }> = ({
  error,
  onClear,
}) => (
  <div className="mx-5 mt-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm flex items-center justify-between">
    <div className="flex items-center space-x-2">
      <AlertCircle size={14} />
      <span>{error}</span>
    </div>
    <button onClick={onClear} className="hover:text-red-300">
      <XCircle size={14} />
    </button>
  </div>
);

const SessionInfoGrid: React.FC<{
  session: RdpSessionInfo;
  stats?: RdpStats;
}> = ({ session, stats }) => (
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
          <span className="text-gray-500 block">Received</span>
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
        <span className="text-gray-500 block">Connection ID</span>
        <span
          className="text-[var(--color-textSecondary)] font-mono truncate block"
          title={session.connection_id}
        >
          {session.connection_id}
        </span>
      </div>
    )}
  </div>
);

const SessionRow: React.FC<{
  session: RdpSessionInfo;
  stats?: RdpStats;
  onDetach: (id: string) => void;
  onDisconnect: (id: string) => void;
}> = ({ session, stats, onDetach, onDisconnect }) => (
  <div className="sor-selection-row p-4 cursor-default">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-2">
        <div
          className={`w-2 h-2 rounded-full ${session.connected ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-sm font-medium text-[var(--color-text)]">
          {session.host}:{session.port}
        </span>
        {session.username && (
          <span className="text-xs text-gray-500">({session.username})</span>
        )}
      </div>
      <div className="flex items-center space-x-1">
        <button
          onClick={() => onDetach(session.id)}
          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-yellow-400 transition-colors"
          title="Detach viewer (keep session running)"
        >
          <Unplug size={14} />
        </button>
        <button
          onClick={() => onDisconnect(session.id)}
          className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
          title="Disconnect session"
        >
          <PowerOff size={14} />
        </button>
      </div>
    </div>
    <SessionInfoGrid session={session} stats={stats} />
    {stats?.last_error && (
      <div className="mt-2 px-2.5 py-1.5 bg-red-900/20 border border-red-800/50 rounded text-xs text-red-400 flex items-center gap-1.5">
        <AlertCircle size={12} />
        <span className="truncate">{stats.last_error}</span>
      </div>
    )}
  </div>
);

const SessionList: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto p-5 space-y-3">
    {mgr.sessions.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <Server size={40} className="mb-3 opacity-40" />
        <p className="text-sm">No active RDP sessions</p>
        <p className="text-xs mt-1">
          Sessions will appear here when RDP connections are established
        </p>
      </div>
    ) : (
      <div className="sor-selection-list">
        {mgr.sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            stats={mgr.statsMap[session.id]}
            onDetach={mgr.handleDetach}
            onDisconnect={mgr.handleDisconnect}
          />
        ))}
      </div>
    )}
  </div>
);

const SessionFooter: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.sessions.length > 0 ? (
    <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
      <div className="text-xs text-gray-500">
        <ArrowDownToLine size={12} className="inline mr-1" />
        Total traffic: {formatBytes(mgr.totalTraffic)}
      </div>
      <button
        onClick={mgr.handleDisconnectAll}
        className="sor-option-chip text-xs bg-red-900/30 hover:bg-red-900/50 border-red-800/50 text-red-400"
      >
        <Power size={12} />
        Disconnect All
      </button>
    </div>
  ) : null;

/* ── main component ── */

interface RdpSessionManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RdpSessionManager: React.FC<RdpSessionManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useRdpSessionManager(isOpen);

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
        <SessionManagerHeader
          mgr={mgr}
          sessionCount={mgr.sessions.length}
          onClose={onClose}
        />
        {mgr.error && (
          <ErrorBanner error={mgr.error} onClear={mgr.clearError} />
        )}
        <SessionList mgr={mgr} />
        <SessionFooter mgr={mgr} />
      </div>
    </Modal>
  );
};
