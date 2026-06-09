import React from "react";
import {
  RefreshCw,
  Trash2,
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  ArrowUpDown,
  ServerCrash,
  StopCircle,
  User,
  ScrollText,
  BarChart3,
} from "lucide-react";
import { ErrorBanner } from '../ui/display';
import {
  useInternalProxyManager,
  formatTime,
  formatDateTime,
  getStatusColor,
  getMethodColor,
  ManagerTab,
} from "../../hooks/network/useInternalProxyManager";
import { Checkbox } from '../ui/forms';

type Mgr = ReturnType<typeof useInternalProxyManager>;

interface InternalProxyManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Session status discriminator                                        */
/* ------------------------------------------------------------------ */
/**
 * Classify a session's health from the manager-reported `error_count`
 * + `last_error` string. Mirrors the categorisation the Rust side
 * uses for themed error pages (P2) so the badge a user sees here
 * matches the page they saw in the iframe.
 *
 * `Healthy` — at least one request, no errors. `Waiting` — no
 * requests yet (typical for a freshly-opened tab whose first GET is
 * in flight, or a no-auth tab whose iframe hasn't navigated to the
 * proxy yet). Everything else surfaces the last failure category.
 */
type SessionStatus =
  | "healthy"
  | "waiting"
  | "refused"
  | "dns"
  | "tls"
  | "timeout"
  | "auth"
  | "errors";

const STATUS_META: Record<SessionStatus, { label: string; tone: "ok" | "warn" | "err" | "muted" }> = {
  healthy: { label: "Healthy", tone: "ok" },
  waiting: { label: "Waiting", tone: "muted" },
  refused: { label: "Refused", tone: "err" },
  dns: { label: "DNS error", tone: "err" },
  tls: { label: "TLS error", tone: "err" },
  timeout: { label: "Timeout", tone: "warn" },
  auth: { label: "Auth required", tone: "warn" },
  errors: { label: "Errors", tone: "err" },
};

function classifySession(s: {
  request_count: number;
  error_count: number;
  last_error?: string | null;
}): SessionStatus {
  if (s.error_count === 0 && s.request_count === 0) return "waiting";
  if (s.error_count === 0) return "healthy";
  const m = (s.last_error || "").toLowerCase();
  if (m.includes("connection refused") || m.includes("actively refused"))
    return "refused";
  if (m.includes("dns") || m.includes("name or service not known") ||
      m.includes("failed to lookup") || m.includes("no address associated"))
    return "dns";
  if (m.includes("certificate") || m.includes("ssl") ||
      m.includes("tls") || m.includes("handshake") ||
      m.includes("self-signed") || m.includes("self signed"))
    return "tls";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (m.includes("http 401")) return "auth";
  return "errors";
}

