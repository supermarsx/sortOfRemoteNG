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
import { Checkbox, NumberInput, Slider } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface MacroSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Shared row primitives ───────────────────────────── */

const ToggleRow: React.FC<{
  settingKey: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}> = ({ settingKey, icon, label, description, checked, onChange, tooltip }) => (
  <label
    data-setting-key={settingKey}
    className="flex items-center justify-between gap-3 cursor-pointer"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[var(--color-text)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

const FieldRow: React.FC<{
  settingKey: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}> = ({ settingKey, icon, label, description, tooltip, children }) => (
  <div
    data-setting-key={settingKey}
    className="flex items-center justify-between gap-3"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

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
        <div className="sor-settings-card">
          <FieldRow
            settingKey="macros.defaultStepDelayMs"
            icon={<Clock size={14} />}
            label="Default delay between steps"
            description="Delay in milliseconds when replaying macros"
            tooltip="Time in milliseconds to wait between each step when replaying a macro. Increase for slower remote hosts."
          >
            <Slider
              value={macros.defaultStepDelayMs}
              onChange={(v: number) => update({ defaultStepDelayMs: v })}
              min={0}
              max={2000}
              variant="wide"
              step={50}
            />
            <span className="text-xs text-[var(--color-textSecondary)] w-14 text-right font-mono">
              {macros.defaultStepDelayMs}ms
            </span>
          </FieldRow>

          <ToggleRow
            settingKey="macros.confirmBeforeReplay"
            icon={<AlertCircle size={14} />}
            label="Confirm before replay"
            description="Show confirmation dialog before replaying a macro"
            checked={macros.confirmBeforeReplay}
            onChange={(v) => update({ confirmBeforeReplay: v })}
            tooltip="Show a confirmation dialog before executing a macro to prevent accidental replay."
          />
        </div>
      </div>

      {/* Limits */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Gauge className="w-4 h-4 text-primary" />}
          title="Limits & Library"
        />
        <div className="sor-settings-card">
          <FieldRow
            settingKey="macros.maxMacroSteps"
            icon={<Hash size={14} />}
            label="Max steps per macro"
            description="Maximum number of steps allowed in a single macro"
            tooltip="Upper limit on the number of recorded steps in a single macro. Prevents excessively large recordings."
          >
            <NumberInput
              value={macros.maxMacroSteps}
              onChange={(v: number) => update({ maxMacroSteps: v })}
              variant="settings-compact"
              className="w-20 text-right"
              min={1}
            />
          </FieldRow>

          <div className="flex items-center gap-4 pt-3 mt-1 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
            <span className="flex items-center gap-1">
              <HardDrive size={12} />
              {macroCount} macro{macroCount !== 1 ? "s" : ""} saved
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MacroSettings;
