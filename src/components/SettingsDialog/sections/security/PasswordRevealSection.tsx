import { GlobalSettings } from "../../../../types/settings/settings";
import { Eye, EyeOff } from "lucide-react";
import { Select, Slider } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
function PasswordRevealSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  const enabled = settings.passwordReveal?.enabled ?? true;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Eye className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Password Reveal{" "}
            <InfoTooltip text="Controls the show/hide eye icon behavior on all password fields throughout the application" />
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
          description="Show an eye icon that temporarily reveals masked passwords"
          infoTooltip="Show an eye icon next to password fields that lets you temporarily view the password in plain text"
        />

        <div
          className={
            !enabled ? "opacity-50 pointer-events-none space-y-4" : "space-y-4"
          }
        >
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              <span className="flex items-center gap-1">
                Reveal Mode{" "}
                <InfoTooltip text="Toggle shows/hides on click; Hold reveals only while the mouse button is held down" />
              </span>
            </label>
            <Select
              value={settings.passwordReveal?.mode ?? "toggle"}
              onChange={(v: string) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    mode: v as "toggle" | "hold",
                  },
                })
              }
              options={[
                { value: "toggle", label: "Toggle (click to show/hide)" },
                { value: "hold", label: "Hold (hold mouse to reveal)" },
              ]}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              <span className="flex items-center gap-1">
                Auto-hide after (seconds):{" "}
                <InfoTooltip text="Automatically re-mask the password after this many seconds — set to 0 to keep it visible until manually hidden" />
              </span>{" "}
              {settings.passwordReveal?.autoHideSeconds ?? 0}
              {(settings.passwordReveal?.autoHideSeconds ?? 0) === 0 &&
                " (disabled)"}
            </label>
            <Slider
              value={settings.passwordReveal?.autoHideSeconds ?? 0}
              onChange={(v: number) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    autoHideSeconds: v,
                  },
                })
              }
              min={0}
              max={60}
              variant="full"
            />
            <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
              <span>Off</span>
              <span>60s</span>
            </div>
          </div>

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
            description="Start with passwords visible instead of masked — security risk"
            infoTooltip="Start with passwords visible instead of masked — this is a security risk and not recommended"
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
            description="Lower the eye icon's opacity while the password is masked"
            infoTooltip="Reduce the eye icon opacity when the password is masked, providing a visual cue of the current state"
          />
        </div>
      </Card>
    </div>
  );
}

export default PasswordRevealSection;
