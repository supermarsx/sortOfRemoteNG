import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  RotateCcw,
  Globe,
  Shield,
  Zap,
  Monitor,
  Code,
  Wifi,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, ProxyConfig } from '../types/settings';
import { SettingsManager } from '../utils/settingsManager';
import { ThemeManager } from '../utils/themeManager';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'success' | 'error' | null>(null);
  const settingsManager = SettingsManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    const currentSettings = await settingsManager.loadSettings();
    setSettings(currentSettings);
  };

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      await settingsManager.saveSettings(settings);
      
      // Apply language change
      if (settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }
      
      // Apply theme changes
      themeManager.applyTheme(settings.theme, settings.colorScheme);
      
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const handleReset = async () => {
    if (confirm(t('settings.reset'))) {
      const defaultSettings = await settingsManager.loadSettings();
      setSettings(defaultSettings);
    }
  };

  const handleBenchmark = async () => {
    if (!settings) return;
    
    setIsBenchmarking(true);
    try {
      const optimalIterations = await settingsManager.benchmarkKeyDerivation(settings.benchmarkTimeSeconds);
      setSettings({
        ...settings,
        keyDerivationIterations: optimalIterations,
      });
    } catch (error) {
      console.error('Benchmark failed:', error);
    } finally {
      setIsBenchmarking(false);
    }
  };

  const showAutoSave = (status: 'success' | 'error') => {
    setAutoSaveStatus(status);
    setTimeout(() => setAutoSaveStatus(null), 2000);
  };

  const updateSettings = async (updates: Partial<GlobalSettings>) => {
    if (!settings) return;

    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    try {
      await settingsManager.saveSettings(newSettings);

      if (updates.language && updates.language !== i18n.language) {
        i18n.changeLanguage(updates.language);
      }

      if (updates.theme || updates.colorScheme) {
        themeManager.applyTheme(newSettings.theme, newSettings.colorScheme);
      }

      showAutoSave('success');
    } catch (error) {
      console.error('Failed to auto save settings:', error);
      showAutoSave('error');
    }
  };

  const updateProxy = async (updates: Partial<ProxyConfig>) => {
    if (!settings) return;

    const newSettings = {
      ...settings,
      globalProxy: { ...settings.globalProxy, ...updates } as ProxyConfig,
    };
    setSettings(newSettings);

    try {
      await settingsManager.saveSettings(newSettings);
      showAutoSave('success');
    } catch (error) {
      console.error('Failed to auto save settings:', error);
      showAutoSave('error');
    }
  };

  if (!isOpen || !settings) return null;

  const tabs = [
    { id: 'general', label: t('settings.general'), icon: Monitor },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'performance', label: t('settings.performance'), icon: Zap },
    { id: 'proxy', label: 'Proxy', icon: Wifi },
    { id: 'advanced', label: t('settings.advanced'), icon: Code },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden relative">
        {autoSaveStatus && (
          <div className={`absolute top-2 right-2 flex items-center space-x-1 text-sm ${
            autoSaveStatus === 'success' ? 'text-green-400' : 'text-red-400'
          }`}>
            {autoSaveStatus === 'success' ? (
              <CheckCircle size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>
              {autoSaveStatus === 'success'
                ? t('settings.autoSaveSuccess')
                : t('settings.autoSaveError')}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex h-[600px]">
          {/* Sidebar */}
          <div className="w-64 bg-gray-900 border-r border-gray-700">
            <div className="p-4">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-left transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {activeTab === 'general' && (
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
                        onChange={(e) => updateSettings({ theme: e.target.value as any })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="darkest">Darkest</option>
                        <option value="oled">OLED Black</option>
                        <option value="semilight">Semi Light</option>
                        <option value="rainbow">Rainbow</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Color Scheme
                      </label>
                      <select
                        value={settings.colorScheme}
                        onChange={(e) => updateSettings({ colorScheme: e.target.value as any })}
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
              )}

              {activeTab === 'security' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-medium text-white">{t('security.title')}</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('security.algorithm')}
                      </label>
                      <select
                        value={settings.encryptionAlgorithm}
                        onChange={(e) => updateSettings({ encryptionAlgorithm: e.target.value as any })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                      >
                        <option value="AES-256-GCM">AES-256-GCM</option>
                        <option value="AES-256-CBC">AES-256-CBC</option>
                        <option value="ChaCha20-Poly1305">ChaCha20-Poly1305</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('security.blockCipher')}
                      </label>
                      <select
                        value={settings.blockCipherMode}
                        onChange={(e) => updateSettings({ blockCipherMode: e.target.value as any })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                      >
                        <option value="GCM">GCM</option>
                        <option value="CBC">CBC</option>
                        <option value="CTR">CTR</option>
                        <option value="OFB">OFB</option>
                        <option value="CFB">CFB</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('security.iterations')}
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="number"
                          value={settings.keyDerivationIterations}
                          onChange={(e) => updateSettings({ keyDerivationIterations: parseInt(e.target.value) })}
                          className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                          min="10000"
                          max="1000000"
                        />
                        <button
                          onClick={handleBenchmark}
                          disabled={isBenchmarking}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
                        >
                          {isBenchmarking ? '...' : 'Benchmark'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('security.benchmarkTime')}
                      </label>
                      <input
                        type="number"
                        value={settings.benchmarkTimeSeconds}
                        onChange={(e) => updateSettings({ benchmarkTimeSeconds: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                        min="0.5"
                        max="10"
                        step="0.5"
                      />
                    </div>
                  </div>

                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={settings.autoBenchmarkIterations}
                      onChange={(e) => updateSettings({ autoBenchmarkIterations: e.target.checked })}
                      className="rounded border-gray-600 bg-gray-700 text-blue-600"
                    />
                    <span className="text-gray-300">{t('security.autoBenchmark')}</span>
                  </label>
                </div>
              )}

              {activeTab === 'performance' && (
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
                        onChange={(e) => updateSettings({ statusCheckMethod: e.target.value as any })}
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
              )}

              {activeTab === 'proxy' && (
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
              )}

              {activeTab === 'advanced' && (
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
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-700">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors flex items-center space-x-2"
          >
            <RotateCcw size={16} />
            <span>{t('settings.reset')}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            {t('settings.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
          >
            <Save size={16} />
            <span>{t('settings.save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
