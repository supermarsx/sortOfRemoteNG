import { GlobalSettings } from "../../../../types/settings/settings";
import { Shield } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
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
          <Shield className="w-4 h-4 text-primary" />
          <span className="flex items-center gap-1">2FA / TOTP Defaults <InfoTooltip text="Default values applied when adding new Time-based One-Time Password configurations to connections" /></span>
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
        <span className="sor-toggle-label flex items-center gap-1">
          Enable TOTP functionality <InfoTooltip text="Turn on built-in TOTP code generation for connections that have a shared secret configured" />
        </span>
      </label>

      <div data-setting-key="totpIssuer">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          <span className="flex items-center gap-1">Default Issuer <InfoTooltip text="Issuer name shown in authenticator apps when scanning the QR code — typically your organization or app name" /></span>
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
            <span className="flex items-center gap-1">Default Digits <InfoTooltip text="Number of digits in each generated TOTP code — 6 is standard, 8 provides extra security" /></span>
          </label>
          <Select value={settings.totpDigits} onChange={(v: string) => updateSettings({ totpDigits: parseInt(v) })} options={[{ value: "6", label: "6 digits" }, { value: "8", label: "8 digits" }]} className="w-full" />
        </div>

        <div data-setting-key="totpPeriod">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            <span className="flex items-center gap-1">Default Period <InfoTooltip text="Time interval in seconds before the TOTP code rotates to a new value — 30 seconds is the most common setting" /></span>
          </label>
          <Select value={settings.totpPeriod} onChange={(v: string) => updateSettings({ totpPeriod: parseInt(v) })} options={[{ value: "15", label: "15 seconds" }, { value: "30", label: "30 seconds" }, { value: "60", label: "60 seconds" }]} className="w-full" />
        </div>

        <div data-setting-key="totpAlgorithm">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            <span className="flex items-center gap-1">Default Algorithm <InfoTooltip text="Hash algorithm used to generate TOTP codes — SHA-1 is widely compatible, SHA-256/512 are more secure but less supported" /></span>
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
