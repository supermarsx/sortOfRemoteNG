import type { SectionProps } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import { Zap, Sparkles } from "lucide-react";
import { Select, Slider } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const NegotiationDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Zap className="w-4 h-4 text-primary" />}
      title="Connection Negotiation Defaults"
    />

    <Card>
      <Toggle
        checked={rdp.autoDetect ?? false}
        onChange={(v) => update({ autoDetect: v })}
        icon={<Sparkles size={16} />}
        label="Enable auto-detect negotiation by default"
        description="Try different protocol combinations until a working one is found"
        infoTooltip="Automatically tries different protocol combinations until a working one is found."
      />

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Strategy{" "}
          <InfoTooltip text="Determines the order in which security protocols are attempted when negotiating a connection." />
        </label>
        <Select
          value={rdp.negotiationStrategy ?? "nla-first"}
          onChange={(v: string) =>
            update({
              negotiationStrategy:
                v as GlobalSettings["rdpDefaults"]["negotiationStrategy"],
            })
          }
          options={[
            { value: "auto", label: "Auto (try all combinations)" },
            { value: "nla-first", label: "NLA First (CredSSP → TLS → Plain)" },
            { value: "tls-first", label: "TLS First (TLS → CredSSP → Plain)" },
            { value: "nla-only", label: "NLA Only" },
            { value: "tls-only", label: "TLS Only" },
            { value: "plain-only", label: "Plain Only (DANGEROUS)" },
          ]}
          className="selectClass"
        />
      </div>

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Max Retries: {rdp.maxRetries ?? 3}{" "}
          <InfoTooltip text="Maximum number of connection attempts before giving up on a failed negotiation." />
        </label>
        <Slider
          value={rdp.maxRetries ?? 3}
          onChange={(v: number) => update({ maxRetries: v })}
          min={1}
          max={10}
          variant="full"
        />
        <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Retry Delay: {rdp.retryDelayMs ?? 1000}ms{" "}
          <InfoTooltip text="Wait time in milliseconds between consecutive connection retry attempts." />
        </label>
        <Slider
          value={rdp.retryDelayMs ?? 1000}
          onChange={(v: number) => update({ retryDelayMs: v })}
          min={100}
          max={5000}
          variant="full"
          step={100}
        />
        <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
          <span>100ms</span>
          <span>5000ms</span>
        </div>
      </div>
    </Card>
  </div>
);

export default NegotiationDefaults;
