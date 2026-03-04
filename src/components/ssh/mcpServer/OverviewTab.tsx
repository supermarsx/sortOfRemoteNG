import React from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  Activity,
  Clock,
  Users,
  Wrench,
  Database,
  MessageSquare,
  Zap,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import type { McpTabProps } from "./types";

export const OverviewTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const { status, metrics, isStarting, isStopping, config } = mgr;

  const formatUptime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-4" data-testid="mcp-overview-tab">
      {/* Server control */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              status?.running
                ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                : "bg-gray-500"
            }`}
          />
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {status?.running
                ? t("mcpServer.status.running", "MCP Server Running")
                : t("mcpServer.status.stopped", "MCP Server Stopped")}
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {status?.running && status.listen_address
                ? `${status.listen_address} · ${t("mcpServer.protocol", "MCP")} ${status.protocol_version}`
                : !config.enabled
                  ? t("mcpServer.status.disabled", "Disabled in settings")
                  : t("mcpServer.status.ready", "Ready to start")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status?.running ? (
            <button
              onClick={mgr.stopServer}
              disabled={isStopping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
              data-testid="mcp-stop-btn"
            >
              {isStopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              {t("mcpServer.actions.stop", "Stop")}
            </button>
          ) : (
            <button
              onClick={mgr.startServer}
              disabled={isStarting || !config.enabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
              data-testid="mcp-start-btn"
            >
              {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {t("mcpServer.actions.start", "Start")}
            </button>
          )}
        </div>
      </div>

      {/* Last error */}
      {status?.last_error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{status.last_error}</span>
        </div>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Clock size={16} />}
          label={t("mcpServer.metrics.uptime", "Uptime")}
          value={status?.running ? formatUptime(status.uptime_secs) : "—"}
          color="blue"
        />
        <StatCard
          icon={<Users size={16} />}
          label={t("mcpServer.metrics.sessions", "Sessions")}
          value={status?.active_sessions?.toString() ?? "0"}
          color="purple"
        />
        <StatCard
          icon={<Zap size={16} />}
          label={t("mcpServer.metrics.totalRequests", "Requests")}
          value={status?.total_requests?.toString() ?? "0"}
          color="amber"
        />
        <StatCard
          icon={<Wrench size={16} />}
          label={t("mcpServer.metrics.toolCalls", "Tool Calls")}
          value={status?.total_tool_calls?.toString() ?? "0"}
          color="green"
        />
      </div>

      {/* Extended metrics */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Database size={16} />}
            label={t("mcpServer.metrics.resourceReads", "Resource Reads")}
            value={metrics.total_resource_reads.toString()}
            color="teal"
          />
          <StatCard
            icon={<AlertTriangle size={16} />}
            label={t("mcpServer.metrics.errors", "Errors")}
            value={metrics.errors.toString()}
            color="red"
          />
          <StatCard
            icon={<Activity size={16} />}
            label={t("mcpServer.metrics.avgResponse", "Avg Response")}
            value={metrics.avg_response_ms > 0 ? `${metrics.avg_response_ms.toFixed(1)}ms` : "—"}
            color="indigo"
          />
          <StatCard
            icon={<MessageSquare size={16} />}
            label={t("mcpServer.metrics.peakSessions", "Peak Sessions")}
            value={metrics.peak_sessions.toString()}
            color="orange"
          />
        </div>
      )}

      {/* Capabilities summary */}
      <div className="p-4 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
          {t("mcpServer.capabilities", "Capabilities")}
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-[var(--color-accent)]">{mgr.tools?.length ?? 0}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {t("mcpServer.tools", "Tools")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--color-accent)]">{mgr.resources?.length ?? 0}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {t("mcpServer.resources", "Resources")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--color-accent)]">{mgr.prompts?.length ?? 0}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {t("mcpServer.prompts", "Prompts")}
            </div>
          </div>
        </div>
      </div>

      {/* Connection instructions */}
      {status?.running && (
        <div className="p-4 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-2 uppercase tracking-wide">
            {t("mcpServer.connectionInfo", "Connection Info")}
          </h3>
          <div className="space-y-2 text-xs text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-2">
              <CheckCircle size={12} className="text-green-500" />
              <span>{t("mcpServer.transport", "Transport")}: Streamable HTTP</span>
            </div>
            <div className="flex justify-between items-center bg-[var(--color-surface)] rounded px-3 py-2 font-mono">
              <span>http://{status.listen_address}/mcp</span>
            </div>
            {config.require_auth && (
              <div className="text-amber-400 text-[10px]">
                {t("mcpServer.authRequired", "Authentication required — include API key as Bearer token")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Stat card helper ────────────────────────────────────────────────

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}> = ({ icon, label, value, color }) => (
  <div className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
    <div className={`flex items-center gap-2 mb-1.5 text-${color}-400`}>
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </span>
    </div>
    <div className="text-lg font-bold text-[var(--color-text-primary)]">{value}</div>
  </div>
);
