import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, Theme, ColorScheme } from "../../../types/settings";
import { ThemeManager } from "../../../utils/themeManager";

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
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
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white">
        {t("settings.general")}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t("settings.language")}
          </label>
          <select
            value={settings.language}
            onChange={(e) => updateSettings({ language: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            <option value="en">English</option>
            <option value="es">Español (España)</option>
            <option value="fr">Français (France)</option>
            <option value="de">Deutsch (Deutschland)</option>
            <option value="pt-PT">Português (Portugal)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t("settings.theme")}
          </label>
          <select
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as Theme })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            {themes.map((th) => (
              <option key={th} value={th}>
                {th}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Color Scheme
          </label>
          <select
            value={settings.colorScheme}
            onChange={(e) =>
              updateSettings({ colorScheme: e.target.value as ColorScheme })
            }
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
          >
            {schemes.map((sc) => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Connection Timeout (seconds)
          </label>
          <input
            type="number"
            value={settings.connectionTimeout}
            onChange={(e) =>
              updateSettings({ connectionTimeout: parseInt(e.target.value) })
            }
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="5"
            max="300"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Primary Accent Color
          </label>
          <input
            type="color"
            value={settings.primaryAccentColor || '#3b82f6'}
            onChange={(e) => updateSettings({ primaryAccentColor: e.target.value })}
            className="w-full h-10 bg-gray-700 border border-gray-600 rounded-md cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Custom CSS
          </label>
          <textarea
            value={settings.customCss || ''}
            onChange={(e) => updateSettings({ customCss: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
            placeholder="Enter custom CSS rules..."
          />
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.singleWindowMode}
            onChange={(e) =>
              updateSettings({ singleWindowMode: e.target.checked })
            }
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t("connections.singleWindow")}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.singleConnectionMode}
            onChange={(e) =>
              updateSettings({ singleConnectionMode: e.target.checked })
            }
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">
            {t("connections.singleConnection")}
          </span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.reconnectOnReload}
            onChange={(e) =>
              updateSettings({ reconnectOnReload: e.target.checked })
            }
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">
            {t("connections.reconnectOnReload")}
          </span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.warnOnClose}
            onChange={(e) => updateSettings({ warnOnClose: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t("connections.warnOnClose")}</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={settings.warnOnExit}
            onChange={(e) => updateSettings({ warnOnExit: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">{t("connections.warnOnExit")}</span>
        </label>
      </div>
    </div>
  );
};

export default GeneralSettings;
