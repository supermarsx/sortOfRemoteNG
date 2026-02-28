import React from "react";
import {
  X,
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
  XCircle,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import {
  useInternalProxyManager,
  formatTime,
  formatDateTime,
  getStatusColor,
  getMethodColor,
  ManagerTab,
} from "../hooks/useInternalProxyManager";

type Mgr = ReturnType<typeof useInternalProxyManager>;

interface InternalProxyManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const ManagerHeader: React.FC<{ mgr: Mgr; onClose: () => void }> = ({
  mgr,
  onClose,
}) => (
  <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
    <div className="flex items-center space-x-3">
      <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center">
        <ArrowUpDown size={16} className="text-cyan-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Internal Proxy Manager
        </h2>
        <p className="text-xs text-gray-500">
          {mgr.sessions.length} active session
          {mgr.sessions.length !== 1 ? "s" : ""} &middot; {mgr.totalRequests}{" "}
          request{mgr.totalRequests !== 1 ? "s" : ""} proxied
        </p>
      </div>
    </div>
    <div className="flex items-center space-x-2">
      <label className="flex items-center space-x-1.5 text-xs text-[var(--color-textSecondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={mgr.autoRefresh}
          onChange={(e) => mgr.setAutoRefresh(e.target.checked)}
          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-cyan-600 w-3.5 h-3.5"
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

const ErrorBanner: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.error) return null;
  return (
    <div className="mx-5 mt-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <AlertCircle size={14} />
        <span>{mgr.error}</span>
      </div>
      <button onClick={() => mgr.setError("")} className="hover:text-red-300">
        <XCircle size={14} />
      </button>
    </div>
  );
};

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const tabs: { id: ManagerTab; label: string; icon: React.ElementType }[] = [
    { id: "sessions", label: "Sessions", icon: Activity },
    { id: "logs", label: "Request Log", icon: ScrollText },
    { id: "stats", label: "Statistics", icon: BarChart3 },
  ];

  return (
    <div className="px-5 pt-3 flex space-x-1 border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => mgr.setActiveTab(tab.id)}
            className={`sor-tab-trigger ${
              mgr.activeTab === tab.id
                ? "sor-tab-trigger-active border-cyan-500"
                : ""
            }`}
          >
            <Icon size={14} />
            <span>{tab.label}</span>
            {tab.id === "logs" && mgr.requestLog.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-[var(--color-border)] rounded text-xs text-[var(--color-textSecondary)]">
                {mgr.requestLog.length}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

const SessionsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Active proxy sessions mediating HTTP traffic with injected credentials.
      </p>
      {mgr.sessions.length > 0 && (
        <button
          onClick={mgr.handleStopAll}
          className="sor-option-chip text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border-red-900/50"
        >
          <StopCircle size={12} />
          <span>Stop All</span>
        </button>
      )}
    </div>

    {mgr.sessions.length === 0 ? (
      <div className="text-center py-16 text-gray-500">
        <Activity size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No active proxy sessions</p>
        <p className="text-xs mt-1">
          Sessions are created when you open HTTP/HTTPS connections with
          authentication.
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
                    className="text-cyan-400 flex-shrink-0"
                  />
                  <span className="text-[var(--color-text)] text-sm font-medium truncate">
                    {s.target_url}
                  </span>
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
                    <span className="flex items-center space-x-1 text-red-400">
                      <AlertCircle size={10} />
                      <span>
                        {s.error_count} error
                        {s.error_count !== 1 ? "s" : ""}
                      </span>
                    </span>
                  )}
                </div>
                {s.last_error && (
                  <div className="mt-2 px-2 py-1 bg-red-900/20 border border-red-900/30 rounded text-xs text-red-400 truncate">
                    Last error: {s.last_error}
                  </div>
                )}
              </div>
              <button
                onClick={() => mgr.handleStopSession(s.session_id)}
                className="ml-3 p-1.5 hover:bg-red-900/30 rounded-lg text-gray-500 hover:text-red-400 transition-colors"
                title="Stop session"
              >
                <StopCircle size={14} />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-gray-600 font-mono truncate">
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
      <div className="text-center py-16 text-gray-500">
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
                className="border-b border-[var(--color-border)]/50 hover:bg-gray-750/50"
              >
                <td className="px-3 py-1.5 text-gray-500 font-mono whitespace-nowrap">
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
                  className="px-3 py-1.5 text-red-400 truncate max-w-[8rem]"
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
    <div className="grid grid-cols-4 gap-3">
      <div className="sor-surface-card p-4 text-center">
        <Activity size={20} className="mx-auto mb-2 text-cyan-400" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.sessions.length}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Active Sessions
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <ArrowUpDown size={20} className="mx-auto mb-2 text-blue-400" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.totalRequests}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Total Requests
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <ServerCrash size={20} className="mx-auto mb-2 text-red-400" />
        <p className="text-2xl font-bold text-[var(--color-text)]">
          {mgr.totalErrors}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Total Errors
        </p>
      </div>
      <div className="sor-surface-card p-4 text-center">
        <CheckCircle2 size={20} className="mx-auto mb-2 text-green-400" />
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
                    className="border-b border-[var(--color-border)]/50 hover:bg-gray-750/50"
                  >
                    <td
                      className="px-3 py-1.5 text-[var(--color-textSecondary)] truncate max-w-sm"
                      title={s.target_url}
                    >
                      {s.target_url}
                    </td>
                    <td className="px-3 py-1.5 text-blue-400 font-mono">
                      {s.request_count}
                    </td>
                    <td className="px-3 py-1.5 text-red-400 font-mono">
                      {s.error_count}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${parseFloat(rate) > 10 ? "bg-red-500" : parseFloat(rate) > 0 ? "bg-yellow-500" : "bg-green-500"}`}
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
                    <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
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
          The internal proxy uses Tauri&apos;s custom URI scheme protocol (
          <code className="text-cyan-400">sortofremote-proxy://</code>) to
          mediate HTTP requests.
        </p>
        <p>
          All requests from HTTP/HTTPS connection viewers are intercepted and
          forwarded to the target server with injected credentials. No local TCP
          ports are opened — all traffic stays within the WebView process.
        </p>
        <p>
          Sessions are created automatically when you open a connection with
          Basic Authentication configured, and are cleaned up when the
          connection tab is closed.
        </p>
      </div>
    </div>
  </div>
);

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/60 backdrop-blur-sm p-4"
      panelClassName="max-w-4xl h-[90vh] rounded-xl border border-[var(--color-border)] overflow-hidden"
      contentClassName="bg-[var(--color-background)]"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        <ManagerHeader mgr={mgr} onClose={onClose} />
        <ErrorBanner mgr={mgr} />
        <TabBar mgr={mgr} />

        <div className="flex-1 overflow-auto p-5">
          {mgr.activeTab === "sessions" && <SessionsTab mgr={mgr} />}
          {mgr.activeTab === "logs" && <LogsTab mgr={mgr} />}
          {mgr.activeTab === "stats" && <StatsTab mgr={mgr} />}
        </div>
      </div>
    </Modal>
  );
};
