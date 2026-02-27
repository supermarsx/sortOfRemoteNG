import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  MousePointerClick,
  Archive,
  CloudCog,
  Fingerprint,
  Globe,
  MonitorDot,
  Cpu,
  Circle,
  ListVideo,
  Search,
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
import BehaviorSettings from './sections/BehaviorSettings';
import SSHTerminalSettings from './sections/SSHTerminalSettings';
import BackupSettings from './sections/BackupSettings';
import CloudSyncSettings from './sections/CloudSyncSettings';
import { TrustVerificationSettings } from './sections/TrustVerificationSettings';
import WebBrowserSettings from './sections/WebBrowserSettings';
import RdpDefaultSettings from './sections/RdpDefaultSettings';
import BackendSettings from './sections/BackendSettings';
import RecordingSettings from './sections/RecordingSettings';
import MacroSettings from './sections/MacroSettings';
import { useSettingsSearch } from './useSettingsSearch';
import { useSettingHighlight } from './useSettingHighlight';
import { SettingsManager } from '../../utils/settingsManager';
import { ThemeManager } from '../../utils/themeManager';
import { loadLanguage } from '../../i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { useSettings } from '../../contexts/SettingsContext';
import { useToastContext } from '../../contexts/ToastContext';

// Default settings for each tab section
const TAB_DEFAULTS: Record<string, (keyof GlobalSettings)[]> = {
  general: [
    'language', 'autoSaveEnabled', 'autoSaveIntervalMinutes', 'warnOnClose', 'warnOnExit',
    'warnOnDetachClose', 'quickConnectHistoryEnabled',
  ],
  behavior: [
    'singleClickConnect', 'singleClickDisconnect', 'doubleClickRename', 'doubleClickConnect', 'middleClickCloseTab',
    'singleWindowMode', 'singleConnectionMode', 'reconnectOnReload', 'enableAutocomplete',
    'openConnectionInBackground', 'switchTabOnActivity', 'closeTabOnDisconnect', 'confirmCloseActiveTab',
    'enableRecentlyClosedTabs', 'recentlyClosedTabsMax',
    'focusTerminalOnTabSwitch', 'scrollTreeToActiveConnection', 'restoreLastActiveTab', 'tabCycleMru',
    'copyOnSelect', 'pasteOnRightClick', 'clearClipboardAfterSeconds', 'trimPastedWhitespace',
    'warnOnMultiLinePaste', 'maxPasteLengthChars',
    'idleDisconnectMinutes', 'sendKeepaliveOnIdle', 'keepaliveIntervalSeconds', 'dimInactiveTabs', 'showIdleDuration',
    'autoReconnectOnDisconnect', 'autoReconnectMaxAttempts', 'autoReconnectDelaySecs', 'notifyOnReconnect',
    'notifyOnConnect', 'notifyOnDisconnect', 'notifyOnError', 'notificationSound', 'flashTaskbarOnActivity',
    'confirmDisconnect', 'confirmDeleteConnection', 'confirmBulkOperations', 'confirmImport',
    'enableFileDragDropToTerminal', 'dragSensitivityPx', 'showDropPreview',
    'terminalScrollSpeed', 'terminalSmoothScroll', 'treeRightClickAction', 'mouseBackAction', 'mouseForwardAction',
    'toolDisplayModes',
  ],
  startup: [
    'startMinimized', 'startMaximized', 'startWithSystem', 'reconnectPreviousSessions',
    'autoOpenLastCollection', 'lastOpenedCollectionId',
    'minimizeToTray', 'closeToTray', 'showTrayIcon', 'hideQuickStartMessage', 'hideQuickStartButtons',
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
    'enableConnectionReorder', 'showQuickConnectIcon', 'showCollectionSwitcherIcon',
    'showImportExportIcon', 'showSettingsIcon', 'showProxyMenuIcon', 'showInternalProxyIcon',
    'showShortcutManagerIcon', 'showPerformanceMonitorIcon', 'showActionLogIcon',
    'showDevtoolsIcon', 'showSecurityIcon', 'showWolIcon',
    'showBulkSSHIcon', 'showScriptManagerIcon', 'showMacroManagerIcon',
    'showRdpSessionsIcon', 'showErrorLogBar',
  ],
  security: [
    'encryptionAlgorithm', 'blockCipherMode', 'keyDerivationIterations',
    'autoBenchmarkIterations', 'benchmarkTimeSeconds', 'totpEnabled',
    'totpIssuer', 'totpDigits', 'totpPeriod', 'totpAlgorithm',
  ],
  trust: [
    'tlsTrustPolicy', 'sshTrustPolicy', 'showTrustIdentityInfo', 'certExpiryWarningDays',
  ],
  performance: [
    'maxConcurrentConnections', 'connectionTimeout', 'retryAttempts', 'retryDelay',
    'enablePerformanceTracking', 'performancePollIntervalMs', 'performanceLatencyTarget',
  ],
  rdpDefaults: ['rdpDefaults'],
  backup: ['backup'],
  cloudSync: ['cloudSync'],
  proxy: ['globalProxy'],
  advanced: [
    'tabGrouping', 'hostnameOverride', 'defaultTabLayout', 'enableTabDetachment',
    'enableTabResize', 'enableZoom', 'enableStatusChecking', 'statusCheckInterval',
    'statusCheckMethod', 'networkDiscovery', 'restApi', 'wolEnabled', 'wolPort',
    'wolBroadcastAddress', 'enableActionLog', 'logLevel', 'maxLogEntries',
    'exportEncryption', 'settingsDialog',
  ],
  recording: ['recording', 'rdpRecording', 'webRecording', 'showRecordingManagerIcon'],
  macros: ['macros'],
  backend: ['backendConfig'],
  sshTerminal: ['sshTerminal'],
  webBrowser: [
    'proxyKeepaliveEnabled', 'proxyKeepaliveIntervalSeconds',
    'proxyAutoRestart', 'proxyMaxAutoRestarts', 'confirmDeleteAllBookmarks',
  ],
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
  showTransparencyToggle: false,
  showQuickConnectIcon: true,
  showCollectionSwitcherIcon: true,
  showImportExportIcon: true,
  showSettingsIcon: true,
  showPerformanceMonitorIcon: true,
  showActionLogIcon: true,
  showDevtoolsIcon: true,
  showSecurityIcon: true,
  showProxyMenuIcon: true,
  showInternalProxyIcon: true,
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
  totpAlgorithm: 'sha1' as const,
  tabGrouping: 'none',
  hostnameOverride: false,
  defaultTabLayout: 'tabs',
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
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
  settingsDialog: {
    showSaveButton: false,
    confirmBeforeReset: true,
    autoSave: true,
  },
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
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const searchResult = useSettingsSearch(searchQuery);
  useSettingHighlight(highlightKey);
  const { toast } = useToastContext();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
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

  // Reset scroll-to-bottom flag when tab changes
  useEffect(() => {
    setHasScrolledToBottom(false);
    // Also scroll to top
    contentScrollRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  // Observe the bottom sentinel to detect when user scrolled to the bottom
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    const container = contentScrollRef.current;
    if (!sentinel || !container) return;

    // If content doesn't overflow, show reset immediately
    const checkOverflow = () => {
      if (container.scrollHeight <= container.clientHeight + 10) {
        setHasScrolledToBottom(true);
      }
    };
    checkOverflow();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setHasScrolledToBottom(true);
      },
      { root: container, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, settings]);

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      // Flush any pending debounced save first, then do the explicit save
      await flushDebouncedSave();
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
    // Check the config at call-time (settings might have changed)
    const confirm = settings?.settingsDialog?.confirmBeforeReset ?? true;
    if (confirm) {
      setShowResetConfirm(true);
    } else {
      confirmReset();
    }
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

  // Debounced save: accumulate changes for 1.5s before writing to disk.
  // UI state updates happen immediately; only the persist call is debounced.
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<GlobalSettings | null>(null);

  // Flush any pending debounced save (used on explicit Save click and unmount)
  const flushDebouncedSave = useCallback(async () => {
    if (debounceSaveRef.current) {
      clearTimeout(debounceSaveRef.current);
      debounceSaveRef.current = null;
    }
    const pending = pendingSettingsRef.current;
    if (pending) {
      pendingSettingsRef.current = null;
      try {
        await settingsManager.saveSettings(pending, { silent: true });
        showAutoSave('success');
      } catch (error) {
        console.error('Failed to flush debounced save:', error);
        showAutoSave('error');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsManager, t]);

  // Flush on unmount so unsaved edits aren't lost
  useEffect(() => {
    return () => {
      if (debounceSaveRef.current) {
        clearTimeout(debounceSaveRef.current);
      }
      const pending = pendingSettingsRef.current;
      if (pending) {
        settingsManager.saveSettings(pending, { silent: true }).catch(() => {});
      }
    };
  }, [settingsManager]);

  /** Schedule a debounced persist of settings (1.5 s after last change).
   *  The in-memory singleton is updated *immediately* so that other code
   *  (e.g. the window-close handler) always reads the latest values.
   *  Only the IndexedDB write is debounced.
   *  When autoSave is disabled, only the in-memory singleton is updated;
   *  the user must click Save to persist to disk. */
  const scheduleSave = useCallback((newSettings: GlobalSettings) => {
    // Immediately update the in-memory singleton so getSettings() is never stale
    settingsManager.applyInMemory(newSettings);

    // If auto-save is disabled, don't schedule a disk write
    const autoSave = newSettings.settingsDialog?.autoSave ?? true;
    if (!autoSave) {
      pendingSettingsRef.current = newSettings;
      return;
    }

    pendingSettingsRef.current = newSettings;
    if (debounceSaveRef.current) {
      clearTimeout(debounceSaveRef.current);
    }
    debounceSaveRef.current = setTimeout(async () => {
      debounceSaveRef.current = null;
      const toSave = pendingSettingsRef.current;
      if (!toSave) return;
      pendingSettingsRef.current = null;
      try {
        await settingsManager.saveSettings(toSave, { silent: true });
        showAutoSave('success');
      } catch (error) {
        console.error('Failed to auto save settings:', error);
        showAutoSave('error');
      }
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsManager, t]);

  const updateSettings = async (updates: Partial<GlobalSettings>) => {
    if (!settings) return;

    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    // Apply language/theme changes immediately (UI responsiveness)
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

    // Debounce the actual disk write
    scheduleSave(newSettings);
  };

  const updateProxy = async (updates: Partial<ProxyConfig>) => {
    if (!settings) return;

    const newSettings = {
      ...settings,
      globalProxy: { ...settings.globalProxy, ...updates } as ProxyConfig,
    };
    setSettings(newSettings);

    // Debounce the actual disk write
    scheduleSave(newSettings);
  };

  if (!isOpen || !settings) return null;

  const dialogConfig = {
    showSaveButton: false,
    confirmBeforeReset: true,
    autoSave: true,
    ...settings.settingsDialog,
  };

  const tabs = [
    { id: 'general', label: t('settings.general'), icon: Monitor },
    { id: 'behavior', label: 'Behavior', icon: MousePointerClick },
    { id: 'startup', label: t('settings.startup.title', 'Startup & Tray'), icon: Power },
    { id: 'theme', label: t('settings.theme'), icon: Palette },
    { id: 'layout', label: 'Layout', icon: LayoutGrid },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'trust', label: 'Trust Center', icon: Fingerprint },
    { id: 'performance', label: t('settings.performance'), icon: Zap },
    { id: 'rdpDefaults', label: 'RDP', icon: MonitorDot },
    { id: 'backup', label: 'Backup', icon: Archive },
    { id: 'cloudSync', label: 'Cloud Sync', icon: CloudCog },
    { id: 'proxy', label: 'Proxy', icon: Wifi },
    { id: 'sshTerminal', label: t('settings.sshTerminal.tab', 'SSH Terminal'), icon: Terminal },
    { id: 'recording', label: 'Recording', icon: Circle },
    { id: 'macros', label: 'Macros', icon: ListVideo },
    { id: 'webBrowser', label: 'Web Browser', icon: Globe },
    { id: 'backend', label: 'Backend', icon: Cpu },
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
            {dialogConfig.showSaveButton && (
              <button
                onClick={handleSave}
                data-tooltip={t("settings.save")}
                aria-label={t("settings.save")}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors"
              >
                <Save size={16} />
              </button>
            )}
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
          <div className="w-64 bg-[var(--color-background)] border-r border-[var(--color-border)] flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-[var(--color-border)]/50">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)]/50 rounded-lg">
                <Search size={14} className="text-[var(--color-textSecondary)] flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setHighlightKey(null); }}
                  placeholder="Search settings..."
                  className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-gray-500 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setHighlightKey(null); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            {/* Tab list */}
            <div className="flex-1 overflow-y-auto p-3">
              {(searchQuery ? tabs.filter(t => searchResult.matchedSections.has(t.id)) : tabs).map(tab => {
                const Icon = tab.icon;
                const sectionResults = searchResult.resultsBySection.get(tab.id);
                return (
                  <div key={tab.id}>
                    <button
                      onClick={() => { setActiveTab(tab.id); setHighlightKey(null); }}
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-left transition-colors ${
                        activeTab === tab.id
                          ? 'bg-blue-600 text-[var(--color-text)]'
                          : 'text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]'
                      }`}
                    >
                      <Icon size={16} />
                      <span className="text-sm">{tab.label}</span>
                      {searchQuery && sectionResults && (
                        <span className="ml-auto text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded-full">
                          {sectionResults.length}
                        </span>
                      )}
                    </button>
                    {/* Show matched settings under active section when searching */}
                    {searchQuery && sectionResults && activeTab === tab.id && (
                      <div className="ml-7 mt-0.5 mb-1 space-y-0.5">
                        {sectionResults.map(entry => (
                          <button
                            key={entry.key}
                            onClick={() => { setActiveTab(tab.id); setHighlightKey(entry.key); }}
                            className="w-full text-left px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/50 rounded truncate"
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {searchQuery && searchResult.matchedSections.size === 0 && (
                <div className="p-4 text-center text-xs text-gray-500">No settings match "{searchQuery}"</div>
              )}
            </div>
          </div>

          {/* Content */}
          <div ref={contentScrollRef} className="flex-1 overflow-y-auto min-h-0 flex flex-col">
            <div className="flex-1 p-6">
              {activeTab === 'general' && (
                <GeneralSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'behavior' && (
                <BehaviorSettings settings={settings} updateSettings={updateSettings} />
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

              {activeTab === 'trust' && (
                <TrustVerificationSettings
                  settings={settings}
                  updateSettings={updateSettings}
                />
              )}

              {activeTab === 'performance' && (
                <PerformanceSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'rdpDefaults' && (
                <RdpDefaultSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'backup' && (
                <BackupSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'cloudSync' && (
                <CloudSyncSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'proxy' && (
                <ProxySettings settings={settings} updateProxy={updateProxy} />
              )}

              {activeTab === 'sshTerminal' && (
                <SSHTerminalSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'recording' && (
                <RecordingSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'macros' && (
                <MacroSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'webBrowser' && (
                <WebBrowserSettings settings={settings} updateSettings={updateSettings} />
              )}

              {activeTab === 'backend' && (
                <BackendSettings settings={settings} updateSettings={updateSettings} />
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

              {/* Sentinel for scroll-to-bottom detection */}
              <div ref={bottomSentinelRef} className="h-px" />
            </div>

            {/* Per-tab reset footer — only visible after scrolling to bottom */}
            {hasScrolledToBottom && activeTab !== 'recovery' && TAB_DEFAULTS[activeTab] && (
              <div className="sticky bottom-0 flex justify-end px-6 py-2 border-t border-[var(--color-border)]/30 bg-[var(--color-surface)]/80 backdrop-blur-sm">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
                >
                  <RotateCcw size={12} />
                  {t("settings.reset", "Reset to Defaults")}
                </button>
              </div>
            )}
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
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 shadow-2xl max-w-sm mx-4">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full border-4 border-[var(--color-border)] border-t-blue-500 animate-spin" />
                <Gauge className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">
                {t("security.benchmarking", "Running Benchmark")}
              </h3>
              <p className="text-sm text-[var(--color-textSecondary)] mb-4">
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
