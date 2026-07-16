import { KeyRound } from "lucide-react";
import { FormField, Select, TextInput } from "../../ui/forms";
import type { PsAuthMethod } from "../../../types/powershell";
import type { PowerShellCredentialSource } from "../../../types/powershellRemoting";
import {
  getPowerShellAuthCapability,
  getPowerShellTransportCapability,
} from "../../../utils/powershell/currentPowerShellCapabilities";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

const AUTH_LABELS: Record<PsAuthMethod, string> = {
  negotiate: "Negotiate",
  kerberos: "Kerberos",
  ntlm: "NTLM",
  basic: "Basic",
  digest: "Digest",
  default: "Backend default",
  credSsp: "CredSSP",
  certificate: "Client certificate",
};

const AUTH_ORDER: PsAuthMethod[] = [
  "negotiate",
  "kerberos",
  "ntlm",
  "basic",
  "digest",
  "default",
  "credSsp",
  "certificate",
];

export function AuthenticationSection({
  value,
  onChange,
  capabilities,
}: PowerShellRemotingSectionProps) {
  const selected = getPowerShellAuthCapability(
    capabilities,
    value.wsman.authMethod,
  );
  const sshCapability = getPowerShellTransportCapability(capabilities, "ssh");
  const sectionStatus =
    value.transport === "ssh"
      ? (sshCapability?.status ?? "unsupported")
      : (selected?.status ?? "unsupported");
  const wsmanOverHttp =
    value.transport === "wsman" && value.wsman.scheme === "http";

  return (
    <PowerShellEditorSection
      id="authentication"
      title="Authentication"
      description="Select an identity source and an authentication mechanism independently."
      icon={<KeyRound size={16} />}
      status={<CapabilityBadge status={sectionStatus} />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField
          label="Credential source"
          hint="Secret values are resolved at connect time and are never stored in this settings object."
        >
          <Select
            label="PowerShell credential source"
            value={value.credential.source}
            onChange={(source) =>
              onChange({
                ...value,
                credential: {
                  ...value.credential,
                  source: source as PowerShellCredentialSource,
                },
              })
            }
            options={[
              { value: "prompt", label: "Prompt on connect" },
              { value: "saved", label: "Saved encrypted credential" },
              { value: "vault", label: "External vault" },
            ]}
            variant="form"
          />
        </FormField>

        {value.transport === "wsman" && (
          <FormField
            label="Authentication method"
            error={
              wsmanOverHttp
                ? "WSMan authentication is blocked over HTTP. Select HTTPS first."
                : undefined
            }
          >
            <Select
              label="PowerShell authentication method"
              value={value.wsman.authMethod}
              onChange={(authMethod) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    authMethod: authMethod as PsAuthMethod,
                  },
                })
              }
              options={AUTH_ORDER.map((authMethod) => {
                const capability = getPowerShellAuthCapability(
                  capabilities,
                  authMethod,
                );
                const unavailable = capability?.status === "unsupported";
                return {
                  value: authMethod,
                  label: `${AUTH_LABELS[authMethod]}${unavailable ? " — unavailable" : ""}`,
                  disabled: unavailable,
                  title: capability?.reason,
                };
              })}
              variant="form"
            />
          </FormField>
        )}

        <FormField label="Username">
          <TextInput
            label="PowerShell username"
            value={value.credential.username}
            onChange={(username) =>
              onChange({
                ...value,
                credential: { ...value.credential, username },
              })
            }
            autoComplete="username"
            variant="form"
          />
        </FormField>
        <FormField label="Domain" hint="Optional for workgroup and UPN logins.">
          <TextInput
            label="PowerShell domain"
            value={value.credential.domain ?? ""}
            onChange={(domain) =>
              onChange({
                ...value,
                credential: {
                  ...value.credential,
                  domain: domain || null,
                },
              })
            }
            variant="form"
          />
        </FormField>

        {value.credential.source === "saved" && (
          <FormField
            label="Saved credential"
            hint="Opaque encrypted-store record ID."
            className="md:col-span-2"
          >
            <TextInput
              label="Saved credential ID"
              value={value.credential.savedCredentialId ?? ""}
              onChange={(savedCredentialId) =>
                onChange({
                  ...value,
                  credential: {
                    ...value.credential,
                    savedCredentialId: savedCredentialId || null,
                  },
                })
              }
              variant="form"
            />
          </FormField>
        )}

        {value.credential.source === "vault" && (
          <>
            <FormField label="Vault integration">
              <TextInput
                label="Vault integration ID"
                value={value.credential.vaultRef?.integrationId ?? ""}
                onChange={(integrationId) =>
                  onChange({
                    ...value,
                    credential: {
                      ...value.credential,
                      vaultRef: {
                        secretId: value.credential.vaultRef?.secretId ?? "",
                        integrationId: integrationId || null,
                      },
                    },
                  })
                }
                variant="form"
              />
            </FormField>
            <FormField label="Vault secret">
              <TextInput
                label="Vault secret ID"
                value={value.credential.vaultRef?.secretId ?? ""}
                onChange={(secretId) =>
                  onChange({
                    ...value,
                    credential: {
                      ...value.credential,
                      vaultRef: {
                        integrationId:
                          value.credential.vaultRef?.integrationId ?? null,
                        secretId,
                      },
                    },
                  })
                }
                variant="form"
              />
            </FormField>
          </>
        )}
      </div>

      {wsmanOverHttp && (
        <CapabilityNotice tone="error">
          WSMan authentication is blocked over HTTP because NTLM and Basic
          traffic require transport confidentiality. Change the endpoint to
          HTTPS.
        </CapabilityNotice>
      )}
      {value.transport === "ssh" ? (
        <CapabilityNotice tone="warning">
          The shipping SSH adapter supports password and private-key
          authentication. Agent identities remain unavailable and host keys must
          match known_hosts or a pinned SHA256 fingerprint.
        </CapabilityNotice>
      ) : (
        <CapabilityNotice
          tone={selected?.status === "unsupported" ? "error" : "warning"}
        >
          {selected?.reason ??
            "This authentication method is not reported by the current backend."}
        </CapabilityNotice>
      )}
    </PowerShellEditorSection>
  );
}
