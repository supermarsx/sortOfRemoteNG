import { GlobalSettings } from "../../../../types/settings/settings";
import { Eye, EyeOff, MousePointerClick, Timer } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
} from "../../../ui/settings/SettingsPrimitives";

function PasswordRevealSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  const enabled = settings.passwordReveal?.enabled ?? true;
  const autoHide = settings.passwordReveal?.autoHideSeconds ?? 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Eye className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Password Reveal{" "}
            <InfoTooltip text="Controls the show/hide eye icon behavior on all password fields throughout the application." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Controls the show/hide eye icon on all password fields throughout
          the application.
        </p>

        <Toggle
          checked={enabled}
          onChange={(v) =>
            updateSettings({
              passwordReveal: {
                ...settings.passwordReveal,
                enabled: v,
              },
            })
          }
          icon={<Eye size={16} />}
          label="Enable password reveal icon on all password fields"
          description="Show an eye icon that temporarily reveals masked passwords."
          infoTooltip="Show an eye icon next to password fields that lets you temporarily view the password in plain text."
        />

        <div
          className={
            enabled
              ? "flex flex-col gap-2.5"
              : "flex flex-col gap-2.5 opacity-50 pointer-events-none"
          }
        >
          <SettingsSelectRow
            icon={<MousePointerClick size={16} />}
            label="Reveal mode"
            value={settings.passwordReveal?.mode ?? "toggle"}
            options={[
              { value: "toggle", label: "Toggle (click to show/hide)" },
              { value: "hold", label: "Hold (hold mouse to reveal)" },
            ]}
            onChange={(v) =>
              updateSettings({
                passwordReveal: {
                  ...settings.passwordReveal,
                  mode: v as "toggle" | "hold",
                },
              })
            }
            infoTooltip="Toggle shows/hides on click; Hold reveals only while the mouse button is held down."
          />

          <SettingsSliderRow
            icon={<Timer size={16} />}
            label="Auto-hide after"
            description={
              autoHide === 0
                ? "0 seconds — passwords stay visible until manually hidden."
                : `Re-mask the password ${autoHide} second${autoHide === 1 ? "" : "s"} after revealing.`
            }
            value={autoHide}
            min={0}
            max={60}
            unit="s"
            onChange={(v) =>
              updateSettings({
                passwordReveal: {
                  ...settings.passwordReveal,
                  autoHideSeconds: v,
                },
              })
            }
            infoTooltip="Automatically re-mask the password after this many seconds — set to 0 to keep it visible until manually hidden."
          />

          <Toggle
            checked={settings.passwordReveal?.showByDefault ?? false}
            onChange={(v) =>
              updateSettings({
                passwordReveal: {
                  ...settings.passwordReveal,
                  showByDefault: v,
                },
              })
            }
            icon={<Eye size={16} />}
            label="Show passwords by default (not recommended)"
            description="Start with passwords visible instead of masked — security risk."
            infoTooltip="Start with passwords visible instead of masked — this is a security risk and not recommended."
          />

          <Toggle
            checked={settings.passwordReveal?.maskIcon ?? false}
            onChange={(v) =>
              updateSettings({
                passwordReveal: {
                  ...settings.passwordReveal,
                  maskIcon: v,
                },
              })
            }
            icon={<EyeOff size={16} />}
            label="Dim eye icon when password is hidden"
            description="Lower the eye icon's opacity while the password is masked."
            infoTooltip="Reduce the eye icon opacity when the password is masked, providing a visual cue of the current state."
          />
        </div>
      </Card>
    </div>
  );
}

export default PasswordRevealSection;
