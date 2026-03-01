import { GlobalSettings } from "../../../../types/settings";
import { ShieldAlert } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
function CredSSPSection({
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
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          CredSSP Remediation Defaults
        </h4>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Global defaults for RDP CredSSP / NLA behaviour. Individual
          connections can override these.
        </p>
      </div>

      {/* Oracle Remediation Policy */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Encryption Oracle Remediation Policy
        </label>
        <Select value={settings.credsspDefaults?.oracleRemediation ?? "mitigated"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                oracleRemediation: v as
                  | "force-updated"
                  | "mitigated"
                  | "vulnerable",
              },
            })} options={[{ value: "force-updated", label: "Force Updated Clients" }, { value: "mitigated", label: "Mitigated (recommended)" }, { value: "vulnerable", label: "Vulnerable (allow all)" }]} className="w-full" />
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          {settings.credsspDefaults?.oracleRemediation === "force-updated"
            ? "Both client and server must be patched for CVE-2018-0886."
            : settings.credsspDefaults?.oracleRemediation === "vulnerable"
              ? "Warning: Allows connections regardless of patch status. Security risk."
              : "Blocks connections to vulnerable servers but permits all others."}
        </p>
      </div>

      {/* NLA Mode */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default NLA Mode
        </label>
        <Select value={settings.credsspDefaults?.nlaMode ?? "required"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                nlaMode: v as
                  | "required"
                  | "preferred"
                  | "disabled",
              },
            })} options={[{ value: "required", label: "Required (reject if NLA unavailable)" }, { value: "preferred", label: "Preferred (fallback to TLS)" }, { value: "disabled", label: "Disabled (TLS only)" }]} className="w-full" />
      </div>

      {/* Minimum TLS Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Minimum TLS Version
        </label>
        <Select value={settings.credsspDefaults?.tlsMinVersion ?? "1.2"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                tlsMinVersion: v as "1.0" | "1.1" | "1.2" | "1.3",
              },
            })} options={[{ value: "1.0", label: "TLS 1.0 (legacy, insecure)" }, { value: "1.1", label: "TLS 1.1 (deprecated)" }, { value: "1.2", label: "TLS 1.2 (recommended)" }, { value: "1.3", label: "TLS 1.3 (strictest)" }]} className="w-full" />
      </div>

      {/* CredSSP Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          CredSSP TSRequest Version
        </label>
        <Select value={String(settings.credsspDefaults?.credsspVersion ?? 6)} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                credsspVersion: parseInt(v) as 2 | 3 | 6,
              },
            })} options={[{ value: "2", label: "Version 2 (legacy)" }, { value: "3", label: "Version 3 (with client nonce)" }, { value: "6", label: "Version 6 (latest, with nonce binding)" }]} className="w-full" />
      </div>

      {/* Server Cert Validation */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Server Certificate Validation
        </label>
        <Select value={settings.credsspDefaults?.serverCertValidation ?? "validate"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                serverCertValidation: v as
                  | "validate"
                  | "warn"
                  | "ignore",
              },
            })} options={[{ value: "validate", label: "Validate (reject untrusted)" }, { value: "warn", label: "Warn (prompt on untrusted)" }, { value: "ignore", label: "Ignore (accept all certificates)" }]} className="w-full" />
      </div>

      {/* Boolean toggles */}
      <div className="space-y-3">
        {[
          {
            key: "allowHybridEx" as const,
            default: false,
            label: "Allow HYBRID_EX protocol (Early User Auth Result)",
          },
          {
            key: "nlaFallbackToTls" as const,
            default: true,
            label: "Allow NLA fallback to TLS on failure",
          },
          {
            key: "enforceServerPublicKeyValidation" as const,
            default: true,
            label: "Enforce server public key validation during CredSSP",
          },
          {
            key: "restrictedAdmin" as const,
            default: false,
            label: "Restricted Admin mode (no credential delegation)",
          },
          {
            key: "remoteCredentialGuard" as const,
            default: false,
            label: "Remote Credential Guard (Kerberos delegation)",
          },
        ].map(({ key, default: def, label }) => (
          <label
            key={key}
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <Checkbox checked={settings.credsspDefaults?.[key] ?? def} onChange={(v: boolean) => updateSettings({
                  credsspDefaults: {
                    ...settings.credsspDefaults,
                    [key]: v,
                  },
                })} />
            <span className="sor-toggle-label">
              {label}
            </span>
          </label>
        ))}
      </div>

      {/* Authentication packages */}
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Authentication Packages
        </label>
        <div className="space-y-2 pl-1">
          {[
            { key: "ntlmEnabled" as const, default: true, label: "NTLM" },
            {
              key: "kerberosEnabled" as const,
              default: false,
              label: "Kerberos",
            },
            { key: "pku2uEnabled" as const, default: false, label: "PKU2U" },
          ].map(({ key, default: def, label }) => (
            <label
              key={key}
              className="flex items-center space-x-3 cursor-pointer group"
            >
              <Checkbox checked={settings.credsspDefaults?.[key] ?? def} onChange={(v: boolean) => updateSettings({
                    credsspDefaults: {
                      ...settings.credsspDefaults,
                      [key]: v,
                    },
                  })} />
              <span className="sor-toggle-label">
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SSPI Override */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          SSPI Package List Override
        </label>
        <input
          type="text"
          value={settings.credsspDefaults?.sspiPackageList ?? ""}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                sspiPackageList: e.target.value,
              },
            })
          }
          className="sor-settings-input w-full text-sm"
          placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
        />
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Advanced: Overrides the auth package checkboxes above. Prefix with !
          to exclude.
        </p>
      </div>
    </div>
  );
}

export default CredSSPSection;
