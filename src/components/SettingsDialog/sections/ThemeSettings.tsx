import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, Theme, ColorScheme } from "../../../types/settings";
import { ThemeManager } from "../../../utils/themeManager";

interface ThemeSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const formatLabel = (value: string): string =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  const themeManager = ThemeManager.getInstance();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);

  useEffect(() => {
    setThemes(themeManager.getAvailableThemes());
    setSchemes(themeManager.getAvailableColorSchemes());
  }, [themeManager]);

  const schemeOptions = useMemo(() => {
    const accent = settings.primaryAccentColor || "#3b82f6";
    return schemes.map((scheme) => ({
      value: scheme,
      label: formatLabel(scheme),
      color:
        scheme === "other"
          ? accent
          : themeManager.getColorSchemeConfig(scheme)?.primary ?? "#3b82f6",
    }));
  }, [schemes, settings.primaryAccentColor, themeManager]);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">
        {t("settings.theme")}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t("settings.theme")}
          </label>
          <select
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as Theme })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            {themes.map((theme) => (
              <option key={theme} value={theme}>
                {formatLabel(theme)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Color Scheme
          </label>
          <div className="grid grid-cols-2 gap-2">
            {schemeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  updateSettings({ colorScheme: option.value as ColorScheme })
                }
                className={`flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors ${
                  settings.colorScheme === option.value
                    ? "border-blue-500 bg-blue-600/20 text-white"
                    : "border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                <span className="flex items-center space-x-2">
                  <span
                    className="w-3 h-3 rounded-full border border-black/30"
                    style={{ backgroundColor: option.color }}
                  />
                  <span>{option.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Custom Scheme Accent
          </label>
          <div className="relative">
            <input
              type="color"
              value={settings.primaryAccentColor || "#3b82f6"}
              onChange={(e) =>
                updateSettings({ primaryAccentColor: e.target.value })
              }
              className="w-full h-12 bg-gray-700 border-2 border-gray-600 rounded-md cursor-pointer transition-all duration-200 hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              style={{
                background: `linear-gradient(45deg, #808080 25%, transparent 25%),
                           linear-gradient(-45deg, #808080 25%, transparent 25%),
                           linear-gradient(45deg, transparent 75%, #808080 75%),
                           linear-gradient(-45deg, transparent 75%, #808080 75%)`,
                backgroundSize: "8px 8px",
                backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
              }}
            />
            <div
              className="absolute inset-0 rounded-md pointer-events-none border-2 border-transparent"
              style={{
                background: `conic-gradient(from 0deg, ${
                  settings.primaryAccentColor || "#3b82f6"
                }, transparent 90deg)`,
                opacity: 0.3,
                filter: "blur(1px)",
              }}
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
              {settings.primaryAccentColor || "#3b82f6"}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Use the "Other" scheme to apply this accent.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Custom CSS
          </label>
          <textarea
            value={settings.customCss || ""}
            onChange={(e) => updateSettings({ customCss: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
            placeholder="Enter custom CSS rules..."
          />
        </div>
      </div>
    </div>
  );
};

export default ThemeSettings;
