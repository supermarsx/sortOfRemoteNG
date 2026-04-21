import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// Undo the global useSettings mock from vitest.setup — this test exercises the real module.
vi.unmock('../../src/contexts/SettingsContext');

import { SettingsProvider, useSettings } from '../../src/contexts/SettingsContext';
import { SettingsManager } from '../../src/utils/settings/settingsManager';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe('SettingsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsManager.resetInstance();

    // Mock the SettingsManager methods
    const mgr = SettingsManager.getInstance();
    vi.spyOn(mgr, 'loadSettings').mockResolvedValue({
      language: 'en',
      theme: 'dark',
    } as any);
    vi.spyOn(mgr, 'saveSettings').mockResolvedValue(undefined);
    vi.spyOn(mgr, 'logAction').mockImplementation(() => {});
    vi.spyOn(mgr, 'applySyncedSettings').mockResolvedValue(undefined);
  });

  it('provides default settings initially', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    // Before loadSettings resolves, defaults are used
    expect(result.current.settings).toBeDefined();
    expect(result.current.settings.theme).toBeDefined();
  });

  it('loads settings from SettingsManager on mount', async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    // Wait for the useEffect to resolve
    await vi.waitFor(() => {
      expect(mgr.loadSettings).toHaveBeenCalled();
    });
    expect(result.current.settings.language).toBe('en');
  });

  it('updates settings via updateSettings', async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    // Wait for initial load to complete and apply
    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });

    await act(async () => {
      await result.current.updateSettings({ language: 'fr' });
    });

    expect(result.current.settings.language).toBe('fr');
    expect(mgr.saveSettings).toHaveBeenCalled();
  });

  it('logs changed settings on update', async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await vi.waitFor(() => {
      expect(mgr.loadSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.updateSettings({ language: 'fr' });
    });

    expect(mgr.logAction).toHaveBeenCalledWith(
      'info',
      'Settings changed',
      undefined,
      expect.stringContaining('language'),
    );
  });

  it('reloads settings via reloadSettings', async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await vi.waitFor(() => {
      expect(mgr.loadSettings).toHaveBeenCalledTimes(1);
    });

    vi.mocked(mgr.loadSettings).mockResolvedValue({
      language: 'de',
      theme: 'dark',
    } as any);

    await act(async () => {
      await result.current.reloadSettings();
    });

    expect(mgr.loadSettings).toHaveBeenCalledTimes(2);
    expect(result.current.settings.language).toBe('de');
  });

  it('throws when used without provider', () => {
    expect(() => {
      renderHook(() => useSettings());
    }).toThrow('useSettings must be used within a SettingsProvider');
  });

  it('exposes updateSettings and reloadSettings functions', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(typeof result.current.updateSettings).toBe('function');
    expect(typeof result.current.reloadSettings).toBe('function');
  });
});
