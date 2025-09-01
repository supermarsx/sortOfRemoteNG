import React, { useEffect, useState } from "react";
import { Palette, Sun, Moon, Monitor } from "lucide-react";
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
    "blue",
    "green",
    "purple",
    "red",
    "orange",
    "teal",
    "grey",
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

  const selectedScheme = themeManager.getColorSchemeConfig(colorScheme);

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
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
                  : "border-gray-600 hover:border-gray-500"
              }`}
            >
              <Icon size={24} className="text-gray-300" />
              <span className="text-white font-medium capitalize">{value}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
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
                  : "border-gray-600 hover:border-gray-500"
              }`}
            >
              <div className="flex items-center space-x-2 mb-2">
                <Palette size={16} className="text-gray-300" />
                <span className="text-white font-medium capitalize">
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
      <div className="bg-gray-700 rounded-lg p-4">
        <h3 className="text-white font-medium mb-3">Preview</h3>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.primary }}
            />
            <span className="text-gray-300">Primary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.secondary }}
            />
            <span className="text-gray-300">Secondary Color</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: selectedScheme?.accent }}
            />
            <span className="text-gray-300">Accent Color</span>
          </div>
        </div>
      </div>

      {/* Management for custom items */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Custom Themes
        </label>
        <ul className="space-y-2">
          {themes
            .filter((tName) => !builtinThemes.includes(tName))
            .map((tName) => (
              <li
                key={tName}
                className="flex items-center justify-between text-white"
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
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Custom Color Schemes
        </label>
        <ul className="space-y-2">
          {schemes
            .filter((s) => !builtinSchemes.includes(s))
            .map((s) => (
              <li
                key={s}
                className="flex items-center justify-between text-white"
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
    </div>
  );
};
