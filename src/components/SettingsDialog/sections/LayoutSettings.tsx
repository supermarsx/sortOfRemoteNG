import React from "react";
import { GlobalSettings } from "../../../types/settings";

interface LayoutSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const LayoutSettings: React.FC<LayoutSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">Layout</h3>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200">Persistence</h4>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.persistWindowSize}
            onChange={(e) => updateSettings({ persistWindowSize: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Remember window size</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.persistWindowPosition}
            onChange={(e) => updateSettings({ persistWindowPosition: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Remember window position</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.persistSidebarWidth}
            onChange={(e) => updateSettings({ persistSidebarWidth: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Remember sidebar width</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.persistSidebarPosition}
            onChange={(e) => updateSettings({ persistSidebarPosition: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Remember sidebar position</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.persistSidebarCollapsed}
            onChange={(e) => updateSettings({ persistSidebarCollapsed: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Remember sidebar collapsed state</span>
        </label>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200">Reordering</h4>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.enableTabReorder}
            onChange={(e) => updateSettings({ enableTabReorder: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Allow tab reordering</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.enableConnectionReorder}
            onChange={(e) => updateSettings({ enableConnectionReorder: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Allow connection reordering</span>
        </label>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200">Secondary Bar</h4>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showQuickConnectIcon}
            onChange={(e) => updateSettings({ showQuickConnectIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Quick Connect</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showCollectionSwitcherIcon}
            onChange={(e) => updateSettings({ showCollectionSwitcherIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Collection Switcher</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showImportExportIcon}
            onChange={(e) => updateSettings({ showImportExportIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Import/Export</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showSettingsIcon}
            onChange={(e) => updateSettings({ showSettingsIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Settings</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showProxyMenuIcon}
            onChange={(e) => updateSettings({ showProxyMenuIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Proxy/VPN Menu</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showShortcutManagerIcon}
            onChange={(e) => updateSettings({ showShortcutManagerIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Shortcut Manager</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showPerformanceMonitorIcon}
            onChange={(e) => updateSettings({ showPerformanceMonitorIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Performance Monitor</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showActionLogIcon}
            onChange={(e) => updateSettings({ showActionLogIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Action Log</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showDevtoolsIcon}
            onChange={(e) => updateSettings({ showDevtoolsIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Devtools</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showSecurityIcon}
            onChange={(e) => updateSettings({ showSecurityIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Security</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.showLanguageSelectorIcon}
            onChange={(e) => updateSettings({ showLanguageSelectorIcon: e.target.checked })}
          />
          <span className="text-gray-300">Show Language Selector</span>
        </label>
      </div>
    </div>
  );
};

export default LayoutSettings;