const StatusBadge: React.FC<{ status: SessionStatus }> = ({ status }) => {
  const meta = STATUS_META[status];
  const cls =
    meta.tone === "ok"
      ? "bg-success/15 text-success border-success/30"
      : meta.tone === "warn"
        ? "bg-warning/15 text-warning border-warning/30"
        : meta.tone === "err"
          ? "bg-error/15 text-error border-error/30"
          : "bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)] border-[var(--color-border)]";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${cls}`}
      data-testid={`session-status-${status}`}
    >
      {meta.label}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const SessionsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Active proxy sessions mediating HTTP traffic with injected credentials.
      </p>
      {mgr.sessions.length > 0 && (
        <button
          onClick={mgr.handleStopAll}
          className="sor-option-chip text-xs bg-error/30 hover:bg-error/50 text-error border-error/50"
        >
          <StopCircle size={12} />
          <span>Stop All</span>
        </button>
      )}
    </div>

    {mgr.sessions.length === 0 ? (
      <div className="text-center py-16 text-[var(--color-textMuted)]">
        <Activity size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No active proxy sessions</p>
        <p className="text-xs mt-1">
          A session is created for every HTTP/HTTPS connection tab — open
          a connection to see it here.
        </p>
      </div>
    ) : (
      <div className="sor-selection-list">
        {mgr.sessions.map((s) => (
          <div
            key={s.session_id}
            className="sor-selection-row p-4 cursor-default"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <Globe
                    size={14}
                    className="text-info flex-shrink-0"
                  />
                  <span className="text-[var(--color-text)] text-sm font-medium truncate">
                    {s.target_url}
                  </span>
                  <StatusBadge status={classifySession(s)} />
                </div>
                <div className="flex items-center space-x-4 text-xs text-[var(--color-textSecondary)]">
                  {s.username && (
                    <span className="flex items-center space-x-1">
                      <User size={10} />
                      <span>{s.username}</span>
                    </span>
                  )}
                  <span className="flex items-center space-x-1">
                    <Clock size={10} />
                    <span>Started {formatDateTime(s.created_at)}</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <ArrowUpDown size={10} />
                    <span>
                      {s.request_count} req
                      {s.request_count !== 1 ? "s" : ""}
                    </span>
                  </span>
                  {s.error_count > 0 && (
                    <span className="flex items-center space-x-1 text-error">
                      <AlertCircle size={10} />
                      <span>
                        {s.error_count} error
                        {s.error_count !== 1 ? "s" : ""}
                      </span>
                    </span>
                  )}
                </div>
                {s.last_error && (
                  <div className="mt-2 px-2 py-1 bg-error/20 border border-error/30 rounded text-xs text-error truncate">
                    Last error: {s.last_error}
                  </div>
                )}
              </div>
              <button
                onClick={() => mgr.handleStopSession(s.session_id)}
                className="ml-3 p-1.5 hover:bg-error/30 rounded-lg text-[var(--color-textMuted)] hover:text-error transition-colors"
                title="Stop session"
              >
                <StopCircle size={14} />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-[var(--color-textMuted)] font-mono truncate">
              ID: {s.session_id}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const LogsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Last {mgr.requestLog.length} proxied requests (newest first).
      </p>
      {mgr.requestLog.length > 0 && (
        <button
          onClick={mgr.handleClearLog}
          className="sor-option-chip text-xs"
        >
          <Trash2 size={12} />
          <span>Clear Log</span>
        </button>
      )}
    </div>

    {mgr.requestLog.length === 0 ? (
      <div className="text-center py-16 text-[var(--color-textMuted)]">
        <ScrollText size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No requests logged yet</p>
        <p className="text-xs mt-1">
          Requests will appear here as they are proxied.
        </p>
      </div>
    ) : (
      <div className="sor-surface-card overflow-hidden">
        <table className="sor-data-table w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-textSecondary)]">
              <th className="text-left px-3 py-2 w-16">Time</th>
              <th className="text-left px-3 py-2 w-16">Method</th>
              <th className="text-left px-3 py-2">URL</th>
              <th className="text-left px-3 py-2 w-16">Status</th>
              <th className="text-left px-3 py-2 w-32">Error</th>
            </tr>
          </thead>
          <tbody>
            {[...mgr.requestLog].reverse().map((entry, i) => (
              <tr
                key={i}
                className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surfaceHover)]/50"
              >
                <td className="px-3 py-1.5 text-[var(--color-textMuted)] font-mono whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </td>
                <td
                  className={`px-3 py-1.5 font-mono font-medium ${getMethodColor(entry.method)}`}
                >
                  {entry.method}
                </td>
                <td
                  className="px-3 py-1.5 text-[var(--color-textSecondary)] truncate max-w-sm"
                  title={entry.url}
                >
                  {entry.url}
                </td>
                <td
                  className={`px-3 py-1.5 font-mono font-medium ${getStatusColor(entry.status)}`}
                >
                  {entry.status}
                </td>
                <td
                  className="px-3 py-1.5 text-error truncate max-w-[8rem]"
                  title={entry.error || ""}
                >
                  {entry.error || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const StatsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    {/* Summary cards */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="sor-surface-card p-4 text-center">
        <Activity size={20} className="mx-auto mb-2 text-info" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.sessions.length}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Active Sessions
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <ArrowUpDown size={20} className="mx-auto mb-2 text-primary" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.totalRequests}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Total Requests
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <ServerCrash size={20} className="mx-auto mb-2 text-error" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.totalErrors}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Total Errors
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <CheckCircle2 size={20} className="mx-auto mb-2 text-success" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.errorRate}%
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">Error Rate</p>
      </div>
    </div>

    {/* Per-session breakdown */}
    {mgr.sessions.length > 0 && (
      <div>
        <h3 className="text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Per-Session Breakdown
        </h3>
        <div className="sor-surface-card overflow-hidden">
          <table className="sor-data-table w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-textSecondary)]">
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2 w-20">Requests</th>
                <th className="text-left px-3 py-2 w-20">Errors</th>
                <th className="text-left px-3 py-2 w-24">Error Rate</th>
                <th className="text-left px-3 py-2 w-32">Started</th>
              </tr>
            </thead>
            <tbody>
              {mgr.sessions.map((s) => {
                const rate =
                  s.request_count > 0
                    ? ((s.error_count / s.request_count) * 100).toFixed(1)
                    : "0.0";
                return (
                  <tr
                    key={s.session_id}
                    className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surfaceHover)]/50"
                  >
                    <td
                      className="px-3 py-1.5 text-[var(--color-textSecondary)] truncate max-w-sm"
                      title={s.target_url}
                    >
                      {s.target_url}
                    </td>
                    <td className="px-3 py-1.5 text-primary font-mono">
                      {s.request_count}
                    </td>
                    <td className="px-3 py-1.5 text-error font-mono">
                      {s.error_count}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${parseFloat(rate) > 10 ? "bg-error" : parseFloat(rate) > 0 ? "bg-warning" : "bg-success"}`}
                            style={{
                              width: `${Math.min(parseFloat(rate), 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-[var(--color-textSecondary)] text-[10px] w-10 text-right">
                          {rate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textMuted)] whitespace-nowrap">
                      {formatDateTime(s.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {/* Info panel */}
    <div className="bg-[var(--color-surface)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        About the Internal Proxy
      </h3>
      <div className="text-xs text-[var(--color-textSecondary)] space-y-1.5">
        <p>
          Each HTTP/HTTPS connection tab opens a per-session mediator on a
          random loopback port (<code className="text-info">127.0.0.1:&lt;port&gt;</code>).
          The iframe loads from that port and the proxy forwards every
          request to the upstream target — injecting Basic Auth credentials
          when configured.
        </p>
        <p>
          Upstream failures (connection refused, DNS lookup failure, TLS
          handshake error, timeout, 5xx) return themed HTML pages styled to
          match the app, not browser-native error chrome.
        </p>
        <p>
          When the upstream returns <code className="text-info">401 Unauthorized</code>
          {' '}with a Basic challenge, the proxy strips the
          {' '}<code className="text-info">WWW-Authenticate</code> header
          (suppressing the browser-native popup) and serves a themed inline
          login form instead. Submitted credentials update the session and
          can be saved to the underlying connection.
        </p>
        <p>
          Sessions are created when the connection tab opens — including
          when no Basic Auth is configured — and are cleaned up when the
          tab closes. Sessions appear here whether or not the upstream is
          reachable.
        </p>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Tab bar                                                            */
/* ------------------------------------------------------------------ */

const tabs: { id: ManagerTab; label: string; icon: React.ElementType; countKey?: 'sessions' | 'logs' }[] = [
  { id: "sessions", label: "Sessions", icon: Activity, countKey: "sessions" },
  { id: "logs", label: "Request Log", icon: ScrollText, countKey: "logs" },
  { id: "stats", label: "Statistics", icon: BarChart3 },
];

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const InternalProxyManager: React.FC<InternalProxyManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useInternalProxyManager(isOpen);

  if (!isOpen) return null;

  return (
    <div className="h-full flex bg-[var(--color-surface)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
        <div className="p-3 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = mgr.activeTab === tab.id;
            const count = tab.countKey === 'sessions' ? mgr.sessions.length
              : tab.countKey === 'logs' ? mgr.requestLog.length
              : undefined;
            return (
              <button
                key={tab.id}
                onClick={() => mgr.setActiveTab(tab.id)}
                className={`sor-sidebar-tab w-full flex items-center gap-2 ${active ? "sor-sidebar-tab-active" : ""}`}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{tab.label}</span>
                {count !== undefined && count > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none bg-[var(--color-border)]">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-auto p-3 border-t border-[var(--color-border)] space-y-2">
          <div className="text-[10px] text-[var(--color-textMuted)]">
            {mgr.sessions.length} session{mgr.sessions.length !== 1 ? 's' : ''} &middot; {mgr.totalRequests} proxied
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-textSecondary)] cursor-pointer">
            <Checkbox checked={mgr.autoRefresh} onChange={(v: boolean) => mgr.setAutoRefresh(v)} />
            <span>Auto-refresh</span>
          </label>
          <button onClick={mgr.handleRefresh} className={`sor-btn sor-btn-secondary sor-btn-xs w-full ${mgr.isLoading ? 'animate-spin' : ''}`}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ErrorBanner error={mgr.error} onClear={() => mgr.setError("")} />
        <div className="flex-1 overflow-y-auto p-4">
          {mgr.activeTab === "sessions" && <SessionsTab mgr={mgr} />}
          {mgr.activeTab === "logs" && <LogsTab mgr={mgr} />}
          {mgr.activeTab === "stats" && <StatsTab mgr={mgr} />}
        </div>
      </div>
    </div>
  );
};
