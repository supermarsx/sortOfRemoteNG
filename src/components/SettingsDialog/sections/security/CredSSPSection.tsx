import React from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  ArrowLeftRight,
  KeyRound,
  UserMinus,
  Lock as LockIcon,
  Network,
  Globe,
  Users,
  List,
} from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsTextRow,
} from "../../../ui/settings/SettingsPrimitives";

function CredSSPSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  const cred = settings.credsspDefaults;
  const oracle = cred?.oracleRemediation ?? "mitigated";

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ShieldAlert className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            CredSSP Remediation Defaults{" "}
            <InfoTooltip text="Global defaults for RDP Credential Security Support Provider and Network Level Authentication behavior." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Global defaults for RDP CredSSP / NLA behaviour. Individual
          connections can override these.
        </p>

        <SettingsSelectRow
          icon={<ShieldAlert size={16} />}
          label="Encryption Oracle Remediation"
          description={
            oracle === "force-updated"
              ? "Both client and server must be patched for CVE-2018-0886."
              : oracle === "vulnerable"
                ? "Warning: allows connections regardless of patch status — security risk."
                : "Blocks connections to vulnerable servers but permits all others."
          }
          value={oracle}
          options={[
            { value: "force-updated", label: "Force Updated Clients" },
            { value: "mitigated", label: "Mitigated (recommended)" },
            { value: "vulnerable", label: "Vulnerable (allow all)" },
          ]}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                oracleRemediation: v as
                  | "force-updated"
                  | "mitigated"
                  | "vulnerable",
              },
            })
          }
          infoTooltip="Controls whether connections are allowed to unpatched servers vulnerable to CVE-2018-0886."
        />

        <SettingsSelectRow
          icon={<Network size={16} />}
          label="Default NLA mode"
          value={cred?.nlaMode ?? "required"}
          options={[
            { value: "required", label: "Required (reject if NLA unavailable)" },
            { value: "preferred", label: "Preferred (fallback to TLS)" },
            { value: "disabled", label: "Disabled (TLS only)" },
          ]}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                nlaMode: v as "required" | "preferred" | "disabled",
              },
            })
          }
          infoTooltip="Network Level Authentication mode — Required rejects if NLA is unavailable, Preferred falls back to TLS, Disabled uses TLS only."
        />

        <SettingsSelectRow
          icon={<LockIcon size={16} />}
          label="Minimum TLS version"
          value={cred?.tlsMinVersion ?? "1.2"}
          options={[
            { value: "1.0", label: "TLS 1.0 (legacy, insecure)" },
            { value: "1.1", label: "TLS 1.1 (deprecated)" },
            { value: "1.2", label: "TLS 1.2 (recommended)" },
            { value: "1.3", label: "TLS 1.3 (strictest)" },
          ]}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                tlsMinVersion: v as "1.0" | "1.1" | "1.2" | "1.3",
              },
            })
          }
          infoTooltip="Lowest TLS protocol version the client will accept — TLS 1.2 or higher is recommended for security."
        />

        <SettingsSelectRow
          icon={<KeyRound size={16} />}
          label="CredSSP TSRequest version"
          value={String(cred?.credsspVersion ?? 6)}
          options={[
            { value: "2", label: "Version 2 (legacy)" },
            { value: "3", label: "Version 3 (with client nonce)" },
            { value: "6", label: "Version 6 (latest, with nonce binding)" },
          ]}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                credsspVersion: parseInt(v, 10) as 2 | 3 | 6,
              },
            })
          }
          infoTooltip="CredSSP protocol version — higher versions add nonce binding and other mitigations against relay attacks."
        />

        <SettingsSelectRow
          icon={<ShieldCheck size={16} />}
          label="Server certificate validation"
          value={cred?.serverCertValidation ?? "validate"}
          options={[
            { value: "validate", label: "Validate (reject untrusted)" },
            { value: "warn", label: "Warn (prompt on untrusted)" },
            { value: "ignore", label: "Ignore (accept all certificates)" },
          ]}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                serverCertValidation: v as "validate" | "warn" | "ignore",
              },
            })
          }
          infoTooltip="How the client handles untrusted server certificates — Validate rejects them, Warn prompts you, Ignore accepts all."
        />

        {/* Boolean toggles */}
        {(
          [
            {
              key: "allowHybridEx",
              default: false,
              label: "Allow HYBRID_EX protocol (Early User Auth Result)",
              tooltip:
                "Enable the HYBRID_EX extension that returns authentication results before full connection setup completes.",
              icon: <Zap size={16} />,
            },
            {
              key: "nlaFallbackToTls",
              default: true,
              label: "Allow NLA fallback to TLS on failure",
              tooltip:
                "Fall back to plain TLS authentication when Network Level Authentication negotiation fails.",
              icon: <ArrowLeftRight size={16} />,
            },
            {
              key: "enforceServerPublicKeyValidation",
              default: true,
              label: "Enforce server public key validation during CredSSP",
              tooltip:
                "Verify the server's public key during the CredSSP handshake to prevent man-in-the-middle attacks.",
              icon: <KeyRound size={16} />,
            },
            {
              key: "restrictedAdmin",
              default: false,
              label: "Restricted Admin mode (no credential delegation)",
              tooltip:
                "Connect without forwarding your credentials to the remote server — prevents credential theft on compromised hosts.",
              icon: <UserMinus size={16} />,
            },
            {
              key: "remoteCredentialGuard",
              default: false,
              label: "Remote Credential Guard (Kerberos delegation)",
              tooltip:
                "Use Kerberos-based credential delegation that keeps credentials on the local machine and never exposes them to the remote host.",
              icon: <LockIcon size={16} />,
            },
          ] as const
        ).map(({ key, default: def, label, tooltip, icon }) => (
          <Toggle
            key={key}
            checked={cred?.[key] ?? def}
            onChange={(v) =>
              updateSettings({
                credsspDefaults: {
                  ...cred,
                  [key]: v,
                },
              })
            }
            icon={icon}
            label={label}
            infoTooltip={tooltip}
          />
        ))}

        {/* Authentication packages — same Toggle style under a sub-header. */}
        <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-[var(--color-border)]/40 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] font-medium">
          <KeyRound size={11} />
          Authentication packages
          <InfoTooltip text="Select which authentication protocols are available for CredSSP negotiation." />
        </div>

        {(
          [
            {
              key: "ntlmEnabled",
              default: true,
              label: "NTLM",
              tooltip:
                "NT LAN Manager authentication — widely supported legacy protocol for Windows credential exchange.",
              icon: <Network size={16} />,
            },
            {
              key: "kerberosEnabled",
              default: false,
              label: "Kerberos",
              tooltip:
                "Kerberos ticket-based authentication — requires a domain controller and is more secure than NTLM.",
              icon: <Globe size={16} />,
            },
            {
              key: "pku2uEnabled",
              default: false,
              label: "PKU2U",
              tooltip:
                "Public Key User-to-User protocol — allows peer-to-peer authentication without a domain controller.",
              icon: <Users size={16} />,
            },
          ] as const
        ).map(({ key, default: def, label, tooltip, icon }) => (
          <Toggle
            key={key}
            checked={cred?.[key] ?? def}
            onChange={(v) =>
              updateSettings({
                credsspDefaults: {
                  ...cred,
                  [key]: v,
                },
              })
            }
            icon={icon}
            label={label}
            infoTooltip={tooltip}
          />
        ))}

        <SettingsTextRow
          icon={<List size={16} />}
          label="SSPI package list override"
          description="Advanced: overrides the auth-package toggles above. Prefix with ! to exclude."
          value={cred?.sspiPackageList ?? ""}
          onChange={(v) =>
            updateSettings({
              credsspDefaults: {
                ...cred,
                sspiPackageList: v,
              },
            })
          }
          placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
          infoTooltip="Advanced: manually specify the SSPI authentication package order — overrides the toggles above. Prefix a package with ! to exclude it."
        />
      </Card>
    </div>
  );
}

export default CredSSPSection;
