import React, { useEffect, useState } from "react";
import { GlobalSettings, MacroConfig } from "../../../types/settings/settings";
import {
  ListVideo,
  Clock,
  AlertCircle,
  Hash,
  Play,
  HardDrive,
  Gauge,
} from "lucide-react";
import * as macroService from "../../../utils/recording/macroService";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
  SettingsSliderRow,
} from "../../ui/settings/SettingsPrimitives";

interface MacroSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Main Component ──────────────────────────────────── */

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
      <SectionHeading
        icon={<ListVideo className="w-5 h-5 text-primary" />}
        title="Macros"
        description="Configure terminal macro recording and replay behavior."
      />

      {/* Replay */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Play className="w-4 h-4 text-primary" />}
          title="Replay Behavior"
        />
        <Card>
          <SettingsSliderRow
            settingKey="macros.defaultStepDelayMs"
            icon={<Clock size={16} />}
            label="Default delay between steps"
            description="Delay in milliseconds when replaying macros"
            value={macros.defaultStepDelayMs}
            min={0}
            max={2000}
            step={50}
            unit="ms"
            onChange={(v) => update({ defaultStepDelayMs: v })}
            infoTooltip="Time in milliseconds to wait between each step when replaying a macro. Increase for slower remote hosts."
          />

          <Toggle
            settingKey="macros.confirmBeforeReplay"
            icon={<AlertCircle size={16} />}
            label="Confirm before replay"
            description="Show confirmation dialog before replaying a macro"
            checked={macros.confirmBeforeReplay}
            onChange={(v) => update({ confirmBeforeReplay: v })}
            infoTooltip="Show a confirmation dialog before executing a macro to prevent accidental replay."
          />
        </Card>
      </div>

      {/* Limits */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Gauge className="w-4 h-4 text-primary" />}
          title="Limits & Library"
        />
        <Card>
          <SettingsNumberRow
            settingKey="macros.maxMacroSteps"
            icon={<Hash size={16} />}
            label="Max steps per macro"
            value={macros.maxMacroSteps}
            min={1}
            onChange={(v) => update({ maxMacroSteps: v })}
            infoTooltip="Upper limit on the number of recorded steps in a single macro. Prevents excessively large recordings."
          />

          <div className="flex items-center gap-4 pt-3 mt-1 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
            <span className="flex items-center gap-1">
              <HardDrive size={12} />
              {macroCount} macro{macroCount !== 1 ? "s" : ""} saved
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default MacroSettings;
