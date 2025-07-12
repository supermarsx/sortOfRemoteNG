import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, Theme, ColorScheme } from '../../types/settings';

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">{t('settings.general')}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('settings.language')}
          </label>
          <select
            value={settings.language}
            onChange={(e) => updateSettings({ language: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('settings.theme')}
          </label>
          <select
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as Theme })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="darkest">Darkest</option>
            <option value="oled">OLED Black</option>
            <option value="semilight">Semi Light</option>
            <option value="auto">Auto</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Color Scheme
          </label>
          <select
            value={settings.colorScheme}
            onChange={(e) => updateSettings({ colorScheme: e.target.value as ColorScheme })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="purple">Purple</option>
            <option value="red">Red</option>
            <option value="orange">Orange</option>
            <option value="teal">Teal</option>
            <option value="grey">Grey</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Connection Timeout (seconds)
          </label>
          <input
            type="number"
            value={settings.connectionTimeout}
            onChange={(e) => updateSettings({ connectionTimeout: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="5"
            max="300"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Max Concurrent Connections
          </label>
          <input
            type="number"
            value={settings.maxConcurrentConnections}
            onChange={(e) => updateSettings({ maxConcurrentConnections: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="1"
            max="50"
          />
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.singleWindowMode}
            onChange={(e) => updateSettings({ singleWindowMode: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t('connections.singleWindow')}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.singleConnectionMode}
            onChange={(e) => updateSettings({ singleConnectionMode: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t('connections.singleConnection')}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.reconnectOnReload}
            onChange={(e) => updateSettings({ reconnectOnReload: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t('connections.reconnectOnReload')}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.warnOnClose}
            onChange={(e) => updateSettings({ warnOnClose: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t('connections.warnOnClose')}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.warnOnExit}
            onChange={(e) => updateSettings({ warnOnExit: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t('connections.warnOnExit')}</span>
        </label>
      </div>
    </div>
  );
};

export default GeneralSettings;
