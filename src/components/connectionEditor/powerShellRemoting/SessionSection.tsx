import { Clock3 } from "lucide-react";
import { Checkbox, FormField, NumberInput, Select } from "../../ui/forms";
import type { OutputBufferingMode } from "../../../types/powershell";
import { getPowerShellFeatureCapability } from "../../../utils/powershell/currentPowerShellCapabilities";
import {
  CapabilityBadge,
  CapabilityNotice,
  PowerShellEditorSection,
} from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

export function SessionSection({
  value,
  onChange,
  capabilities,
}: PowerShellRemotingSectionProps) {
  const reconnect = getPowerShellFeatureCapability(
    capabilities,
    "disconnectReconnect",
  );
  const cancellation = getPowerShellFeatureCapability(
    capabilities,
    "commandCancellation",
  );
  const setSessionNumber = (
    key:
      | "connectTimeoutSec"
      | "openTimeoutSec"
      | "operationTimeoutSec"
      | "cancelTimeoutSec"
      | "idleTimeoutSec"
      | "maxReceivedDataSizeMb"
      | "maxReceivedObjectSizeMb",
    number: number,
  ) => onChange({ ...value, session: { ...value.session, [key]: number } });

  return (
    <PowerShellEditorSection
      id="session"
      title="Session"
      description="Timeouts, reconnect policy, and bounded output handling."
      icon={<Clock3 size={16} />}
      status={<CapabilityBadge status={reconnect?.status ?? "unsupported"} />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(
          [
            ["connectTimeoutSec", "Connect timeout", 30],
            ["openTimeoutSec", "Open timeout", 180],
            ["operationTimeoutSec", "Operation timeout", 180],
            ["cancelTimeoutSec", "Cancel timeout", 60],
            ["idleTimeoutSec", "Idle timeout", 7200],
          ] as const
        ).map(([key, label]) => (
          <FormField key={key} label={`${label} (seconds)`}>
            <NumberInput
              label={`${label} seconds`}
              value={value.session[key]}
              onChange={(number) => setSessionNumber(key, number)}
              min={1}
              max={key === "idleTimeoutSec" ? 604800 : 86400}
              variant="form"
            />
          </FormField>
        ))}
        <FormField label="Output buffering">
          <Select
            label="Disconnected output buffering mode"
            value={value.session.outputBufferingMode}
            onChange={(outputBufferingMode) =>
              onChange({
                ...value,
                session: {
                  ...value.session,
                  outputBufferingMode:
                    outputBufferingMode as OutputBufferingMode,
                },
              })
            }
            options={[
              { value: "block", label: "Block when full" },
              { value: "drop", label: "Drop oldest output" },
              { value: "none", label: "Do not buffer" },
            ]}
            variant="form"
          />
        </FormField>
        <FormField label="Max received data (MB)">
          <NumberInput
            label="Maximum received data MB"
            value={value.session.maxReceivedDataSizeMb}
            onChange={(number) =>
              setSessionNumber("maxReceivedDataSizeMb", number)
            }
            min={1}
            max={4096}
            variant="form"
          />
        </FormField>
        <FormField label="Max received object (MB)">
          <NumberInput
            label="Maximum received object MB"
            value={value.session.maxReceivedObjectSizeMb}
            onChange={(number) =>
              setSessionNumber("maxReceivedObjectSizeMb", number)
            }
            min={1}
            max={4096}
            variant="form"
          />
        </FormField>
      </div>

      <div className="rounded border border-[var(--color-border)] p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
          <Checkbox
            aria-label="Reconnect PowerShell session"
            checked={value.session.reconnect.enabled}
            onChange={(enabled) =>
              onChange({
                ...value,
                session: {
                  ...value.session,
                  reconnect: { ...value.session.reconnect, enabled },
                },
              })
            }
            disabled={reconnect?.status === "unsupported"}
            variant="form"
          />
          Attempt session reconnect
        </label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Maximum attempts">
            <NumberInput
              label="Maximum reconnect attempts"
              value={value.session.reconnect.maxAttempts}
              onChange={(maxAttempts) =>
                onChange({
                  ...value,
                  session: {
                    ...value.session,
                    reconnect: { ...value.session.reconnect, maxAttempts },
                  },
                })
              }
              min={0}
              max={100}
              disabled={!value.session.reconnect.enabled}
              variant="form"
            />
          </FormField>
          <FormField label="Delay (seconds)">
            <NumberInput
              label="Reconnect delay seconds"
              value={value.session.reconnect.delaySec}
              onChange={(delaySec) =>
                onChange({
                  ...value,
                  session: {
                    ...value.session,
                    reconnect: { ...value.session.reconnect, delaySec },
                  },
                })
              }
              min={0}
              max={3600}
              disabled={!value.session.reconnect.enabled}
              variant="form"
            />
          </FormField>
        </div>
        <CapabilityNotice tone="warning">
          {reconnect?.reason ?? "Reconnect capability is not reported."}
        </CapabilityNotice>
      </div>

      {cancellation?.status === "unsupported" && (
        <CapabilityNotice tone="muted">
          Command cancellation is unavailable: {cancellation.reason}. The cancel
          timeout is retained for schema compatibility but does not imply that
          the current runtime can interrupt a running command.
        </CapabilityNotice>
      )}
    </PowerShellEditorSection>
  );
}
