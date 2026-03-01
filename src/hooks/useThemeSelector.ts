import { useState, useEffect, useRef, useCallback } from 'react';
import { Theme, ColorScheme, ThemeConfig } from '../types/settings';
import { ThemeManager } from '../utils/themeManager';

const themeManager = ThemeManager.getInstance();

export const BUILTIN_THEMES = ['light', 'dark', 'auto', 'darkest', 'oled', 'semilight'];
export const BUILTIN_SCHEMES = [
  'red', 'rose', 'pink', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'slate', 'grey', 'custom',
];

export function useThemeSelector(
  theme: Theme,
  colorScheme: ColorScheme,
  onThemeChange: (theme: Theme) => void,
  onColorSchemeChange: (scheme: ColorScheme) => void,
) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setThemes(themeManager.getAvailableThemes());
    setSchemes(themeManager.getAvailableColorSchemes());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const themeOptions = themes.map((tName) => ({ value: tName }));

  const schemeOptions = schemes.map((name) => ({
    name,
    colors: themeManager.getColorSchemeConfig(name) || {
      primary: '#000',
      secondary: '#000',
      accent: '#000',
    },
  }));

  const selectedScheme = themeManager.getColorSchemeConfig(colorScheme);

  const handleAddTheme = useCallback(async () => {
    const name = prompt('Theme name?');
    if (!name) return;
    const existing: ThemeConfig = themeManager.getThemeConfig(name) || {
      name,
      colors: {
        primary: '#000000', secondary: '#000000', accent: '#000000',
        background: '#000000', surface: '#000000', text: '#ffffff',
        textSecondary: '#cccccc', border: '#000000', success: '#10b981',
        warning: '#f59e0b', error: '#ef4444',
      },
    };
    const configStr = prompt('Theme config JSON', JSON.stringify(existing, null, 2));
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as ThemeConfig;
      config.name = config.name || name;
      await themeManager.addCustomTheme(name, config);
      refresh();
    } catch {
      alert('Invalid theme config');
    }
  }, [refresh]);

  const handleEditTheme = useCallback(
    async (name: string) => {
      const configStr = prompt(
        'Theme config JSON',
        JSON.stringify(themeManager.getThemeConfig(name), null, 2),
      );
      if (!configStr) return;
      try {
        const config = JSON.parse(configStr) as ThemeConfig;
        config.name = config.name || name;
        await themeManager.editCustomTheme(name, config);
        refresh();
      } catch {
        alert('Invalid theme config');
      }
    },
    [refresh],
  );

  const handleRemoveTheme = useCallback(
    async (name: string) => {
      if (!confirm('Delete theme?')) return;
      await themeManager.removeCustomTheme(name);
      refresh();
      if (theme === name) onThemeChange('dark');
    },
    [refresh, theme, onThemeChange],
  );

  const handleAddScheme = useCallback(async () => {
    const name = prompt('Color scheme name?');
    if (!name) return;
    const configStr = prompt(
      'Color scheme JSON',
      JSON.stringify({ primary: '#3b82f6', secondary: '#1d4ed8', accent: '#1e40af' }, null, 2),
    );
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as Record<string, string>;
      await themeManager.addCustomColorScheme(name, config);
      refresh();
    } catch {
      alert('Invalid color scheme');
    }
  }, [refresh]);

  const handleEditScheme = useCallback(
    async (name: string) => {
      const configStr = prompt(
        'Color scheme JSON',
        JSON.stringify(themeManager.getColorSchemeConfig(name), null, 2),
      );
      if (!configStr) return;
      try {
        const config = JSON.parse(configStr) as Record<string, string>;
        await themeManager.editCustomColorScheme(name, config);
        refresh();
      } catch {
        alert('Invalid color scheme');
      }
    },
    [refresh],
  );

  const handleRemoveScheme = useCallback(
    async (name: string) => {
      if (!confirm('Delete color scheme?')) return;
      await themeManager.removeCustomColorScheme(name);
      refresh();
      if (colorScheme === name) onColorSchemeChange('blue');
    },
    [refresh, colorScheme, onColorSchemeChange],
  );

  const handleExportAll = useCallback(() => {
    const data = themeManager.exportThemeData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sortofremoteng-themes-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.themes && !data.colorSchemes) {
          throw new Error('Invalid theme file format');
        }
        const result = await themeManager.importThemeData(data, { overwrite: false });
        const messages: string[] = [];
        if (result.importedThemes.length > 0) messages.push(`Imported ${result.importedThemes.length} theme(s)`);
        if (result.importedSchemes.length > 0) messages.push(`Imported ${result.importedSchemes.length} color scheme(s)`);
        if (result.skippedThemes.length > 0) messages.push(`Skipped ${result.skippedThemes.length} existing theme(s)`);
        if (result.skippedSchemes.length > 0) messages.push(`Skipped ${result.skippedSchemes.length} existing scheme(s)`);
        setImportStatus(messages.length === 0 ? 'No new themes or color schemes to import' : messages.join(', '));
        refresh();
        setTimeout(() => setImportStatus(null), 5000);
      } catch (err) {
        setImportStatus(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setTimeout(() => setImportStatus(null), 5000);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [refresh],
  );

  return {
    themes,
    schemes,
    themeOptions,
    schemeOptions,
    selectedScheme,
    fileInputRef,
    importStatus,
    handleAddTheme,
    handleEditTheme,
    handleRemoveTheme,
    handleAddScheme,
    handleEditScheme,
    handleRemoveScheme,
    handleExportAll,
    handleImportClick,
    handleFileSelect,
  };
}
