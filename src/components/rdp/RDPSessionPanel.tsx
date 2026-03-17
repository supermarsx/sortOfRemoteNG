import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  Activity,
  Monitor,
  Power,
  PowerOff,
  Clock,
  Server,
  ArrowDownToLine,
  Unplug,
  PlugZap,
  LogOut,
  RotateCcw,
  ExternalLink,
  ScrollText,
  X,
  AlertCircle,
  History,
  Trash2,
  Search,
  User,
} from 'lucide-react';
import { ErrorBanner, EmptyState } from '../ui/display';
import { Connection } from '../../types/connection/connection';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';
import { RDPLogViewer } from './RDPLogViewer';
import {
  useRDPSessionPanel,
  RDPSessionInfo,
  RDPSessionHistoryEntry,
  RDPStats,
  formatUptime,
  formatBytes,
} from '../../hooks/rdp/useRDPSessionPanel';
import { Checkbox } from '../ui/forms';

interface RDPSessionPanelProps {
  isVisible: boolean;
  connections: Connection[];
  activeBackendSessionIds?: string[];
  onClose: () => void;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onReconnect?: (connection: Connection) => void;
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: 'realtime' | 'on-blur' | 'on-detach' | 'manual';
  thumbnailInterval?: number;
}

type Mgr = ReturnType<typeof useRDPSessionPanel>;

/* ── Sub-components ──────────────────────────────────────────────── */

const PanelHeader: React.FC<{ mgr: Mgr; onClose: () => void }> = ({ mgr, onClose }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
    <div className="flex items-center space-x-2.5">
      <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center">
        <Monitor size={14} className="text-accent" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] leading-tight">RDP Sessions</h2>
        <p className="text-[10px] text-[var(--color-textMuted)]">{mgr.sessions.length} active session{mgr.sessions.length !== 1 ? 's' : ''}</p>
      </div>
    </div>
    <div className="flex items-center space-x-1">
      <label className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] cursor-pointer">
        <Checkbox checked={mgr.autoRefresh} onChange={(v: boolean) => mgr.setAutoRefresh(v)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-accent w-3 h-3" />
        <span>Auto</span>
      </label>
      <button onClick={mgr.handleRefresh} className={`p-1.5 hover:bg-[var(--color-surface)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] ${mgr.isLoading ? 'animate-spin' : ''}`} data-tooltip="Refresh">
        <RefreshCw size={12} />
      </button>
      <button onClick={onClose} className="p-1.5 hover:bg-error/20 rounded transition-colors text-[var(--color-textSecondary)] hover:text-error" data-tooltip="Close panel">
        <X size={14} />
      </button>
    </div>
  </div>
);

const PanelTabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex border-b border-[var(--color-border)] flex-shrink-0">
    <button onClick={() => { mgr.setActiveTab('sessions'); mgr.setLogSessionFilter(null); }} className={`px-4 py-2 text-xs font-medium transition-colors ${mgr.activeTab === 'sessions' ? 'text-[var(--color-text)] border-b-2 border-accent' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-textSecondary)]'}`}>
      Sessions
    </button>
    <button onClick={() => mgr.setActiveTab('logs')} className={`px-4 py-2 text-xs font-medium transition-colors ${mgr.activeTab === 'logs' ? 'text-[var(--color-text)] border-b-2 border-accent' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-textSecondary)]'}`}>
      Logs
    </button>
    <button onClick={() => mgr.setActiveTab('history')} className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1 ${mgr.activeTab === 'history' ? 'text-[var(--color-text)] border-b-2 border-accent' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-textSecondary)]'}`}>
      History
      {mgr.sessionHistory.length > 0 && (
        <span className="text-[9px] bg-[var(--color-border)] rounded-full px-1 min-w-[16px] text-center">{mgr.sessionHistory.length}</span>
      )}
    </button>
  </div>
);



