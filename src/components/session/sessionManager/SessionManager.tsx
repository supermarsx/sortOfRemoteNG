import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Monitor,
  Globe,
  PowerOff,
  Unplug,
  PlugZap,
  LogOut,
  RotateCcw,
  ExternalLink,
  ScrollText,
  StopCircle,
  ArrowUpDown,
  Server,
  History,
  BarChart3,
  LayoutGrid,
  Terminal,
  Database,
  Wrench,
  Search,
  ChevronLeft,
  ChevronRight,
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
import { RdpHistoryView } from "./RdpHistoryView";
import { SshSessionsView } from "./SshSessionsView";

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

function formatSessionSourceSummary(mgr: Mgr): string {
  const sources = [
    [mgr.rdpRows.length, "RDP"],
    [mgr.sshRows.length, "SSH"],
    [mgr.proxyRows.length, "proxy"],
    [mgr.frontendRows.length, "tabs"],
  ] as const;

  return sources
    .map(([count, label]) => `${count.toLocaleString()} ${label}`)
    .join(" · ");
}

/* ═══════════════════════════════════════════════════════════════════
   Sidebar views (Sessions + absorbed sub-views)
   ═══════════════════════════════════════════════════════════════════ */

type ManagerView =
  | "sessions"
  | "ssh-sessions"
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
   Sessions view (both kinds, grouped + filtered)
   ═══════════════════════════════════════════════════════════════════ */

type SessionFilter =
  | "all"
  | "rdp"
  | "ssh"
  | "proxy"
  | "connections"
  | "tools"
  | "winmgmt"
  | "integrations";

const KIND_FILTERS: {
  id: SessionFilter;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    id: "all",
    label: "All",
    description: "Show every active session",
    icon: LayoutGrid,
  },
  {
    id: "rdp",
    label: "RDP",
    description: "Show Remote Desktop sessions",
    icon: Monitor,
  },
  {
    id: "ssh",
    label: "SSH",
    description: "Show native SSH sessions",
    icon: Terminal,
  },
  {
    id: "proxy",
    label: "Proxy",
    description: "Show internal HTTP and HTTPS proxy sessions",
    icon: Globe,
  },
  {
    id: "connections",
    label: "Connections",
    description: "Show other connection tabs",
    icon: Server,
  },
  {
    id: "tools",
    label: "Tools",
    description: "Show utility and tool tabs",
    icon: Wrench,
  },
  {
    id: "winmgmt",
    label: "Windows",
    description: "Show Windows management tabs",
    icon: Server,
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Show integration sessions",
    icon: Database,
  },
];

export const SESSION_MANAGER_FILTER_STORAGE_KEY =
  "sortofremoteng.session-manager.filter";

function readStoredSessionFilter(): SessionFilter {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(
      SESSION_MANAGER_FILTER_STORAGE_KEY,
    );
    return KIND_FILTERS.some((filter) => filter.id === stored)
      ? (stored as SessionFilter)
      : "all";
  } catch {
    return "all";
  }
}

type SessionSortKey = "name" | "protocol" | "status" | "started" | "activity";
type SortDirection = "asc" | "desc";

function sessionDateValue(value?: Date): number {
  return value?.getTime() ?? 0;
}

