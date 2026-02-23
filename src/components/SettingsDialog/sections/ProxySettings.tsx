import React from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../../ui/PasswordInput';
import { GlobalSettings, ProxyConfig } from '../../../types/settings';
import {
  Shield,
  Globe,
  Server,
  Hash,
  User,
  Lock,
  Network,
} from 'lucide-react';

interface ProxySettingsProps {
  settings: GlobalSettings;
  updateProxy: (updates: Partial<ProxyConfig>) => void;
}

const PROXY_TYPES = [
  { value: 'http', label: 'HTTP', description: 'Standard HTTP proxy' },
  { value: 'https', label: 'HTTPS', description: 'Secure HTTP proxy' },
  { value: 'socks4', label: 'SOCKS4', description: 'SOCKS4 protocol' },
  { value: 'socks5', label: 'SOCKS5', description: 'SOCKS5 with auth' },
];

export const ProxySettings: React.FC<ProxySettingsProps> = ({ settings, updateProxy }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Network className="w-5 h-5" />
        Proxy Settings
      </h3>

      {/* Enable Global Proxy */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.globalProxy?.enabled || false}
            onChange={(e) => updateProxy({ enabled: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <Shield className="w-4 h-4 text-gray-500 group-hover:text-blue-400" />
          <div>
            <span className="text-gray-300 group-hover:text-white">Enable Global Proxy</span>
            <p className="text-xs text-gray-500">Route all connections through a proxy server</p>
          </div>
        </label>
      </div>

      {settings.globalProxy?.enabled && (
        <>
          {/* Proxy Type Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              Proxy Type
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PROXY_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => updateProxy({ type: type.value as any })}
                  className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                    settings.globalProxy?.type === type.value
                      ? 'border-blue-500 bg-blue-600/20 text-white ring-1 ring-blue-500/50'
                      : 'border-gray-600 bg-gray-700/50 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                  }`}
                >
                  <Shield className={`w-5 h-5 mb-1 ${settings.globalProxy?.type === type.value ? 'text-blue-400' : ''}`} />
                  <span className="text-sm font-medium">{type.label}</span>
                  <span className="text-xs text-gray-400 mt-1">{type.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Connection Details Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Server className="w-4 h-4 text-green-400" />
              Connection Details
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Server className="w-4 h-4" />
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

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Hash className="w-4 h-4" />
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
              </div>
            </div>
          </div>

          {/* Authentication Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Lock className="w-4 h-4 text-yellow-400" />
              Authentication (Optional)
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <User className="w-4 h-4" />
                    Username
                  </label>
                  <input
                    type="text"
                    value={settings.globalProxy?.username || ''}
                    onChange={(e) => updateProxy({ username: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    placeholder="Optional"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Lock className="w-4 h-4" />
                    Password
                  </label>
                  <PasswordInput
                    value={settings.globalProxy?.password || ''}
                    onChange={(e) => updateProxy({ password: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Leave blank if your proxy server doesn't require authentication
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ProxySettings;
