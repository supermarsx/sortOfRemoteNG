import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Save,
  RotateCcw,
  Shield,
  Zap,
  Monitor,
  Code,
  Wifi,
  Palette,
  LayoutGrid,
  Power,
  Loader2,
  Gauge,
  Server,
  Settings as SettingsIcon,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, ProxyConfig, defaultSSHTerminalConfig } from '../../types/settings';
import GeneralSettings from './sections/GeneralSettings';
import ThemeSettings from './sections/ThemeSettings';
import LayoutSettings from './sections/LayoutSettings';
import SecuritySettings from './sections/SecuritySettings';
import PerformanceSettings from './sections/PerformanceSettings';
import ProxySettings from './sections/ProxySettings';
import AdvancedSettings from './sections/AdvancedSettings';
import StartupSettings from './sections/StartupSettings';
import ApiSettings from './sections/ApiSettings';
import RecoverySettings from './sections/RecoverySettings';
import SSHTerminalSettings from './sections/SSHTerminalSettings';
import { SettingsManager } from '../../utils/settingsManager';
import { ThemeManager } from '../../utils/themeManager';
import { loadLanguage } from '../../i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { useSettings } from '../../contexts/SettingsContext';
import { useToastContext } from '../../contexts/ToastContext';

// Default settings for each tab section
const TAB_DEFAULTS: Record<string, (keyof GlobalSettings)[]> = {
  general: [
    'language', 'autoSaveEnabled', 'autoSaveIntervalMinutes', 'singleWindowMode',
    'singleConnectionMode', 'reconnectOnReload', 'warnOnClose', 'warnOnExit',
    'warnOnDetachClose', 'quickConnectHistoryEnabled',
  ],
  startup: [
    'startMinimized', 'startMaximized', 'startWithSystem', 'reconnectPreviousSessions',
    'autoOpenLastCollection', 'lastOpenedCollectionId',
    'minimizeToTray', 'closeToTray', 'showTrayIcon', 'singleClickConnect',
    'singleClickDisconnect', 'doubleClickRename', 'hideQuickStartMessage', 'hideQuickStartButtons',
    'welcomeScreenTitle', 'welcomeScreenMessage',
  ],
  theme: [
    'theme', 'colorScheme', 'primaryAccentColor', 'backgroundGlowEnabled',
    'backgroundGlowColor', 'backgroundGlowOpacity', 'backgroundGlowRadius',
    'backgroundGlowBlur', 'windowTransparencyEnabled', 'windowTransparencyOpacity',
    'showTransparencyToggle', 'customCss', 'animationsEnabled', 'animationDuration', 'reduceMotion',
  ],
  layout: [
    'persistWindowSize', 'persistWindowPosition', 'persistSidebarWidth',
    'persistSidebarPosition', 'persistSidebarCollapsed', 'enableTabReorder',
    'enableConnectionReorder', 'middleClickCloseTab', 'showQuickConnectIcon', 'showCollectionSwitcherIcon',
    'showImportExportIcon', 'showSettingsIcon', 'showProxyMenuIcon',
    'showShortcutManagerIcon', 'showPerformanceMonitorIcon', 'showActionLogIcon',
    'showDevtoolsIcon', 'showSecurityIcon', 'showWolIcon',
  ],
  security: [
    'encryptionAlgorithm', 'blockCipherMode', 'keyDerivationIterations',
    'autoBenchmarkIterations', 'benchmarkTimeSeconds', 'totpEnabled',
    'totpIssuer', 'totpDigits', 'totpPeriod',
  ],
  performance: [
    'maxConcurrentConnections', 'connectionTimeout', 'retryAttempts', 'retryDelay',
    'enablePerformanceTracking', 'performancePollIntervalMs', 'performanceLatencyTarget',
  ],
  proxy: ['globalProxy'],
  advanced: [
    'tabGrouping', 'hostnameOverride', 'defaultTabLayout', 'enableTabDetachment',
    'enableTabResize', 'enableZoom', 'enableStatusChecking', 'statusCheckInterval',
    'statusCheckMethod', 'networkDiscovery', 'restApi', 'wolEnabled', 'wolPort',
    'wolBroadcastAddress', 'enableActionLog', 'logLevel', 'maxLogEntries',
    'exportEncryption',
  ],
  sshTerminal: ['sshTerminal'],
};

