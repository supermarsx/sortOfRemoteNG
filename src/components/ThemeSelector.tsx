import React, { useEffect, useState, useRef } from "react";
import { Palette, Sun, Moon, Monitor, Download, Upload, FileJson } from "lucide-react";
import { Theme, ColorScheme, ThemeConfig } from "../types/settings";
import { ThemeManager } from "../utils/themeManager";

interface ThemeSelectorProps {
  theme: Theme;
  colorScheme: ColorScheme;
  onThemeChange: (theme: Theme) => void;
  onColorSchemeChange: (scheme: ColorScheme) => void;
}

const themeManager = ThemeManager.getInstance();

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  theme,
  colorScheme,
  onThemeChange,
  onColorSchemeChange,
}) => {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);

  const refresh = () => {
    setThemes(themeManager.getAvailableThemes());
    setSchemes(themeManager.getAvailableColorSchemes());
  };

  useEffect(() => {
    refresh();
  }, []);

  const builtinThemes = [
    "light",
    "dark",
    "auto",
    "darkest",
    "oled",
    "semilight",
  ];
  const builtinSchemes = [
    "red",
    "rose",
    "pink",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "slate",
    "grey",
    "custom",
  ];

  const themeOptions = themes.map((tName) => {
    let Icon = Palette;
    if (tName === "light") Icon = Sun;
    else if (tName === "dark") Icon = Moon;
    else if (tName === "auto") Icon = Monitor;
    return { value: tName, icon: Icon };
  });

  const schemeOptions = schemes.map((name) => ({
    name,
    colors: themeManager.getColorSchemeConfig(name) || {
      primary: "#000",
      secondary: "#000",
      accent: "#000",
    },
  }));

  const handleAddTheme = async () => {
    const name = prompt("Theme name?");
    if (!name) return;
    const existing: ThemeConfig = themeManager.getThemeConfig(name) || {
      name,
      colors: {
        primary: "#000000",
        secondary: "#000000",
        accent: "#000000",
        background: "#000000",
        surface: "#000000",
        text: "#ffffff",
        textSecondary: "#cccccc",
        border: "#000000",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    };
    const configStr = prompt(
      "Theme config JSON",
      JSON.stringify(existing, null, 2),
    );
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as ThemeConfig;
      config.name = config.name || name;
      await themeManager.addCustomTheme(name, config);
      refresh();
    } catch {
      alert("Invalid theme config");
    }
  };

  const handleEditTheme = async (name: string) => {
    const configStr = prompt(
      "Theme config JSON",
      JSON.stringify(themeManager.getThemeConfig(name), null, 2),
    );
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as ThemeConfig;
      config.name = config.name || name;
      await themeManager.editCustomTheme(name, config);
      refresh();
    } catch {
      alert("Invalid theme config");
    }
  };

  const handleRemoveTheme = async (name: string) => {
    if (!confirm("Delete theme?")) return;
    await themeManager.removeCustomTheme(name);
    refresh();
    if (theme === name) onThemeChange("dark");
  };

  const handleAddScheme = async () => {
    const name = prompt("Color scheme name?");
    if (!name) return;
    const configStr = prompt(
      "Color scheme JSON",
      JSON.stringify(
        { primary: "#3b82f6", secondary: "#1d4ed8", accent: "#1e40af" },
        null,
        2,
      ),
    );
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as Record<string, string>;
      await themeManager.addCustomColorScheme(name, config);
      refresh();
    } catch {
      alert("Invalid color scheme");
    }
  };

  const handleEditScheme = async (name: string) => {
    const configStr = prompt(
      "Color scheme JSON",
      JSON.stringify(themeManager.getColorSchemeConfig(name), null, 2),
    );
    if (!configStr) return;
    try {
      const config = JSON.parse(configStr) as Record<string, string>;
      await themeManager.editCustomColorScheme(name, config);
      refresh();
    } catch {
      alert("Invalid color scheme");
    }
  };

  const handleRemoveScheme = async (name: string) => {
    if (!confirm("Delete color scheme?")) return;
    await themeManager.removeCustomColorScheme(name);
    refresh();
    if (colorScheme === name) onColorSchemeChange("blue");
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleExportAll = () => {
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
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validate the data structure
      if (!data.themes && !data.colorSchemes) {
        throw new Error('Invalid theme file format');
      }

      const result = await themeManager.importThemeData(data, { overwrite: false });
      
      const messages: string[] = [];
      if (result.importedThemes.length > 0) {
        messages.push(`Imported ${result.importedThemes.length} theme(s)`);
      }
      if (result.importedSchemes.length > 0) {
        messages.push(`Imported ${result.importedSchemes.length} color scheme(s)`);
      }
      if (result.skippedThemes.length > 0) {
        messages.push(`Skipped ${result.skippedThemes.length} existing theme(s)`);
      }
      if (result.skippedSchemes.length > 0) {
        messages.push(`Skipped ${result.skippedSchemes.length} existing scheme(s)`);
      }
      
      if (messages.length === 0) {
        setImportStatus('No new themes or color schemes to import');
      } else {
        setImportStatus(messages.join(', '));
      }
      
      refresh();
      setTimeout(() => setImportStatus(null), 5000);
    } catch (err) {
      setImportStatus(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setImportStatus(null), 5000);
    }
    
    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const selectedScheme = themeManager.getColorSchemeConfig(colorScheme);

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">
          Theme
        </label>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map(({ value, icon: Icon }) => (
            <button
              key={value}
              onClick={() => onThemeChange(value as Theme)}
              className={`p-4 rounded-lg border-2 transition-colors flex flex-col items-center space-y-2 ${
                theme === value
                  ? "border-blue-500 bg-blue-500/20"
                  : "border-[var(--color-border)] hover:border-[var(--color-border)]"
              }`}
            >
              <Icon size={24} className="text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-text)] font-medium capitalize">{value}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">
          Color Scheme
        </label>
        <div className="grid grid-cols-3 gap-3">
          {schemeOptions.map((scheme) => (
            <button
              key={scheme.name}
              onClick={() => onColorSchemeChange(scheme.name as ColorScheme)}
              className={`p-4 rounded-lg border-2 transition-colors ${
                colorScheme === scheme.name
                  ? "border-blue-500 bg-blue-500/20"
                  : "border-[var(--color-border)] hover:border-[var(--color-border)]"
              }`}
            >
              <div className="flex items-center space-x-2 mb-2">
                <Palette size={16} className="text-[var(--color-textSecondary)]" />
                <span className="text-[var(--color-text)] font-medium capitalize">
                  {scheme.name}
                </span>
              </div>
              <div className="flex space-x-1">
                {["primary", "secondary", "accent"].map((key) => (
                  <div
                    key={key}
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: scheme.colors[key] }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[var(--color-border)] rounded-lg p-4">
        <h3 className="text-[var(--color-text)] font-medium mb-3">Preview</h3>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.primary }}
            />
            <span className="text-[var(--color-textSecondary)]">Primary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.secondary }}
            />
            <span className="text-[var(--color-textSecondary)]">Secondary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.accent }}
            />
            <span className="text-[var(--color-textSecondary)]">Accent Color</span>
          </div>
        </div>
      </div>

      {/* Management for custom items */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Custom Themes
        </label>
        <ul className="space-y-2">
          {themes
            .filter((tName) => !builtinThemes.includes(tName))
            .map((tName) => (
              <li
                key={tName}
                className="flex items-center justify-between text-[var(--color-text)]"
              >
                <span className="capitalize">{tName}</span>
                <div className="space-x-2 text-sm">
                  <button
                    className="text-blue-400 hover:underline"
                    onClick={() => handleEditTheme(tName)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-red-400 hover:underline"
                    onClick={() => handleRemoveTheme(tName)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
        </ul>
        <button
          className="mt-2 text-blue-400 text-sm hover:underline"
          onClick={handleAddTheme}
        >
          Add Theme
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Custom Color Schemes
        </label>
        <ul className="space-y-2">
          {schemes
            .filter((s) => !builtinSchemes.includes(s))
            .map((s) => (
              <li
                key={s}
                className="flex items-center justify-between text-[var(--color-text)]"
              >
                <span className="capitalize">{s}</span>
                <div className="space-x-2 text-sm">
                  <button
                    className="text-blue-400 hover:underline"
                    onClick={() => handleEditScheme(s)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-red-400 hover:underline"
                    onClick={() => handleRemoveScheme(s)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
        </ul>
        <button
          className="mt-2 text-blue-400 text-sm hover:underline"
          onClick={handleAddScheme}
        >
          Add Color Scheme
        </button>
      </div>

      {/* Import/Export Section */}
      <div className="border-t border-[var(--color-border)] pt-4">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">
          Import / Export
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportAll}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors text-sm"
          >
            <Download size={16} />
            Export All Custom
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-lg transition-colors text-sm"
          >
            <Upload size={16} />
            Import from File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        {importStatus && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            importStatus.includes('failed') 
              ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
              : 'bg-green-500/20 text-green-400 border border-green-500/30'
          }`}>
            <FileJson size={14} className="inline mr-2" />
            {importStatus}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--color-textSecondary)]">
          Export your custom themes and color schemes to share or backup. 
          Import will skip existing items unless you delete them first.
        </p>
      </div>
    </div>
  );
};
