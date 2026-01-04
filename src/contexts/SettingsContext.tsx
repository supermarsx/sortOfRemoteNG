import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { GlobalSettings } from '../types/settings';
import { SettingsManager } from '../utils/settingsManager';

interface SettingsContextType {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

const defaultSettings: GlobalSettings = {
  language: 'en',
  theme: 'dark',
  colorScheme: 'blue',
  autoSaveEnabled: false,
  autoSaveIntervalMinutes: 5,
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: true,
  warnOnClose: true,
  warnOnExit: true,
  warnOnDetachClose: true,
  quickConnectHistoryEnabled: true,
  quickConnectHistory: [],
  startMinimized: false,
  startMaximized: false,
  startWithSystem: false,
  reconnectPreviousSessions: false,
  minimizeToTray: false,
  closeToTray: false,
  showTrayIcon: true,
  singleClickConnect: false,
  singleClickDisconnect: false,
  doubleClickRename: false,
  animationsEnabled: true,
  animationDuration: 200,
  reduceMotion: false,
  backgroundGlowEnabled: true,
  backgroundGlowColor: "#2563eb",
  backgroundGlowOpacity: 0.25,
  backgroundGlowRadius: 520,
  backgroundGlowBlur: 140,
  windowTransparencyEnabled: false,
  windowTransparencyOpacity: 0.94,
  showQuickConnectIcon: true,
  showCollectionSwitcherIcon: true,
  showImportExportIcon: true,
  showSettingsIcon: true,
  showPerformanceMonitorIcon: true,
  showActionLogIcon: true,
  showDevtoolsIcon: true,
  showSecurityIcon: true,
  showLanguageSelectorIcon: true,
  showProxyMenuIcon: true,
  showShortcutManagerIcon: true,
  showWolIcon: true,
  autoLock: {
    enabled: false,
    timeoutMinutes: 15,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
  },
  maxConcurrentConnections: 10,
  connectionTimeout: 30,
  retryAttempts: 3,
  retryDelay: 5000,
  enablePerformanceTracking: true,
  performancePollIntervalMs: 20000,
  performanceLatencyTarget: "1.1.1.1",
  encryptionAlgorithm: 'AES-256-GCM',
  blockCipherMode: 'GCM',
  keyDerivationIterations: 100000,
  autoBenchmarkIterations: false,
  benchmarkTimeSeconds: 1,
  totpEnabled: false,
  totpIssuer: 'sortOfRemoteNG',
  totpDigits: 6,
  totpPeriod: 30,
  globalProxy: {
    type: 'http',
    host: '',
    port: 8080,
    enabled: false,
  },
  tabGrouping: 'none',
  hostnameOverride: false,
  defaultTabLayout: 'tabs',
  enableTabDetachment: true,
  enableTabResize: true,
  enableZoom: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
  colorTags: {},
  enableStatusChecking: true,
  statusCheckInterval: 60000,
  statusCheckMethod: 'ping',
  persistWindowSize: true,
  persistWindowPosition: true,
  persistSidebarWidth: true,
  persistSidebarPosition: true,
  persistSidebarCollapsed: true,
  networkDiscovery: {
    enabled: true,
    autoScan: false,
    scanInterval: 300000,
    subnet: '',
    portRange: '22,3389,5900',
    timeout: 1000,
  },
  restApi: {
    enabled: false,
    port: 8081,
  },
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<GlobalSettings>(defaultSettings);
  const settingsManager = SettingsManager.getInstance();

  const reloadSettings = useCallback(async () => {
    const loadedSettings = await settingsManager.loadSettings();
    setSettings(loadedSettings);
  }, [settingsManager]);

  const updateSettings = useCallback(async (updates: Partial<GlobalSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await settingsManager.saveSettings(newSettings);
  }, [settings, settingsManager]);

  useEffect(() => {
    reloadSettings();
  }, [reloadSettings]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, reloadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (!context) {
    // Return a default for testing environments without provider
    return {
      settings: defaultSettings,
      updateSettings: async () => {},
      reloadSettings: async () => {},
    };
  }
  return context;
};

export default SettingsContext;
