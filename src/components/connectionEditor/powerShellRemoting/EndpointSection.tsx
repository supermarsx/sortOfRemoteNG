import { Link2, Network } from "lucide-react";
import { FormField, NumberInput, Select, TextInput } from "../../ui/forms";
import { canonicalPowerShellEndpoint } from "../../../utils/powershell/normalizePowerShellRemoting";
import { getPowerShellTransportCapability } from "../../../utils/powershell/currentPowerShellCapabilities";
import type { PowerShellRemotingTransport } from "../../../types/powershellRemoting";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

export function EndpointSection({
  value,
  onChange,
  capabilities,
  targetHost,
}: PowerShellRemotingSectionProps) {
  const selectedCapability = getPowerShellTransportCapability(
    capabilities,
    value.transport,
    value.wsman.scheme,
  );
  const sshCapability = getPowerShellTransportCapability(capabilities, "ssh");
  const wsmanCapability = getPowerShellTransportCapability(
    capabilities,
    "wsman",
    value.wsman.scheme,
  );

  let endpointPreview: string;
  let endpointError: string | undefined;
  try {
    endpointPreview = canonicalPowerShellEndpoint(value, targetHost);
  } catch (error) {
    endpointPreview = "Endpoint is incomplete";
    endpointError = error instanceof Error ? error.message : "Invalid endpoint";
  }

  const setTransport = (transport: PowerShellRemotingTransport) => {
    onChange({ ...value, transport });
  };

  return (
    <PowerShellEditorSection
      id="endpoint"
      title="Endpoint"
      description="Choose the remoting transport and its canonical, credential-free endpoint."
      icon={<Network size={16} />}
      status={
        <CapabilityBadge status={selectedCapability?.status ?? "unsupported"} />
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField
          label="Transport"
          hint="WSMan and PowerShell-over-SSH have separate settings and capability checks."
        >
          <Select
            label="PowerShell remoting transport"
            value={value.transport}
            onChange={(next) =>
              setTransport(next as PowerShellRemotingTransport)
            }
            options={[
              {
                value: "wsman",
                label: "WSMan — unavailable",
                disabled: wsmanCapability?.status === "unsupported",
                title: wsmanCapability?.reason,
              },
              {
                value: "ssh",
                label: `PowerShell over SSH${sshCapability?.status === "unsupported" ? " — unavailable" : ""}`,
                disabled: sshCapability?.status === "unsupported",
                title: sshCapability?.reason,
              },
            ]}
            variant="form"
          />
        </FormField>

        {value.transport === "wsman" && (
          <FormField label="WSMan scheme">
            <Select
              label="WSMan scheme"
              value={value.wsman.scheme}
              onChange={(scheme) => {
                const nextScheme = scheme as "http" | "https";
                const currentIsDefault =
                  value.wsman.port === 5985 || value.wsman.port === 5986;
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    scheme: nextScheme,
                    port: currentIsDefault
                      ? nextScheme === "https"
                        ? 5986
                        : 5985
                      : value.wsman.port,
                  },
                });
              }}
              options={[
                { value: "https", label: "HTTPS (recommended)" },
                { value: "http", label: "HTTP" },
              ]}
              variant="form"
            />
          </FormField>
        )}

        {value.transport === "wsman" && (
          <>
            <FormField label="Port">
              <NumberInput
                label="WSMan port"
                value={value.wsman.port}
                onChange={(port) =>
                  onChange({
                    ...value,
                    wsman: { ...value.wsman, port },
                  })
                }
                min={1}
                max={65535}
                variant="form"
              />
            </FormField>
            <FormField label="WSMan path">
              <TextInput
                label="WSMan path"
                value={value.wsman.path}
                onChange={(path) =>
                  onChange({
                    ...value,
                    wsman: { ...value.wsman, path },
                  })
                }
                placeholder="/wsman"
                variant="form"
              />
            </FormField>
            <FormField
              label="Connection URI override"
              hint="Optional. Must be an HTTP(S) URI without credentials, query parameters, or fragments."
              className="md:col-span-2"
            >
              <TextInput
                label="Connection URI override"
                value={value.wsman.connectionUri ?? ""}
                onChange={(connectionUri) =>
                  onChange({
                    ...value,
                    wsman: {
                      ...value.wsman,
                      connectionUri: connectionUri || null,
                    },
                  })
                }
                placeholder="https://server.example.test:5986/wsman"
                error={endpointError}
                variant="form"
              />
            </FormField>
            <FormField label="PowerShell configuration">
              <TextInput
                label="PowerShell configuration"
                value={value.wsman.configurationName}
                onChange={(configurationName) =>
                  onChange({
                    ...value,
                    wsman: { ...value.wsman, configurationName },
                  })
                }
                placeholder="microsoft.powershell"
                variant="form"
              />
            </FormField>
            <FormField label="WSMan application">
              <TextInput
                label="WSMan application"
                value={value.wsman.applicationName}
                onChange={(applicationName) =>
                  onChange({
                    ...value,
                    wsman: { ...value.wsman, applicationName },
                  })
                }
                placeholder="wsman"
                variant="form"
              />
            </FormField>
          </>
        )}
      </div>

      <CapabilityNotice
        tone={
          selectedCapability?.status === "unsupported" ? "error" : "warning"
        }
      >
        {selectedCapability?.reason ??
          "This transport is not reported by the current backend."}
      </CapabilityNotice>

      <div className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] px-3 py-2">
        <Link2
          size={14}
          className="mt-0.5 shrink-0 text-[var(--color-textMuted)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-textMuted)]">
            Canonical endpoint
          </p>
          <code className="block break-all text-xs text-[var(--color-text)]">
            {endpointPreview}
          </code>
        </div>
      </div>
    </PowerShellEditorSection>
  );
}
