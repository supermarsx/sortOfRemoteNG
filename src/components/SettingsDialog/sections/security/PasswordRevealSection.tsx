import { GlobalSettings } from "../../../../types/settings";
import { Eye, EyeOff } from "lucide-react";
import { Checkbox, Select, Slider } from "../../../ui/forms";
function PasswordRevealSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="sor-settings-card space-y-4">
      <div>
        <h4 className="sor-section-heading">
          <Eye className="w-4 h-4 text-blue-400" />
          Password Reveal
        </h4>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Controls the show/hide eye icon on all password fields throughout the
          application.
        </p>
      </div>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.passwordReveal?.enabled ?? true} onChange={(v: boolean) => updateSettings({
              passwordReveal: {
                ...settings.passwordReveal,
                enabled: v,
              },
            })} />
        <span className="sor-toggle-label">
          Enable password reveal icon on all password fields
        </span>
      </label>

      {(settings.passwordReveal?.enabled ?? true) && (
        <>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Reveal Mode
            </label>
            <Select value={settings.passwordReveal?.mode ?? "toggle"} onChange={(v: string) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    mode: v as "toggle" | "hold",
                  },
                })} options={[{ value: "toggle", label: "Toggle (click to show/hide)" }, { value: "hold", label: "Hold (hold mouse to reveal)" }]} className="w-full" />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Auto-hide after (seconds):{" "}
              {settings.passwordReveal?.autoHideSeconds ?? 0}
              {(settings.passwordReveal?.autoHideSeconds ?? 0) === 0 &&
                " (disabled)"}
            </label>
            <Slider value={settings.passwordReveal?.autoHideSeconds ?? 0} onChange={(v: number) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    autoHideSeconds: v,
                  },
                })} min={0} max={60} variant="full" />
            <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
              <span>Off</span>
              <span>60s</span>
            </div>
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.passwordReveal?.showByDefault ?? false} onChange={(v: boolean) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    showByDefault: v,
                  },
                })} />
            <span className="sor-toggle-label">
              Show passwords by default (not recommended)
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.passwordReveal?.maskIcon ?? false} onChange={(v: boolean) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    maskIcon: v,
                  },
                })} />
            <span className="sor-toggle-label flex items-center gap-2">
              Dim eye icon when password is hidden
              <EyeOff className="w-3.5 h-3.5 opacity-40" />
            </span>
          </label>
        </>
      )}
    </div>
  );
}

export default PasswordRevealSection;
