import { GlobalSettings } from "../../../../types/settings/settings";
import { Shield, Tag, Hash, Timer, KeyRound } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsTextRow,
} from "../../../ui/settings/SettingsPrimitives";

function TOTPDefaultsSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            2FA / TOTP Defaults{" "}
            <InfoTooltip text="Default values applied when adding new Time-based One-Time Password configurations to connections." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Default values used when adding new TOTP configurations to
          connections.
        </p>

        <Toggle
          checked={settings.totpEnabled}
          onChange={(v) => updateSettings({ totpEnabled: v })}
          icon={<Shield size={16} />}
          label="Enable TOTP functionality"
          description="Generate TOTP codes for connections that have a shared secret configured."
          settingKey="totpEnabled"
          infoTooltip="Turn on built-in TOTP code generation for connections that have a shared secret configured."
        />

        <SettingsTextRow
          settingKey="totpIssuer"
          icon={<Tag size={16} />}
          label="Default issuer"
          value={settings.totpIssuer}
          onChange={(v) => updateSettings({ totpIssuer: v })}
          placeholder="sortOfRemoteNG"
          infoTooltip="Issuer name shown in authenticator apps when scanning the QR code — typically your organization or app name."
        />

        <SettingsSelectRow
          settingKey="totpDigits"
          icon={<Hash size={16} />}
          label="Default digits"
          value={String(settings.totpDigits)}
          options={[
            { value: "6", label: "6 digits" },
            { value: "8", label: "8 digits" },
          ]}
          onChange={(v) => updateSettings({ totpDigits: parseInt(v, 10) })}
          infoTooltip="Number of digits in each generated TOTP code — 6 is standard, 8 provides extra security."
        />

        <SettingsSelectRow
          settingKey="totpPeriod"
          icon={<Timer size={16} />}
          label="Default period"
          value={String(settings.totpPeriod)}
          options={[
            { value: "15", label: "15 seconds" },
            { value: "30", label: "30 seconds" },
            { value: "60", label: "60 seconds" },
          ]}
          onChange={(v) => updateSettings({ totpPeriod: parseInt(v, 10) })}
          infoTooltip="Time interval in seconds before the TOTP code rotates to a new value — 30 seconds is the most common setting."
        />

        <SettingsSelectRow
          settingKey="totpAlgorithm"
          icon={<KeyRound size={16} />}
          label="Default algorithm"
          value={settings.totpAlgorithm}
          options={[
            { value: "sha1", label: "SHA-1" },
            { value: "sha256", label: "SHA-256" },
            { value: "sha512", label: "SHA-512" },
          ]}
          onChange={(v) =>
            updateSettings({
              totpAlgorithm: v as "sha1" | "sha256" | "sha512",
            })
          }
          infoTooltip="Hash algorithm used to generate TOTP codes — SHA-1 is widely compatible, SHA-256/512 are more secure but less supported."
        />
      </Card>
    </div>
  );
}

export default TOTPDefaultsSection;
