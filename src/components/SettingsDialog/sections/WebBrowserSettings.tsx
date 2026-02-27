import React from 'react';
import { Globe, Wifi, Bookmark, RefreshCw, Trash2 } from 'lucide-react';
import { GlobalSettings } from '../../../types/settings';

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
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Globe className="w-5 h-5" />
        Web Browser
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Internal proxy keepalive, bookmarks, and web browser connection settings.
      </p>

      {/* ── Proxy Keepalive ── */}
      <section>
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Wifi className="w-4 h-4 text-blue-400" />
          Internal Proxy Keepalive
        </h4>
        <p className="text-sm text-gray-400 mb-4">
          When the web browser connects through an internal authentication proxy, these settings
          control how dead proxy sessions are detected and recovered.
        </p>

        <div className="space-y-4">
          {/* Enable keepalive */}
          <label className="flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] rounded-lg">
            <div>
              <span className="text-sm text-[var(--color-text)]">Enable proxy health checks</span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Periodically verify the local proxy is still alive
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.proxyKeepaliveEnabled}
              onChange={(e) => updateSettings({ proxyKeepaliveEnabled: e.target.checked })}
              className="w-4 h-4 accent-blue-500"
            />
          </label>

          {/* Interval */}
          <div className={`p-3 bg-[var(--color-surfaceHover)] rounded-lg ${!settings.proxyKeepaliveEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center justify-between">
              <div>
                <span className="text-sm text-[var(--color-text)]">Health-check interval</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  How often to probe the proxy port (seconds)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={settings.proxyKeepaliveIntervalSeconds}
                  onChange={(e) =>
                    updateSettings({
                      proxyKeepaliveIntervalSeconds: Math.max(3, Math.min(120, Number(e.target.value) || 10)),
                    })
                  }
                  className="w-20 px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] text-right"
                />
                <span className="text-xs text-[var(--color-textSecondary)]">sec</span>
              </div>
            </label>
          </div>

          {/* Auto-restart */}
          <label className={`flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] rounded-lg ${!settings.proxyKeepaliveEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1.5">
                <RefreshCw size={14} className="text-green-400" />
                Auto-restart dead proxies
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Automatically restart the proxy when a health check fails
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.proxyAutoRestart}
              onChange={(e) => updateSettings({ proxyAutoRestart: e.target.checked })}
              className="w-4 h-4 accent-blue-500"
            />
          </label>

          {/* Max auto-restarts */}
          <div className={`p-3 bg-[var(--color-surfaceHover)] rounded-lg ${!settings.proxyKeepaliveEnabled || !settings.proxyAutoRestart ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center justify-between">
              <div>
                <span className="text-sm text-[var(--color-text)]">Max consecutive auto-restarts</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Stop auto-restarting after this many attempts (0 = unlimited)
                </p>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.proxyMaxAutoRestarts}
                onChange={(e) =>
                  updateSettings({
                    proxyMaxAutoRestarts: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  })
                }
                className="w-20 px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] text-right"
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── Bookmarks ── */}
      <section>
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-yellow-400" />
          Bookmarks
        </h4>

        <div className="space-y-4">
          {/* Confirm delete all */}
          <label className="flex items-center justify-between p-3 bg-[var(--color-surfaceHover)] rounded-lg">
            <div>
              <span className="text-sm text-[var(--color-text)] flex items-center gap-1.5">
                <Trash2 size={14} className="text-red-400" />
                Confirm before deleting all bookmarks
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Show a confirmation dialog before clearing all bookmarks for a connection
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.confirmDeleteAllBookmarks}
              onChange={(e) => updateSettings({ confirmDeleteAllBookmarks: e.target.checked })}
              className="w-4 h-4 accent-blue-500"
            />
          </label>
        </div>
      </section>
    </div>
  );
};

export default WebBrowserSettings;
