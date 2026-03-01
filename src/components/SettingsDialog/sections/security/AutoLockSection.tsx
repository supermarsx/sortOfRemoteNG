import { GlobalSettings } from "../../../../types/settings";
import { Lock, Timer, Clock } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";
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
        <Clock className="w-4 h-4 text-yellow-400" />
        Auto Lock
      </h4>

      <div className="sor-settings-card space-y-4">
        {!mgr.hasPassword && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-700/50 rounded-md text-yellow-400 text-sm">
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
          <Clock className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-yellow-400" />
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
            Enable auto lock after inactivity
          </span>
        </label>

        <div
          className={`space-y-2 ${!mgr.hasPassword || !settings.autoLock.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Timer className="w-4 h-4" />
            Auto lock timeout (minutes)
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
