/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { GlobalSettings, defaultSSHTerminalConfig, defaultBackupConfig, defaultCloudSyncConfig } from '../types/settings';
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
  detectUnexpectedClose: true,
  confirmMainAppClose: false,
  hideQuickStartMessage: false,
  hideQuickStartButtons: false,
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
  backgroundGlowFollowsColorScheme: true,
  backgroundGlowColor: "#2563eb",
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
  showErrorLogBar: false,
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
  middleClickCloseTab: true,
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
    ipRange: '192.168.1.0/24',
    portRanges: ['22', '3389', '5900'],
    protocols: ['ssh', 'rdp', 'vnc'],
    timeout: 1000,
    maxConcurrent: 50,
    maxPortConcurrent: 10,
    customPorts: {},
    probeStrategies: {},
    cacheTTL: 300000,
    hostnameTtl: 600000,
    macTtl: 3600000,
  },
  restApi: {
    enabled: false,
    port: 8081,
    useRandomPort: false,
    authentication: false,
    corsEnabled: true,
    rateLimiting: false,
    startOnLaunch: false,
    allowRemoteConnections: false,
    sslEnabled: false,
    sslMode: 'manual' as const,
    sslCertPath: '',
    sslKeyPath: '',
    maxRequestsPerMinute: 60,
    maxThreads: 4,
    requestTimeout: 30,
  },
  // Wake on LAN
  wolEnabled: true,
  wolPort: 9,
  wolBroadcastAddress: '255.255.255.255',
  // Logging
  enableActionLog: true,
  logLevel: 'info',
  maxLogEntries: 1000,
  // Export Settings
  exportEncryption: true,
  // SSH Terminal Settings
  sshTerminal: defaultSSHTerminalConfig,
  // Backup Settings
  backup: defaultBackupConfig,
  // Cloud Sync Settings
  cloudSync: defaultCloudSyncConfig,
  showBulkSSHIcon: true,
  showScriptManagerIcon: true,
  showSyncBackupStatusIcon: false,     // Legacy combined - disabled by default
  showBackupStatusIcon: true,          // Separate backup icon
  showCloudSyncStatusIcon: true,       // Separate cloud sync icon
  autoRepatriateWindow: true,
  // Trust & Verification
  enableAutocomplete: false,
  tlsTrustPolicy: 'tofu',
  sshTrustPolicy: 'tofu',
  showTrustIdentityInfo: true,
  certExpiryWarningDays: 5,
  // CredSSP Remediation Defaults
  credsspDefaults: {
    oracleRemediation: 'mitigated',
    allowHybridEx: false,
    nlaFallbackToTls: true,
    tlsMinVersion: '1.2',
    ntlmEnabled: true,
    kerberosEnabled: false,
    pku2uEnabled: false,
    restrictedAdmin: false,
    remoteCredentialGuard: false,
    enforceServerPublicKeyValidation: true,
    credsspVersion: 6,
    sspiPackageList: '',
    nlaMode: 'required',
    serverCertValidation: 'validate',
  },
  // Password Reveal
  passwordReveal: {
    enabled: true,
    mode: 'toggle',
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
  },
  // RDP Global Defaults
  rdpDefaults: {
    useCredSsp: true,
    enableTls: true,
    enableNla: true,
    autoLogon: false,
    gatewayEnabled: false,
    gatewayHostname: '',
    gatewayPort: 443,
    gatewayAuthMethod: 'ntlm',
    gatewayTransportMode: 'auto',
    gatewayBypassLocal: true,
    enhancedSessionMode: false,
    autoDetect: false,
    negotiationStrategy: 'nla-first',
    maxRetries: 3,
    retryDelayMs: 1000,
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultColorDepth: 32,
    smartSizing: true,
    tcpConnectTimeoutSecs: 10,
    tcpNodelay: true,
    tcpKeepAlive: true,
    tcpKeepAliveIntervalSecs: 60,
    tcpRecvBufferSize: 262144,
    tcpSendBufferSize: 262144,
    // Performance / Frame Delivery
    targetFps: 30,
    frameBatching: false,
    frameBatchIntervalMs: 33,
    fullFrameSyncInterval: 300,
    readTimeoutMs: 16,
    // Bitmap Codecs
    codecsEnabled: true,
    remoteFxEnabled: true,
    remoteFxEntropy: 'rlgr3' as const,
    gfxEnabled: false,
    h264Decoder: 'auto' as const,
    // Render Backend
    renderBackend: 'webview' as const,
    frontendRenderer: 'auto' as const,
  },
  // RDP Session Panel Settings
  rdpSessionDisplayMode: 'popup' as const,
  rdpSessionThumbnailsEnabled: true,
  rdpSessionThumbnailPolicy: 'realtime' as const,
  rdpSessionThumbnailInterval: 5,
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
    
    // Log each changed setting
    const changedKeys = Object.keys(updates) as (keyof GlobalSettings)[];
    if (changedKeys.length > 0) {
      const settingDetails = changedKeys
        .map(key => {
          const oldVal = settings[key];
          const newVal = updates[key];
          // Format the value for display
          const formatVal = (v: unknown): string => {
            if (v === null || v === undefined) return 'null';
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v);
          };
          return `${key}: ${formatVal(oldVal)} → ${formatVal(newVal)}`;
        })
        .join(', ');
      
      settingsManager.logAction(
        'info',
        'Settings changed',
        undefined,
        settingDetails
      );
    }
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
