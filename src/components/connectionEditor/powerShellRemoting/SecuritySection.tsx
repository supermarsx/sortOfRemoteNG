import { ShieldCheck } from "lucide-react";
import { Checkbox, FormField, Select, TextInput } from "../../ui/forms";
import type { PowerShellTlsTrustMode } from "../../../types/powershellRemoting";
import { getPowerShellAuthCapability } from "../../../utils/powershell/currentPowerShellCapabilities";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

export function SecuritySection({
  value,
  onChange,
  capabilities,
}: PowerShellRemotingSectionProps) {
  const certificate = getPowerShellAuthCapability(capabilities, "certificate");
  const tlsActive =
    value.transport === "wsman" && value.wsman.scheme === "https";

  return (
    <PowerShellEditorSection
      id="security"
      title="Security"
      description="Configure server trust separately from the credential and authentication method."
      icon={<ShieldCheck size={16} />}
      status={
        <CapabilityBadge status={tlsActive ? "supported" : "unsupported"} />
      }
    >
      {!tlsActive && (
        <CapabilityNotice tone="warning">
          TLS trust settings are inactive because this endpoint uses HTTP.
          Switch to HTTPS before using sensitive authentication.
        </CapabilityNotice>
      )}

      <fieldset disabled={!tlsActive} className="space-y-3 disabled:opacity-60">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Server certificate trust">
            <Select
              label="TLS server trust mode"
              value={value.wsman.tls.trustMode}
              onChange={(trustMode) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    tls: {
                      ...value.wsman.tls,
                      trustMode: trustMode as PowerShellTlsTrustMode,
                    },
                  },
                })
              }
              options={[
                { value: "system", label: "System trust store" },
                { value: "tofu", label: "Trust on first use" },
                { value: "pinned", label: "Pinned fingerprint" },
                { value: "alwaysTrust", label: "Always trust (unsafe)" },
              ]}
              variant="form"
            />
          </FormField>

          {value.wsman.tls.trustMode === "pinned" && (
            <FormField label="Pinned certificate fingerprint" required>
              <TextInput
                label="Pinned certificate fingerprint"
                value={value.wsman.tls.pinnedFingerprint ?? ""}
                onChange={(pinnedFingerprint) =>
                  onChange({
                    ...value,
                    wsman: {
                      ...value.wsman,
                      tls: {
                        ...value.wsman.tls,
                        pinnedFingerprint: pinnedFingerprint || null,
                      },
                    },
                  })
                }
                placeholder="SHA256 fingerprint"
                variant="form"
              />
            </FormField>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="flex items-start gap-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox
              aria-label="Skip TLS hostname verification"
              checked={value.wsman.tls.skipHostnameCheck}
              onChange={(skipHostnameCheck) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    tls: { ...value.wsman.tls, skipHostnameCheck },
                  },
                })
              }
              variant="form"
            />
            <span>
              Skip hostname verification
              <span className="block text-xs text-[var(--color-textMuted)]">
                Weakens endpoint identity checks.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox
              aria-label="Skip TLS revocation verification"
              checked={value.wsman.tls.skipRevocationCheck}
              onChange={(skipRevocationCheck) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    tls: { ...value.wsman.tls, skipRevocationCheck },
                  },
                })
              }
              variant="form"
            />
            <span>
              Skip revocation verification
              <span className="block text-xs text-[var(--color-textMuted)]">
                Use only when the revocation service is unreachable.
              </span>
            </span>
          </label>
        </div>

        <FormField
          label="Client certificate identity"
          hint={
            certificate?.reason ??
            "Client certificate capability is unavailable."
          }
        >
          <TextInput
            label="Client certificate credential reference"
            value={value.wsman.tls.clientCertificateRef ?? ""}
            onChange={() => undefined}
            placeholder="Unavailable in the current backend"
            disabled={certificate?.status === "unsupported"}
            variant="form"
          />
        </FormField>
      </fieldset>

      {value.wsman.tls.trustMode === "alwaysTrust" && tlsActive && (
        <CapabilityNotice tone="error">
          Always trust disables server certificate validation. Prefer the system
          trust store, TOFU, or a pinned fingerprint.
        </CapabilityNotice>
      )}
      {certificate?.status === "unsupported" && (
        <CapabilityNotice tone="muted">
          Client certificate authentication is unavailable: {certificate.reason}
        </CapabilityNotice>
      )}
    </PowerShellEditorSection>
  );
}
