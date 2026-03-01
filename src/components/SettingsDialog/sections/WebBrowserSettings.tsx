import React from "react";
import { Globe, Wifi, Bookmark, RefreshCw, Trash2 } from "lucide-react";
import { GlobalSettings } from "../../../types/settings";
import { Checkbox, NumberInput } from '../../ui/forms';

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
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Globe className="w-5 h-5" />
        Web Browser
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Internal proxy keepalive, bookmarks, and web browser connection
        settings.
      </p>

      {/* ── Proxy Keepalive ── */}
      <section>
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Wifi className="w-4 h-4 text-blue-400" />
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
              <span className="text-sm text-[var(--color-text)]">
                Enable proxy health checks
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
                <span className="text-sm text-[var(--color-text)]">
                  Health-check interval
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
                <RefreshCw size={14} className="text-green-400" />
                Auto-restart dead proxies
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
                <span className="text-sm text-[var(--color-text)]">
                  Max consecutive auto-restarts
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
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-yellow-400" />
          Bookmarks
        </h4>

        <div className="space-y-4">
          {/* Confirm delete all */}
          <label className="sor-settings-tile">
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1.5">
                <Trash2 size={14} className="text-red-400" />
                Confirm before deleting all bookmarks
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
