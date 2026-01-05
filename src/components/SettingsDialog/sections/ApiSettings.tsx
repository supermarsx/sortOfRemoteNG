import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../../types/settings';
import {
  Server,
  Power,
  Globe,
  Key,
  Shield,
  Clock,
  FileKey,
  AlertTriangle,
  Copy,
  RefreshCw,
} from 'lucide-react';

interface ApiSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const ApiSettings: React.FC<ApiSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();

  const updateRestApi = (updates: Partial<GlobalSettings['restApi']>) => {
    updateSettings({
      restApi: {
        ...settings.restApi,
        ...updates,
      },
    });
  };

  const generateApiKey = () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const key = Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    updateRestApi({ apiKey: key });
  };

  const copyApiKey = async () => {
    if (settings.restApi?.apiKey) {
      await navigator.clipboard.writeText(settings.restApi.apiKey);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Server className="w-5 h-5" />
        {t('settings.api.title', 'API Server')}
      </h3>

      <p className="text-sm text-gray-400">
        {t(
          'settings.api.description',
          'Configure the internal REST API server for remote control and automation.'
        )}
      </p>

      {/* Enable API Server */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.restApi?.enabled || false}
            onChange={(e) => updateRestApi({ enabled: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <Power className="w-4 h-4 text-gray-500 group-hover:text-blue-400" />
          <div>
            <span className="text-gray-300 group-hover:text-white">
              {t('settings.api.enable', 'Enable API Server')}
            </span>
            <p className="text-xs text-gray-500">
              {t('settings.api.enableDescription', 'Start an HTTP server for remote control')}
            </p>
          </div>
        </label>
      </div>

      {settings.restApi?.enabled && (
        <>
          {/* Start on Launch */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
            <label className="flex items-center space-x-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.restApi?.startOnLaunch || false}
                onChange={(e) => updateRestApi({ startOnLaunch: e.target.checked })}
                className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
              />
              <Clock className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
              <div>
                <span className="text-gray-300 group-hover:text-white">
                  {t('settings.api.startOnLaunch', 'Start on Application Launch')}
                </span>
                <p className="text-xs text-gray-500">
                  {t(
                    'settings.api.startOnLaunchDescription',
                    'Automatically start the API server when the application opens'
                  )}
                </p>
              </div>
            </label>
          </div>

          {/* Port Configuration */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              {t('settings.api.network', 'Network')}
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Server className="w-4 h-4" />
                    {t('settings.api.port', 'Port')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={settings.restApi?.port || 9876}
                    onChange={(e) => updateRestApi({ port: parseInt(e.target.value) || 9876 })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    placeholder="9876"
                  />
                  <p className="text-xs text-gray-500">
                    {t('settings.api.portDescription', 'Port number for the API server (1-65535)')}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center space-x-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={settings.restApi?.allowRemoteConnections || false}
                      onChange={(e) => updateRestApi({ allowRemoteConnections: e.target.checked })}
                      className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
                    />
                    <div>
                      <span className="text-gray-300 group-hover:text-white flex items-center gap-2">
                        <Globe className="w-4 h-4 text-yellow-500" />
                        {t('settings.api.allowRemote', 'Allow Remote Connections')}
                      </span>
                      <p className="text-xs text-gray-500">
                        {t(
                          'settings.api.allowRemoteDescription',
                          'Listen on all interfaces instead of localhost only'
                        )}
                      </p>
                    </div>
                  </label>
                  {settings.restApi?.allowRemoteConnections && (
                    <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {t(
                          'settings.api.remoteWarning',
                          'Warning: This exposes the API to your network. Ensure authentication is enabled.'
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Authentication */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              {t('settings.api.authentication', 'Authentication')}
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.restApi?.requireAuth || false}
                  onChange={(e) => updateRestApi({ requireAuth: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
                />
                <Key className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
                <div>
                  <span className="text-gray-300 group-hover:text-white">
                    {t('settings.api.requireAuth', 'Require Authentication')}
                  </span>
                  <p className="text-xs text-gray-500">
                    {t(
                      'settings.api.requireAuthDescription',
                      'Require an API key for all requests'
                    )}
                  </p>
                </div>
              </label>

              {settings.restApi?.requireAuth && (
                <div className="space-y-2 pt-2 border-t border-gray-700">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Key className="w-4 h-4" />
                    {t('settings.api.apiKey', 'API Key')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={settings.restApi?.apiKey || ''}
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white font-mono text-sm"
                      placeholder={t('settings.api.noApiKey', 'No API key generated')}
                    />
                    <button
                      type="button"
                      onClick={copyApiKey}
                      disabled={!settings.restApi?.apiKey}
                      className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-300 hover:bg-gray-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('settings.api.copyKey', 'Copy API Key')}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={generateApiKey}
                      className="px-3 py-2 bg-blue-600 border border-blue-500 rounded-md text-white hover:bg-blue-500"
                      title={t('settings.api.generateKey', 'Generate New Key')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {t(
                      'settings.api.apiKeyDescription',
                      'Include this key in the X-API-Key header for all requests'
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* SSL/TLS */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <FileKey className="w-4 h-4 text-purple-400" />
              {t('settings.api.ssl', 'SSL/TLS')}
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.restApi?.sslEnabled || false}
                  onChange={(e) => updateRestApi({ sslEnabled: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
                />
                <Shield className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
                <div>
                  <span className="text-gray-300 group-hover:text-white">
                    {t('settings.api.enableSsl', 'Enable HTTPS')}
                  </span>
                  <p className="text-xs text-gray-500">
                    {t(
                      'settings.api.enableSslDescription',
                      'Use SSL/TLS encryption for API connections'
                    )}
                  </p>
                </div>
              </label>

              {settings.restApi?.sslEnabled && (
                <div className="space-y-4 pt-2 border-t border-gray-700">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-400">
                      <FileKey className="w-4 h-4" />
                      {t('settings.api.certPath', 'Certificate Path')}
                    </label>
                    <input
                      type="text"
                      value={settings.restApi?.sslCertPath || ''}
                      onChange={(e) => updateRestApi({ sslCertPath: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                      placeholder="/path/to/certificate.pem"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-400">
                      <Key className="w-4 h-4" />
                      {t('settings.api.keyPath', 'Private Key Path')}
                    </label>
                    <input
                      type="text"
                      value={settings.restApi?.sslKeyPath || ''}
                      onChange={(e) => updateRestApi({ sslKeyPath: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                      placeholder="/path/to/private-key.pem"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-400" />
              {t('settings.api.rateLimit', 'Rate Limiting')}
            </h4>

            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <Clock className="w-4 h-4" />
                  {t('settings.api.maxRequests', 'Max Requests Per Minute')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={settings.restApi?.maxRequestsPerMinute || 60}
                  onChange={(e) =>
                    updateRestApi({ maxRequestsPerMinute: parseInt(e.target.value) || 60 })
                  }
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                  placeholder="60"
                />
                <p className="text-xs text-gray-500">
                  {t(
                    'settings.api.maxRequestsDescription',
                    'Set to 0 to disable rate limiting. Recommended: 60-120 for normal use.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
