import { Route } from "lucide-react";
import { FormField, Select, TextInput } from "../../ui/forms";
import type { PowerShellProxyMode } from "../../../types/powershellRemoting";
import { getPowerShellFeatureCapability } from "../../../utils/powershell/currentPowerShellCapabilities";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

interface NetworkPathSummarySectionProps extends PowerShellRemotingSectionProps {
  summary?: string | null;
}

export function NetworkPathSummarySection({
  value,
  onChange,
  capabilities,
  summary,
}: NetworkPathSummarySectionProps) {
  const capability = getPowerShellFeatureCapability(
    capabilities,
    "networkPath",
  );
  const displaySummary =
    summary ?? value.networkPath.summary ?? "Direct connection";
  const routed =
    value.networkPath.mode === "connectionPath" ||
    value.wsman.proxy.mode !== "none";
  return (
    <PowerShellEditorSection
      id="network-path"
      title="Network Path"
      description="Read-only summary from the connection-level route resolver."
      icon={<Route size={16} />}
      status={<CapabilityBadge status={capability?.status ?? "unsupported"} />}
    >
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] px-3 py-2">
        <p className="text-sm text-[var(--color-text)]">{displaySummary}</p>
        {value.networkPath.pathId && (
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            Route reference: {value.networkPath.pathId}
          </p>
        )}
      </div>
      <fieldset
        disabled={capability?.status === "unsupported"}
        aria-label="WSMan proxy settings"
        className="space-y-3 disabled:opacity-60"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Explicit WSMan proxy">
            <Select
              label="WSMan proxy mode"
              value={value.wsman.proxy.mode}
              onChange={(mode) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    proxy: {
                      ...value.wsman.proxy,
                      mode: mode as PowerShellProxyMode,
                    },
                  },
                })
              }
              options={[
                { value: "none", label: "No explicit proxy" },
                { value: "http", label: "HTTP proxy" },
                { value: "socks5", label: "SOCKS5 proxy" },
              ]}
              variant="form"
            />
          </FormField>
          <FormField label="Proxy URL">
            <TextInput
              label="WSMan proxy URL"
              value={value.wsman.proxy.url ?? ""}
              onChange={(url) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    proxy: { ...value.wsman.proxy, url: url || null },
                  },
                })
              }
              placeholder="http://proxy.example.test:8080"
              variant="form"
            />
          </FormField>
          <FormField
            label="Proxy credential reference"
            hint="Opaque encrypted-store reference; no inline proxy password."
            className="md:col-span-2"
          >
            <TextInput
              label="WSMan proxy credential reference"
              value={value.wsman.proxy.credentialRef ?? ""}
              onChange={(credentialRef) =>
                onChange({
                  ...value,
                  wsman: {
                    ...value.wsman,
                    proxy: {
                      ...value.wsman.proxy,
                      credentialRef: credentialRef || null,
                    },
                  },
                })
              }
              variant="form"
            />
          </FormField>
        </div>
      </fieldset>
      {capability?.status === "unsupported" && (
        <CapabilityNotice tone={routed ? "error" : "muted"}>
          {routed ? "Connection blocked for this route: " : "Unavailable: "}
          {capability.reason}. Direct endpoints do not require network-path
          materialization.
        </CapabilityNotice>
      )}
    </PowerShellEditorSection>
  );
}
