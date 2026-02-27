import React, { useEffect, useState } from "react";
import { GlobalSettings, MacroConfig } from "../../../types/settings";
import { ListVideo, Clock, AlertCircle, Hash } from "lucide-react";
import * as macroService from "../../../utils/macroService";

interface MacroSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const MacroSettings: React.FC<MacroSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const macros = settings.macros;
  const [macroCount, setMacroCount] = useState(0);

  useEffect(() => {
    macroService.loadMacros().then((m) => setMacroCount(m.length));
  }, []);

  const update = (patch: Partial<MacroConfig>) => {
    updateSettings({ macros: { ...macros, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <ListVideo size={16} className="text-orange-400" />
          Macros
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Configure terminal macro recording and replay behavior.
        </p>
      </div>

      {/* Default delay */}
      <div className="space-y-3">
        <div data-setting-key="macros.defaultStepDelayMs" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-blue-400" />
            <div>
              <span className="text-sm text-gray-300">Default delay between steps</span>
              <p className="text-[10px] text-gray-500">Delay in milliseconds when replaying macros</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              value={macros.defaultStepDelayMs}
              onChange={(e) => update({ defaultStepDelayMs: Number(e.target.value) })}
              min={0}
              max={2000}
              step={50}
              className="w-32"
            />
            <span className="text-xs text-gray-400 w-14 text-right">{macros.defaultStepDelayMs}ms</span>
          </div>
        </div>

        {/* Confirm before replay */}
        <label data-setting-key="macros.confirmBeforeReplay" className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <AlertCircle size={14} className="text-yellow-400" />
            <div>
              <span className="text-sm text-gray-300 group-hover:text-white">Confirm before replay</span>
              <p className="text-[10px] text-gray-500">Show confirmation dialog before replaying a macro</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={macros.confirmBeforeReplay}
            onChange={(e) => update({ confirmBeforeReplay: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>

        {/* Max steps */}
        <div data-setting-key="macros.maxMacroSteps" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Hash size={14} className="text-green-400" />
            <div>
              <span className="text-sm text-gray-300">Max steps per macro</span>
              <p className="text-[10px] text-gray-500">Maximum number of steps allowed in a single macro</p>
            </div>
          </div>
          <input
            type="number"
            value={macros.maxMacroSteps}
            onChange={(e) => update({ maxMacroSteps: Math.max(1, Number(e.target.value)) })}
            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
            min={1}
          />
        </div>
      </div>

      {/* Storage info */}
      <div className="pt-2 border-t border-gray-700">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <ListVideo size={12} />
          <span>{macroCount} macro{macroCount !== 1 ? 's' : ''} saved</span>
        </div>
      </div>
    </div>
  );
};

export default MacroSettings;
