import React, { useEffect, useState } from "react";
import { GlobalSettings, MacroConfig } from "../../../types/settings/settings";
import { ListVideo, Clock, AlertCircle, Hash } from "lucide-react";
import * as macroService from "../../../utils/recording/macroService";
import { Checkbox, NumberInput, Slider } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';

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
        <SectionHeading icon={<ListVideo className="w-5 h-5" />} title="Macros" description="Configure terminal macro recording and replay behavior." />
      </div>

      {/* Default delay */}
      <div className="space-y-3">
        <div
          data-setting-key="macros.defaultStepDelayMs"
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-primary" />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                Default delay between steps
                <InfoTooltip text="Time in milliseconds to wait between each step when replaying a macro. Increase for slower remote hosts." />
              </span>
              <p className="text-[10px] text-[var(--color-textMuted)]">
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
            <AlertCircle size={14} className="text-warning" />
            <div>
              <span className="sor-toggle-label flex items-center gap-1">
                Confirm before replay
                <InfoTooltip text="Show a confirmation dialog before executing a macro to prevent accidental replay." />
              </span>
              <p className="text-[10px] text-[var(--color-textMuted)]">
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
            <Hash size={14} className="text-success" />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                Max steps per macro
                <InfoTooltip text="Upper limit on the number of recorded steps in a single macro. Prevents excessively large recordings." />
              </span>
              <p className="text-[10px] text-[var(--color-textMuted)]">
                Maximum number of steps allowed in a single macro
              </p>
            </div>
          </div>
          <NumberInput value={macros.maxMacroSteps} onChange={(v: number) => update({ maxMacroSteps: v })} variant="settings-compact" className="w-20 text-right" min={1} />
        </div>
      </div>

      {/* Storage info */}
      <div className="pt-2 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-3 text-xs text-[var(--color-textMuted)]">
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
