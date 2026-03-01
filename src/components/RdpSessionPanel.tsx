import React from 'react';
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
  PanelRightClose,
} from 'lucide-react';
import { ErrorBanner, EmptyState } from './ui/display';
import { Connection } from '../types/connection';
import { ConfirmDialog } from './ConfirmDialog';
import { RdpLogViewer } from './RdpLogViewer';
import {
  useRdpSessionPanel,
  RdpSessionInfo,
  RdpStats,
  formatUptime,
  formatBytes,
} from '../hooks/rdp/useRdpSessionPanel';
import { Checkbox } from './ui/forms';

interface RdpSessionPanelProps {
  isVisible: boolean;
  connections: Connection[];
  activeBackendSessionIds?: string[];
  onClose: () => void;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: 'realtime' | 'on-blur' | 'on-detach' | 'manual';
  thumbnailInterval?: number;
}

type Mgr = ReturnType<typeof useRdpSessionPanel>;

/* ── Sub-components ──────────────────────────────────────────────── */

const PanelHeader: React.FC<{ mgr: Mgr; onClose: () => void }> = ({ mgr, onClose }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
    <div className="flex items-center space-x-2.5">
      <div className="w-7 h-7 rounded-lg bg-indigo-600/20 flex items-center justify-center">
        <Monitor size={14} className="text-indigo-400" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] leading-tight">RDP Sessions</h2>
        <p className="text-[10px] text-gray-500">{mgr.sessions.length} active session{mgr.sessions.length !== 1 ? 's' : ''}</p>
      </div>
    </div>
    <div className="flex items-center space-x-1">
      <label className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] cursor-pointer">
        <Checkbox checked={mgr.autoRefresh} onChange={(v: boolean) => mgr.setAutoRefresh(v)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-indigo-600 w-3 h-3" />
        <span>Auto</span>
      </label>
      <button onClick={mgr.handleRefresh} className={`p-1.5 hover:bg-[var(--color-surface)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] ${mgr.isLoading ? 'animate-spin' : ''}`} data-tooltip="Refresh">
        <RefreshCw size={12} />
      </button>
      <button onClick={onClose} className="p-1.5 hover:bg-[var(--color-surface)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" data-tooltip="Close panel">
        <PanelRightClose size={14} />
      </button>
    </div>
  </div>
);

const PanelTabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex border-b border-[var(--color-border)] flex-shrink-0">
    <button onClick={() => { mgr.setActiveTab('sessions'); mgr.setLogSessionFilter(null); }} className={`px-4 py-2 text-xs font-medium transition-colors ${mgr.activeTab === 'sessions' ? 'text-[var(--color-text)] border-b-2 border-indigo-500' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-textSecondary)]'}`}>
      Sessions
    </button>
    <button onClick={() => mgr.setActiveTab('logs')} className={`px-4 py-2 text-xs font-medium transition-colors ${mgr.activeTab === 'logs' ? 'text-[var(--color-text)] border-b-2 border-indigo-500' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-textSecondary)]'}`}>
      Logs
    </button>
  </div>
);



const SessionThumbnail: React.FC<{ mgr: Mgr; session: RdpSessionInfo; thumbnailsEnabled: boolean }> = ({ mgr, session, thumbnailsEnabled }) => {
  if (!thumbnailsEnabled) return null;
  return (
    <div className="flex-shrink-0 w-[120px] h-[68px] rounded overflow-hidden bg-[var(--color-background)]">
      {mgr.thumbnails[session.id] ? (
        <img src={mgr.thumbnails[session.id]} alt="Session preview" className="w-full h-full object-cover" draggable={false} />
      ) : session.connected ? (
        <div className="w-full h-full flex items-center justify-center"><Monitor size={16} className="text-gray-700" /></div>
      ) : (
        <div className="w-full h-full flex items-center justify-center"><Monitor size={16} className="text-gray-600 opacity-50" /></div>
      )}
    </div>
  );
};

