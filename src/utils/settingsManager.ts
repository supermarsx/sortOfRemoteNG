import { GlobalSettings, ActionLogEntry, PerformanceMetrics, CustomScript } from '../types/settings';
import { SecureStorage } from './storage';

const DEFAULT_SETTINGS: GlobalSettings = {
  language: 'en',
  theme: 'dark',
  colorScheme: 'blue',
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: true,
  warnOnClose: true,
  warnOnExit: true,

  autoLock: {
    enabled: false,
    timeoutMinutes: 10,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
  },

  maxConcurrentConnections: 10,
  connectionTimeout: 30,
  retryAttempts: 3,
  retryDelay: 5000,
  enablePerformanceTracking: true,

  encryptionAlgorithm: 'AES-256-GCM',
  blockCipherMode: 'GCM',
  keyDerivationIterations: 100000,
  autoBenchmarkIterations: true,
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
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  colorTags: {},

  enableStatusChecking: true,
  statusCheckInterval: 30,
  statusCheckMethod: 'socket',

  networkDiscovery: {
    enabled: false,
    ipRange: '192.168.1.0/24',
    portRanges: ['22', '80', '443', '3389', '5900'],
    protocols: ['ssh', 'http', 'https', 'rdp', 'vnc'],
    timeout: 5000,
    maxConcurrent: 50,
    customPorts: {
      ssh: [22],
      http: [80, 8080, 8000],
      https: [443, 8443],
      rdp: [3389],
      vnc: [5900, 5901, 5902],
      mysql: [3306],
      ftp: [21],
      telnet: [23],
    },
  },

  restApi: {
    enabled: false,
    port: 8080,
    authentication: false,
    apiKey: '',
    corsEnabled: true,
    rateLimiting: true,
  },

  wolEnabled: false,
  wolPort: 9,
  wolBroadcastAddress: '255.255.255.255',

  enableActionLog: true,
  logLevel: 'info',
  maxLogEntries: 1000,

  exportEncryption: false,
  exportPassword: undefined,
};

