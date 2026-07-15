import { TerminalSquare } from "lucide-react";
import {
  Checkbox,
  FormField,
  NumberInput,
  Select,
  TextInput,
} from "../../ui/forms";
import type {
  PowerShellSshAuthMethod,
  PowerShellSshHostTrustMode,
} from "../../../types/powershellRemoting";
import { getPowerShellTransportCapability } from "../../../utils/powershell/currentPowerShellCapabilities";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

export function SshSection({
  value,
  onChange,
  capabilities,
}: PowerShellRemotingSectionProps) {
  const capability = getPowerShellTransportCapability(capabilities, "ssh");
  const unavailable = capability?.status === "unsupported";

  return (
    <PowerShellEditorSection
      id="ssh"
      title="SSH"
      description="PowerShell 7+ subsystem, identity, agent, and host-key policy."
      icon={<TerminalSquare size={16} />}
      status={<CapabilityBadge status={capability?.status ?? "unsupported"} />}
    >
      {unavailable && (
        <CapabilityNotice tone="error">
          SSH is unavailable in the current backend: {capability.reason}
        </CapabilityNotice>
      )}
      <fieldset
        disabled={unavailable || value.transport !== "ssh"}
        aria-label="PowerShell over SSH settings"
        className="space-y-3 disabled:opacity-60"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="SSH port">
            <NumberInput
              label="PowerShell SSH port"
              value={value.ssh.port}
              onChange={(port) =>
                onChange({ ...value, ssh: { ...value.ssh, port } })
              }
              min={1}
              max={65535}
              variant="form"
            />
          </FormField>
          <FormField label="PowerShell subsystem">
            <TextInput
              label="PowerShell SSH subsystem"
              value={value.ssh.subsystem}
              onChange={(subsystem) =>
                onChange({ ...value, ssh: { ...value.ssh, subsystem } })
              }
              placeholder="powershell"
              variant="form"
            />
          </FormField>
          <FormField label="SSH authentication">
            <Select
              label="PowerShell SSH authentication"
              value={value.ssh.authMethod}
              onChange={(authMethod) =>
                onChange({
                  ...value,
                  ssh: {
                    ...value.ssh,
                    authMethod: authMethod as PowerShellSshAuthMethod,
                  },
                })
              }
              options={[
                { value: "agent", label: "SSH agent" },
                { value: "privateKey", label: "Private key" },
                { value: "password", label: "Password from credential source" },
              ]}
              variant="form"
            />
          </FormField>
          <FormField
            label="Agent socket"
            hint="Optional platform-specific socket override."
          >
            <TextInput
              label="SSH agent socket"
              value={value.ssh.agentSocket ?? ""}
              onChange={(agentSocket) =>
                onChange({
                  ...value,
                  ssh: { ...value.ssh, agentSocket: agentSocket || null },
                })
              }
              variant="form"
            />
          </FormField>
          <FormField label="Private key path">
            <TextInput
              label="SSH private key path"
              value={value.ssh.privateKeyPath ?? ""}
              onChange={(privateKeyPath) =>
                onChange({
                  ...value,
                  ssh: { ...value.ssh, privateKeyPath: privateKeyPath || null },
                })
              }
              variant="form"
            />
          </FormField>
          <FormField label="Key credential reference">
            <TextInput
              label="SSH private key credential reference"
              value={value.ssh.privateKeyCredentialRef ?? ""}
              onChange={(privateKeyCredentialRef) =>
                onChange({
                  ...value,
                  ssh: {
                    ...value.ssh,
                    privateKeyCredentialRef: privateKeyCredentialRef || null,
                  },
                })
              }
              variant="form"
            />
          </FormField>
          <FormField label="Host-key trust">
            <Select
              label="SSH host-key trust mode"
              value={value.ssh.hostTrust.mode}
              onChange={(mode) =>
                onChange({
                  ...value,
                  ssh: {
                    ...value.ssh,
                    hostTrust: {
                      ...value.ssh.hostTrust,
                      mode: mode as PowerShellSshHostTrustMode,
                    },
                  },
                })
              }
              options={[
                { value: "strict", label: "Strict known-hosts verification" },
                { value: "tofu", label: "Trust on first use" },
                { value: "pinned", label: "Pinned host-key fingerprint" },
              ]}
              variant="form"
            />
          </FormField>
          <FormField label="Host-key fingerprint">
            <TextInput
              label="SSH host-key fingerprint"
              value={value.ssh.hostTrust.fingerprint ?? ""}
              onChange={(fingerprint) =>
                onChange({
                  ...value,
                  ssh: {
                    ...value.ssh,
                    hostTrust: {
                      ...value.ssh.hostTrust,
                      fingerprint: fingerprint || null,
                    },
                  },
                })
              }
              variant="form"
            />
          </FormField>
          <FormField label="Keepalive (seconds)">
            <NumberInput
              label="SSH keepalive seconds"
              value={value.ssh.keepaliveSec}
              onChange={(keepaliveSec) =>
                onChange({ ...value, ssh: { ...value.ssh, keepaliveSec } })
              }
              min={0}
              max={3600}
              variant="form"
            />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox
              aria-label="Enable SSH compression"
              checked={value.ssh.compression}
              onChange={(compression) =>
                onChange({ ...value, ssh: { ...value.ssh, compression } })
              }
              variant="form"
            />
            Enable SSH compression
          </label>
        </div>
      </fieldset>
    </PowerShellEditorSection>
  );
}