const SessionActions: React.FC<{
  mgr: Mgr;
  session: RdpSessionInfo;
  isDetached: boolean;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
}> = ({ mgr, session, isDetached, onReattachSession, onDetachToWindow }) => (
  <div className="flex items-center space-x-0.5 mt-1">
    {isDetached && onReattachSession && (
      <button onClick={() => onReattachSession(session.id, session.connection_id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-green-400 transition-colors" data-tooltip="Reattach viewer"><PlugZap size={12} /></button>
    )}
    {onDetachToWindow && (
      <button onClick={() => onDetachToWindow(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-blue-400 transition-colors" data-tooltip="Open in separate window"><ExternalLink size={12} /></button>
    )}
    <button onClick={() => mgr.handleDetach(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-yellow-400 transition-colors" data-tooltip="Detach viewer (keep session running)"><Unplug size={12} /></button>
    <button onClick={() => mgr.handleSignOut(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-blue-400 transition-colors" data-tooltip="Sign out remote session"><LogOut size={12} /></button>
    <button onClick={() => mgr.setRebootConfirmSessionId(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors" data-tooltip="Force reboot remote machine"><RotateCcw size={12} /></button>
    <button onClick={() => { mgr.setLogSessionFilter(session.id); mgr.setActiveTab('logs'); }} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-indigo-400 transition-colors" data-tooltip="View logs for this session"><ScrollText size={12} /></button>
    <button onClick={() => mgr.handleDisconnect(session.id)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors" data-tooltip="Disconnect session"><PowerOff size={12} /></button>
  </div>
);

const SessionInfoGrid: React.FC<{ session: RdpSessionInfo; stats?: RdpStats; displayName: string }> = ({ session, stats, displayName }) => (
  <div className="grid grid-cols-2 gap-1 mt-1.5 text-[10px]">
    <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5">
      <span className="text-gray-500">Res </span>
      <span className="text-[var(--color-textSecondary)] font-mono">{session.desktop_width}&times;{session.desktop_height}</span>
    </div>
    <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5" title={session.id}>
      <span className="text-gray-500">ID </span>
      <span className="text-[var(--color-textSecondary)] font-mono truncate">{displayName !== `${session.host}:${session.port}` ? displayName : session.id.slice(0, 8)}</span>
    </div>
    {stats && (
      <>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-gray-500">Up </span><span className="text-[var(--color-textSecondary)] font-mono">{formatUptime(stats.uptime_secs)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-gray-500">FPS </span><span className="text-[var(--color-textSecondary)] font-mono">{stats.fps.toFixed(1)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-gray-500">Rx </span><span className="text-[var(--color-textSecondary)] font-mono">{formatBytes(stats.bytes_received)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-gray-500">Tx </span><span className="text-[var(--color-textSecondary)] font-mono">{formatBytes(stats.bytes_sent)}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className="text-gray-500">Frames </span><span className="text-[var(--color-textSecondary)] font-mono">{stats.frame_count.toLocaleString()}</span></div>
        <div className="bg-[var(--color-background)]/50 rounded px-1.5 py-0.5"><span className={`font-mono ${stats.phase === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>{stats.phase}</span></div>
      </>
    )}
  </div>
);

const SessionCard: React.FC<{
  mgr: Mgr;
  session: RdpSessionInfo;
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
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${session.connected ? (isDetached ? 'bg-yellow-400' : 'bg-green-400') : 'bg-red-400'}`} />
            <div className="min-w-0">
              <span className="text-xs font-medium text-[var(--color-text)] block truncate">{display.name}</span>
              {display.subtitle && <span className="text-[10px] text-gray-500 block truncate">{display.subtitle}</span>}
            </div>
          </div>
          <SessionActions mgr={mgr} session={session} isDetached={isDetached} onReattachSession={onReattachSession} onDetachToWindow={onDetachToWindow} />
          <SessionInfoGrid session={session} stats={stats} displayName={display.name} />
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
};

const PanelFooter: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.sessions.length === 0) return null;
  return (
    <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
      <div className="text-[10px] text-gray-500">
        <ArrowDownToLine size={10} className="inline mr-1" />
        {formatBytes(mgr.totalTraffic)}
      </div>
      <button onClick={mgr.handleDisconnectAll} className="flex items-center gap-1 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 rounded text-red-400 text-[10px] transition-colors">
        <Power size={10} />
        Disconnect All
      </button>
    </div>
  );
};

/* ── Root component ──────────────────────────────────────────────── */

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
  const mgr = useRdpSessionPanel({
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
        ) : (
          <RdpLogViewer isVisible={mgr.activeTab === 'logs'} sessionFilter={mgr.logSessionFilter} />
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

export default RdpSessionPanel;
