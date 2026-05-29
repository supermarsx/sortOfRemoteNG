import React from "react";
import { useTranslation } from "react-i18next";
import {
  Key,
  Shield,
  Globe,
  Clock,
  Loader2,
  AlertTriangle,
  Cpu,
  FileText,
  RefreshCw,
  Wrench,
  Database,
  MessageSquare,
  Settings,
  Power,
  Play,
  Square,
  RotateCcw,
  Gauge,
  Timer,
  Share2,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpServerConfig, McpLogLevel } from "../../../types/mcp/mcpServer";
import { MCP_LOG_LEVELS } from "../../../types/mcp/mcpServer";
import { Checkbox } from "../../ui/forms";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsTextRow,
  SettingsNumberRow,
  SettingsSelectRow,
} from "../../ui/settings/SettingsPrimitives";
import {
  SettingsApiKeyField,
  SettingsHostRow,
  SettingsPortRow,
  SettingsRemoteAccessRow,
} from "../../ui/settings/NetworkPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

export const ConfigTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const draft = mgr.config;

  const handleGenerateKey = async () => {
    await mgr.generateApiKey();
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(draft.api_key);
  };

  const update = <K extends keyof McpServerConfig>(
    key: K,
    value: McpServerConfig[K],
  ) => {
    void mgr.updateConfig({ ...mgr.config, [key]: value });
  };

  const handleStart = () => {
    void mgr.startServer();
  };
  const handleStop = () => {
    void mgr.stopServer();
  };
  const handleRestart = async () => {
    await mgr.stopServer();
    await mgr.startServer();
  };

  const isRunning = !!mgr.status?.running;
  const isBusy = mgr.isStarting || mgr.isStopping;

  const statusLabel = isRunning
    ? "Running"
    : mgr.isStarting
      ? "Starting…"
      : mgr.isStopping
        ? "Stopping…"
        : "Stopped";

  const statusBadgeClass = isRunning
    ? "bg-success/20 text-success"
    : isBusy
      ? "bg-warning/20 text-warning"
      : "bg-[var(--color-surfaceHover)]/50 text-[var(--color-textSecondary)]";

  const statusDotClass = isRunning
    ? "bg-success"
    : isBusy
      ? "bg-warning animate-pulse"
      : "bg-[var(--color-secondary)]";

  return (
    <div className="space-y-6" data-testid="mcp-config-tab">
      {/* Enable MCP Server */}
      <Card>
        <Toggle
          icon={<Power size={16} />}
          label={t("mcpServer.config.enabled", "Enable MCP server")}
          description={t(
            "mcpServer.config.enabledDesc",
            "Allow AI assistants to connect to this application via MCP",
          )}
          checked={draft.enabled}
          onChange={(v) => update("enabled", v)}
          infoTooltip="Allow AI assistants to connect to this application via the Model Context Protocol."
        />
        <Toggle
          icon={<Clock size={16} />}
          label={t("mcpServer.config.autoStart", "Start on application launch")}
          description={t(
            "mcpServer.config.autoStartDesc",
            "Automatically start the MCP server when the application opens",
          )}
          checked={draft.auto_start}
          onChange={(v) => update("auto_start", v)}
          infoTooltip="Automatically start the MCP server when the application opens, without manual activation."
        />
      </Card>

      {/* Server Controls */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Settings className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.serverControls", "Server Controls")}
        />
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-textSecondary)]">
              {t("mcpServer.config.serverStatus", "Server status")}
            </span>
            <div
              className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${statusBadgeClass}`}
            >
              <div className={`w-2 h-2 rounded-full ${statusDotClass}`} />
              {statusLabel}
              {isRunning && mgr.status?.listen_address && (
                <span className="text-[var(--color-textSecondary)]">
                  @{mgr.status.listen_address}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={isRunning || isBusy}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-success hover:bg-success/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
              data-testid="mcp-start-btn"
            >
              {mgr.isStarting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {t("mcpServer.actions.start", "Start")}
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={!isRunning || isBusy}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-error hover:bg-error/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
              data-testid="mcp-stop-btn"
            >
              {mgr.isStopping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              {t("mcpServer.actions.stop", "Stop")}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={!isRunning || isBusy}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-warning hover:bg-warning/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t("mcpServer.actions.restart", "Restart")}
            </button>
          </div>
        </Card>
      </div>

      {/* General (Network) */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.general", "General")}
        />
        <Card>
          <SettingsHostRow
            label={t("mcpServer.config.host", "Host")}
            value={draft.host}
            onChange={(v) => update("host", v)}
            warnOnPublicBind
            infoTooltip="Network interface the MCP server binds to. Use 127.0.0.1 for localhost only or 0.0.0.0 to listen on all interfaces."
          />
          <SettingsPortRow
            label={t("mcpServer.config.port", "Port")}
            value={draft.port}
            min={1024}
            max={65535}
            onChange={(v) => update("port", v)}
            infoTooltip="TCP port number the MCP server listens on. Choose a port not used by other services."
          />
        </Card>
      </div>

      {/* Security */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.security", "Security")}
        />
        <Card>
          <Toggle
            icon={<Key size={16} />}
            label={t("mcpServer.config.requireAuth", "Require authentication")}
            description={t(
              "mcpServer.config.requireAuthDesc",
              "Require API key for all requests",
            )}
            checked={draft.require_auth}
            onChange={(v) => update("require_auth", v)}
            infoTooltip="Require an API key (Bearer token) for all incoming MCP requests. Strongly recommended when remote connections are allowed."
          />

          <SettingsApiKeyField
            label={t("mcpServer.config.apiKey", "API Key")}
            value={draft.api_key}
            onCopy={handleCopyKey}
            onRegenerate={handleGenerateKey}
            isRegenerating={mgr.isGeneratingKey}
            placeholder={t(
              "mcpServer.config.noApiKey",
              "No API key generated",
            )}
            description={t(
              "mcpServer.config.apiKeyDescription",
              "Include this key as a Bearer token in the Authorization header",
            )}
            infoTooltip="Secret key clients must include as a Bearer token to authenticate MCP requests."
            disabled={!draft.require_auth}
          />

          <SettingsRemoteAccessRow
            icon={<Globe size={16} />}
            checked={draft.allow_remote}
            onChange={(v) => update("allow_remote", v)}
            label={t("mcpServer.config.allowRemote", "Allow remote connections")}
            description={t(
              "mcpServer.config.allowRemoteDesc",
              "Allow connections from non-localhost addresses (security risk)",
            )}
            warningText={t(
              "mcpServer.config.remoteWarning",
              "Warning: This exposes the MCP server to your network. Ensure authentication is enabled.",
            )}
            infoTooltip="Listen on non-localhost addresses. Exposes the API to other machines on your network — ensure authentication is enabled."
          />

          <Toggle
            icon={<AlertTriangle size={16} />}
            label={t("mcpServer.config.exposeSensitive", "Expose sensitive data")}
            description={t(
              "mcpServer.config.exposeSensitiveDesc",
              "Include passwords and secrets in resource responses",
            )}
            checked={draft.expose_sensitive_data}
            onChange={(v) => update("expose_sensitive_data", v)}
            infoTooltip="Include passwords, tokens, and other secrets in resource responses. Only enable if you trust connecting clients."
          />
        </Card>
      </div>

      {/* Sessions & Limits */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Cpu className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.limits", "Sessions & Limits")}
        />
        <Card>
          <SettingsNumberRow
            icon={<Cpu size={16} />}
            label={t("mcpServer.config.maxSessions", "Max concurrent sessions")}
            value={draft.max_sessions}
            min={1}
            max={100}
            onChange={(v) => update("max_sessions", v)}
            infoTooltip="Maximum number of MCP client sessions that can be active simultaneously."
          />
          <SettingsNumberRow
            icon={<Timer size={16} />}
            label={t("mcpServer.config.sessionTimeout", "Session timeout")}
            value={draft.session_timeout_secs}
            min={60}
            max={86400}
            unit="s"
            onChange={(v) => update("session_timeout_secs", v)}
            infoTooltip="Idle MCP sessions are disconnected after this many seconds without activity."
          />
          <SettingsNumberRow
            icon={<Gauge size={16} />}
            label={t("mcpServer.config.rateLimit", "Rate limit")}
            value={draft.rate_limit_per_minute}
            min={1}
            max={10000}
            unit="req/min"
            onChange={(v) => update("rate_limit_per_minute", v)}
            infoTooltip="Maximum number of requests per minute per session. Set high to effectively disable rate limiting."
          />
          <SettingsSelectRow
            icon={<FileText size={16} />}
            label={t("mcpServer.config.logLevel", "Log level")}
            value={draft.log_level}
            options={MCP_LOG_LEVELS.map((l) => ({ value: l, label: l }))}
            onChange={(v) => update("log_level", v as McpLogLevel)}
            infoTooltip="Verbosity of MCP server log output."
          />
        </Card>
      </div>

      {/* CORS / Transport */}
      <div className="space-y-4">
        <SectionHeader
          icon={<RefreshCw className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.cors", "CORS")}
        />
        <Card>
          <Toggle
            icon={<Globe size={16} />}
            label={t("mcpServer.config.corsEnabled", "Enable CORS")}
            description={t(
              "mcpServer.config.corsDesc",
              "Allow cross-origin browser requests",
            )}
            checked={draft.cors_enabled}
            onChange={(v) => update("cors_enabled", v)}
            infoTooltip="Allow cross-origin requests to the MCP server from web-based clients."
          />

          <Toggle
            icon={<Share2 size={16} />}
            label={t("mcpServer.config.sseEnabled", "Enable SSE")}
            description={t(
              "mcpServer.config.sseDesc",
              "Enable Server-Sent Events for real-time notifications",
            )}
            checked={draft.sse_enabled}
            onChange={(v) => update("sse_enabled", v)}
            infoTooltip="Enable Server-Sent Events for real-time notifications to MCP clients."
          />
        </Card>
      </div>

      {/* Server Instructions */}
      <div className="space-y-4">
        <SectionHeader
          icon={<FileText className="w-4 h-4 text-primary" />}
          title={t("mcpServer.config.instructions", "Server Instructions")}
        />
        <Card>
          <div className="space-y-2 w-full">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <FileText className="w-4 h-4" />
              {t("mcpServer.config.instructionsLabel", "Instructions to clients")}
              <InfoTooltip text="Free-form text sent to AI clients during initialization, describing what this server provides and how to use it." />
            </label>
            <textarea
              value={draft.server_instructions}
              onChange={(e) => update("server_instructions", e.target.value)}
              className="sor-settings-input w-full h-40 resize-y font-mono text-sm leading-relaxed"
              placeholder={t(
                "mcpServer.config.instructionsPlaceholder",
                "Instructions sent to AI clients describing this server...",
              )}
              data-testid="mcp-instructions-input"
            />
            <p className="text-xs text-[var(--color-textMuted)]">
              {t(
                "mcpServer.config.instructionsDescription",
                "Sent to AI clients on connection to describe this server's capabilities",
              )}
            </p>
          </div>
        </Card>
      </div>

      {/* Tools */}
      <CapabilityListSection
        title={t("mcpServer.config.toolsTitle", "Tools")}
        icon={<Wrench className="w-4 h-4 text-primary" />}
        infoText="Choose which MCP tools are exposed to AI clients. When all are enabled, the server exposes its full toolset by default."
        items={(mgr.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
        }))}
        enabled={draft.enabled_tools}
        onChange={(next) => update("enabled_tools", next)}
        emptyText={t("mcpServer.config.toolsEmpty", "No tools registered")}
        allLabel={t("mcpServer.config.toolsAll", "Expose all tools (default)")}
      />

      {/* Resources */}
      <CapabilityListSection
        title={t("mcpServer.config.resourcesTitle", "Resources")}
        icon={<Database className="w-4 h-4 text-primary" />}
        infoText="Choose which MCP resources (data sources) are exposed to AI clients."
        items={(mgr.resources ?? []).map((res) => ({
          name: res.uri,
          description: res.name + (res.description ? ` — ${res.description}` : ""),
        }))}
        enabled={draft.enabled_resources}
        onChange={(next) => update("enabled_resources", next)}
        emptyText={t(
          "mcpServer.config.resourcesEmpty",
          "No resources registered",
        )}
        allLabel={t(
          "mcpServer.config.resourcesAll",
          "Expose all resources (default)",
        )}
      />

      {/* Prompts */}
      <CapabilityListSection
        title={t("mcpServer.config.promptsTitle", "Prompts")}
        icon={<MessageSquare className="w-4 h-4 text-primary" />}
        infoText="Choose which MCP prompts (templates) are exposed to AI clients."
        items={(mgr.prompts ?? []).map((p) => ({
          name: p.name,
          description: p.description,
        }))}
        enabled={draft.enabled_prompts}
        onChange={(next) => update("enabled_prompts", next)}
        emptyText={t("mcpServer.config.promptsEmpty", "No prompts registered")}
        allLabel={t(
          "mcpServer.config.promptsAll",
          "Expose all prompts (default)",
        )}
      />
    </div>
  );
};

interface CapabilityItem {
  name: string;
  description?: string;
}

const CapabilityListSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  infoText: string;
  items: CapabilityItem[];
  enabled: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  allLabel: string;
}> = ({ title, icon, infoText, items, enabled, onChange, emptyText, allLabel }) => {
  const allEnabled = enabled.length === 0;
  const isItemEnabled = (name: string) => allEnabled || enabled.includes(name);
  const enabledCount = allEnabled ? items.length : enabled.length;

  const toggleItem = (name: string, checked: boolean) => {
    const baseline = allEnabled ? items.map((i) => i.name) : enabled;
    let next = checked
      ? Array.from(new Set([...baseline, name]))
      : baseline.filter((n) => n !== name);
    if (items.length > 0 && next.length === items.length) {
      next = [];
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={icon}
        title={
          <span className="flex items-center gap-2">
            {title}
            <span className="text-xs font-normal text-[var(--color-textMuted)]">
              {enabledCount}/{items.length}
            </span>
          </span>
        }
      />

      <Card>
        <div className="flex items-center justify-between text-xs text-[var(--color-textMuted)]">
          <span className="flex items-center gap-1">
            {allEnabled
              ? allLabel
              : `${enabledCount} of ${items.length} ${title.toLowerCase()} exposed`}
            <InfoTooltip text={infoText} />
          </span>
          {!allEnabled && items.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[var(--color-textSecondary)] hover:text-primary text-xs"
            >
              Enable all
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-[var(--color-textMuted)] italic">
            {emptyText}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pt-1 border-t border-[var(--color-border)]">
            {items.map((item) => (
              <label
                key={item.name}
                className="flex items-start space-x-3 cursor-pointer group py-1"
              >
                <Checkbox
                  checked={isItemEnabled(item.name)}
                  onChange={(v: boolean) => toggleItem(item.name, v)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-[var(--color-text)] truncate">
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="text-[10px] text-[var(--color-textMuted)] truncate">
                      {item.description}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ConfigTab;
