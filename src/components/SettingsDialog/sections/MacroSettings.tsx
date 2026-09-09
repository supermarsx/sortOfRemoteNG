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
import { normalizeSessionQuickActions } from "../../../utils/connection/sessionQuickActions";
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
  const quickActions = normalizeSessionQuickActions(
    settings.sessionQuickActions,
  );
  const [macroCount, setMacroCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    macroService
      .loadMacros()
      .then((m) => {
        if (mounted) setMacroCount(m.length);
      })
      .catch(() => {
        if (mounted) setMacroCount(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const update = (patch: Partial<MacroConfig>) => {
    updateSettings({ macros: { ...macros, ...patch } });
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<ListVideo className="w-5 h-5 text-primary" />}
        title="Macros"
        description="Configure SSH and website quick actions, script confirmation, and macro replay. Website execution still requires explicit connection-level consent."
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
            description="Show confirmation before replaying terminal or website interaction macros"
            checked={macros.confirmBeforeReplay}
            onChange={(v) => update({ confirmBeforeReplay: v })}
            infoTooltip="Show a confirmation dialog before executing a macro to prevent accidental replay."
          />
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<Play className="w-4 h-4 text-primary" />}
          title="Session quick actions"
        />
        <Card>
          <Toggle
            settingKey="sessionQuickActions.sshEnabled"
            label="SSH quick-action bar"
            description="Show favorite scripts and macros, including Add and manage controls."
            checked={quickActions.sshEnabled}
            onChange={(sshEnabled) =>
              updateSettings({
                sessionQuickActions: { ...quickActions, sshEnabled },
              })
            }
          />
          <Toggle
            settingKey="sessionQuickActions.httpEnabled"
            label="Website quick-action bar"
            description="Show website script and interaction macro controls."
            checked={quickActions.httpEnabled}
            onChange={(httpEnabled) =>
              updateSettings({
                sessionQuickActions: { ...quickActions, httpEnabled },
              })
            }
          />
          <Toggle
            settingKey="sessionQuickActions.allowWebMacros"
            label="Allow website interaction macros"
            description="Global kill switch. Each connection must separately opt in."
            checked={quickActions.allowWebMacros}
            onChange={(allowWebMacros) =>
              updateSettings({
                sessionQuickActions: { ...quickActions, allowWebMacros },
              })
            }
          />
          <Toggle
            settingKey="sessionQuickActions.allowWebScriptInjection"
            label="Allow website script injection"
            description="Global kill switch for manually running website scripts. Each connection must separately opt in."
            checked={quickActions.allowWebScriptInjection}
            onChange={(allowWebScriptInjection) =>
              updateSettings({
                sessionQuickActions: {
                  ...quickActions,
                  allowWebScriptInjection,
                },
              })
            }
          />
          <Toggle
            settingKey="sessionQuickActions.allowWebForceDark"
            label="Allow forced-dark websites"
            description="Allow the appearance override only on connections that explicitly enable it."
            checked={quickActions.allowWebForceDark}
            onChange={(allowWebForceDark) =>
              updateSettings({
                sessionQuickActions: { ...quickActions, allowWebForceDark },
              })
            }
          />
          <Toggle
            settingKey="sessionQuickActions.confirmBeforeScriptRun"
            label="Confirm before running scripts"
            description="Review a manual SSH or website script before execution."
            checked={quickActions.confirmBeforeScriptRun}
            onChange={(confirmBeforeScriptRun) =>
              updateSettings({
                sessionQuickActions: {
                  ...quickActions,
                  confirmBeforeScriptRun,
                },
              })
            }
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
              {macroCount === null
                ? "Macro library unavailable or loading"
                : `${macroCount} macro${macroCount !== 1 ? "s" : ""} saved`}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default MacroSettings;
