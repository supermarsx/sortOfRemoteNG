import React, { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Monitor, Power, PowerOff, Server, ArrowDownToLine, Unplug,
  PlugZap, LogOut, RotateCcw, ExternalLink, ScrollText, X, AlertCircle,
  History, Trash2, Search, User, Wifi, WifiOff, Clock,
} from 'lucide-react';
import { ErrorBanner, EmptyState } from '../ui/display';
import { Connection } from '../../types/connection/connection';
import { useConnections } from '../../contexts/useConnections';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';
import { RDPLogViewer } from './RDPLogViewer';
import {
  useRDPSessionPanel, RDPSessionInfo, RDPSessionHistoryEntry, RDPStats,
  formatUptime, formatBytes,
} from '../../hooks/rdp/useRdpSessionPanel';
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

/* ═══════════════════════════════════════════════════════════════════
   Header
   ═══════════════════════════════════════════════════════════════════ */

const PanelHeader: React.FC<{ mgr: Mgr; onClose: () => void }> = ({ mgr, onClose }) => {
  const connected = mgr.sessions.filter(s => s.connected).length;
  const detached = mgr.sessions.length - connected;

  return (
    <div className="px-6 pt-5 pb-4 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
            <Monitor size={18} className="text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)] leading-tight">RDP Sessions</h2>
            <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
              {connected > 0 && <><span className="text-success font-medium">{connected}</span> connected</>}
              {connected > 0 && detached > 0 && <span className="mx-1">&middot;</span>}
              {detached > 0 && <><span className="text-warning font-medium">{detached}</span> detached</>}
              {mgr.sessions.length === 0 && 'No active sessions'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-textSecondary)] cursor-pointer mr-1">
            <Checkbox checked={mgr.autoRefresh} onChange={(v: boolean) => mgr.setAutoRefresh(v)} />
            <span>Auto-refresh</span>
          </label>
          <button onClick={mgr.handleRefresh} className={`p-1.5 rounded-md hover:bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors ${mgr.isLoading ? 'animate-spin' : ''}`} data-tooltip="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Tab bar
   ═══════════════════════════════════════════════════════════════════ */

const PanelTabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const tabs = [
    { id: 'sessions' as const, label: 'Sessions', icon: Monitor, count: mgr.sessions.length },
    { id: 'logs' as const, label: 'Logs', icon: ScrollText },
    { id: 'history' as const, label: 'History', icon: History, count: mgr.sessionHistory.length },
  ];

  return (
    <div className="flex gap-1 px-6 border-b border-[var(--color-border)] flex-shrink-0">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const active = mgr.activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => { mgr.setActiveTab(tab.id); if (tab.id === 'sessions') mgr.setLogSessionFilter(null); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative ${
              active
                ? 'text-[var(--color-text)]'
                : 'text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]'
            }`}
          >
            <Icon size={13} />
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none ${
                active ? 'bg-accent/20 text-accent' : 'bg-[var(--color-border)] text-[var(--color-textMuted)]'
              }`}>
                {tab.count}
              </span>
            )}
            {active && <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full" />}
          </button>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function formatRelativeTime(isoDate: string): string {
  const diffSecs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diffSecs < 60) return 'just now';
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ═══════════════════════════════════════════════════════════════════
   Session card
   ═══════════════════════════════════════════════════════════════════ */

const SessionCard: React.FC<{
  mgr: Mgr;
  session: RDPSessionInfo;
  thumbnailsEnabled: boolean;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onViewerDetach?: (backendSessionId: string) => void;
}> = ({ mgr, session, thumbnailsEnabled, onReattachSession, onDetachToWindow, onViewerDetach }) => {
  const stats = mgr.statsMap[session.id];
  const display = mgr.getSessionDisplayName(session);
  const isDetached = mgr.isSessionDetached(session);
  const statusColor = session.connected ? (isDetached ? 'text-warning' : 'text-success') : 'text-error';
  const StatusIcon = session.connected ? Wifi : WifiOff;

  return (
    <div className="group px-6 py-3 hover:bg-[var(--color-surface)]/50 transition-colors">
      <div className="flex gap-3">
        {/* Thumbnail */}
        {thumbnailsEnabled && (
          <div className="flex-shrink-0 w-24 h-14 rounded-lg overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)]">
            {mgr.thumbnails[session.id] ? (
              <img src={mgr.thumbnails[session.id]} alt="" className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Monitor size={16} className="text-[var(--color-textMuted)] opacity-40" />
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <StatusIcon size={12} className={`flex-shrink-0 ${statusColor}`} />
            <span className="text-sm font-medium text-[var(--color-text)] truncate">{display.name}</span>
            {display.subtitle && (
              <span className="text-[11px] text-[var(--color-textMuted)] font-mono truncate">{display.subtitle}</span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-[11px] text-[var(--color-textMuted)]">
            <span className="font-mono text-[var(--color-textSecondary)]">{session.desktop_width}&times;{session.desktop_height}</span>
            {stats && (
              <>
                <span className="flex items-center gap-1"><Clock size={10} />{formatUptime(stats.uptime_secs)}</span>
                <span>{stats.fps.toFixed(0)} fps</span>
                <span>&darr; {formatBytes(stats.bytes_received)}</span>
                <span>&uarr; {formatBytes(stats.bytes_sent)}</span>
                <span className={`font-medium ${stats.phase === 'active' ? 'text-success' : 'text-warning'}`}>{stats.phase}</span>
              </>
            )}
          </div>

          {/* Error */}
          {stats?.last_error && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-error">
              <AlertCircle size={10} className="flex-shrink-0" />
              <span className="truncate">{stats.last_error}</span>
            </div>
          )}

          {/* Actions — visible on hover */}
          <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {isDetached && onReattachSession && (
              <button onClick={() => onReattachSession(session.id, session.connection_id)} className="sor-icon-btn-xs" data-tooltip="Reattach"><PlugZap size={12} /></button>
            )}
            {onDetachToWindow && (
              <button onClick={() => onDetachToWindow(session.id)} className="sor-icon-btn-xs" data-tooltip="Detach to window"><ExternalLink size={12} /></button>
            )}
            <button onClick={() => { mgr.handleDetach(session.id); onViewerDetach?.(session.id); }} className="sor-icon-btn-xs" data-tooltip="Detach viewer"><Unplug size={12} /></button>
            <button onClick={() => mgr.handleSignOut(session.id)} className="sor-icon-btn-xs" data-tooltip="Sign out"><LogOut size={12} /></button>
            <button onClick={() => { mgr.setLogSessionFilter(session.id); mgr.setActiveTab('logs'); }} className="sor-icon-btn-xs" data-tooltip="View logs"><ScrollText size={12} /></button>
            <div className="w-px h-3 bg-[var(--color-border)] mx-0.5" />
            <button onClick={() => mgr.setRebootConfirmSessionId(session.id)} className="sor-icon-btn-xs text-warning hover:text-warning" data-tooltip="Force reboot"><RotateCcw size={12} /></button>
            <button onClick={() => mgr.handleDisconnect(session.id)} className="sor-icon-btn-xs text-error hover:text-error" data-tooltip="Disconnect"><PowerOff size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   History entry
   ═══════════════════════════════════════════════════════════════════ */

const HistoryEntry: React.FC<{
  entry: RDPSessionHistoryEntry;
  canReconnect: boolean;
  onReconnect: () => void;
}> = ({ entry, canReconnect, onReconnect }) => (
  <div className="group flex items-center gap-3 px-6 py-2 hover:bg-[var(--color-surface)]/50 transition-colors">
    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[var(--color-textMuted)]" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--color-text)] truncate">{entry.connectionName}</span>
        <span className="text-[11px] text-[var(--color-textMuted)] font-mono truncate">{entry.hostname}:{entry.port}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 mt-0.5 text-[11px] text-[var(--color-textMuted)]">
        <span title={new Date(entry.disconnectedAt).toLocaleString()}>{formatRelativeTime(entry.disconnectedAt)}</span>
        <span className="flex items-center gap-1"><Clock size={9} /><span className="font-mono">{formatUptime(entry.duration)}</span></span>
        <span className="font-mono">{entry.desktopWidth}&times;{entry.desktopHeight}</span>
        {entry.username && <span className="flex items-center gap-0.5"><User size={9} />{entry.username}</span>}
        {!canReconnect && <span className="italic text-[var(--color-textMuted)]">unavailable</span>}
      </div>
    </div>
    {canReconnect && (
      <button
        onClick={onReconnect}
        className="flex-shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent/15 text-[var(--color-textSecondary)] hover:text-accent transition-all"
        data-tooltip="Reconnect"
      >
        <RefreshCw size={13} />
      </button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   History tab
   ═══════════════════════════════════════════════════════════════════ */

const HistoryTab: React.FC<{
  mgr: Mgr;
  onReconnect?: (connection: Connection) => void;
}> = ({ mgr, onReconnect }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return mgr.sessionHistory;
    const q = searchQuery.toLowerCase();
    return mgr.sessionHistory.filter(
      (e) => e.connectionName.toLowerCase().includes(q) ||
        e.hostname.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q),
    );
  }, [mgr.sessionHistory, searchQuery]);

  if (mgr.sessionHistory.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
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
      {/* Search toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name, host, user..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <span className="text-[11px] text-[var(--color-textMuted)] flex-shrink-0">{filteredHistory.length} entries</span>
        <button
          onClick={mgr.clearHistory}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-error/10 hover:bg-error/20 text-error text-[11px] font-medium transition-colors flex-shrink-0"
          data-tooltip="Clear all history"
        >
          <Trash2 size={11} />
          Clear
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-textMuted)] text-xs">
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
                onReconnect={() => { if (conn && onReconnect) onReconnect(conn); }}
              />
            );
          })
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════════════════════════════ */

const PanelFooter: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.sessions.length === 0) return null;
  return (
    <div className="px-6 py-2.5 border-t border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
      <div className="text-[11px] text-[var(--color-textMuted)] flex items-center gap-1">
        <ArrowDownToLine size={11} />
        Total: {formatBytes(mgr.totalTraffic)}
      </div>
      <button onClick={mgr.handleDisconnectAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 hover:bg-error/20 text-error text-[11px] font-medium transition-colors">
        <Power size={11} />
        Disconnect All
      </button>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Root
   ═══════════════════════════════════════════════════════════════════ */

export const RDPSessionPanel: React.FC<RDPSessionPanelProps> = ({
  isVisible, connections, activeBackendSessionIds = [], onClose,
  onReattachSession, onDetachToWindow, onReconnect,
  thumbnailsEnabled = true, thumbnailPolicy = 'realtime', thumbnailInterval = 5,
}) => {
  const { state, dispatch } = useConnections();
  const mgr = useRDPSessionPanel({
    isVisible, connections, activeBackendSessionIds,
    thumbnailsEnabled, thumbnailPolicy, thumbnailInterval,
  });

  /** Mark the frontend session tab as disconnected when the viewer is detached. */
  const handleViewerDetach = useCallback((backendSessionId: string) => {
    const frontendSession = state.sessions.find(
      s => s.protocol === 'rdp' && (s.backendSessionId === backendSessionId || s.connectionId === backendSessionId),
    );
    if (frontendSession) {
      dispatch({ type: 'UPDATE_SESSION', payload: { ...frontendSession, status: 'disconnected' } });
    }
  }, [state.sessions, dispatch]);

  if (!isVisible) return null;

  return (
    <>
      <div className="flex flex-col h-full bg-[var(--color-background)] overflow-hidden">
        <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 min-h-0">
          <PanelHeader mgr={mgr} onClose={onClose} />
          <PanelTabBar mgr={mgr} />
          <ErrorBanner error={mgr.error} onClear={() => mgr.setError('')} compact />

          {mgr.activeTab === 'sessions' ? (
            <>
              <div className="flex-1 overflow-y-auto">
                {mgr.sessions.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <EmptyState
                      icon={Server}
                      message="No active RDP sessions"
                      hint="Sessions appear when RDP connections are established"
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--color-border)]">
                    {mgr.sessions.map((session) => (
                      <SessionCard key={session.id} mgr={mgr} session={session} thumbnailsEnabled={thumbnailsEnabled} onReattachSession={onReattachSession} onDetachToWindow={onDetachToWindow} onViewerDetach={handleViewerDetach} />
                    ))}
                  </div>
                )}
              </div>
              <PanelFooter mgr={mgr} />
            </>
          ) : mgr.activeTab === 'history' ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <HistoryTab mgr={mgr} onReconnect={onReconnect} />
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <RDPLogViewer isVisible={mgr.activeTab === 'logs'} sessionFilter={mgr.logSessionFilter} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={mgr.rebootConfirmSessionId !== null}
        title="Force Reboot Remote Machine"
        message="This will immediately restart the remote machine. All unsaved work on the remote machine will be lost. Are you sure you want to proceed?"
        confirmText="Force Reboot"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => { if (mgr.rebootConfirmSessionId) mgr.handleForceReboot(mgr.rebootConfirmSessionId); mgr.setRebootConfirmSessionId(null); }}
        onCancel={() => mgr.setRebootConfirmSessionId(null)}
      />
    </>
  );
};

export default RDPSessionPanel;
