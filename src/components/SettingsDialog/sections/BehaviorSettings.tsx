import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  MousePointerClick,
  MousePointer2,
  AppWindow,
  Link,
  RefreshCw,
} from "lucide-react";

interface BehaviorSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const BehaviorSettings: React.FC<BehaviorSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <MousePointerClick className="w-5 h-5" />
        Behavior
      </h3>

      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <MousePointer2 className="w-4 h-4 text-blue-400" />
          Click Actions
        </h4>
        
        <p className="text-sm text-gray-400">
          When enabled, clicking a connection in the tree will immediately connect or disconnect instead of selecting it.
        </p>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleClickConnect}
              onChange={(e) =>
                updateSettings({ singleClickConnect: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <span className="text-gray-300 group-hover:text-white">Connect on single click</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleClickDisconnect}
              onChange={(e) =>
                updateSettings({ singleClickDisconnect: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <span className="text-gray-300 group-hover:text-white">Disconnect on single click (active connections)</span>
          </label>
        
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.doubleClickRename}
              onChange={(e) =>
                updateSettings({ doubleClickRename: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <span className="text-gray-300 group-hover:text-white">Rename on double click</span>
          </label>
        </div>
      </div>

      {/* Window & Connection Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <AppWindow className="w-4 h-4 text-purple-400" />
          Window & Connection Behavior
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleWindowMode}
              onChange={(e) =>
                updateSettings({ singleWindowMode: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <AppWindow className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">Disallow multiple instances</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleConnectionMode}
              onChange={(e) =>
                updateSettings({ singleConnectionMode: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Link className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">
              {t("connections.singleConnection")}
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.reconnectOnReload}
              onChange={(e) =>
                updateSettings({ reconnectOnReload: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <RefreshCw className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">
              {t("connections.reconnectOnReload")}
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enableAutocomplete}
              onChange={(e) =>
                updateSettings({ enableAutocomplete: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <span className="text-gray-300 group-hover:text-white">
              Enable browser autocomplete on input fields
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default BehaviorSettings;
