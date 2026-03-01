import React, { useEffect, useState } from "react";
import { GlobalSettings, MacroConfig } from "../../../types/settings";
import { ListVideo, Clock, AlertCircle, Hash } from "lucide-react";
import * as macroService from "../../../utils/macroService";
import { Checkbox, NumberInput, Slider } from '../../ui/forms';

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
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <ListVideo className="w-5 h-5" />
          Macros
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)] mb-4">
          Configure terminal macro recording and replay behavior.
        </p>
      </div>

      {/* Default delay */}
      <div className="space-y-3">
        <div
          data-setting-key="macros.defaultStepDelayMs"
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-blue-400" />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)]">
                Default delay between steps
              </span>
              <p className="text-[10px] text-gray-500">
                Delay in milliseconds when replaying macros
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Slider value={macros.defaultStepDelayMs} onChange={(v: number) => update({ defaultStepDelayMs: v })} min={0} max={2000} variant="wide" step={50} />
            <span className="text-xs text-[var(--color-textSecondary)] w-14 text-right">
              {macros.defaultStepDelayMs}ms
            </span>
          </div>
        </div>

        {/* Confirm before replay */}
        <label
          data-setting-key="macros.confirmBeforeReplay"
          className="flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center gap-3">
            <AlertCircle size={14} className="text-yellow-400" />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Confirm before replay
              </span>
              <p className="text-[10px] text-gray-500">
                Show confirmation dialog before replaying a macro
              </p>
            </div>
          </div>
          <Checkbox checked={macros.confirmBeforeReplay} onChange={(v: boolean) => update({ confirmBeforeReplay: v })} />
        </label>

        {/* Max steps */}
        <div
          data-setting-key="macros.maxMacroSteps"
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Hash size={14} className="text-green-400" />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)]">
                Max steps per macro
              </span>
              <p className="text-[10px] text-gray-500">
                Maximum number of steps allowed in a single macro
              </p>
            </div>
          </div>
          <NumberInput value={macros.maxMacroSteps} onChange={(v: number) => update({ maxMacroSteps: v })} variant="settings-compact" className="w-20 text-right" min={1} />
        </div>
      </div>

      {/* Storage info */}
      <div className="pt-2 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <ListVideo size={12} />
          <span>
            {macroCount} macro{macroCount !== 1 ? "s" : ""} saved
          </span>
        </div>
      </div>
    </div>
  );
};

export default MacroSettings;
