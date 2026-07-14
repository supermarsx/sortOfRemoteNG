import React, { useCallback, useMemo, useState } from "react";
import {
  RefreshCw,
  Monitor,
  Globe,
  Power,
  PowerOff,
  Unplug,
  PlugZap,
  LogOut,
  RotateCcw,
  ExternalLink,
  ScrollText,
  StopCircle,
  AlertCircle,
  Clock,
  User,
  ArrowUpDown,
  Wifi,
  WifiOff,
  Server,
  History,
  BarChart3,
  LayoutGrid,
  Terminal,
  Database,
  Wrench,
} from "lucide-react";
import { ErrorBanner, EmptyState } from "../../ui/display";
import { Checkbox } from "../../ui/forms";
import { Connection } from "../../../types/connection/connection";
import { useConnections } from "../../../contexts/useConnections";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import { RDPLogViewer } from "../../rdp/RDPLogViewer";
import {
  formatUptime,
  formatBytes,
} from "../../../hooks/rdp/useRdpSessionPanel";
import {
  ProxyLogsTab,
  ProxyStatsTab,
  StatusBadge,
  classifySession,
} from "../../network/InternalProxyManager";
import {
  useUnifiedSessionManager,
  UnifiedSessionRow,
} from "../../../hooks/session/useUnifiedSessionManager";

/* ═══════════════════════════════════════════════════════════════════
   Props
   ═══════════════════════════════════════════════════════════════════ */

interface SessionManagerProps {
  isVisible: boolean;
  connections: Connection[];
  activeBackendSessionIds?: string[];
  onClose: () => void;
  /** RDP detach/reattach/reconnect call paths supplied by App-level hooks. */
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onReconnect?: (connection: Connection) => void;
  onCloseSession?: (sessionId: string) => void;
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: "realtime" | "on-blur" | "on-detach" | "manual";
  thumbnailInterval?: number;
}

type Mgr = ReturnType<typeof useUnifiedSessionManager>;

/* ═══════════════════════════════════════════════════════════════════
   Sidebar views (Sessions + absorbed sub-views)
   ═══════════════════════════════════════════════════════════════════ */

type ManagerView =
  | "sessions"
  | "rdp-logs"
  | "rdp-history"
  | "proxy-logs"
  | "proxy-stats";

const KIND_ICON_MAP: Record<string, React.ElementType> = {
  anydesk: Monitor,
  http: Globe,
  "http-proxy": Globe,
  https: Globe,
  integration: Database,
  rdp: Monitor,
  rlogin: Terminal,
  rustdesk: Monitor,
  sftp: Server,
  ssh: Terminal,
  telnet: Terminal,
  tool: Wrench,
  vnc: Monitor,
  winmgmt: Server,
  winrm: Server,
};

function groupIconForRow(row: UnifiedSessionRow): React.ElementType {
  if (row.bucket === "integration") return Database;
  if (row.bucket === "tool") return Wrench;
  if (row.bucket === "winmgmt") return Server;
  return KIND_ICON_MAP[String(row.kind)] ?? Server;
}

/* ═══════════════════════════════════════════════════════════════════
   Status pill (normalized across both kinds)
   ═══════════════════════════════════════════════════════════════════ */

