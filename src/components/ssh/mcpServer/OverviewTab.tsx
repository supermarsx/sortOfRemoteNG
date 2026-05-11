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
  Settings,
  Layers,
} from "lucide-react";
import type { McpTabProps } from "./types";

export const OverviewTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const { status, metrics, isStarting, isStopping, config } = mgr;

  const safeNumber = (value: unknown, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  const numberText = (value: unknown): string => safeNumber(value).toString();

  const formatUptime = (value: unknown) => {
    const secs = safeNumber(value);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const avgResponseMs = safeNumber(metrics?.avg_response_ms);

  return (
    <div className="space-y-6" data-testid="mcp-overview-tab">
      {/* Server Controls */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Settings className="w-4 h-4 text-primary" />
          {t("mcpServer.overview.serverControls", "Server Controls")}
        </h4>

        <div className="sor-settings-card">
          <div className="flex items-center gap-3 mb-3">
            <div
              className={`w-3 h-3 rounded-full ${
                status?.running
                  ? "bg-success shadow-[0_0_8px_rgb(var(--color-success-rgb)/0.5)]"
                  : "bg-[var(--color-textSecondary)]"
              }`}
            />
            <div>
              <div className="text-sm font-medium text-[var(--color-text)]">
                {status?.running
                  ? t("mcpServer.status.running", "MCP Server Running")
                  : t("mcpServer.status.stopped", "MCP Server Stopped")}
              </div>
              <div className="text-xs text-[var(--color-textSecondary)]">
                {status?.running && status.listen_address
                  ? `${status.listen_address} · ${t("mcpServer.protocol", "MCP")} ${status.protocol_version}`
                  : !config.enabled
                    ? t("mcpServer.status.disabled", "Disabled in settings")
                    : t("mcpServer.status.ready", "Ready to start")}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {status?.running ? (
              <button
                type="button"
                onClick={mgr.stopServer}
                disabled={isStopping}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-error hover:bg-error/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
                data-testid="mcp-stop-btn"
              >
                {isStopping ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {t("mcpServer.actions.stop", "Stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={mgr.startServer}
                disabled={isStarting || !config.enabled}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-success hover:bg-success/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
                data-testid="mcp-start-btn"
              >
                {isStarting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {t("mcpServer.actions.start", "Start")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Last error */}
      {status?.last_error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{status.last_error}</span>
        </div>
      )}

      {/* Metrics */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Activity className="w-4 h-4 text-info" />
          {t("mcpServer.overview.metrics", "Metrics")}
        </h4>

        <div className="sor-settings-card space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<Clock className="w-4 h-4" />}
              label={t("mcpServer.metrics.uptime", "Uptime")}
              value={status?.running ? formatUptime(status.uptime_secs) : "-"}
              accent="text-info"
            />
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label={t("mcpServer.metrics.sessions", "Sessions")}
              value={numberText(status?.active_sessions)}
              accent="text-primary"
            />
            <StatCard
              icon={<Zap className="w-4 h-4" />}
              label={t("mcpServer.metrics.totalRequests", "Requests")}
              value={numberText(status?.total_requests)}
              accent="text-warning"
            />
            <StatCard
              icon={<Wrench className="w-4 h-4" />}
              label={t("mcpServer.metrics.toolCalls", "Tool Calls")}
              value={numberText(status?.total_tool_calls)}
              accent="text-success"
            />
          </div>

          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-[var(--color-border)]">
              <StatCard
                icon={<Database className="w-4 h-4" />}
                label={t("mcpServer.metrics.resourceReads", "Resource Reads")}
                value={numberText(metrics.total_resource_reads)}
                accent="text-info"
              />
              <StatCard
                icon={<AlertTriangle className="w-4 h-4" />}
                label={t("mcpServer.metrics.errors", "Errors")}
                value={numberText(metrics.errors)}
                accent="text-error"
              />
              <StatCard
                icon={<Activity className="w-4 h-4" />}
                label={t("mcpServer.metrics.avgResponse", "Avg Response")}
                value={avgResponseMs > 0 ? `${avgResponseMs.toFixed(1)}ms` : "-"}
                accent="text-primary"
              />
              <StatCard
                icon={<MessageSquare className="w-4 h-4" />}
                label={t("mcpServer.metrics.peakSessions", "Peak Sessions")}
                value={numberText(metrics.peak_sessions)}
                accent="text-warning"
              />
            </div>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Layers className="w-4 h-4 text-success" />
          {t("mcpServer.overview.capabilities", "Capabilities")}
        </h4>

        <div className="sor-settings-card">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold text-primary drop-shadow-[0_0_6px_rgb(var(--color-primary-rgb)/0.4)]">
                {mgr.tools?.length ?? 0}
              </div>
              <div className="text-xs text-[var(--color-textSecondary)]">
                {t("mcpServer.overview.toolsAvailable", "Tools")}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary drop-shadow-[0_0_6px_rgb(var(--color-primary-rgb)/0.4)]">
                {mgr.resources?.length ?? 0}
              </div>
              <div className="text-xs text-[var(--color-textSecondary)]">
                {t("mcpServer.overview.resourcesAvailable", "Resources")}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary drop-shadow-[0_0_6px_rgb(var(--color-primary-rgb)/0.4)]">
                {mgr.prompts?.length ?? 0}
              </div>
              <div className="text-xs text-[var(--color-textSecondary)]">
                {t("mcpServer.overview.promptsAvailable", "Prompts")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection info */}
      {status?.running && (
        <div className="space-y-4">
          <h4 className="sor-section-heading">
            <CheckCircle className="w-4 h-4 text-success" />
            {t("mcpServer.connectionInfo", "Connection Info")}
          </h4>

          <div className="sor-settings-card">
            <div className="space-y-2 text-xs text-[var(--color-textSecondary)]">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-success" />
                <span>
                  {t("mcpServer.transport", "Transport")}: Streamable HTTP
                </span>
              </div>
              <div className="flex justify-between items-center bg-[var(--color-surface)] rounded px-3 py-2 font-mono">
                <span>http://{status.listen_address}/mcp</span>
              </div>
              {config.require_auth && (
                <div className="text-warning text-[10px]">
                  {t(
                    "mcpServer.authRequired",
                    "Authentication required - include API key as Bearer token",
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}> = ({ icon, label, value, accent }) => (
  <div className="p-3 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)]">
    <div className={`flex items-center gap-2 mb-1.5 ${accent}`}>
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-textSecondary)]">
        {label}
      </span>
    </div>
    <div className="text-lg font-bold text-[var(--color-text)]">{value}</div>
  </div>
);

export default OverviewTab;
