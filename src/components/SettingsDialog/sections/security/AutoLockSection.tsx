import { GlobalSettings } from "../../../../types/settings/settings";
import { Lock, Timer, Clock } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
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
      <h4 className="sor-section-heading">
        <Clock className="w-4 h-4 text-warning" />
        <span className="flex items-center gap-1">Auto Lock <InfoTooltip text="Automatically lock the application after a period of inactivity, requiring the master password to resume" /></span>
      </h4>

      <div className="sor-settings-card space-y-4">
        {!mgr.hasPassword && (
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/20 border border-warning/50 rounded-md text-warning text-sm">
            <Lock className="w-4 h-4" />
            Set a storage password to enable auto lock.
          </div>
        )}

        <label
          className={`flex items-center space-x-3 cursor-pointer group ${!mgr.hasPassword ? "opacity-50" : ""}`}
        >
          <Checkbox checked={settings.autoLock.enabled && mgr.hasPassword} onChange={(v: boolean) => updateSettings({
                autoLock: { ...settings.autoLock, enabled: v },
              })} disabled={!mgr.hasPassword} />
          <Clock className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
            Enable auto lock after inactivity <InfoTooltip text="When enabled, the app locks itself after the configured idle timeout elapses" />
          </span>
        </label>

        <div
          className={`space-y-2 ${!mgr.hasPassword || !settings.autoLock.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Timer className="w-4 h-4" />
            <span className="flex items-center gap-1">Auto lock timeout (minutes) <InfoTooltip text="Number of minutes of inactivity before the application automatically locks" /></span>
          </label>
          <NumberInput value={settings.autoLock.timeoutMinutes} onChange={(v: number) => updateSettings({
                autoLock: {
                  ...settings.autoLock,
                  timeoutMinutes: v,
                },
              })} className="w-full" min={1} max={240} disabled={!mgr.hasPassword} />
        </div>
      </div>
    </div>
  );
}

export default AutoLockSection;
