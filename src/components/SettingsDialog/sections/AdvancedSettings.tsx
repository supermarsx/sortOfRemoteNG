import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../../types/settings';
import {
  Cog,
  Layers,
  FileText,
  Terminal,
  Tags,
  AlertCircle,
  Bug,
  Info,
  ShieldAlert,
} from 'lucide-react';

interface AdvancedSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const LOG_LEVEL_CONFIG = [
  { value: 'debug', label: 'Debug', icon: Bug, color: 'text-purple-400', description: 'All messages including debug info' },
  { value: 'info', label: 'Info', icon: Info, color: 'text-blue-400', description: 'Informational messages and above' },
  { value: 'warn', label: 'Warning', icon: AlertCircle, color: 'text-yellow-400', description: 'Warnings and errors only' },
  { value: 'error', label: 'Error', icon: AlertCircle, color: 'text-red-400', description: 'Errors only' },
];

const TAB_GROUPING_CONFIG = [
  { value: 'none', label: 'None', description: 'No grouping' },
  { value: 'protocol', label: 'By Protocol', description: 'Group by SSH, RDP, etc.' },
  { value: 'status', label: 'By Status', description: 'Group by connection state' },
  { value: 'hostname', label: 'By Hostname', description: 'Group by server name' },
];

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Cog className="w-5 h-5" />
        {t('settings.advanced')}
      </h3>

      {/* Tab Grouping Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          Tab Grouping
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TAB_GROUPING_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() => updateSettings({ tabGrouping: option.value as any })}
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.tabGrouping === option.value
                    ? 'border-blue-500 bg-blue-600/20 text-white ring-1 ring-blue-500/50'
                    : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                }`}
              >
                <Layers className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-gray-400 mt-1 text-center">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logging Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-green-400" />
          Logging
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
          <label className="block text-sm text-gray-400 mb-3">Log Level</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {LOG_LEVEL_CONFIG.map((level) => {
              const Icon = level.icon;
              return (
                <button
                  key={level.value}
                  onClick={() => updateSettings({ logLevel: level.value as any })}
                  className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                    settings.logLevel === level.value
                      ? 'border-blue-500 bg-blue-600/20 text-white ring-1 ring-blue-500/50'
                      : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-1 ${settings.logLevel === level.value ? level.color : ''}`} />
                  <span className="text-sm font-medium">{level.label}</span>
                  <span className="text-xs text-gray-400 mt-1 text-center">{level.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Naming Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Tags className="w-4 h-4 text-purple-400" />
          Tab Naming
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.hostnameOverride}
              onChange={(e) => updateSettings({ hostnameOverride: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Terminal className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <div>
              <span className="text-gray-300 group-hover:text-white">Override tab names with hostname</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Display the server hostname instead of the connection name in tabs
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Diagnostics Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-yellow-400" />
          Diagnostics
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.detectUnexpectedClose ?? true}
              onChange={(e) => updateSettings({ detectUnexpectedClose: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ShieldAlert className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <div>
              <span className="text-gray-300 group-hover:text-white">Detect unexpected app close</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Show recovery options if the app was closed unexpectedly
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default AdvancedSettings;
