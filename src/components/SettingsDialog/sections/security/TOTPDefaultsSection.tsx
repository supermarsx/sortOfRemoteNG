import { GlobalSettings } from "../../../../types/settings";
import { Shield } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
function TOTPDefaultsSection({
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
          <Shield className="w-4 h-4 text-blue-400" />
          2FA / TOTP Defaults
        </h4>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Default values used when adding new TOTP configurations to
          connections.
        </p>
      </div>

      <label
        data-setting-key="totpEnabled"
        className="flex items-center space-x-3 cursor-pointer group"
      >
        <Checkbox checked={settings.totpEnabled} onChange={(v: boolean) => updateSettings({ totpEnabled: v })} />
        <span className="sor-toggle-label">
          Enable TOTP functionality
        </span>
      </label>

      <div data-setting-key="totpIssuer">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Issuer
        </label>
        <input
          type="text"
          value={settings.totpIssuer}
          onChange={(e) => updateSettings({ totpIssuer: e.target.value })}
          className="sor-settings-input w-full text-sm"
          placeholder="sortOfRemoteNG"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div data-setting-key="totpDigits">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Digits
          </label>
          <Select value={settings.totpDigits} onChange={(v: string) => updateSettings({ totpDigits: parseInt(v) })} options={[{ value: "6", label: "6 digits" }, { value: "8", label: "8 digits" }]} className="w-full" />
        </div>

        <div data-setting-key="totpPeriod">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Period
          </label>
          <Select value={settings.totpPeriod} onChange={(v: string) => updateSettings({ totpPeriod: parseInt(v) })} options={[{ value: "15", label: "15 seconds" }, { value: "30", label: "30 seconds" }, { value: "60", label: "60 seconds" }]} className="w-full" />
        </div>

        <div data-setting-key="totpAlgorithm">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Algorithm
          </label>
          <Select value={settings.totpAlgorithm} onChange={(v: string) => updateSettings({
                totpAlgorithm: v as "sha1" | "sha256" | "sha512",
              })} options={[{ value: "sha1", label: "SHA-1" }, { value: "sha256", label: "SHA-256" }, { value: "sha512", label: "SHA-512" }]} className="w-full" />
        </div>
      </div>
    </div>
  );
}

export default TOTPDefaultsSection;
