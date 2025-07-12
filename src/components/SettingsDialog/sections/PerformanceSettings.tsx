import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, StatusCheckMethod } from '../../../types/settings';

interface PerformanceSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const PerformanceSettings: React.FC<PerformanceSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">{t('performance.title')}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Retry Attempts
          </label>
          <input
            type="number"
            value={settings.retryAttempts}
            onChange={(e) => updateSettings({ retryAttempts: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="0"
            max="10"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Retry Delay (ms)
          </label>
          <input
            type="number"
            value={settings.retryDelay}
            onChange={(e) => updateSettings({ retryDelay: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="1000"
            max="60000"
            step="1000"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Status Check Interval (seconds)
          </label>
          <input
            type="number"
            value={settings.statusCheckInterval}
            onChange={(e) => updateSettings({ statusCheckInterval: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="10"
            max="300"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Status Check Method
          </label>
          <select
            value={settings.statusCheckMethod}
            onChange={(e) => updateSettings({ statusCheckMethod: e.target.value as StatusCheckMethod })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="socket">Socket</option>
            <option value="http">HTTP</option>
            <option value="ping">Ping</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Max Log Entries
          </label>
          <input
            type="number"
            value={settings.maxLogEntries}
            onChange={(e) => updateSettings({ maxLogEntries: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="100"
            max="10000"
            step="100"
          />
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.enablePerformanceTracking}
            onChange={(e) => updateSettings({ enablePerformanceTracking: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Enable Performance Tracking</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.enableStatusChecking}
            onChange={(e) => updateSettings({ enableStatusChecking: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Enable Status Checking</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.enableActionLog}
            onChange={(e) => updateSettings({ enableActionLog: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Enable Action Logging</span>
        </label>
      </div>
    </div>
  );
};

export default PerformanceSettings;