function formatSessionDate(value?: Date): string {
  if (!value) return "—";
  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionSearchText(row: UnifiedSessionRow): string {
  return [
    row.title,
    row.subtitle,
    row.kindLabel,
    row.groupLabel,
    row.protocol,
    row.status,
    row.hostname,
    row.username,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function sessionDetails(row: UnifiedSessionRow): string {
  const withError = (details: string) =>
    row.errorMessage ? `${details} · Error: ${row.errorMessage}` : details;

  if (row.source === "rdp" && row.rdpStats) {
    const resolution = row.rdpSession
      ? `${row.rdpSession.desktop_width}×${row.rdpSession.desktop_height}`
      : "Unknown resolution";
    return withError(
      `${resolution} · ${formatUptime(row.rdpStats.uptime_secs)} uptime · ${row.rdpStats.phase} · ${row.rdpStats.fps.toFixed(0)} fps · ↓ ${formatBytes(row.rdpStats.bytes_received)} · ↑ ${formatBytes(row.rdpStats.bytes_sent)}`,
    );
  }
  if (row.source === "http-proxy" && row.proxySession) {
    return withError(
      `${row.proxySession.request_count} request${row.proxySession.request_count === 1 ? "" : "s"} · ${row.proxySession.error_count} error${row.proxySession.error_count === 1 ? "" : "s"}`,
    );
  }
  if (row.metrics?.latency != null) {
    return withError(`${Math.round(row.metrics.latency)} ms latency`);
  }
  return withError(
    row.connectionId ? `Connection ${row.connectionId.slice(0, 8)}` : "—",
  );
}

const SortHeader: React.FC<{
  sortKey: SessionSortKey;
  label: string;
  activeSort: SessionSortKey;
  direction: SortDirection;
  onSort: (key: SessionSortKey) => void;
}> = ({ sortKey, label, activeSort, direction, onSort }) => {
  const active = activeSort === sortKey;
  const ariaSort = !active
    ? "none"
    : direction === "asc"
      ? "ascending"
      : "descending";
  return (
    <th scope="col" aria-sort={ariaSort} className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
        title={`Sort by ${label.toLowerCase()}`}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <ArrowUpDown
          size={11}
          aria-hidden="true"
          className={active ? "text-[var(--color-primary)]" : "opacity-50"}
        />
      </button>
    </th>
  );
};

const SessionRowActions: React.FC<{
  mgr: Mgr;
  row: UnifiedSessionRow;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onViewRdpLogs: (sessionId: string) => void;
  onViewerDetach: (backendSessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDisconnectSsh: (row: UnifiedSessionRow) => void | Promise<void>;
}> = ({
  mgr,
  row,
  onReattachSession,
  onDetachToWindow,
  onViewRdpLogs,
  onViewerDetach,
  onCloseSession,
  onDisconnectSsh,
}) => {
  if (row.source === "rdp" && row.rdpSession) {
    const session = row.rdpSession;
    return (
      <div className="flex items-center justify-end gap-0.5">
        {row.detached && onReattachSession && (
          <button
            type="button"
            onClick={() => onReattachSession(session.id, session.connection_id)}
            className="sor-icon-btn-xs"
            title="Reattach RDP session"
            aria-label={`Reattach ${row.title}`}
          >
            <PlugZap size={14} aria-hidden="true" />
          </button>
        )}
        {onDetachToWindow && (
          <button
            type="button"
            onClick={() => onDetachToWindow(session.id)}
            className="sor-icon-btn-xs"
            title="Detach RDP to window"
            aria-label={`Detach ${row.title} to a window`}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            mgr.rdp.handleDetach(session.id);
            onViewerDetach(session.id);
          }}
          className="sor-icon-btn-xs"
          title="Detach RDP viewer"
          aria-label={`Detach viewer for ${row.title}`}
        >
          <Unplug size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => mgr.rdp.handleSignOut(session.id)}
          className="sor-icon-btn-xs"
          title="Sign out RDP session"
          aria-label={`Sign out ${row.title}`}
        >
          <LogOut size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onViewRdpLogs(session.id)}
          className="sor-icon-btn-xs"
          title="View RDP logs"
          aria-label={`View logs for ${row.title}`}
        >
          <ScrollText size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => mgr.rdp.setRebootConfirmSessionId(session.id)}
          className="sor-icon-btn-xs text-warning hover:text-warning"
          title="Force reboot remote machine"
          aria-label={`Force reboot ${row.title}`}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => mgr.rdp.handleDisconnect(session.id)}
          className="sor-icon-btn-xs text-error hover:text-error"
          title="Disconnect RDP session"
          aria-label={`Disconnect ${row.title}`}
        >
          <PowerOff size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (row.source === "ssh" && row.sshSession) {
    return (
      <button
        type="button"
        onClick={() => onDisconnectSsh(row)}
        className="sor-icon-btn-xs text-error hover:text-error"
        title="Disconnect SSH session"
        aria-label={`Disconnect SSH session ${row.title}`}
      >
        <PowerOff size={14} aria-hidden="true" />
      </button>
    );
  }

  if (row.source === "http-proxy" && row.proxySession) {
    return (
      <button
        type="button"
        onClick={() => mgr.proxy.handleStopSession(row.nativeId)}
        className="sor-icon-btn-xs text-error hover:text-error"
        title="Stop proxy session"
        aria-label={`Stop proxy session ${row.title}`}
      >
        <StopCircle size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onCloseSession(row.nativeId)}
      className="sor-icon-btn-xs text-error hover:text-error"
      title="Close session tab"
      aria-label={`Close session ${row.title}`}
    >
      <StopCircle size={14} aria-hidden="true" />
    </button>
  );
};

const SessionsView: React.FC<{
  mgr: Mgr;
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onViewRdpLogs: (sessionId: string) => void;
  onViewerDetach: (backendSessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDisconnectSsh: (row: UnifiedSessionRow) => void | Promise<void>;
  onDisconnectAllSsh: () => void | Promise<void>;
}> = ({
  mgr,
  onReattachSession,
  onDetachToWindow,
  onViewRdpLogs,
  onViewerDetach,
  onCloseSession,
  onDisconnectSsh,
  onDisconnectAllSsh,
}) => {
  const [kindFilter, setKindFilter] = useState<SessionFilter>(
    readStoredSessionFilter,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SessionSortKey>("started");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [confirmEndSelected, setConfirmEndSelected] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_MANAGER_FILTER_STORAGE_KEY,
        kindFilter,
      );
    } catch {
      // Preference persistence is best-effort (private/locked browser storage).
    }
  }, [kindFilter]);

  const visibleRows = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return mgr.rows
      .filter((row) => {
        const matchesKind = (() => {
          switch (kindFilter) {
            case "rdp":
              return row.kind === "rdp";
            case "ssh":
              return row.kind === "ssh";
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
        })();
        return (
          matchesKind && (!query || sessionSearchText(row).includes(query))
        );
      })
      .sort((left, right) => {
        let result = 0;
        switch (sortKey) {
          case "name":
            result = left.title.localeCompare(right.title, undefined, {
              numeric: true,
              sensitivity: "base",
            });
            break;
          case "protocol":
            result = left.kindLabel.localeCompare(right.kindLabel);
            break;
          case "status":
            result = left.status.localeCompare(right.status);
            break;
          case "activity":
            result =
              sessionDateValue(left.lastActivity) -
              sessionDateValue(right.lastActivity);
            break;
          case "started":
          default:
            result =
              sessionDateValue(left.startedAt) -
              sessionDateValue(right.startedAt);
            break;
        }
        if (result === 0) result = left.uid.localeCompare(right.uid);
        return sortDirection === "asc" ? result : -result;
      });
  }, [kindFilter, mgr.rows, searchTerm, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visibleRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const pageRowIds = pageRows.map((row) => row.uid);
  const allPageRowsSelected =
    pageRowIds.length > 0 && pageRowIds.every((id) => selectedRows.has(id));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    const liveIds = new Set(mgr.rows.map((row) => row.uid));
    setSelectedRows((current) => {
      const next = new Set([...current].filter((id) => liveIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [mgr.rows]);

  const changeFilter = (filter: SessionFilter) => {
    setKindFilter(filter);
    setPage(1);
  };
  const changeSort = (nextSort: SessionSortKey) => {
    if (sortKey === nextSort) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextSort);
      setSortDirection(
        nextSort === "name" || nextSort === "protocol" ? "asc" : "desc",
      );
    }
    setPage(1);
  };
  const togglePageSelection = (checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      pageRowIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const endSession = useCallback(
    async (row: UnifiedSessionRow) => {
      if (row.source === "rdp") {
        await mgr.rdp.handleDisconnect(row.nativeId);
      } else if (row.source === "ssh") {
        await onDisconnectSsh(row);
      } else if (row.source === "http-proxy") {
        await mgr.proxy.handleStopSession(row.nativeId);
      } else {
        onCloseSession(row.nativeId);
      }
    },
    [mgr.proxy, mgr.rdp, onCloseSession, onDisconnectSsh],
  );

  const endSelectedSessions = async () => {
    const rows = mgr.rows.filter((row) => selectedRows.has(row.uid));
    await Promise.allSettled(rows.map(endSession));
    setSelectedRows(new Set());
  };

  const showRdpBulk =
    mgr.rdpRows.length > 0 && (kindFilter === "all" || kindFilter === "rdp");
  const showProxyBulk =
    mgr.proxyRows.length > 0 &&
    (kindFilter === "all" || kindFilter === "proxy");
  const showSshBulk =
    mgr.sshRows.length > 0 && (kindFilter === "all" || kindFilter === "ssh");

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search sessions</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, target, protocol, user, or status…"
              className="sor-form-input w-full pl-8"
              data-testid="session-search"
            />
          </label>
          <div className="flex items-center gap-1.5">
            {selectedRows.size > 0 && (
              <button
                type="button"
                onClick={() => setConfirmEndSelected(true)}
                className="sor-option-chip text-xs bg-error/20 text-error border-error/40 hover:bg-error/30"
                title="End selected sessions"
                data-testid="session-end-selected"
              >
                <StopCircle size={12} aria-hidden="true" />
                End selected ({selectedRows.size})
              </button>
            )}
            {showRdpBulk && (
              <button
                type="button"
                onClick={mgr.rdp.handleDisconnectAll}
                className="sor-option-chip text-xs bg-error/20 hover:bg-error/40 text-error border-error/40"
                title="Disconnect all RDP sessions"
              >
                <Monitor size={12} aria-hidden="true" />
                <span>Disconnect RDP</span>
              </button>
            )}
            {showSshBulk && (
              <button
                type="button"
                onClick={onDisconnectAllSsh}
                className="sor-option-chip text-xs bg-error/20 hover:bg-error/40 text-error border-error/40"
                title="Disconnect all SSH sessions"
                aria-label="Disconnect all SSH sessions"
              >
                <Terminal size={12} aria-hidden="true" />
                <span>Disconnect SSH</span>
              </button>
            )}
            {showProxyBulk && (
              <button
                type="button"
                onClick={mgr.proxy.handleStopAll}
                className="sor-option-chip text-xs bg-error/20 hover:bg-error/40 text-error border-error/40"
                title="Stop all proxy sessions"
              >
                <Globe size={12} aria-hidden="true" />
                <span>Stop Proxies</span>
              </button>
            )}
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 overflow-x-auto"
          role="toolbar"
          aria-label="Filter sessions by type"
        >
          {KIND_FILTERS.map((filter) => {
            const Icon = filter.icon;
            const active = kindFilter === filter.id;
            return (
              <button
                type="button"
                key={filter.id}
                onClick={() => changeFilter(filter.id)}
                className={`sor-option-chip text-xs flex-shrink-0 ${active ? "sor-option-chip-active" : ""}`}
                data-testid={`session-filter-${filter.id}`}
                data-tooltip={filter.description}
                title={filter.description}
                aria-label={filter.description}
                aria-pressed={active}
              >
                <Icon size={12} aria-hidden="true" />
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto p-3 overscroll-contain"
        data-testid="session-table-scroll-region"
      >
        <div
          className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]"
          data-testid="session-table-frame"
        >
          <table
            className="w-full min-w-[1040px] border-collapse text-left text-xs"
            data-testid="session-management-table"
          >
            <caption className="sr-only">Active session management</caption>
            <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allPageRowsSelected}
                    onChange={togglePageSelection}
                    aria-label="Select all sessions on this page"
                    disabled={pageRows.length === 0}
                  />
                </th>
                <SortHeader
                  sortKey="name"
                  label="Name / target"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="protocol"
                  label="Protocol"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="status"
                  label="Status"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="started"
                  label="Started"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="activity"
                  label="Last activity"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <th scope="col" className="px-3 py-2 font-medium">
                  Details
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {pageRows.map((row) => {
                const Icon = groupIconForRow(row);
                return (
                  <tr
                    key={row.uid}
                    className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                    data-testid={`session-table-row-${row.uid}`}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selectedRows.has(row.uid)}
                        onChange={(checked) =>
                          setSelectedRows((current) => {
                            const next = new Set(current);
                            if (checked) next.add(row.uid);
                            else next.delete(row.uid);
                            return next;
                          })
                        }
                        aria-label={`Select ${row.title}`}
                      />
                    </td>
                    <th
                      scope="row"
                      className="max-w-72 px-3 py-2.5 font-normal"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon
                          size={14}
                          className="flex-shrink-0 text-info"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div
                            className="truncate font-medium text-[var(--color-text)]"
                            title={row.title}
                          >
                            {row.title}
                          </div>
                          <div
                            className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                            title={row.subtitle}
                          >
                            {row.subtitle || row.nativeId}
                          </div>
                        </div>
                      </div>
                    </th>
                    <td className="px-3 py-2.5 text-[var(--color-textSecondary)]">
                      {row.kindLabel}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill row={row} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                      {formatSessionDate(row.startedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                      {formatSessionDate(row.lastActivity)}
                    </td>
                    <td
                      className="max-w-60 truncate px-3 py-2.5 text-[var(--color-textSecondary)]"
                      title={sessionDetails(row)}
                    >
                      {sessionDetails(row)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <SessionRowActions
                        mgr={mgr}
                        row={row}
                        onReattachSession={onReattachSession}
                        onDetachToWindow={onDetachToWindow}
                        onViewRdpLogs={onViewRdpLogs}
                        onViewerDetach={onViewerDetach}
                        onCloseSession={onCloseSession}
                        onDisconnectSsh={onDisconnectSsh}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pageRows.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={Server}
                message="No matching sessions"
                hint="Adjust the search or type filter, or open a remote session."
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)]">
        <span aria-live="polite">
          {visibleRows.length === 0
            ? "0 sessions"
            : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, visibleRows.length)} of ${visibleRows.length}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="sor-form-input py-1"
              aria-label="Session rows per page"
              data-testid="session-page-size"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous session page"
            aria-label="Previous session page"
            data-testid="session-previous-page"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            disabled={currentPage >= pageCount}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title="Next session page"
            aria-label="Next session page"
            data-testid="session-next-page"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmEndSelected}
        title="End Selected Sessions"
        message={`End ${selectedRows.size} selected session${selectedRows.size === 1 ? "" : "s"}? Active transports will be disconnected and selected tabs will be closed.`}
        confirmText="End Sessions"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          setConfirmEndSelected(false);
          void endSelectedSessions();
        }}
        onCancel={() => setConfirmEndSelected(false)}
      />
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
  { id: "ssh-sessions", label: "SSH Sessions", icon: Terminal },
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

  const handleDisconnectSsh = useCallback(
    async (row: UnifiedSessionRow) => {
      await mgr.ssh.handleDisconnect(row.nativeId);
    },
    [mgr.ssh],
  );

  const handleDisconnectAllSsh = useCallback(async () => {
    await mgr.ssh.handleDisconnectAll();
  }, [mgr.ssh]);

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
  const sessionSourceSummary = formatSessionSourceSummary(mgr);

  if (!isVisible) return null;

  const totalSessions = mgr.rows.length;

  return (
    <>
      <div className="h-full min-h-0 flex bg-[var(--color-surface)] overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 min-h-0 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const active = view === v.id;
              const count =
                v.id === "sessions"
                  ? totalSessions
                  : v.id === "ssh-sessions"
                    ? mgr.sshRows.length
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
          <div className="flex-shrink-0 p-3 border-t border-[var(--color-border)] space-y-2">
            <div
              className="text-[10px] text-[var(--color-textMuted)]"
              aria-label={sessionSourceSummary}
              aria-live="polite"
              data-testid="session-source-summary"
            >
              {sessionSourceSummary}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-textSecondary)] cursor-pointer">
              <Checkbox
                checked={
                  mgr.rdp.autoRefresh &&
                  mgr.ssh.autoRefresh &&
                  mgr.proxy.autoRefresh
                }
                onChange={(v: boolean) => {
                  mgr.rdp.setAutoRefresh(v);
                  mgr.ssh.setAutoRefresh(v);
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
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ErrorBanner error={mgr.error} onClear={mgr.clearError} compact />

          {view === "sessions" && (
            <SessionsView
              mgr={mgr}
              onReattachSession={onReattachSession}
              onDetachToWindow={onDetachToWindow}
              onViewRdpLogs={handleViewRdpLogs}
              onViewerDetach={handleViewerDetach}
              onCloseSession={handleCloseManagedSession}
              onDisconnectSsh={handleDisconnectSsh}
              onDisconnectAllSsh={handleDisconnectAllSsh}
            />
          )}
          {view === "ssh-sessions" && <SshSessionsView />}
          {view === "rdp-logs" && (
            <div className="flex-1 min-h-0">
              <RDPLogViewer isVisible sessionFilter={logSessionFilter} />
            </div>
          )}
          {view === "rdp-history" && (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <RdpHistoryView
                history={mgr.rdp.sessionHistory}
                resolveConnection={mgr.rdp.reconnectFromHistory}
                onClear={mgr.rdp.clearHistory}
                onReconnect={onReconnect}
              />
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

export default SessionManager;
