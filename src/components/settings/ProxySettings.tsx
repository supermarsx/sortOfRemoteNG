import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, ProxyConfig } from '../../types/settings';

interface ProxySettingsProps {
  settings: GlobalSettings;
  updateProxy: (updates: Partial<ProxyConfig>) => void;
}

export const ProxySettings: React.FC<ProxySettingsProps> = ({ settings, updateProxy }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">Proxy Settings</h3>

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={settings.globalProxy?.enabled || false}
          onChange={(e) => updateProxy({ enabled: e.target.checked })}
          className="rounded border-gray-600 bg-gray-700 text-blue-600"
        />
        <span className="text-gray-300">Enable Global Proxy</span>
      </label>

      {settings.globalProxy?.enabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Proxy Type
            </label>
            <select
              value={settings.globalProxy?.type || 'http'}
              onChange={(e) => updateProxy({ type: e.target.value as any })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks4">SOCKS4</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Proxy Host
            </label>
            <input
              type="text"
              value={settings.globalProxy?.host || ''}
              onChange={(e) => updateProxy({ host: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              placeholder="proxy.example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Proxy Port
            </label>
            <input
              type="number"
              value={settings.globalProxy?.port || 8080}
              onChange={(e) => updateProxy({ port: parseInt(e.target.value) })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              min="1"
              max="65535"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Username (optional)
            </label>
            <input
              type="text"
              value={settings.globalProxy?.username || ''}
              onChange={(e) => updateProxy({ username: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Password (optional)
            </label>
            <input
              type="password"
              value={settings.globalProxy?.password || ''}
              onChange={(e) => updateProxy({ password: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProxySettings;