function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSecs = Math.floor((now - then) / 1000);

  if (diffSecs < 60) return 'just now';
  if (diffSecs < 3600) {
    const m = Math.floor(diffSecs / 60);
    return `${m}m ago`;
  }
  if (diffSecs < 86400) {
    const h = Math.floor(diffSecs / 3600);
    return `${h}h ago`;
  }
  if (diffSecs < 604800) {
    const d = Math.floor(diffSecs / 86400);
    return `${d}d ago`;
  }
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const HistoryEntry: React.FC<{
  entry: RDPSessionHistoryEntry;
  canReconnect: boolean;
  onReconnect: () => void;
}> = ({ entry, canReconnect, onReconnect }) => (
  <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-2.5 overflow-hidden">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0 bg-[var(--color-textMuted)]" />
          <span className="text-xs font-medium text-[var(--color-text)] truncate">{entry.connectionName}</span>
        </div>
        <div className="text-[10px] text-[var(--color-textMuted)] mt-0.5 truncate">{entry.hostname}:{entry.port}</div>
      </div>
      {canReconnect && (
        <button
          onClick={onReconnect}
          className="flex-shrink-0 p-1.5 hover:bg-accent/20 rounded text-[var(--color-textSecondary)] hover:text-accent transition-colors"
          data-tooltip="Reconnect"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </div>
    <div className="grid grid-cols-2 gap-1 mt-1.5 text-[10px]">
      <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5">
        <span className="text-[var(--color-textMuted)]">When </span>
        <span className="text-[var(--color-textSecondary)]" title={new Date(entry.disconnectedAt).toLocaleString()}>{formatRelativeTime(entry.disconnectedAt)}</span>
      </div>
      <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5">
        <span className="text-[var(--color-textMuted)]">Dur </span>
        <span className="text-[var(--color-textSecondary)] font-mono">{formatUptime(entry.duration)}</span>
      </div>
      <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5">
        <span className="text-[var(--color-textMuted)]">Res </span>
        <span className="text-[var(--color-textSecondary)] font-mono">{entry.desktopWidth}&times;{entry.desktopHeight}</span>
      </div>
      <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5 flex items-center gap-0.5">
        <User size={8} className="text-[var(--color-textMuted)] flex-shrink-0" />
        <span className="text-[var(--color-textSecondary)] truncate">{entry.username || 'n/a'}</span>
      </div>
    </div>
    {!canReconnect && (
      <div className="mt-1 text-[9px] text-[var(--color-textMuted)] italic">Connection no longer available</div>
    )}
  </div>
);

const HistoryTab: React.FC<{
  mgr: Mgr;
  onReconnect?: (connection: Connection) => void;
}> = ({ mgr, onReconnect }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return mgr.sessionHistory;
    const q = searchQuery.toLowerCase();
    return mgr.sessionHistory.filter(
      (e) =>
        e.connectionName.toLowerCase().includes(q) ||
        e.hostname.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q),
    );
  }, [mgr.sessionHistory, searchQuery]);

  if (mgr.sessionHistory.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <EmptyState
          icon={History}
          message="No session history yet"
          hint="Past RDP sessions will appear here after disconnecting"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name, host, user..."
            className="w-full pl-6 pr-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={mgr.clearHistory}
          className="flex items-center gap-1 px-2 py-1 bg-error/20 hover:bg-error/30 border border-error/50 rounded text-error text-[10px] transition-colors flex-shrink-0"
          data-tooltip="Clear all history"
        >
          <Trash2 size={10} />
          Clear
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-textMuted)] text-xs">
            No matches for &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          filteredHistory.map((entry, idx) => {
            const conn = mgr.reconnectFromHistory(entry);
            return (
              <HistoryEntry
                key={`${entry.disconnectedAt}-${idx}`}
                entry={entry}
                canReconnect={!!conn && !!onReconnect}
                onReconnect={() => {
                  if (conn && onReconnect) onReconnect(conn);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
};

const SessionThumbnail: React.FC<{ mgr: Mgr; session: RDPSessionInfo; thumbnailsEnabled: boolean }> = ({ mgr, session, thumbnailsEnabled }) => {
  if (!thumbnailsEnabled) return null;
  return (
    <div className="flex-shrink-0 w-[120px] h-[68px] rounded overflow-hidden bg-[var(--color-background)]">
      {mgr.thumbnails[session.id] ? (
        <img src={mgr.thumbnails[session.id]} alt="Session preview" className="w-full h-full object-cover" draggable={false} />
      ) : session.connected ? (
        <div className="w-full h-full flex items-center justify-center"><Monitor size={16} className="text-[var(--color-textMuted)]" /></div>
      ) : (
        <div className="w-full h-full flex items-center justify-center"><Monitor size={16} className="text-[var(--color-textMuted)] opacity-50" /></div>
      )}
    </div>
  );
};

const SessionActions: React.FC<{
  mgr: Mgr;
  session: RDPSessionInfo;
  isDetached: boolean;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
}> = ({ mgr, session, isDetached, onReattachSession, onDetachToWindow }) => (
  <div className="flex items-center space-x-0.5 mt-1">
    {isDetached && onReattachSession && (
      <button onClick={() => onReattachSession(session.id, session.connection_id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-success transition-colors" data-tooltip="Reattach viewer"><PlugZap size={12} /></button>
    )}
    {onDetachToWindow && (
      <button onClick={() => onDetachToWindow(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-primary transition-colors" data-tooltip="Open in separate window"><ExternalLink size={12} /></button>
    )}
    <button onClick={() => mgr.handleDetach(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-warning transition-colors" data-tooltip="Detach viewer (keep session running)"><Unplug size={12} /></button>
    <button onClick={() => mgr.handleSignOut(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-primary transition-colors" data-tooltip="Sign out remote session"><LogOut size={12} /></button>
    <button onClick={() => mgr.setRebootConfirmSessionId(session.id)} className="sor-icon-btn-danger" data-tooltip="Force reboot remote machine"><RotateCcw size={12} /></button>
    <button onClick={() => { mgr.setLogSessionFilter(session.id); mgr.setActiveTab('logs'); }} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-accent transition-colors" data-tooltip="View logs for this session"><ScrollText size={12} /></button>
    <button onClick={() => mgr.handleDisconnect(session.id)} className="sor-icon-btn-danger" data-tooltip="Disconnect session"><PowerOff size={12} /></button>
  </div>
);

const SessionInfoGrid: React.FC<{ session: RDPSessionInfo; stats?: RDPStats; displayName: string }> = ({ session, stats, displayName }) => (
  <div className="grid grid-cols-2 gap-1 mt-1.5 text-[10px]">
    <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5">
      <span className="text-[var(--color-textMuted)]">Res </span>
      <span className="text-[var(--color-textSecondary)] font-mono">{session.desktop_width}&times;{session.desktop_height}</span>
    </div>
    <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5" title={session.id}>
      <span className="text-[var(--color-textMuted)]">ID </span>
      <span className="text-[var(--color-textSecondary)] font-mono truncate">{displayName !== `${session.host}:${session.port}` ? displayName : session.id.slice(0, 8)}</span>
    </div>
    {stats && (
      <>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-[var(--color-textMuted)]">Up </span><span className="text-[var(--color-textSecondary)] font-mono">{formatUptime(stats.uptime_secs)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-[var(--color-textMuted)]">FPS </span><span className="text-[var(--color-textSecondary)] font-mono">{stats.fps.toFixed(1)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-[var(--color-textMuted)]">Rx </span><span className="text-[var(--color-textSecondary)] font-mono">{formatBytes(stats.bytes_received)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-[var(--color-textMuted)]">Tx </span><span className="text-[var(--color-textSecondary)] font-mono">{formatBytes(stats.bytes_sent)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-[var(--color-textMuted)]">Frames </span><span className="text-[var(--color-textSecondary)] font-mono">{stats.frame_count.toLocaleString()}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className={`font-mono ${stats.phase === 'active' ? 'text-success' : 'text-warning'}`}>{stats.phase}</span></div>
      </>
    )}
  </div>
);

const SessionCard: React.FC<{
  mgr: Mgr;
  session: RDPSessionInfo;
  thumbnailsEnabled: boolean;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
}> = ({ mgr, session, thumbnailsEnabled, onReattachSession, onDetachToWindow }) => {
  const stats = mgr.statsMap[session.id];
  const display = mgr.getSessionDisplayName(session);
  const isDetached = mgr.isSessionDetached(session);

  return (
    <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-2.5 overflow-hidden">
      <div className="flex gap-2.5">
        <SessionThumbnail mgr={mgr} session={session} thumbnailsEnabled={thumbnailsEnabled} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-1.5 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${session.connected ? (isDetached ? 'bg-warning' : 'bg-success') : 'bg-error'}`} />
            <div className="min-w-0">
              <span className="text-xs font-medium text-[var(--color-text)] block truncate">{display.name}</span>
              {display.subtitle && <span className="text-[10px] text-[var(--color-textMuted)] block truncate">{display.subtitle}</span>}
            </div>
          </div>
          <SessionActions mgr={mgr} session={session} isDetached={isDetached} onReattachSession={onReattachSession} onDetachToWindow={onDetachToWindow} />
          <SessionInfoGrid session={session} stats={stats} displayName={display.name} />
          {stats?.last_error && (
            <div className="mt-1 px-1.5 py-0.5 bg-error/20 border border-error/50 rounded text-[10px] text-error flex items-center gap-1">
              <AlertCircle size={10} />
              <span className="truncate">{stats.last_error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PanelFooter: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.sessions.length === 0) return null;
  return (
    <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
      <div className="text-[10px] text-[var(--color-textMuted)]">
        <ArrowDownToLine size={10} className="inline mr-1" />
        {formatBytes(mgr.totalTraffic)}
      </div>
      <button onClick={mgr.handleDisconnectAll} className="flex items-center gap-1 px-2 py-1 bg-error/20 hover:bg-error/30 border border-error/50 rounded text-error text-[10px] transition-colors">
        <Power size={10} />
        Disconnect All
      </button>
    </div>
  );
};

/* ── Root component ──────────────────────────────────────────────── */

export const RDPSessionPanel: React.FC<RDPSessionPanelProps> = ({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  onClose,
  onReattachSession,
  onDetachToWindow,
  onReconnect,
  thumbnailsEnabled = true,
  thumbnailPolicy = 'realtime',
  thumbnailInterval = 5,
}) => {
  const mgr = useRDPSessionPanel({
    isVisible,
    connections,
    activeBackendSessionIds,
    thumbnailsEnabled,
    thumbnailPolicy,
    thumbnailInterval,
  });

  if (!isVisible) return null;

  return (
    <>
      <div className="flex flex-col h-full bg-[var(--color-background)] border-l border-[var(--color-border)] overflow-hidden">
        <PanelHeader mgr={mgr} onClose={onClose} />
        <PanelTabBar mgr={mgr} />
        <ErrorBanner error={mgr.error} onClear={() => mgr.setError('')} compact />

        {mgr.activeTab === 'sessions' ? (
          <>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {mgr.sessions.length === 0 ? (
                <EmptyState
                  icon={Server}
                  message="No active RDP sessions"
                  hint="Sessions appear when RDP connections are established"
                />
              ) : (
                mgr.sessions.map((session) => (
                  <SessionCard key={session.id} mgr={mgr} session={session} thumbnailsEnabled={thumbnailsEnabled} onReattachSession={onReattachSession} onDetachToWindow={onDetachToWindow} />
                ))
              )}
            </div>
            <PanelFooter mgr={mgr} />
          </>
        ) : mgr.activeTab === 'history' ? (
          <HistoryTab mgr={mgr} onReconnect={onReconnect} />
        ) : (
          <RDPLogViewer isVisible={mgr.activeTab === 'logs'} sessionFilter={mgr.logSessionFilter} />
        )}
      </div>

      <ConfirmDialog
        isOpen={mgr.rebootConfirmSessionId !== null}
        title="Force Reboot Remote Machine"
        message="This will immediately restart the remote machine. All unsaved work on the remote machine will be lost. Are you sure you want to proceed?"
        confirmText="Force Reboot"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          if (mgr.rebootConfirmSessionId) {
            mgr.handleForceReboot(mgr.rebootConfirmSessionId);
          }
          mgr.setRebootConfirmSessionId(null);
        }}
        onCancel={() => mgr.setRebootConfirmSessionId(null)}
      />
    </>
  );
};

export default RDPSessionPanel;
