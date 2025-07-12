import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { GlobalSettings } from '../src/types/settings';

// mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } })
}));

const mockSettings: GlobalSettings = {
  language: 'en',
  theme: 'dark',
  colorScheme: 'blue',
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: false,
  warnOnClose: false,
  warnOnExit: false,
  autoLock: { enabled: false, timeoutMinutes: 10, lockOnIdle: true, lockOnSuspend: true, requirePassword: true },
  maxConcurrentConnections: 5,
  connectionTimeout: 30,
  retryAttempts: 0,
  retryDelay: 5000,
  enablePerformanceTracking: false,
  encryptionAlgorithm: 'AES-256-GCM',
  blockCipherMode: 'GCM',
  keyDerivationIterations: 1000,
  autoBenchmarkIterations: false,
  benchmarkTimeSeconds: 1,
  totpEnabled: false,
  totpIssuer: '',
  totpDigits: 6,
  totpPeriod: 30,
  globalProxy: { type: 'http', host: '', port: 8080, enabled: false },
  tabGrouping: 'none',
  hostnameOverride: false,
  defaultTabLayout: 'tabs',
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  colorTags: {},
  enableStatusChecking: false,
  statusCheckInterval: 30,
  statusCheckMethod: 'socket',
  networkDiscovery: { enabled: false, ipRange: '', portRanges: [], protocols: [], timeout: 5000, maxConcurrent: 50, customPorts: {} },
  restApi: { enabled: false, port: 8080, authentication: false, apiKey: '', corsEnabled: true, rateLimiting: true },
  wolEnabled: false,
  wolPort: 9,
  wolBroadcastAddress: '255.255.255.255',
  enableActionLog: false,
  logLevel: 'info',
  maxLogEntries: 1000,
  exportEncryption: false,
  exportPassword: undefined,
};

vi.mock('../src/utils/settingsManager', () => ({
  SettingsManager: {
    getInstance: () => ({
      loadSettings: vi.fn().mockResolvedValue(mockSettings),
      saveSettings: vi.fn(),
    }),
  },
}));

vi.mock('../src/utils/themeManager', () => ({
  ThemeManager: { getInstance: () => ({ applyTheme: vi.fn() }) },
}));

describe('SettingsDialog', () => {
  it('renders general tab content', async () => {
    render(<SettingsDialog isOpen onClose={() => {}} />);
    const items = await screen.findAllByText('settings.general');
    expect(items.length).toBeGreaterThan(0);
  });
});

