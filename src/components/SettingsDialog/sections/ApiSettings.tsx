import React, { useState } from 'react';
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
  Play,
  Square,
  RotateCcw,
  Shuffle,
  Settings,
  Cpu,
  Zap,
} from 'lucide-react';

interface ApiSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const ApiSettings: React.FC<ApiSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<'stopped' | 'running' | 'starting' | 'stopping'>('stopped');
  const [actualPort, setActualPort] = useState<number | null>(null);

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

  const generateRandomPort = () => {
    // Generate a random port between 10000 and 60000
    const randomPort = Math.floor(Math.random() * 50000) + 10000;
    updateRestApi({ port: randomPort });
  };

  const handleStartServer = async () => {
    setServerStatus('starting');
    try {
      // In a real implementation, this would call Tauri backend to start the server
      // For now, we simulate the behavior
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (settings.restApi?.useRandomPort) {
        const randomPort = Math.floor(Math.random() * 50000) + 10000;
        setActualPort(randomPort);
      } else {
        setActualPort(settings.restApi?.port || 9876);
      }
      setServerStatus('running');
    } catch (error) {
      console.error('Failed to start API server:', error);
      setServerStatus('stopped');
    }
  };

  const handleStopServer = async () => {
    setServerStatus('stopping');
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      setActualPort(null);
      setServerStatus('stopped');
    } catch (error) {
      console.error('Failed to stop API server:', error);
    }
  };

  const handleRestartServer = async () => {
    await handleStopServer();
    await handleStartServer();
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Server className="w-5 h-5" />
        {t('settings.api.title', 'API Server')}
      </h3>

      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Configure the internal REST API server for remote control and automation.
      </p>

      {/* Enable API Server */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.restApi?.enabled || false}
            onChange={(e) => updateRestApi({ enabled: e.target.checked })}
            className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
          />
          <Power className="w-4 h-4 text-gray-500 group-hover:text-blue-400" />
          <div>
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
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
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
            <label className="flex items-center space-x-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.restApi?.startOnLaunch || false}
                onChange={(e) => updateRestApi({ startOnLaunch: e.target.checked })}
                className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
              />
              <Clock className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
              <div>
                <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
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

          {/* Server Controls */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-400" />
                {t('settings.api.serverControls', 'Server Controls')}
              </h4>
              <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                serverStatus === 'running' 
                  ? 'bg-green-500/20 text-green-400' 
                  : serverStatus === 'starting' || serverStatus === 'stopping'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-gray-600/50 text-[var(--color-textSecondary)]'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  serverStatus === 'running' 
                    ? 'bg-green-400' 
                    : serverStatus === 'starting' || serverStatus === 'stopping'
                      ? 'bg-yellow-400 animate-pulse'
                      : 'bg-gray-500'
                }`} />
                {serverStatus === 'running' ? 'Running' : serverStatus === 'starting' ? 'Starting...' : serverStatus === 'stopping' ? 'Stopping...' : 'Stopped'}
                {actualPort && serverStatus === 'running' && (
                  <span className="text-[var(--color-textSecondary)]">:{actualPort}</span>
                )}
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStartServer}
                disabled={serverStatus === 'running' || serverStatus === 'starting' || serverStatus === 'stopping'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Play className="w-4 h-4" />
                {t('settings.api.start', 'Start')}
              </button>
              <button
                type="button"
                onClick={handleStopServer}
                disabled={serverStatus === 'stopped' || serverStatus === 'starting' || serverStatus === 'stopping'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Square className="w-4 h-4" />
                {t('settings.api.stop', 'Stop')}
              </button>
              <button
                type="button"
                onClick={handleRestartServer}
                disabled={serverStatus === 'stopped' || serverStatus === 'starting' || serverStatus === 'stopping'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {t('settings.api.restart', 'Restart')}
              </button>
            </div>
          </div>

          {/* Port Configuration */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              {t('settings.api.network', 'Network')}
            </h4>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Server className="w-4 h-4" />
                    {t('settings.api.port', 'Port')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={settings.restApi?.port || 9876}
                      onChange={(e) => updateRestApi({ port: parseInt(e.target.value) || 9876 })}
                      disabled={settings.restApi?.useRandomPort}
                      className="flex-1 px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="9876"
                    />
                    <button
                      type="button"
                      onClick={generateRandomPort}
                      disabled={settings.restApi?.useRandomPort}
                      className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('settings.api.randomizePort', 'Randomize Port')}
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer group mt-2">
                    <input
                      type="checkbox"
                      checked={settings.restApi?.useRandomPort || false}
                      onChange={(e) => updateRestApi({ useRandomPort: e.target.checked })}
                      className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
                    />
                    <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-textSecondary)]">
                      {t('settings.api.useRandomPort', 'Use random port on each start')}
                    </span>
                  </label>
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
                      className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
                    />
                    <div>
                      <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-2">
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
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              {t('settings.api.authentication', 'Authentication')}
            </h4>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.restApi?.authentication || false}
                  onChange={(e) => updateRestApi({ authentication: e.target.checked })}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
                />
                <Key className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
                <div>
                  <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
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

              {settings.restApi?.authentication && (
                <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Key className="w-4 h-4" />
                    {t('settings.api.apiKey', 'API Key')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={settings.restApi?.apiKey || ''}
                      className="flex-1 px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] font-mono text-sm"
                      placeholder={t('settings.api.noApiKey', 'No API key generated')}
                    />
                    <button
                      type="button"
                      onClick={copyApiKey}
                      disabled={!settings.restApi?.apiKey}
                      className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('settings.api.copyKey', 'Copy API Key')}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={generateApiKey}
                      className="px-3 py-2 bg-blue-600 border border-blue-500 rounded-md text-[var(--color-text)] hover:bg-blue-500"
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
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <FileKey className="w-4 h-4 text-purple-400" />
              {t('settings.api.ssl', 'SSL/TLS')}
            </h4>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.restApi?.sslEnabled || false}
                  onChange={(e) => updateRestApi({ sslEnabled: e.target.checked })}
                  className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
                />
                <Shield className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
                <div>
                  <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
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
                <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                  {/* SSL Mode Selection */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                      <Shield className="w-4 h-4" />
                      {t('settings.api.sslMode', 'Certificate Mode')}
                    </label>
                    <select
                      value={settings.restApi?.sslMode || 'manual'}
                      onChange={(e) => updateRestApi({ sslMode: e.target.value as 'manual' | 'self-signed' | 'letsencrypt' })}
                      className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                    >
                      <option value="manual">{t('settings.api.sslManual', 'Manual (Provide Certificate)')}</option>
                      <option value="self-signed">{t('settings.api.sslSelfSigned', 'Auto-Generate Self-Signed')}</option>
                      <option value="letsencrypt">{t('settings.api.sslLetsEncrypt', "Let's Encrypt (Auto-Renew)")}</option>
                    </select>
                  </div>

                  {/* Manual Certificate Paths */}
                  {settings.restApi?.sslMode === 'manual' && (
                    <>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <FileKey className="w-4 h-4" />
                          {t('settings.api.certPath', 'Certificate Path')}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslCertPath || ''}
                          onChange={(e) => updateRestApi({ sslCertPath: e.target.value })}
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                          placeholder="/path/to/certificate.pem"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Key className="w-4 h-4" />
                          {t('settings.api.keyPath', 'Private Key Path')}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslKeyPath || ''}
                          onChange={(e) => updateRestApi({ sslKeyPath: e.target.value })}
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                          placeholder="/path/to/private-key.pem"
                        />
                      </div>
                    </>
                  )}

                  {/* Self-Signed Info */}
                  {settings.restApi?.sslMode === 'self-signed' && (
                    <div className="flex items-start gap-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-xs">
                      <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {t(
                          'settings.api.selfSignedInfo',
                          'A self-signed certificate will be automatically generated. Browsers will show a security warning.'
                        )}
                      </span>
                    </div>
                  )}

                  {/* Let's Encrypt Configuration */}
                  {settings.restApi?.sslMode === 'letsencrypt' && (
                    <>
                      <div className="flex items-start gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs">
                        <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          {t(
                            'settings.api.letsEncryptInfo',
                            "Let's Encrypt certificates are free, trusted, and auto-renewed. Requires a public domain pointing to this server."
                          )}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Globe className="w-4 h-4" />
                          {t('settings.api.sslDomain', 'Domain Name')}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslDomain || ''}
                          onChange={(e) => updateRestApi({ sslDomain: e.target.value })}
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                          placeholder="api.example.com"
                        />
                        <p className="text-xs text-gray-500">
                          {t('settings.api.sslDomainDescription', 'Must be a valid domain pointing to this server')}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Key className="w-4 h-4" />
                          {t('settings.api.sslEmail', 'Email for Certificate Notices')}
                        </label>
                        <input
                          type="email"
                          value={settings.restApi?.sslEmail || ''}
                          onChange={(e) => updateRestApi({ sslEmail: e.target.value })}
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                          placeholder="admin@example.com"
                        />
                        <p className="text-xs text-gray-500">
                          {t('settings.api.sslEmailDescription', "Let's Encrypt will send renewal reminders to this email")}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Performance & Threading */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              {t('settings.api.performance', 'Performance')}
            </h4>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Cpu className="w-4 h-4" />
                    {t('settings.api.maxThreads', 'Max Worker Threads')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={settings.restApi?.maxThreads || 4}
                    onChange={(e) => updateRestApi({ maxThreads: parseInt(e.target.value) || 4 })}
                    className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                    placeholder="4"
                  />
                  <p className="text-xs text-gray-500">
                    {t('settings.api.maxThreadsDescription', 'Number of threads to handle requests (1-64)')}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Clock className="w-4 h-4" />
                    {t('settings.api.requestTimeout', 'Request Timeout (seconds)')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={settings.restApi?.requestTimeout || 30}
                    onChange={(e) => updateRestApi({ requestTimeout: parseInt(e.target.value) || 30 })}
                    className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                    placeholder="30"
                  />
                  <p className="text-xs text-gray-500">
                    {t('settings.api.requestTimeoutDescription', 'Maximum time for a request before timeout')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-400" />
              {t('settings.api.rateLimit', 'Rate Limiting')}
            </h4>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
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
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
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

export default ApiSettings;
