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

      </div>

      <div className="space-y-4">
        <h4 className="text-md font-medium text-white">Desktop Shortcuts</h4>
        <p className="text-sm text-gray-400">
          Create desktop shortcuts to quickly launch the application with specific connections.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Shortcut Name
            </label>
            <input
              type="text"
              placeholder="My Server Connection"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Collection (Optional)
            </label>
            <select className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="">Select a collection...</option>
              {/* TODO: Populate with available collections */}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Connection (Optional)
            </label>
            <select className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="">Select a connection...</option>
              {/* TODO: Populate with available connections */}
            </select>
          </div>
          
          <div className="flex items-end">
            <button
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              Create Shortcut
            </button>
          </div>
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