export class SettingsManager {
  private static instance: SettingsManager;
  private settings: GlobalSettings = DEFAULT_SETTINGS;
  private actionLog: ActionLogEntry[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  private customScripts: CustomScript[] = [];

  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  async loadSettings(): Promise<GlobalSettings> {
    try {
      const stored = localStorage.getItem('mremote-settings');
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
      return this.settings;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(settings: Partial<GlobalSettings>): Promise<void> {
    try {
      this.settings = { ...this.settings, ...settings };
      localStorage.setItem('mremote-settings', JSON.stringify(this.settings));
      this.logAction('info', 'Settings updated', undefined, 'Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  getSettings(): GlobalSettings {
    return this.settings;
  }

  // Action Logging
  logAction(
    level: 'debug' | 'info' | 'warn' | 'error',
    action: string,
    connectionId?: string,
    details: string = '',
    duration?: number
  ): void {
    if (!this.settings.enableActionLog) return;

    const entry: ActionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      action,
      connectionId,
      connectionName: connectionId ? this.getConnectionName(connectionId) : undefined,
      details,
      duration,
    };

    this.actionLog.unshift(entry);

    // Limit log size
    if (this.actionLog.length > this.settings.maxLogEntries) {
      this.actionLog = this.actionLog.slice(0, this.settings.maxLogEntries);
    }

    // Persist to localStorage
    this.saveActionLog();
  }

  getActionLog(): ActionLogEntry[] {
    return this.actionLog;
  }

  clearActionLog(): void {
    this.actionLog = [];
    this.saveActionLog();
  }

  private saveActionLog(): void {
    try {
      localStorage.setItem('mremote-action-log', JSON.stringify(this.actionLog));
    } catch (error) {
      console.error('Failed to save action log:', error);
    }
  }

  private loadActionLog(): void {
    try {
      const stored = localStorage.getItem('mremote-action-log');
      if (stored) {
        this.actionLog = JSON.parse(stored).map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
      }
    } catch (error) {
      console.error('Failed to load action log:', error);
    }
  }

  // Performance Metrics
  recordPerformanceMetric(metric: PerformanceMetrics): void {
    if (!this.settings.enablePerformanceTracking) return;

    this.performanceMetrics.unshift(metric);

    // Keep only last 1000 metrics
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(0, 1000);
    }

    this.savePerformanceMetrics();
  }

  getPerformanceMetrics(): PerformanceMetrics[] {
    return this.performanceMetrics;
  }

  private savePerformanceMetrics(): void {
    try {
      localStorage.setItem('mremote-performance-metrics', JSON.stringify(this.performanceMetrics));
    } catch (error) {
      console.error('Failed to save performance metrics:', error);
    }
  }

  private loadPerformanceMetrics(): void {
    try {
      const stored = localStorage.getItem('mremote-performance-metrics');
      if (stored) {
        this.performanceMetrics = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load performance metrics:', error);
    }
  }

  // Custom Scripts
  addCustomScript(script: Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>): CustomScript {
    const newScript: CustomScript = {
      ...script,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.customScripts.push(newScript);
    this.saveCustomScripts();
    this.logAction('info', 'Custom script added', undefined, `Script "${script.name}" created`);

    return newScript;
  }

  updateCustomScript(id: string, updates: Partial<CustomScript>): void {
    const index = this.customScripts.findIndex(script => script.id === id);
    if (index !== -1) {
      this.customScripts[index] = {
        ...this.customScripts[index],
        ...updates,
        updatedAt: new Date(),
      };
      this.saveCustomScripts();
      this.logAction('info', 'Custom script updated', undefined, `Script "${this.customScripts[index].name}" updated`);
    }
  }

  deleteCustomScript(id: string): void {
    const script = this.customScripts.find(s => s.id === id);
    this.customScripts = this.customScripts.filter(script => script.id !== id);
    this.saveCustomScripts();
    this.logAction('info', 'Custom script deleted', undefined, `Script "${script?.name}" deleted`);
  }

  getCustomScripts(): CustomScript[] {
    return this.customScripts;
  }

  private saveCustomScripts(): void {
    try {
      localStorage.setItem('mremote-custom-scripts', JSON.stringify(this.customScripts));
    } catch (error) {
      console.error('Failed to save custom scripts:', error);
    }
  }

  private loadCustomScripts(): void {
    try {
      const stored = localStorage.getItem('mremote-custom-scripts');
      if (stored) {
        this.customScripts = JSON.parse(stored).map((script: any) => ({
          ...script,
          createdAt: new Date(script.createdAt),
          updatedAt: new Date(script.updatedAt),
        }));
      }
    } catch (error) {
      console.error('Failed to load custom scripts:', error);
    }
  }

  // Key Derivation Benchmarking
  async benchmarkKeyDerivation(targetTimeSeconds: number = 1): Promise<number> {
    const testPassword = 'benchmark-test-password';
    const testSalt = 'benchmark-test-salt';
    let iterations = 10000;
    let lastTime = 0;

    this.logAction('info', 'Key derivation benchmark started', undefined, `Target time: ${targetTimeSeconds}s`);

    // Binary search for optimal iterations
    while (true) {
      const startTime = performance.now();
      
      // Simulate key derivation (simplified)
      for (let i = 0; i < iterations; i++) {
        // Simple hash operation to simulate work
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testPassword + testSalt + i));
      }
      
      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      if (Math.abs(duration - targetTimeSeconds) < 0.1) {
        break;
      }

      if (duration < targetTimeSeconds) {
        iterations = Math.floor(iterations * (targetTimeSeconds / duration));
      } else {
        iterations = Math.floor(iterations * (targetTimeSeconds / duration));
      }

      // Prevent infinite loop
      if (Math.abs(duration - lastTime) < 0.01) {
        break;
      }
      lastTime = duration;
    }

    this.logAction('info', 'Key derivation benchmark completed', undefined, `Optimal iterations: ${iterations}`);
    return iterations;
  }

  // Single Window Management
  checkSingleWindow(): boolean {
    if (!this.settings.singleWindowMode) return true;

    const windowId = sessionStorage.getItem('mremote-window-id');
    const activeWindowId = localStorage.getItem('mremote-active-window');

    if (!windowId) {
      const newWindowId = crypto.randomUUID();
      sessionStorage.setItem('mremote-window-id', newWindowId);
      localStorage.setItem('mremote-active-window', newWindowId);
      return true;
    }

    if (activeWindowId && activeWindowId !== windowId) {
      return false; // Another window is active
    }

    localStorage.setItem('mremote-active-window', windowId);
    return true;
  }

  // Helper methods
  private getConnectionName(connectionId: string): string {
    // This would need to be implemented to get connection name from context
    return `Connection ${connectionId.slice(0, 8)}`;
  }

  // Initialize all data
  async initialize(): Promise<void> {
    await this.loadSettings();
    this.loadActionLog();
    this.loadPerformanceMetrics();
    this.loadCustomScripts();

    // Auto-benchmark if enabled
    if (this.settings.autoBenchmarkIterations) {
      try {
        const optimalIterations = await this.benchmarkKeyDerivation(this.settings.benchmarkTimeSeconds);
        await this.saveSettings({ keyDerivationIterations: optimalIterations });
      } catch (error) {
        console.error('Auto-benchmark failed:', error);
      }
    }
  }
}
