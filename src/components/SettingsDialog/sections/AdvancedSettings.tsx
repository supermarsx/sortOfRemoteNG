import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../../types/settings';

interface AdvancedSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">{t('settings.advanced')}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Tab Grouping
          </label>
          <select
            value={settings.tabGrouping}
            onChange={(e) => updateSettings({ tabGrouping: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="none">None</option>
            <option value="protocol">By Protocol</option>
            <option value="status">By Status</option>
            <option value="hostname">By Hostname</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Log Level
          </label>
          <select
            value={settings.logLevel}
            onChange={(e) => updateSettings({ logLevel: e.target.value as any })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={settings.hostnameOverride}
          onChange={(e) => updateSettings({ hostnameOverride: e.target.checked })}
          className="rounded border-gray-600 bg-gray-700 text-blue-600"
        />
        <span className="text-gray-300">Override tab names with hostname</span>
      </label>
    </div>
  );
};

export default AdvancedSettings;
