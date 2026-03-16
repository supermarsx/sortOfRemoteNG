import React from "react";
import { Globe, Wifi, Bookmark, RefreshCw, Trash2 } from "lucide-react";
import { GlobalSettings } from "../../../types/settings/settings";
import { Checkbox, NumberInput } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface WebBrowserSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const WebBrowserSettings: React.FC<WebBrowserSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="space-y-6">
      <SectionHeading icon={<Globe className="w-5 h-5" />} title="Web Browser" description="Internal proxy keepalive, bookmarks, and web browser connection settings." />

      {/* ── Proxy Keepalive ── */}
      <section>
        <h4 className="sor-section-heading">
          <Wifi className="w-4 h-4 text-primary" />
          Internal Proxy Keepalive
        </h4>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          When the web browser connects through an internal authentication
          proxy, these settings control how dead proxy sessions are detected and
          recovered.
        </p>

        <div className="space-y-4">
          {/* Enable keepalive */}
          <label className="sor-settings-tile">
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1">
                Enable proxy health checks
                <InfoTooltip text="Periodically verify the local authentication proxy is still alive and responsive." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Periodically verify the local proxy is still alive
              </p>
            </div>
            <Checkbox checked={settings.proxyKeepaliveEnabled} onChange={(v: boolean) => updateSettings({ proxyKeepaliveEnabled: v })} />
          </label>

          {/* Interval */}
          <div
            className={`sor-settings-tile ${!settings.proxyKeepaliveEnabled ? "sor-settings-tile-disabled" : ""}`}
          >
            <label className="flex items-center justify-between">
              <div>
                <span className="text-sm text-[var(--color-text)] flex items-center gap-1">
                  Health-check interval
                  <InfoTooltip text="How often, in seconds, the proxy port is probed to verify it is still responding." />
                </span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  How often to probe the proxy port (seconds)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <NumberInput value={settings.proxyKeepaliveIntervalSeconds} onChange={(v: number) => updateSettings({
                      proxyKeepaliveIntervalSeconds: Math.max(
                        3,
                        Math.min(120, v || 10),
                      ),
                    })} className="w-20 text-right" min={3} max={120} />
                <span className="text-xs text-[var(--color-textSecondary)]">
                  sec
                </span>
              </div>
            </label>
          </div>

          {/* Auto-restart */}
          <label
            className={`sor-settings-tile ${!settings.proxyKeepaliveEnabled ? "sor-settings-tile-disabled" : ""}`}
          >
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1.5">
                <RefreshCw size={14} className="text-success" />
                Auto-restart dead proxies
                <InfoTooltip text="Automatically restart the local proxy process when a health check detects it has stopped responding." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Automatically restart the proxy when a health check fails
              </p>
            </div>
            <Checkbox checked={settings.proxyAutoRestart} onChange={(v: boolean) => updateSettings({ proxyAutoRestart: v })} />
          </label>

          {/* Max auto-restarts */}
          <div
            className={`sor-settings-tile ${!settings.proxyKeepaliveEnabled || !settings.proxyAutoRestart ? "sor-settings-tile-disabled" : ""}`}
          >
            <label className="flex items-center justify-between">
              <div>
                <span className="text-sm text-[var(--color-text)] flex items-center gap-1">
                  Max consecutive auto-restarts
                  <InfoTooltip text="Stop auto-restarting the proxy after this many consecutive failed attempts. Set to 0 for unlimited retries." />
                </span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Stop auto-restarting after this many attempts (0 = unlimited)
                </p>
              </div>
              <NumberInput value={settings.proxyMaxAutoRestarts} onChange={(v: number) => updateSettings({
                    proxyMaxAutoRestarts: Math.max(
                      0,
                      Math.min(100, v || 0),
                    ),
                  })} className="w-20 text-right" min={0} max={100} />
            </label>
          </div>
        </div>
      </section>

      {/* ── Bookmarks ── */}
      <section>
        <h4 className="sor-section-heading">
          <Bookmark className="w-4 h-4 text-warning" />
          Bookmarks
        </h4>

        <div className="space-y-4">
          {/* Confirm delete all */}
          <label className="sor-settings-tile">
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1.5">
                <Trash2 size={14} className="text-error" />
                Confirm before deleting all bookmarks
                <InfoTooltip text="Show a confirmation dialog before clearing all saved bookmarks for a web browser connection." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Show a confirmation dialog before clearing all bookmarks for a
                connection
              </p>
            </div>
            <Checkbox checked={settings.confirmDeleteAllBookmarks} onChange={(v: boolean) => updateSettings({ confirmDeleteAllBookmarks: v })} />
          </label>
        </div>
      </section>
    </div>
  );
};

export default WebBrowserSettings;
