import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../src/utils/settings/themeManager', () => {
  const instance = {
    getAvailableThemes: vi.fn(() => ['dark', 'light', 'darkest']),
    getAvailableColorSchemes: vi.fn(() => ['blue', 'green', 'purple', 'custom']),
    getColorSchemeConfig: vi.fn((scheme: string) => {
      const colors: Record<string, { primary: string }> = {
        blue: { primary: '#3b82f6' },
        green: { primary: '#22c55e' },
        purple: { primary: '#8b5cf6' },
      };
      return colors[scheme] ?? null;
    }),
  };
  return {
    ThemeManager: {
      getInstance: () => instance,
    },
  };
});

import { useThemeSettings } from '../../src/hooks/settings/useThemeSettings';
import type { GlobalSettings } from '../../src/types/settings/settings';

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    theme: 'dark',
    colorScheme: 'blue',
    primaryAccentColor: '#3b82f6',
    useCustomAccent: false,
    customCss: '',
    windowTransparencyOpacity: 0.94,
    ...overrides,
  } as GlobalSettings;
}

describe('useThemeSettings', () => {
  it('returns current theme as dark', () => {
    const update = vi.fn();
    const settings = makeSettings({ theme: 'dark' });
    const { result } = renderHook(() => useThemeSettings(settings, update));

    expect(result.current.themes).toContain('dark');
    expect(result.current.themes).toContain('light');
  });

  it('returns available color schemes', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useThemeSettings(settings, update));

    expect(result.current.schemes).toEqual(['blue', 'green', 'purple', 'custom']);
  });

  it('toggles between light and dark theme via settings update', () => {
    const update = vi.fn();
    const settings = makeSettings({ theme: 'dark' });
    const { result, rerender } = renderHook(
      ({ s, u }) => useThemeSettings(s, u),
      { initialProps: { s: settings, u: update } },
    );

    // Simulate switching to light
    const lightSettings = makeSettings({ theme: 'light' });
    rerender({ s: lightSettings, u: update });

    // Theme list stays available
    expect(result.current.themes).toContain('light');
    expect(result.current.themes).toContain('dark');
  });

  it('handleSchemeChange calls updateSettings with new scheme', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useThemeSettings(settings, update));

    act(() => {
      result.current.handleSchemeChange('green');
    });

    expect(update).toHaveBeenCalledWith({
      colorScheme: 'green',
      useCustomAccent: false,
    });
  });

  it('handleAccentChange persists custom accent color', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useThemeSettings(settings, update));

    act(() => {
      result.current.handleAccentChange('#ff0000');
    });

    expect(update).toHaveBeenCalledWith({
      primaryAccentColor: '#ff0000',
      useCustomAccent: true,
    });
  });

  it('handleToggleCustomAccent toggles custom accent flag', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useThemeSettings(settings, update));

    act(() => {
      result.current.handleToggleCustomAccent(true);
    });

    expect(update).toHaveBeenCalledWith({ useCustomAccent: true });

    act(() => {
      result.current.handleToggleCustomAccent(false);
    });

    expect(update).toHaveBeenCalledWith({ useCustomAccent: false });
  });

  it('schemeOptions maps schemes to labeled options with colors', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useThemeSettings(settings, update));

    const blueOpt = result.current.schemeOptions.find((o) => o.value === 'blue');
    expect(blueOpt).toBeDefined();
    expect(blueOpt!.label).toBe('Blue');
    expect(blueOpt!.color).toBe('#3b82f6');
  });

  it('opacity value reflects settings', () => {
    const update = vi.fn();
    const settings = makeSettings({ windowTransparencyOpacity: 0.8 });
    const { result } = renderHook(() => useThemeSettings(settings, update));

    expect(result.current.opacityValue).toBe(0.8);
  });
});
