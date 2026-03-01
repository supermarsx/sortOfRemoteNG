import React from "react";
import { Palette, Sun, Moon, Monitor, Download, Upload, FileJson } from "lucide-react";
import { Theme, ColorScheme } from "../types/settings";
import { useThemeSelector, BUILTIN_THEMES, BUILTIN_SCHEMES } from "../hooks/window/useThemeSelector";

type Mgr = ReturnType<typeof useThemeSelector>;

/* ── Sub-components ──────────────────────────────────── */

const ThemeModeGrid: React.FC<{ mgr: Mgr; theme: Theme; onThemeChange: (t: Theme) => void }> = ({ mgr, theme, onThemeChange }) => {
  const getIcon = (value: string) => {
    if (value === "light") return Sun;
    if (value === "dark") return Moon;
    if (value === "auto") return Monitor;
    return Palette;
  };

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">Theme</label>
      <div className="grid grid-cols-3 gap-3">
        {mgr.themeOptions.map(({ value }) => {
          const Icon = getIcon(value);
          return (
            <button key={value} onClick={() => onThemeChange(value as Theme)} className={`p-4 rounded-lg border-2 transition-colors flex flex-col items-center space-y-2 ${theme === value ? "border-blue-500 bg-blue-500/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"}`}>
              <Icon size={24} className="text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-text)] font-medium capitalize">{value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ColorSchemeGrid: React.FC<{ mgr: Mgr; colorScheme: ColorScheme; onColorSchemeChange: (s: ColorScheme) => void }> = ({ mgr, colorScheme, onColorSchemeChange }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">Color Scheme</label>
    <div className="grid grid-cols-3 gap-3">
      {mgr.schemeOptions.map((scheme) => (
        <button key={scheme.name} onClick={() => onColorSchemeChange(scheme.name as ColorScheme)} className={`p-4 rounded-lg border-2 transition-colors ${colorScheme === scheme.name ? "border-blue-500 bg-blue-500/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"}`}>
          <div className="flex items-center space-x-2 mb-2">
            <Palette size={16} className="text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-text)] font-medium capitalize">{scheme.name}</span>
          </div>
          <div className="flex space-x-1">
            {["primary", "secondary", "accent"].map((key) => (
              <div key={key} className="w-6 h-6 rounded" style={{ backgroundColor: scheme.colors[key] }} />
            ))}
          </div>
        </button>
      ))}
    </div>
  </div>
);

const PreviewSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-border)] rounded-lg p-4">
    <h3 className="text-[var(--color-text)] font-medium mb-3">Preview</h3>
    <div className="space-y-2">
      {[
        { key: "primary" as const, label: "Primary Color" },
        { key: "secondary" as const, label: "Secondary Color" },
        { key: "accent" as const, label: "Accent Color" },
      ].map(({ key, label }) => (
        <div key={key} className="flex items-center space-x-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: mgr.selectedScheme?.[key] }} />
          <span className="text-[var(--color-textSecondary)]">{label}</span>
        </div>
      ))}
    </div>
  </div>
);

const CustomThemesList: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Custom Themes</label>
    <ul className="space-y-2">
      {mgr.themes.filter((tName) => !BUILTIN_THEMES.includes(tName)).map((tName) => (
        <li key={tName} className="flex items-center justify-between text-[var(--color-text)]">
          <span className="capitalize">{tName}</span>
          <div className="space-x-2 text-sm">
            <button className="text-blue-400 hover:underline" onClick={() => mgr.handleEditTheme(tName)}>Edit</button>
            <button className="text-red-400 hover:underline" onClick={() => mgr.handleRemoveTheme(tName)}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
    <button className="mt-2 text-blue-400 text-sm hover:underline" onClick={mgr.handleAddTheme}>Add Theme</button>
  </div>
);

const CustomSchemesList: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Custom Color Schemes</label>
    <ul className="space-y-2">
      {mgr.schemes.filter((s) => !BUILTIN_SCHEMES.includes(s)).map((s) => (
        <li key={s} className="flex items-center justify-between text-[var(--color-text)]">
          <span className="capitalize">{s}</span>
          <div className="space-x-2 text-sm">
            <button className="text-blue-400 hover:underline" onClick={() => mgr.handleEditScheme(s)}>Edit</button>
            <button className="text-red-400 hover:underline" onClick={() => mgr.handleRemoveScheme(s)}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
    <button className="mt-2 text-blue-400 text-sm hover:underline" onClick={mgr.handleAddScheme}>Add Color Scheme</button>
  </div>
);

const ImportExportSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="border-t border-[var(--color-border)] pt-4">
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">Import / Export</label>
    <div className="flex flex-wrap gap-3">
      <button onClick={mgr.handleExportAll} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors text-sm">
        <Download size={16} />Export All Custom
      </button>
      <button onClick={mgr.handleImportClick} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-lg transition-colors text-sm">
        <Upload size={16} />Import from File
      </button>
      <input ref={mgr.fileInputRef} type="file" accept=".json" onChange={mgr.handleFileSelect} className="hidden" />
    </div>
    {mgr.importStatus && (
      <div className={`mt-3 p-3 rounded-lg text-sm ${mgr.importStatus.includes('failed') ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
        <FileJson size={14} className="inline mr-2" />{mgr.importStatus}
      </div>
    )}
    <p className="mt-3 text-xs text-[var(--color-textSecondary)]">
      Export your custom themes and color schemes to share or backup. Import will skip existing items unless you delete them first.
    </p>
  </div>
);

/* ── Main Component ──────────────────────────────────── */

interface ThemeSelectorProps {
  theme: Theme;
  colorScheme: ColorScheme;
  onThemeChange: (theme: Theme) => void;
  onColorSchemeChange: (scheme: ColorScheme) => void;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  theme,
  colorScheme,
  onThemeChange,
  onColorSchemeChange,
}) => {
  const mgr = useThemeSelector(theme, colorScheme, onThemeChange, onColorSchemeChange);

  return (
    <div className="space-y-6">
      <ThemeModeGrid mgr={mgr} theme={theme} onThemeChange={onThemeChange} />
      <ColorSchemeGrid mgr={mgr} colorScheme={colorScheme} onColorSchemeChange={onColorSchemeChange} />
      <PreviewSection mgr={mgr} />
      <CustomThemesList mgr={mgr} />
      <CustomSchemesList mgr={mgr} />
      <ImportExportSection mgr={mgr} />
    </div>
  );
};
