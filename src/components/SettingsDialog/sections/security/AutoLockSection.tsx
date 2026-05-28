import { GlobalSettings } from "../../../../types/settings/settings";
import { Lock, Timer, Clock } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function AutoLockSection({
  settings,
  updateSettings,
  mgr,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  mgr: Mgr;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Clock className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Auto Lock{" "}
            <InfoTooltip text="Automatically lock the application after a period of inactivity, requiring the master password to resume." />
          </span>
        }
      />

      <Card>
        {!mgr.hasPassword && (
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/20 border border-warning/50 rounded-md text-warning text-sm">
            <Lock className="w-4 h-4" />
            Set a storage password to enable auto lock.
          </div>
        )}

        <div
          className={
            mgr.hasPassword ? undefined : "opacity-50 pointer-events-none"
          }
        >
          <Toggle
            checked={settings.autoLock.enabled && mgr.hasPassword}
            onChange={(v) =>
              updateSettings({
                autoLock: { ...settings.autoLock, enabled: v },
              })
            }
            disabled={!mgr.hasPassword}
            icon={<Clock size={16} />}
            label="Enable auto lock after inactivity"
            description="Lock the app when the idle timeout elapses."
            infoTooltip="When enabled, the app locks itself after the configured idle timeout elapses."
          />
        </div>

        <div
          className={
            !mgr.hasPassword || !settings.autoLock.enabled
              ? "opacity-50 pointer-events-none"
              : undefined
          }
        >
          <SettingsNumberRow
            settingKey="autoLock.timeoutMinutes"
            icon={<Timer size={16} />}
            label="Auto lock timeout"
            value={settings.autoLock.timeoutMinutes}
            min={1}
            max={240}
            unit="min"
            onChange={(v) =>
              updateSettings({
                autoLock: { ...settings.autoLock, timeoutMinutes: v },
              })
            }
            infoTooltip="Number of minutes of inactivity before the application automatically locks."
          />
        </div>
      </Card>
    </div>
  );
}

export default AutoLockSection;
