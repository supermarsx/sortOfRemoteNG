import { GlobalSettings } from "../../../../types/settings/settings";
import { Lock, Timer, Clock, Minimize2, EyeOff, Focus } from "lucide-react";
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

          <Toggle
            checked={!!settings.autoLock.lockOnMinimize}
            onChange={(v) =>
              updateSettings({
                autoLock: { ...settings.autoLock, lockOnMinimize: v },
              })
            }
            disabled={!mgr.hasPassword || !settings.autoLock.enabled}
            icon={<Minimize2 size={16} />}
            label="Lock when window is minimised"
            description="Lock immediately when the application window is minimised, regardless of the idle timer."
            infoTooltip="Useful on shared desktops — the screen-pinning password is required to bring the app back."
          />

          <Toggle
            checked={!!settings.autoLock.lockOnBlur}
            onChange={(v) =>
              updateSettings({
                autoLock: { ...settings.autoLock, lockOnBlur: v },
              })
            }
            disabled={!mgr.hasPassword || !settings.autoLock.enabled}
            icon={<Focus size={16} />}
            label="Lock when window loses focus"
            description="Lock after 250 ms if you alt-tab to another application; cancelled if focus returns first."
            infoTooltip="The 250 ms debounce avoids accidental locks from tooltips, popups, or transient focus changes."
          />

          <Toggle
            checked={!!settings.autoLock.lockOnVisibilityHidden}
            onChange={(v) =>
              updateSettings({
                autoLock: {
                  ...settings.autoLock,
                  lockOnVisibilityHidden: v,
                },
              })
            }
            disabled={!mgr.hasPassword || !settings.autoLock.enabled}
            icon={<EyeOff size={16} />}
            label="Lock when document becomes hidden"
            description="Browser-side fallback that catches any platform-specific way the window can go hidden (background tab, mission-control sweep)."
            infoTooltip="Independent of the window manager — `document.hidden` flips whenever the OS or browser decides the window is no longer visible to the user."
          />
        </div>
      </Card>
    </div>
  );
}

export default AutoLockSection;
