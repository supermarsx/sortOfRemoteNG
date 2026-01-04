import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
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
            <option value="es">Espanol (Espana)</option>
            <option value="fr">Francais (France)</option>
            <option value="de">Deutsch (Deutschland)</option>
            <option value="pt-PT">Portugues (Portugal)</option>
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
            Autosave Interval (minutes)
          </label>
          <input
            type="number"
            value={settings.autoSaveIntervalMinutes}
            onChange={(e) =>
              updateSettings({ autoSaveIntervalMinutes: parseInt(e.target.value) })
            }
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            min="1"
            max="120"
          />
        </div>

        <div className="flex items-end">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={settings.autoSaveEnabled}
              onChange={(e) =>
                updateSettings({ autoSaveEnabled: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600"
            />
            <span className="text-gray-300">Enable autosave</span>
          </label>
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
          <span className="text-gray-300">Disallow multiple instances</span>
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
            checked={settings.warnOnDetachClose}
            onChange={(e) =>
              updateSettings({ warnOnDetachClose: e.target.checked })
            }
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">
            {t("connections.warnOnDetachClose")}
          </span>
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

