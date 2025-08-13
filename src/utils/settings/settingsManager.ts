import { GlobalSettings, PerformanceMetrics, CustomScript, ActionLogEntry } from '../../types/settings';
import { IndexedDbService } from '../indexedDbService';
import { generateId } from '../id';
import { ActionLogManager } from './actionLogManager';
import { PerformanceMetricsManager } from './performanceMetricsManager';
import { CustomScriptManager } from './customScriptManager';

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
    maxPortConcurrent: 100,
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
  private static instance: SettingsManager | null = null;
  private settings: GlobalSettings = DEFAULT_SETTINGS;

  private actionLogManager = new ActionLogManager(
    () => this.settings,
    this.getConnectionName.bind(this),
  );
  private performanceMetricsManager = new PerformanceMetricsManager(() => this.settings);
  private customScriptManager = new CustomScriptManager(this.logAction.bind(this));

  static getInstance(): SettingsManager {
    if (SettingsManager.instance === null) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  static resetInstance(): void {
    SettingsManager.instance = null;
  }

  async loadSettings(): Promise<GlobalSettings> {
    try {
      const stored = await IndexedDbService.getItem<GlobalSettings>('mremote-settings');
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...stored };
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
      await IndexedDbService.setItem('mremote-settings', this.settings);
      this.logAction('info', 'Settings updated', undefined, 'Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  getSettings(): GlobalSettings {
    return this.settings;
  }

  logAction(
    level: 'debug' | 'info' | 'warn' | 'error',
    action: string,
    connectionId?: string,
    details: string = '',
    duration?: number,
  ): void {
    this.actionLogManager.logAction(level, action, connectionId, details, duration);
  }

  getActionLog(): ActionLogEntry[] {
    return this.actionLogManager.getActionLog();
  }

  clearActionLog(): void {
    this.actionLogManager.clearActionLog();
  }

  recordPerformanceMetric(metric: PerformanceMetrics): void {
    this.performanceMetricsManager.recordPerformanceMetric(metric);
  }

  getPerformanceMetrics(): PerformanceMetrics[] {
    return this.performanceMetricsManager.getPerformanceMetrics();
  }

  addCustomScript(script: Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>): CustomScript {
    return this.customScriptManager.addCustomScript(script);
  }

  updateCustomScript(id: string, updates: Partial<CustomScript>): void {
    this.customScriptManager.updateCustomScript(id, updates);
  }

  deleteCustomScript(id: string): void {
    this.customScriptManager.deleteCustomScript(id);
  }

  getCustomScripts(): CustomScript[] {
    return this.customScriptManager.getCustomScripts();
  }

  async benchmarkKeyDerivation(
    targetTimeSeconds: number = 1,
    maxTimeSeconds: number = 30,
    maxIterations: number = 20,
  ): Promise<number> {
    if (
      typeof globalThis.performance?.now !== 'function' ||
      typeof globalThis.crypto?.subtle === 'undefined'
    ) {
      throw new Error('Required Web APIs not available');
    }

    const testPassword = 'benchmark-test-password';
    const testSalt = 'benchmark-test-salt';
    let iterations = 10000;
    let lastTime = 0;
    let iterationCount = 0;
    let elapsedTime = 0;
    const maxElapsedMs = maxTimeSeconds * 1000;
    const benchmarkStart = globalThis.performance.now();

    this.logAction(
      'info',
      'Key derivation benchmark started',
      undefined,
      `Target time: ${targetTimeSeconds}s`,
    );

    while (iterationCount < maxIterations && elapsedTime < maxElapsedMs) {
      const startTime = globalThis.performance.now();
      iterationCount++;

      for (let i = 0; i < iterations; i++) {
        await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(testPassword + testSalt + i),
        );

        elapsedTime = globalThis.performance.now() - benchmarkStart;
        if (elapsedTime >= maxElapsedMs) {
          break;
        }
      }

      const endTime = globalThis.performance.now();
      const duration = (endTime - startTime) / 1000;
      elapsedTime = endTime - benchmarkStart;

      if (elapsedTime >= maxElapsedMs || iterationCount >= maxIterations) {
        break;
      }

      if (Math.abs(duration - targetTimeSeconds) < 0.1) {
        break;
      }

      iterations = Math.floor(iterations * (targetTimeSeconds / duration));

      if (Math.abs(duration - lastTime) < 0.01) {
        break;
      }
      lastTime = duration;
    }

    this.logAction('info', 'Key derivation benchmark completed', undefined, `Optimal iterations: ${iterations}`);
    return iterations;
  }

  async checkSingleWindow(): Promise<boolean> {
    if (!this.settings.singleWindowMode) return true;

    const windowId = sessionStorage.getItem('mremote-window-id');
    const activeWindowId = await IndexedDbService.getItem<string>('mremote-active-window');

    if (!windowId) {
      const newWindowId = generateId();
      sessionStorage.setItem('mremote-window-id', newWindowId);
      await IndexedDbService.setItem('mremote-active-window', newWindowId);
      return true;
    }

    if (activeWindowId && activeWindowId !== windowId) {
      return false;
    }

    await IndexedDbService.setItem('mremote-active-window', windowId);
    return true;
  }

  private getConnectionName(connectionId: string): string {
    return `Connection ${connectionId.slice(0, 8)}`;
  }

  async initialize(): Promise<void> {
    await this.loadSettings();
    await this.actionLogManager.load();
    await this.performanceMetricsManager.load();
    await this.customScriptManager.load();

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