// Default values for settings (mirrors settingsManager.ts)
const DEFAULT_VALUES: Partial<GlobalSettings> = {
  language: 'en',
  theme: 'dark',
  colorScheme: 'blue',
  primaryAccentColor: '#3b82f6',
  autoSaveEnabled: false,
  autoSaveIntervalMinutes: 5,
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: true,
  warnOnClose: true,
  warnOnExit: true,
  warnOnDetachClose: true,
  quickConnectHistoryEnabled: true,
  startMinimized: false,
  startMaximized: false,
  startWithSystem: false,
  reconnectPreviousSessions: false,
  autoOpenLastCollection: true,
  lastOpenedCollectionId: undefined,
  minimizeToTray: false,
  closeToTray: false,
  showTrayIcon: true,
  singleClickConnect: false,
  singleClickDisconnect: false,
  doubleClickRename: false,
  animationsEnabled: true,
  animationDuration: 550,
  reduceMotion: false,
  backgroundGlowEnabled: true,
  backgroundGlowColor: '#2563eb',
  backgroundGlowOpacity: 0.25,
  backgroundGlowRadius: 520,
  backgroundGlowBlur: 140,
  windowTransparencyEnabled: false,
  windowTransparencyOpacity: 0.94,
  showTransparencyToggle: true,
  showQuickConnectIcon: true,
  showCollectionSwitcherIcon: true,
  showImportExportIcon: true,
  showSettingsIcon: true,
  showPerformanceMonitorIcon: true,
  showActionLogIcon: true,
  showDevtoolsIcon: true,
  showSecurityIcon: true,
  showProxyMenuIcon: true,
  showShortcutManagerIcon: true,
  showWolIcon: true,
  maxConcurrentConnections: 10,
  connectionTimeout: 30,
  retryAttempts: 3,
  retryDelay: 5000,
  enablePerformanceTracking: true,
  performancePollIntervalMs: 20000,
  performanceLatencyTarget: '1.1.1.1',
  encryptionAlgorithm: 'AES-256-GCM',
  blockCipherMode: 'GCM',
  keyDerivationIterations: 100000,
  autoBenchmarkIterations: false,
  benchmarkTimeSeconds: 1,
  totpEnabled: false,
  totpIssuer: 'sortOfRemoteNG',
  totpDigits: 6,
  totpPeriod: 30,
  tabGrouping: 'none',
  hostnameOverride: false,
  defaultTabLayout: 'tabs',
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
  middleClickCloseTab: true,
  enableStatusChecking: true,
  statusCheckInterval: 30,
  statusCheckMethod: 'socket',
  persistWindowSize: true,
  persistWindowPosition: true,
  persistSidebarWidth: true,
  persistSidebarPosition: true,
  persistSidebarCollapsed: true,
  wolEnabled: false,
  wolPort: 9,
  wolBroadcastAddress: '255.255.255.255',
  enableActionLog: true,
  logLevel: 'info',
  maxLogEntries: 1000,
  exportEncryption: false,
  globalProxy: {
    type: 'http',
    host: '',
    port: 8080,
    enabled: false,
  },
  sshTerminal: defaultSSHTerminalConfig,
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const { settings: contextSettings } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const { toast } = useToastContext();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const settingsManager = SettingsManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  const loadSettings = useCallback(async () => {
    const currentSettings = await settingsManager.loadSettings();
    setSettings(currentSettings);
  }, [settingsManager]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, loadSettings]);

  // Keyboard handling for ESC
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      await settingsManager.saveSettings(settings);
      
      // Apply language change
      if (settings.language !== i18n.language) {
        if (settings.language !== "en") {
          await loadLanguage(settings.language);
        }
        await i18n.changeLanguage(settings.language);
      }
      
      // Apply theme changes
      themeManager.applyTheme(
        settings.theme,
        settings.colorScheme,
        settings.primaryAccentColor,
      );
      
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const handleReset = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = async () => {
    if (!settings) return;
    
    // Reset only the current tab's settings to defaults
    const tabKeys = TAB_DEFAULTS[activeTab] || [];
    const resetUpdates: Partial<GlobalSettings> = {};
    
    for (const key of tabKeys) {
      if (key in DEFAULT_VALUES) {
        (resetUpdates as Record<string, unknown>)[key] = (DEFAULT_VALUES as Record<string, unknown>)[key];
      }
    }
    
    const newSettings = { ...settings, ...resetUpdates };
    setSettings(newSettings);
    
    try {
      await settingsManager.saveSettings(newSettings);
      
      // Re-apply theme if we reset theme settings
      if (activeTab === 'theme') {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.primaryAccentColor,
        );
      }
      
      showAutoSave('success');
    } catch (error) {
      console.error('Failed to reset tab settings:', error);
      showAutoSave('error');
    }
    
    setShowResetConfirm(false);
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
    if (status === 'success') {
      toast.success(t('settings.autoSaveSuccess'), 2000);
    } else {
      toast.error(t('settings.autoSaveError'), 3000);
    }
  };

  const updateSettings = async (updates: Partial<GlobalSettings>) => {
    if (!settings) return;

    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    try {
      // Use silent save for auto-save to prevent action log spam
      await settingsManager.saveSettings(newSettings, { silent: true });

      if (updates.language && updates.language !== i18n.language) {
        if (updates.language !== "en") {
          await loadLanguage(updates.language);
        }
        await i18n.changeLanguage(updates.language);
      }

      if (
        updates.theme ||
        updates.colorScheme ||
        typeof updates.primaryAccentColor !== "undefined"
      ) {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.primaryAccentColor,
        );
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
      // Use silent save for auto-save to prevent action log spam
      await settingsManager.saveSettings(newSettings, { silent: true });
      showAutoSave('success');
    } catch (error) {
      console.error('Failed to auto save settings:', error);
      showAutoSave('error');
    }
  };

  if (!isOpen || !settings) return null;

  const tabs = [
    { id: 'general', label: t('settings.general'), icon: Monitor },
    { id: 'startup', label: t('settings.startup.title', 'Startup & Tray'), icon: Power },
    { id: 'theme', label: t('settings.theme'), icon: Palette },
    { id: 'layout', label: 'Layout', icon: LayoutGrid },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'performance', label: t('settings.performance'), icon: Zap },
    { id: 'proxy', label: 'Proxy', icon: Wifi },
    { id: 'sshTerminal', label: t('settings.sshTerminal.tab', 'SSH Terminal'), icon: Terminal },
    { id: 'api', label: 'API Server', icon: Server },
    { id: 'advanced', label: t('settings.advanced'), icon: Code },
    { id: 'recovery', label: 'Recovery', icon: RotateCcw },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-4xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] ${contextSettings.backgroundGlowEnabled ? 'settings-glow' : ''} relative`}>
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <SettingsIcon size={18} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t("settings.title")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              data-tooltip={t("settings.reset")}
              aria-label={t("settings.reset")}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={handleSave}
              data-tooltip={t("settings.save")}
              aria-label={t("settings.save")}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Save size={16} />
            </button>
            <button
              onClick={onClose}
              data-tooltip={t("settings.cancel")}
              aria-label={t("settings.cancel")}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
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
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {activeTab === 'general' && (
                <GeneralSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'startup' && (
                <StartupSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'theme' && (
                <ThemeSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'layout' && (
                <LayoutSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'security' && (
                <SecuritySettings
                  settings={settings}
                  updateSettings={updateSettings}
                  handleBenchmark={handleBenchmark}
                  isBenchmarking={isBenchmarking}
                />
              )}

              {activeTab === 'performance' && (
                <PerformanceSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'proxy' && (
                <ProxySettings settings={settings} updateProxy={updateProxy} />
              )}

              {activeTab === 'sshTerminal' && (
                <SSHTerminalSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'api' && (
                <ApiSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'advanced' && (
                <AdvancedSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'recovery' && (
                <RecoverySettings onClose={onClose} />
              )}
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={showResetConfirm}
        message={t("settings.resetTabConfirm", `Reset "${tabs.find(t => t.id === activeTab)?.label}" settings to defaults?`)}
        onConfirm={confirmReset}
        onCancel={() => setShowResetConfirm(false)}
      />
      {isBenchmarking && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 shadow-2xl max-w-sm mx-4">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full border-4 border-gray-700 border-t-blue-500 animate-spin" />
                <Gauge className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {t("security.benchmarking", "Running Benchmark")}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Testing encryption performance to find optimal iteration count...
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>This may take {settings.benchmarkTimeSeconds || 1} second(s)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
