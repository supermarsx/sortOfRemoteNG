import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Key,
  Eye,
  EyeOff,
  Shield,
  Globe,
  Clock,
  Loader2,
  Copy,
  Check,
  Server,
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
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpServerConfig, McpLogLevel } from "../../../types/mcp/mcpServer";
import { MCP_LOG_LEVELS } from "../../../types/mcp/mcpServer";
import { Checkbox, NumberInput, Select, TextInput } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

export const ConfigTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const draft = mgr.config;

  const handleGenerateKey = async () => {
    const key = await mgr.generateApiKey();
    if (key) {
      setShowApiKey(true);
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(draft.api_key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
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

  return (
    <div className="space-y-6" data-testid="mcp-config-tab">
      {/* Enable MCP Server */}
      <div className="sor-settings-card">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox
            checked={draft.enabled}
            onChange={(v: boolean) => update("enabled", v)}
          />
          <Power className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
          <div>
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              {t("mcpServer.config.enabled", "Enable MCP Server")}
              <InfoTooltip text="Allow AI assistants to connect to this application via the Model Context Protocol." />
            </span>
            <p className="text-xs text-[var(--color-textMuted)]">
              {t(
                "mcpServer.config.enabledDesc",
                "Allow AI assistants to connect to this application via MCP",
              )}
            </p>
          </div>
        </label>
      </div>

      {/* Auto-start on Launch */}
      {draft.enabled && (
        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={draft.auto_start}
              onChange={(v: boolean) => update("auto_start", v)}
            />
            <Clock className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.autoStart", "Auto-start on launch")}
                <InfoTooltip text="Start the MCP server automatically when the application opens, without manual activation." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.autoStartDesc",
                  "Start the MCP server automatically when the app opens",
                )}
              </p>
            </div>
          </label>
        </div>
      )}

      {draft.enabled && (
        <>
          {/* Server Controls */}
          <div className="sor-settings-card">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                {t("mcpServer.config.serverControls", "Server Controls")}
              </h4>
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                  isRunning
                    ? "bg-success/20 text-success"
                    : isBusy
                      ? "bg-warning/20 text-warning"
                      : "bg-[var(--color-surfaceHover)]/50 text-[var(--color-textSecondary)]"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    isRunning
                      ? "bg-success"
                      : isBusy
                        ? "bg-warning animate-pulse"
                        : "bg-[var(--color-secondary)]"
                  }`}
                />
                {isRunning
                  ? "Running"
                  : mgr.isStarting
                    ? "Starting..."
                    : mgr.isStopping
                      ? "Stopping..."
                      : "Stopped"}
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
          </div>

          {/* General (Network) */}
          <div className="space-y-4">
            <h4 className="sor-section-heading">
              <Globe className="w-4 h-4 text-primary" />
              {t("mcpServer.config.general", "General")}
            </h4>

            <div className="sor-settings-card">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Globe className="w-4 h-4" />
                    {t("mcpServer.config.host", "Host")}
                    <InfoTooltip text="Network interface the MCP server binds to. Use 127.0.0.1 for localhost only or 0.0.0.0 to listen on all interfaces." />
                  </label>
                  <TextInput
                    value={draft.host}
                    onChange={(v) => update("host", v)}
                    placeholder="127.0.0.1"
                    variant="settings"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Server className="w-4 h-4" />
                    {t("mcpServer.config.port", "Port")}
                    <InfoTooltip text="TCP port number the MCP server listens on. Choose a port not used by other services." />
                  </label>
                  <NumberInput
                    value={draft.port}
                    onChange={(v: number) => update("port", v)}
                    min={1024}
                    max={65535}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>

      {/* Security */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Shield className="w-4 h-4 text-success" />
          {t("mcpServer.config.security", "Security")}
        </h4>

        <div className="sor-settings-card space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={draft.require_auth}
              onChange={(v: boolean) => update("require_auth", v)}
            />
            <Key className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.requireAuth", "Require authentication")}
                <InfoTooltip text="Require an API key (Bearer token) for all incoming MCP requests. Strongly recommended when remote connections are allowed." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.requireAuthDesc",
                  "Require API key for all requests",
                )}
              </p>
            </div>
          </label>

          {draft.require_auth && (
            <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Key className="w-4 h-4" />
                {t("mcpServer.config.apiKey", "API Key")}
                <InfoTooltip text="Secret key clients must include as a Bearer token to authenticate MCP requests." />
              </label>
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-1 sor-settings-input min-w-0 px-2">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={draft.api_key}
                    readOnly
                    className="min-w-0 flex-1 bg-transparent border-0 p-0 text-sm font-mono text-[var(--color-text)] outline-none"
                    data-testid="mcp-api-key-input"
                    placeholder={t(
                      "mcpServer.config.noApiKey",
                      "No API key generated",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    aria-label={
                      showApiKey
                        ? t("mcpServer.config.hideKey", "Hide key")
                        : t("mcpServer.config.showKey", "Show key")
                    }
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                  {draft.api_key && (
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      aria-label={t("mcpServer.config.copyKey", "Copy key")}
                    >
                      {copiedKey ? (
                        <Check className="w-4 h-4 text-success" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  disabled={mgr.isGeneratingKey}
                  className="shrink-0 px-3 py-2 bg-primary border border-primary rounded-md text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50"
                  data-testid="mcp-generate-key-btn"
                  title={t("mcpServer.config.generateKey", "Generate New Key")}
                  aria-label={t("mcpServer.config.generateKey", "Generate")}
                >
                  {mgr.isGeneratingKey ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.apiKeyDescription",
                  "Include this key as a Bearer token in the Authorization header",
                )}
              </p>
            </div>
          )}

          <label className="flex items-center space-x-3 cursor-pointer group pt-2 border-t border-[var(--color-border)]">
            <Checkbox
              checked={draft.allow_remote}
              onChange={(v: boolean) => update("allow_remote", v)}
            />
            <Globe className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.allowRemote", "Allow remote connections")}
                <InfoTooltip text="Listen on non-localhost addresses. Exposes the API to other machines on your network — ensure authentication is enabled." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.allowRemoteDesc",
                  "Allow connections from non-localhost addresses (security risk)",
                )}
              </p>
            </div>
          </label>

          {draft.allow_remote && (
            <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {t(
                  "mcpServer.config.remoteWarning",
                  "Warning: This exposes the MCP server to your network. Ensure authentication is enabled.",
                )}
              </span>
            </div>
          )}

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={draft.expose_sensitive_data}
              onChange={(v: boolean) => update("expose_sensitive_data", v)}
            />
            <AlertTriangle className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-error" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.exposeSensitive", "Expose sensitive data")}
                <InfoTooltip text="Include passwords, tokens, and other secrets in resource responses. Only enable if you trust connecting clients." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.exposeSensitiveDesc",
                  "Include passwords and secrets in resource responses",
                )}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Sessions & Limits */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Cpu className="w-4 h-4 text-info" />
          {t("mcpServer.config.limits", "Sessions & Limits")}
        </h4>

        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Cpu className="w-4 h-4" />
                {t("mcpServer.config.maxSessions", "Max concurrent sessions")}
                <InfoTooltip text="Maximum number of MCP client sessions that can be active simultaneously." />
              </label>
              <NumberInput
                value={draft.max_sessions}
                onChange={(v: number) => update("max_sessions", v)}
                min={1}
                max={100}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                {t(
                  "mcpServer.config.sessionTimeout",
                  "Session timeout (seconds)",
                )}
                <InfoTooltip text="Idle MCP sessions are disconnected after this many seconds without activity." />
              </label>
              <NumberInput
                value={draft.session_timeout_secs}
                onChange={(v: number) => update("session_timeout_secs", v)}
                min={60}
                max={86400}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                {t("mcpServer.config.rateLimit", "Rate limit (req/min)")}
                <InfoTooltip text="Maximum number of requests per minute per session. Set high to effectively disable rate limiting." />
              </label>
              <NumberInput
                value={draft.rate_limit_per_minute}
                onChange={(v: number) => update("rate_limit_per_minute", v)}
                min={1}
                max={10000}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <FileText className="w-4 h-4" />
                {t("mcpServer.config.logLevel", "Log level")}
                <InfoTooltip text="Verbosity of MCP server log output." />
              </label>
              <Select
                value={draft.log_level}
                onChange={(v: string) => update("log_level", v as McpLogLevel)}
                variant="settings"
                className="w-full"
                options={MCP_LOG_LEVELS.map((l) => ({ value: l, label: l }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CORS / Transport */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <RefreshCw className="w-4 h-4 text-primary" />
          {t("mcpServer.config.cors", "CORS")}
        </h4>

        <div className="sor-settings-card space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={draft.cors_enabled}
              onChange={(v: boolean) => update("cors_enabled", v)}
            />
            <Globe className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.corsEnabled", "Enable CORS")}
                <InfoTooltip text="Allow cross-origin requests to the MCP server from web-based clients." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.corsDesc",
                  "Allow cross-origin browser requests",
                )}
              </p>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox
              checked={draft.sse_enabled}
              onChange={(v: boolean) => update("sse_enabled", v)}
            />
            <RefreshCw className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
                {t("mcpServer.config.sseEnabled", "Enable SSE")}
                <InfoTooltip text="Enable Server-Sent Events for real-time notifications to MCP clients." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "mcpServer.config.sseDesc",
                  "Enable Server-Sent Events for real-time notifications",
                )}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Server Instructions */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <FileText className="w-4 h-4 text-info" />
          {t("mcpServer.config.instructions", "Server Instructions")}
        </h4>

        <div className="sor-settings-card">
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
        </div>
      </div>

      {/* Tools */}
      <CapabilityListSection
        title={t("mcpServer.config.toolsTitle", "Tools")}
        icon={<Wrench className="w-4 h-4 text-success" />}
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
        icon={<MessageSquare className="w-4 h-4 text-warning" />}
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
        </>
      )}
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
      <h4 className="sor-section-heading">
        {icon}
        {title}
        <span className="ml-auto text-xs font-normal text-[var(--color-textMuted)]">
          {enabledCount}/{items.length}
        </span>
      </h4>

      <div className="sor-settings-card space-y-3">
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
      </div>
    </div>
  );
};

export default ConfigTab;
