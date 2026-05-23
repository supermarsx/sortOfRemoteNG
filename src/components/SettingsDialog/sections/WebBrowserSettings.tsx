import React from "react";
import { Globe, Wifi, Bookmark, RefreshCw, Trash2, Timer, Repeat } from "lucide-react";
import { GlobalSettings } from "../../../types/settings/settings";
import { Checkbox, NumberInput } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface WebBrowserSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Shared row primitives ───────────────────────────── */

const ToggleRow: React.FC<{
  settingKey?: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}> = ({ settingKey, icon, label, description, checked, disabled, onChange, tooltip }) => (
  <label
    {...(settingKey ? { "data-setting-key": settingKey } : {})}
    className="flex items-center justify-between gap-3 cursor-pointer"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[var(--color-text)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      disabled={disabled}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

const FieldRow: React.FC<{
  settingKey?: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}> = ({ settingKey, icon, label, description, tooltip, children }) => (
  <div
    {...(settingKey ? { "data-setting-key": settingKey } : {})}
    className="flex items-center justify-between gap-3"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

/* ── Main Component ──────────────────────────────────── */

const WebBrowserSettings: React.FC<WebBrowserSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const keepaliveOn = settings.proxyKeepaliveEnabled;
  const autoRestartOn = keepaliveOn && settings.proxyAutoRestart;

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Globe className="w-5 h-5 text-primary" />}
        title="Web Browser"
        description="Internal proxy keepalive, bookmarks, and web browser connection settings."
      />

      {/* Proxy Keepalive */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Wifi className="w-4 h-4 text-primary" />}
          title="Internal Proxy Keepalive"
        />
        <div className="sor-settings-card">
          <p className="text-xs text-[var(--color-textSecondary)]">
            When the web browser connects through an internal authentication
            proxy, these settings control how dead proxy sessions are
            detected and recovered.
          </p>

          <ToggleRow
            settingKey="proxyKeepaliveEnabled"
            icon={<Wifi size={14} />}
            label="Enable proxy health checks"
            description="Periodically verify the local proxy is still alive"
            checked={settings.proxyKeepaliveEnabled}
            onChange={(v) => updateSettings({ proxyKeepaliveEnabled: v })}
            tooltip="Periodically verify the local authentication proxy is still alive and responsive."
          />

          <div
            className={
              !keepaliveOn ? "opacity-50 pointer-events-none" : undefined
            }
          >
            <FieldRow
              settingKey="proxyKeepaliveIntervalSeconds"
              icon={<Timer size={14} />}
              label="Health-check interval"
              description="How often to probe the proxy port (seconds)"
              tooltip="How often, in seconds, the proxy port is probed to verify it is still responding."
            >
              <NumberInput
                value={settings.proxyKeepaliveIntervalSeconds}
                onChange={(v: number) =>
                  updateSettings({
                    proxyKeepaliveIntervalSeconds: Math.max(
                      3,
                      Math.min(120, v || 10),
                    ),
                  })
                }
                className="w-20 text-right"
                min={3}
                max={120}
              />
              <span className="text-xs text-[var(--color-textSecondary)]">
                sec
              </span>
            </FieldRow>
          </div>

          <div
            className={
              !keepaliveOn ? "opacity-50 pointer-events-none" : undefined
            }
          >
            <ToggleRow
              settingKey="proxyAutoRestart"
              icon={<RefreshCw size={14} />}
              label="Auto-restart dead proxies"
              description="Automatically restart the proxy when a health check fails"
              checked={settings.proxyAutoRestart}
              onChange={(v) => updateSettings({ proxyAutoRestart: v })}
              tooltip="Automatically restart the local proxy process when a health check detects it has stopped responding."
            />
          </div>

          <div
            className={
              !autoRestartOn ? "opacity-50 pointer-events-none" : undefined
            }
          >
            <FieldRow
              settingKey="proxyMaxAutoRestarts"
              icon={<Repeat size={14} />}
              label="Max consecutive auto-restarts"
              description="Stop auto-restarting after this many attempts (0 = unlimited)"
              tooltip="Stop auto-restarting the proxy after this many consecutive failed attempts. Set to 0 for unlimited retries."
            >
              <NumberInput
                value={settings.proxyMaxAutoRestarts}
                onChange={(v: number) =>
                  updateSettings({
                    proxyMaxAutoRestarts: Math.max(
                      0,
                      Math.min(100, v || 0),
                    ),
                  })
                }
                className="w-20 text-right"
                min={0}
                max={100}
              />
            </FieldRow>
          </div>
        </div>
      </div>

      {/* Bookmarks */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Bookmark className="w-4 h-4 text-primary" />}
          title="Bookmarks"
        />
        <div className="sor-settings-card">
          <ToggleRow
            settingKey="confirmDeleteAllBookmarks"
            icon={<Trash2 size={14} />}
            label="Confirm before deleting all bookmarks"
            description="Show a confirmation dialog before clearing all bookmarks for a connection"
            checked={settings.confirmDeleteAllBookmarks}
            onChange={(v) => updateSettings({ confirmDeleteAllBookmarks: v })}
            tooltip="Show a confirmation dialog before clearing all saved bookmarks for a web browser connection."
          />
        </div>
      </div>
    </div>
  );
};

export default WebBrowserSettings;