const StatusPill: React.FC<{ row: UnifiedSessionRow }> = ({ row }) => {
  if (row.kind === "http-proxy" && row.proxySession) {
    return <StatusBadge status={classifySession(row.proxySession)} />;
  }
  const tone =
    row.status === "connected"
      ? "bg-success/15 text-success border-success/30"
      : row.status === "detached"
        ? "bg-warning/15 text-warning border-warning/30"
        : row.status === "error"
          ? "bg-error/15 text-error border-error/30"
          : "bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)] border-[var(--color-border)]";
  const label =
    row.status === "connected"
      ? "Connected"
      : row.status === "detached"
        ? "Detached"
        : row.status === "disconnected"
          ? "Disconnected"
          : row.status === "error"
            ? "Error"
            : "Waiting";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${tone}`}
      data-testid={`session-status-${row.status}`}
    >
      {label}
    </span>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   RDP row — preserves every RDP action
   ═══════════════════════════════════════════════════════════════════ */

const RdpRow: React.FC<{
  mgr: Mgr;
  row: UnifiedSessionRow;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onViewLogs: (sessionId: string) => void;
  onViewerDetach: (backendSessionId: string) => void;
}> = ({
  mgr,
  row,
  onReattachSession,
  onDetachToWindow,
  onViewLogs,
  onViewerDetach,
}) => {
  const { rdp } = mgr;
  const s = row.rdpSession!;
  const stats = row.rdpStats;
  const StatusIcon = s.connected ? Wifi : WifiOff;
  const statusColor = s.connected
    ? row.detached
      ? "text-warning"
      : "text-success"
    : "text-error";

  return (
    <div
      className="group sor-selection-row p-4 cursor-default"
      data-testid={`session-row-rdp-${s.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon size={13} className={`flex-shrink-0 ${statusColor}`} />
            <Monitor size={13} className="text-info flex-shrink-0" />
            <span className="text-[var(--color-text)] text-sm font-medium truncate">
              {row.title}
            </span>
            {row.subtitle && (
              <span className="text-[11px] text-[var(--color-textMuted)] font-mono truncate">
                {row.subtitle}
              </span>
            )}
            <StatusPill row={row} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-textSecondary)]">
            <span className="font-mono">
              {s.desktop_width}&times;{s.desktop_height}
            </span>
            {stats && (
              <>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {formatUptime(stats.uptime_secs)}
                </span>
                <span>{stats.fps.toFixed(0)} fps</span>
                <span>&darr; {formatBytes(stats.bytes_received)}</span>
                <span>&uarr; {formatBytes(stats.bytes_sent)}</span>
                <span
                  className={`font-medium ${stats.phase === "active" ? "text-success" : "text-warning"}`}
                >
                  {stats.phase}
                </span>
              </>
            )}
          </div>
          {stats?.last_error && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-error">
              <AlertCircle size={10} className="flex-shrink-0" />
              <span className="truncate">{stats.last_error}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {row.detached && onReattachSession && (
            <button
              onClick={() => onReattachSession(s.id, s.connection_id)}
              className="sor-icon-btn-xs"
              data-tooltip="Reattach"
              title="Reattach"
            >
              <PlugZap size={15} />
            </button>
          )}
          {onDetachToWindow && (
            <button
              onClick={() => onDetachToWindow(s.id)}
              className="sor-icon-btn-xs"
              data-tooltip="Detach to window"
              title="Detach to window"
            >
              <ExternalLink size={15} />
            </button>
          )}
          <button
            onClick={() => {
              rdp.handleDetach(s.id);
              onViewerDetach(s.id);
            }}
            className="sor-icon-btn-xs"
            data-tooltip="Detach viewer"
            title="Detach viewer"
          >
            <Unplug size={15} />
          </button>
          <button
            onClick={() => rdp.handleSignOut(s.id)}
            className="sor-icon-btn-xs"
            data-tooltip="Sign out"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
          <button
            onClick={() => onViewLogs(s.id)}
            className="sor-icon-btn-xs"
            data-tooltip="View logs"
            title="View logs"
          >
            <ScrollText size={15} />
          </button>
          <div className="w-px h-3 bg-[var(--color-border)] mx-0.5" />
          <button
            onClick={() => rdp.setRebootConfirmSessionId(s.id)}
            className="sor-icon-btn-xs text-warning hover:text-warning"
            data-tooltip="Force reboot"
            title="Force reboot"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={() => rdp.handleDisconnect(s.id)}
            className="sor-icon-btn-xs text-error hover:text-error"
            data-tooltip="Disconnect"
            title="Disconnect session"
          >
            <PowerOff size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Proxy row — preserves every proxy session action
   ═══════════════════════════════════════════════════════════════════ */

const ProxyRow: React.FC<{
  mgr: Mgr;
  row: UnifiedSessionRow;
}> = ({ mgr, row }) => {
  const { proxy } = mgr;
  const s = row.proxySession!;
  return (
    <div
      className="group sor-selection-row p-4 cursor-default"
      data-testid={`session-row-proxy-${s.session_id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Globe size={14} className="text-info flex-shrink-0" />
            <span className="text-[var(--color-text)] text-sm font-medium truncate">
              {s.target_url}
            </span>
            <StatusPill row={row} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-textSecondary)]">
            {s.username && (
              <span className="flex items-center gap-1">
                <User size={10} />
                <span>{s.username}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} />
              <span>{s.session_id.slice(0, 8)}</span>
            </span>
            <span className="flex items-center gap-1">
              <ArrowUpDown size={10} />
              <span>
                {s.request_count} req{s.request_count !== 1 ? "s" : ""}
              </span>
            </span>
            {s.error_count > 0 && (
              <span className="flex items-center gap-1 text-error">
                <AlertCircle size={10} />
                <span>
                  {s.error_count} error{s.error_count !== 1 ? "s" : ""}
                </span>
              </span>
            )}
          </div>
          {s.last_error && (
            <div className="mt-1 px-2 py-1 bg-error/20 border border-error/30 rounded text-[11px] text-error truncate">
              Last error: {s.last_error}
            </div>
          )}
        </div>
        <button
          onClick={() => proxy.handleStopSession(s.session_id)}
          className="flex-shrink-0 p-1.5 hover:bg-error/30 rounded-lg text-[var(--color-textMuted)] hover:text-error transition-colors"
          title="Stop session"
          data-tooltip="Stop session"
        >
          <StopCircle size={15} />
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Frontend row — tabs projected from ConnectionContext sessions
   ═══════════════════════════════════════════════════════════════════ */

const FrontendRow: React.FC<{
  row: UnifiedSessionRow;
  onCloseSession: (sessionId: string) => void;
}> = ({ row, onCloseSession }) => {
  const Icon = groupIconForRow(row);
  const started = row.startedAt
    ? row.startedAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className="group sor-selection-row p-4 cursor-default"
      data-testid={`session-row-frontend-${row.nativeId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={14} className="text-info flex-shrink-0" />
            <span className="text-[var(--color-text)] text-sm font-medium truncate">
              {row.title}
            </span>
            {row.kindLabel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-textSecondary)] uppercase">
                {row.kindLabel}
              </span>
            )}
            <StatusPill row={row} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-textSecondary)]">
            {row.subtitle && (
              <span className="font-mono truncate">{row.subtitle}</span>
            )}
            {started && (
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {started}
              </span>
            )}
            {row.metrics?.latency != null && (
              <span>{Math.round(row.metrics.latency)} ms</span>
            )}
          </div>
          {row.errorMessage && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-error">
              <AlertCircle size={10} className="flex-shrink-0" />
              <span className="truncate">{row.errorMessage}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onCloseSession(row.nativeId)}
            className="sor-icon-btn-xs text-error hover:text-error"
            data-tooltip="Close session"
            title="Close session"
          >
            <StopCircle size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Group header (collapsible)
   ═══════════════════════════════════════════════════════════════════ */

