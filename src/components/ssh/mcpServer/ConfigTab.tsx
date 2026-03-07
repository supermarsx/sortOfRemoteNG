import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Save,
  RefreshCw,
  Key,
  Eye,
  EyeOff,
  Shield,
  Globe,
  Clock,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpServerConfig, McpLogLevel } from "../../../types/mcp/mcpServer";
import { MCP_LOG_LEVELS } from "../../../types/mcp/mcpServer";

export const ConfigTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<McpServerConfig>(mgr.config);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Sync draft when config updates externally
  useEffect(() => {
    setDraft(mgr.config);
  }, [mgr.config]);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(mgr.config);

  const handleSave = async () => {
    await mgr.updateConfig(draft);
  };

  const handleGenerateKey = async () => {
    const key = await mgr.generateApiKey();
    if (key) {
      setDraft((d) => ({ ...d, api_key: key }));
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
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <div className="space-y-4" data-testid="mcp-config-tab">
      {/* Save bar */}
      {hasChanges && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/30">
          <span className="text-xs text-warning">
            {t("mcpServer.config.unsavedChanges", "You have unsaved changes")}
          </span>
          <button
            onClick={handleSave}
            disabled={mgr.isSavingConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
            data-testid="mcp-config-save"
          >
            {mgr.isSavingConfig ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t("mcpServer.config.save", "Save")}
          </button>
        </div>
      )}

      {/* General settings */}
      <Section title={t("mcpServer.config.general", "General")} icon={<Globe size={14} />}>
        <Toggle
          label={t("mcpServer.config.enabled", "Enable MCP Server")}
          description={t("mcpServer.config.enabledDesc", "Allow AI assistants to connect to this application via MCP")}
          checked={draft.enabled}
          onChange={(v) => update("enabled", v)}
        />
        <Toggle
          label={t("mcpServer.config.autoStart", "Auto-start on launch")}
          description={t("mcpServer.config.autoStartDesc", "Start the MCP server automatically when the app opens")}
          checked={draft.auto_start}
          onChange={(v) => update("auto_start", v)}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label={t("mcpServer.config.host", "Host")}
            value={draft.host}
            onChange={(v) => update("host", v)}
            placeholder="127.0.0.1"
          />
          <NumberInput
            label={t("mcpServer.config.port", "Port")}
            value={draft.port}
            onChange={(v) => update("port", v)}
            min={1024}
            max={65535}
          />
        </div>
      </Section>

      {/* Security settings */}
      <Section title={t("mcpServer.config.security", "Security")} icon={<Shield size={14} />}>
        <Toggle
          label={t("mcpServer.config.requireAuth", "Require authentication")}
          description={t("mcpServer.config.requireAuthDesc", "Require API key for all requests")}
          checked={draft.require_auth}
          onChange={(v) => update("require_auth", v)}
        />

        {draft.require_auth && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
              {t("mcpServer.config.apiKey", "API Key")}
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1 bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] px-3 py-1.5">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={draft.api_key}
                  readOnly
                  className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] font-mono outline-none"
                  data-testid="mcp-api-key-input"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                {draft.api_key && (
                  <button
                    onClick={handleCopyKey}
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    {copiedKey ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
              <button
                onClick={handleGenerateKey}
                disabled={mgr.isGeneratingKey}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
                data-testid="mcp-generate-key-btn"
              >
                {mgr.isGeneratingKey ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                {t("mcpServer.config.generateKey", "Generate")}
              </button>
            </div>
          </div>
        )}

        <Toggle
          label={t("mcpServer.config.allowRemote", "Allow remote connections")}
          description={t("mcpServer.config.allowRemoteDesc", "Allow connections from non-localhost addresses (security risk)")}
          checked={draft.allow_remote}
          onChange={(v) => update("allow_remote", v)}
        />

        <Toggle
          label={t("mcpServer.config.exposeSensitive", "Expose sensitive data")}
          description={t("mcpServer.config.exposeSensitiveDesc", "Include passwords and secrets in resource responses")}
          checked={draft.expose_sensitive_data}
          onChange={(v) => update("expose_sensitive_data", v)}
        />
      </Section>

      {/* Session & Limits */}
      <Section title={t("mcpServer.config.limits", "Sessions & Limits")} icon={<Clock size={14} />}>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label={t("mcpServer.config.maxSessions", "Max concurrent sessions")}
            value={draft.max_sessions}
            onChange={(v) => update("max_sessions", v)}
            min={1}
            max={100}
          />
          <NumberInput
            label={t("mcpServer.config.sessionTimeout", "Session timeout (seconds)")}
            value={draft.session_timeout_secs}
            onChange={(v) => update("session_timeout_secs", v)}
            min={60}
            max={86400}
          />
          <NumberInput
            label={t("mcpServer.config.rateLimit", "Rate limit (req/min)")}
            value={draft.rate_limit_per_minute}
            onChange={(v) => update("rate_limit_per_minute", v)}
            min={1}
            max={10000}
          />
          <SelectInput
            label={t("mcpServer.config.logLevel", "Log level")}
            value={draft.log_level}
            options={MCP_LOG_LEVELS.map((l) => ({ value: l, label: l }))}
            onChange={(v) => update("log_level", v as McpLogLevel)}
          />
        </div>
      </Section>

      {/* CORS */}
      <Section title={t("mcpServer.config.cors", "CORS")} icon={<RefreshCw size={14} />}>
        <Toggle
          label={t("mcpServer.config.corsEnabled", "Enable CORS")}
          checked={draft.cors_enabled}
          onChange={(v) => update("cors_enabled", v)}
        />
        <Toggle
          label={t("mcpServer.config.sseEnabled", "Enable SSE")}
          description={t("mcpServer.config.sseDesc", "Enable Server-Sent Events for real-time notifications")}
          checked={draft.sse_enabled}
          onChange={(v) => update("sse_enabled", v)}
        />
      </Section>

      {/* Server instructions */}
      <Section title={t("mcpServer.config.instructions", "Server Instructions")} icon={<Globe size={14} />}>
        <textarea
          value={draft.server_instructions}
          onChange={(e) => update("server_instructions", e.target.value)}
          className="w-full h-24 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-2 text-xs text-[var(--color-text-primary)] resize-none outline-none focus:border-[var(--color-accent)]"
          placeholder={t("mcpServer.config.instructionsPlaceholder", "Instructions sent to AI clients describing this server...")}
          data-testid="mcp-instructions-input"
        />
      </Section>
    </div>
  );
};

// ── Shared field components ─────────────────────────────────────────

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className="p-4 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] space-y-3">
    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
      {icon}
      {title}
    </div>
    {children}
  </div>
);

const Toggle: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 accent-[var(--color-accent)]"
    />
    <div>
      <div className="text-xs font-medium text-[var(--color-text-primary)]">{label}</div>
      {description && (
        <div className="text-[10px] text-[var(--color-text-secondary)]">{description}</div>
      )}
    </div>
  </label>
);

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
  <div>
    <label className="block text-[10px] font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
    />
  </div>
);

const NumberInput: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}> = ({ label, value, onChange, min, max }) => (
  <div>
    <label className="block text-[10px] font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
    />
  </div>
);

const SelectInput: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    <label className="block text-[10px] font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);
