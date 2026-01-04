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
    </div>
  );
};

export default LayoutSettings;