const GroupHeader: React.FC<{
  groupKey: string;
  label: string;
  icon: React.ElementType;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}> = ({ groupKey, label, icon: Icon, count, collapsed, onToggle }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs font-semibold text-[var(--color-textSecondary)] uppercase tracking-wide hover:bg-[var(--color-surfaceHover)]/60 transition-colors"
      aria-expanded={!collapsed}
      data-testid={`session-group-${groupKey}`}
    >
      <Icon size={13} className="text-[var(--color-textMuted)]" />
      <span className="flex-1">{label}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-border)] text-[var(--color-textSecondary)]">
        {count}
      </span>
    </button>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Sessions view (both kinds, grouped + filtered)
   ═══════════════════════════════════════════════════════════════════ */

type SessionFilter =
  | "all"
  | "rdp"
  | "proxy"
  | "connections"
  | "tools"
  | "winmgmt"
  | "integrations";

const KIND_FILTERS: { id: SessionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "rdp", label: "RDP" },
  { id: "proxy", label: "Proxy" },
  { id: "connections", label: "Connections" },
  { id: "tools", label: "Tools" },
  { id: "winmgmt", label: "Windows" },
  { id: "integrations", label: "Integrations" },
];

interface SessionGroup {
  key: string;
  label: string;
  icon: React.ElementType;
  rows: UnifiedSessionRow[];
}

