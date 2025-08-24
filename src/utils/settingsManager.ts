import { GlobalSettings, ActionLogEntry, PerformanceMetrics, CustomScript } from '../types/settings';
import { SecureStorage } from './storage';
import { IndexedDbService } from './indexedDbService';
import { generateId } from './id';

/**
 * Default global application settings. These values are used when no user
 * settings have been persisted. Any settings not provided by the user will
 * fall back to these defaults.
 */
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

/**
 * Handles persistence and retrieval of application settings, action logs,
 * performance metrics and custom scripts. Implemented as a singleton so that
 * state is shared across the application.
 */
export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private settings: GlobalSettings = DEFAULT_SETTINGS;
  private actionLog: ActionLogEntry[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  private customScripts: CustomScript[] = [];

  /**
   * Retrieves the singleton instance of the manager.
   * @returns {SettingsManager} The shared instance.
   */
  static getInstance(): SettingsManager {
    if (SettingsManager.instance === null) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Resets the singleton instance. Primarily used for testing to create a new
   * instance with a clean state.
   */
  static resetInstance(): void {
    SettingsManager.instance = null;
  }

  /**
   * Loads settings from persistent storage.
   * @returns {Promise<GlobalSettings>} Resolves with the merged settings; returns defaults if retrieval fails.
   */
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

  /**
   * Persists new settings to storage, merging with existing ones.
   * @param {Partial<GlobalSettings>} settings - Settings to merge and save.
   * @returns {Promise<void>} Resolves when saving succeeds.
   * @throws {Error} If the settings could not be persisted.
   */
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

  /**
   * Provides access to the currently loaded settings.
   * @returns {GlobalSettings} The in-memory settings object.
   */
  getSettings(): GlobalSettings {
    return this.settings;
  }

  // Action Logging
  /**
   * Adds an entry to the action log and persists the log. Older entries are
   * discarded when the log exceeds the configured maximum.
   * @param {'debug' | 'info' | 'warn' | 'error'} level - Severity level.
   * @param {string} action - Description of the action performed.
   * @param {string} [connectionId] - Optional connection identifier.
   * @param {string} [details=''] - Additional details about the action.
   * @param {number} [duration] - Optional duration associated with the action.
   */
  logAction(
    level: 'debug' | 'info' | 'warn' | 'error',
    action: string,
    connectionId?: string,
    details: string = '',
    duration?: number
  ): void {
    if (!this.settings.enableActionLog) return;

    const entry: ActionLogEntry = {
      id: generateId(),
      timestamp: new Date(),
      level,
      action,
      connectionId,
      connectionName: connectionId ? this.getConnectionName(connectionId) : undefined,
      details,
      duration,
    };

    this.actionLog.unshift(entry); // Add newest entry to the front

    // Limit log size to avoid unbounded memory growth
    if (this.actionLog.length > this.settings.maxLogEntries) {
      // Keep only the most recent maxLogEntries entries
      this.actionLog = this.actionLog.slice(0, this.settings.maxLogEntries);
    }

    // Persist asynchronously so logs survive page reloads
    this.saveActionLog();
  }

  /**
   * Returns the current action log.
   * @returns {ActionLogEntry[]} Array of action log entries.
   */
  getActionLog(): ActionLogEntry[] {
    return this.actionLog;
  }

  /**
   * Removes all log entries and persists the empty log.
   */
  clearActionLog(): void {
    this.actionLog = [];
    this.saveActionLog();
  }

  private async saveActionLog(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-action-log', this.actionLog);
    } catch (error) {
      console.error('Failed to save action log:', error);
    }
  }

  private async loadActionLog(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<any[]>('mremote-action-log');
      if (stored) {
        this.actionLog = stored.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
      }
    } catch (error) {
      console.error('Failed to load action log:', error);
    }
  }

  // Performance Metrics
  /**
   * Records a performance metric and persists it. Only the most recent 1000
   * metrics are retained to limit storage usage.
   * @param {PerformanceMetrics} metric - Metric data to record.
   */
  recordPerformanceMetric(metric: PerformanceMetrics): void {
    if (!this.settings.enablePerformanceTracking) return;

    this.performanceMetrics.unshift(metric); // Store newest first

    // Keep only last 1000 metrics to control data size
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(0, 1000);
    }

    // Persist asynchronously; errors are logged inside savePerformanceMetrics
    void this.savePerformanceMetrics();
  }

  /**
     * Retrieves recorded performance metrics.
     * @returns {PerformanceMetrics[]} Array of metrics.
     */
  getPerformanceMetrics(): PerformanceMetrics[] {
    return this.performanceMetrics;
  }

  private async savePerformanceMetrics(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-performance-metrics', this.performanceMetrics);
    } catch (error) {
      console.error('Failed to save performance metrics:', error);
    }
  }

  private async loadPerformanceMetrics(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<PerformanceMetrics[]>('mremote-performance-metrics');
      if (stored) {
        this.performanceMetrics = stored;
      }
    } catch (error) {
      console.error('Failed to load performance metrics:', error);
    }
  }

  // Custom Scripts
  /**
   * Adds a new custom script and persists it.
   * @param {Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>} script - Script details without id and timestamps.
   * @returns {CustomScript} The newly created script with id and timestamps.
   */
  addCustomScript(script: Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>): CustomScript {
    const newScript: CustomScript = {
      ...script,
      id: generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.customScripts.push(newScript);
    void this.saveCustomScripts();
    this.logAction('info', 'Custom script added', undefined, `Script "${script.name}" created`);

    return newScript;
  }

  /**
   * Updates an existing custom script if it exists.
   * @param {string} id - Identifier of the script to update.
   * @param {Partial<CustomScript>} updates - Fields to update.
   */
  updateCustomScript(id: string, updates: Partial<CustomScript>): void {
    const index = this.customScripts.findIndex(script => script.id === id);
    if (index !== -1) {
      this.customScripts[index] = {
        ...this.customScripts[index],
        ...updates,
        updatedAt: new Date(),
      };
      void this.saveCustomScripts();
      this.logAction('info', 'Custom script updated', undefined, `Script "${this.customScripts[index].name}" updated`);
    }
  }

  /**
   * Deletes a custom script.
   * @param {string} id - Identifier of the script to remove.
   */
  deleteCustomScript(id: string): void {
    const script = this.customScripts.find(s => s.id === id);
    this.customScripts = this.customScripts.filter(script => script.id !== id);
    void this.saveCustomScripts();
    this.logAction('info', 'Custom script deleted', undefined, `Script "${script?.name}" deleted`);
  }

  /**
   * Lists all stored custom scripts.
   * @returns {CustomScript[]} Array of scripts.
   */
  getCustomScripts(): CustomScript[] {
    return this.customScripts;
  }

  private async saveCustomScripts(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-custom-scripts', this.customScripts);
    } catch (error) {
      console.error('Failed to save custom scripts:', error);
    }
  }

  private async loadCustomScripts(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<any[]>('mremote-custom-scripts');
      if (stored) {
        this.customScripts = stored.map((script: any) => ({
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
  /**
   * Estimates the optimal number of key derivation iterations using a binary
   * search approach to reach a target duration.
   * @param {number} [targetTimeSeconds=1] - Desired time for a derivation run.
   * @param {number} [maxTimeSeconds=30] - Maximum total time to spend benchmarking.
   * @param {number} [maxIterations=20] - Maximum iterations of the search loop.
   * @returns {Promise<number>} Estimated iteration count.
   * @throws {Error} If required Web APIs (performance or crypto.subtle) are unavailable.
   */
  async benchmarkKeyDerivation(
    targetTimeSeconds: number = 1,
    maxTimeSeconds: number = 30,
    maxIterations: number = 20
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
      `Target time: ${targetTimeSeconds}s`
    );

    // Binary search for optimal iterations
    while (iterationCount < maxIterations && elapsedTime < maxElapsedMs) {
      const startTime = globalThis.performance.now();
      iterationCount++;

      // Simulate key derivation (simplified)
      for (let i = 0; i < iterations; i++) {
        // Simple hash operation to simulate work
        await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(testPassword + testSalt + i)
        );

        // Track elapsed time inside the loop and break if exceeded
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
  /**
   * Ensures only one application window is active when singleWindowMode is
   * enabled.
   * @returns {Promise<boolean>} Resolves false if another window is active.
   */
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
      return false; // Another window is active
    }

    await IndexedDbService.setItem('mremote-active-window', windowId);
    return true;
  }

  // Helper methods
  private getConnectionName(connectionId: string): string {
    // This would need to be implemented to get connection name from context
    return `Connection ${connectionId.slice(0, 8)}`;
  }

  // Initialize all data
  /**
   * Loads all persisted data and performs optional auto-benchmarking.
   * Should be called during application start up.
   */
  async initialize(): Promise<void> {
    await this.loadSettings();
    await this.loadActionLog();
    await this.loadPerformanceMetrics();
    await this.loadCustomScripts();

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