const SessionsView: React.FC<{
  mgr: Mgr;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onViewRdpLogs: (sessionId: string) => void;
  onViewerDetach: (backendSessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}> = ({
  mgr,
  onReattachSession,
  onDetachToWindow,
  onViewRdpLogs,
  onViewerDetach,
  onCloseSession,
}) => {
  const [kindFilter, setKindFilter] = useState<SessionFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const visibleRows = useMemo(() => {
    return mgr.rows.filter((row) => {
      switch (kindFilter) {
        case "rdp":
          return row.source === "rdp";
        case "proxy":
          return row.source === "http-proxy";
        case "connections":
          return row.bucket === "connection";
        case "tools":
          return row.bucket === "tool";
        case "winmgmt":
          return row.bucket === "winmgmt";
        case "integrations":
          return row.bucket === "integration";
        case "all":
        default:
          return true;
      }
    });
  }, [kindFilter, mgr.rows]);

  const groups = useMemo<SessionGroup[]>(() => {
    const byKey = new Map<string, SessionGroup>();
    for (const row of visibleRows) {
      const key = row.groupKey || String(row.kind);
      const existing = byKey.get(key);
      if (existing) {
        existing.rows.push(row);
        continue;
      }
      byKey.set(key, {
        key,
        label: row.groupLabel || row.kindLabel || String(row.kind),
        icon: groupIconForRow(row),
        rows: [row],
      });
    }
    return Array.from(byKey.values());
  }, [visibleRows]);

  const totalVisible = visibleRows.length;
  const showRdpBulk =
    mgr.rdpRows.length > 0 && (kindFilter === "all" || kindFilter === "rdp");
  const showProxyBulk =
    mgr.proxyRows.length > 0 &&
    (kindFilter === "all" || kindFilter === "proxy");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter / action bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setKindFilter(f.id)}
              className={`sor-option-chip text-xs ${kindFilter === f.id ? "sor-option-chip-active" : ""}`}
              data-testid={`session-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {(showRdpBulk || showProxyBulk) && (
          <div className="flex items-center gap-1.5">
            {showRdpBulk && (
              <button
                onClick={mgr.rdp.handleDisconnectAll}
                className="sor-option-chip text-xs bg-error/20 hover:bg-error/40 text-error border-error/40"
                title="Disconnect all RDP sessions"
              >
                <Power size={12} />
                <span>Disconnect RDP</span>
              </button>
            )}
            {showProxyBulk && (
              <button
                onClick={mgr.proxy.handleStopAll}
                className="sor-option-chip text-xs bg-error/20 hover:bg-error/40 text-error border-error/40"
                title="Stop all proxy sessions"
              >
                <StopCircle size={12} />
                <span>Stop Proxies</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {totalVisible === 0 ? (
          <div className="flex items-center justify-center py-16">
            <EmptyState
              icon={Server}
              message="No active sessions"
              hint="Remote sessions, tool tabs, Windows panels, integration panels, and internal proxy sessions appear here when active."
            />
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.key}>
                <GroupHeader
                  groupKey={group.key}
                  label={group.label}
                  icon={group.icon}
                  count={group.rows.length}
                  collapsed={collapsed[group.key] ?? false}
                  onToggle={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [group.key]: !(c[group.key] ?? false),
                    }))
                  }
                />
                {!(collapsed[group.key] ?? false) && (
                  <div className="sor-selection-list mt-1">
                    {group.rows.map((row) => {
                      if (row.source === "rdp" && row.rdpSession) {
                        return (
                          <RdpRow
                            key={row.uid}
                            mgr={mgr}
                            row={row}
                            onReattachSession={onReattachSession}
                            onDetachToWindow={onDetachToWindow}
                            onViewLogs={onViewRdpLogs}
                            onViewerDetach={onViewerDetach}
                          />
                        );
                      }
                      if (row.source === "http-proxy" && row.proxySession) {
                        return <ProxyRow key={row.uid} mgr={mgr} row={row} />;
                      }
                      return (
                        <FrontendRow
                          key={row.uid}
                          row={row}
                          onCloseSession={onCloseSession}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Root
   ═══════════════════════════════════════════════════════════════════ */

const VIEWS: {
  id: ManagerView;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "sessions", label: "Sessions", icon: LayoutGrid },
  { id: "rdp-logs", label: "RDP Logs", icon: ScrollText },
  { id: "rdp-history", label: "RDP History", icon: History },
  { id: "proxy-logs", label: "Proxy Log", icon: ScrollText },
  { id: "proxy-stats", label: "Proxy Stats", icon: BarChart3 },
];

export const SessionManager: React.FC<SessionManagerProps> = ({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  onReattachSession,
  onDetachToWindow,
  onReconnect,
  onCloseSession,
  thumbnailsEnabled = true,
  thumbnailPolicy = "realtime",
  thumbnailInterval = 5,
}) => {
  const { state, dispatch } = useConnections();
  const mgr = useUnifiedSessionManager({
    isVisible,
    connections,
    activeBackendSessionIds,
    thumbnailsEnabled,
    thumbnailPolicy,
    thumbnailInterval,
  });
  const [view, setView] = useState<ManagerView>("sessions");
  const [logSessionFilter, setLogSessionFilter] = useState<string | null>(null);

  const handleViewRdpLogs = (sessionId: string) => {
    setLogSessionFilter(sessionId);
    setView("rdp-logs");
  };

  const handleCloseManagedSession = useCallback(
    (sessionId: string) => {
      if (onCloseSession) {
        onCloseSession(sessionId);
        return;
      }
      dispatch({ type: "REMOVE_SESSION", payload: sessionId });
    },
    [dispatch, onCloseSession],
  );

  /** Mark the frontend RDP tab disconnected when its viewer is detached. */
  const handleViewerDetach = useCallback(
    (backendSessionId: string) => {
      const frontendSession = state.sessions.find(
        (s) =>
          s.protocol === "rdp" &&
          (s.backendSessionId === backendSessionId ||
            s.connectionId === backendSessionId),
      );
      if (frontendSession) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...frontendSession, status: "disconnected" },
        });
      }
    },
    [state.sessions, dispatch],
  );

  // RDP history reconnect resolves to a saved connection
  const rdpHistory = mgr.rdp.sessionHistory;

  if (!isVisible) return null;

  const totalSessions = mgr.rows.length;

  return (
    <>
      <div className="h-full flex bg-[var(--color-surface)] overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
          <div className="p-3 space-y-1">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const active = view === v.id;
              const count =
                v.id === "sessions"
                  ? totalSessions
                  : v.id === "rdp-history"
                    ? rdpHistory.length
                    : v.id === "proxy-logs"
                      ? mgr.proxy.requestLog.length
                      : undefined;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setView(v.id);
                    if (v.id !== "rdp-logs") setLogSessionFilter(null);
                  }}
                  className={`sor-sidebar-tab w-full flex items-center gap-2 ${active ? "sor-sidebar-tab-active" : ""}`}
                  data-testid={`session-view-${v.id}`}
                >
                  <Icon size={14} />
                  <span className="flex-1 text-left">{v.label}</span>
                  {count != null && count > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none bg-[var(--color-border)]">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-auto p-3 border-t border-[var(--color-border)] space-y-2">
            <div className="text-[10px] text-[var(--color-textMuted)]">
              {mgr.rdpRows.length} RDP &middot; {mgr.proxyRows.length} proxy
              &middot; {mgr.frontendRows.length} tabs
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-textSecondary)] cursor-pointer">
              <Checkbox
                checked={mgr.rdp.autoRefresh && mgr.proxy.autoRefresh}
                onChange={(v: boolean) => {
                  mgr.rdp.setAutoRefresh(v);
                  mgr.proxy.setAutoRefresh(v);
                }}
              />
              <span>Auto-refresh</span>
            </label>
            <button
              onClick={mgr.handleRefresh}
              disabled={mgr.isLoading}
              aria-busy={mgr.isLoading}
              className="sor-btn sor-btn-secondary sor-btn-xs w-full disabled:opacity-60"
            >
              <RefreshCw size={12} />{" "}
              {mgr.isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ErrorBanner error={mgr.error} onClear={mgr.clearError} compact />

          {view === "sessions" && (
            <SessionsView
              mgr={mgr}
              onReattachSession={onReattachSession}
              onDetachToWindow={onDetachToWindow}
              onViewRdpLogs={handleViewRdpLogs}
              onViewerDetach={handleViewerDetach}
              onCloseSession={handleCloseManagedSession}
            />
          )}
          {view === "rdp-logs" && (
            <div className="flex-1 min-h-0">
              <RDPLogViewer isVisible sessionFilter={logSessionFilter} />
            </div>
          )}
          {view === "rdp-history" && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <RdpHistoryView mgr={mgr} onReconnect={onReconnect} />
            </div>
          )}
          {view === "proxy-logs" && (
            <div className="flex-1 overflow-y-auto p-4">
              <ProxyLogsTab mgr={mgr.proxy} />
            </div>
          )}
          {view === "proxy-stats" && (
            <div className="flex-1 overflow-y-auto p-4">
              <ProxyStatsTab mgr={mgr.proxy} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={mgr.rdp.rebootConfirmSessionId !== null}
        title="Force Reboot Remote Machine"
        message="This will immediately restart the remote machine. All unsaved work on the remote machine will be lost. Are you sure you want to proceed?"
        confirmText="Force Reboot"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          if (mgr.rdp.rebootConfirmSessionId)
            mgr.rdp.handleForceReboot(mgr.rdp.rebootConfirmSessionId);
          mgr.rdp.setRebootConfirmSessionId(null);
        }}
        onCancel={() => mgr.rdp.setRebootConfirmSessionId(null)}
      />
    </>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   RDP history sub-view (absorbed from RDPSessionPanel)
   ═══════════════════════════════════════════════════════════════════ */

const RdpHistoryView: React.FC<{
  mgr: Mgr;
  onReconnect?: (connection: Connection) => void;
}> = ({ mgr, onReconnect }) => {
  const history = mgr.rdp.sessionHistory;
  if (history.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <EmptyState
          icon={History}
          message="No session history yet"
          hint="Past RDP sessions appear here after disconnecting"
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
        <span className="text-xs text-[var(--color-textMuted)]">
          {history.length} entr{history.length === 1 ? "y" : "ies"}
        </span>
        <button
          onClick={mgr.rdp.clearHistory}
          className="sor-option-chip text-xs bg-error/10 hover:bg-error/20 text-error border-error/30"
        >
          Clear
        </button>
      </div>
      <div>
        {history.map((entry, idx) => {
          const conn = mgr.rdp.reconnectFromHistory(entry);
          const canReconnect = !!conn && !!onReconnect;
          return (
            <div
              key={`${entry.disconnectedAt}-${idx}`}
              className="group flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-surfaceHover)] transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[var(--color-textMuted)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--color-text)] truncate">
                    {entry.connectionName}
                  </span>
                  <span className="text-[11px] text-[var(--color-textMuted)] font-mono truncate">
                    {entry.hostname}:{entry.port}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 mt-0.5 text-[11px] text-[var(--color-textMuted)]">
                  <span className="flex items-center gap-1">
                    <Clock size={9} />
                    <span className="font-mono">
                      {formatUptime(entry.duration)}
                    </span>
                  </span>
                  <span className="font-mono">
                    {entry.desktopWidth}&times;{entry.desktopHeight}
                  </span>
                  {entry.username && (
                    <span className="flex items-center gap-0.5">
                      <User size={9} />
                      {entry.username}
                    </span>
                  )}
                  {!canReconnect && <span className="italic">unavailable</span>}
                </div>
              </div>
              {canReconnect && (
                <button
                  onClick={() => {
                    if (conn && onReconnect) onReconnect(conn);
                  }}
                  className="flex-shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-primary/15 text-[var(--color-textSecondary)] hover:text-primary transition-all"
                  title="Reconnect"
                >
                  <RefreshCw size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SessionManager;
