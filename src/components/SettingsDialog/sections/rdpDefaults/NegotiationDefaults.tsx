import type { SectionProps } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import { Zap, Sparkles, ListChecks, Repeat, Timer } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
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
        description="Try different protocol combinations until a working one is found."
        infoTooltip="Automatically tries different protocol combinations until a working one is found."
      />

      <SettingsSelectRow
        settingKey="negotiationStrategy"
        icon={<ListChecks size={16} />}
        label="Default strategy"
        value={rdp.negotiationStrategy ?? "nla-first"}
        options={[
          { value: "auto", label: "Auto (try all combinations)" },
          { value: "nla-first", label: "NLA First (CredSSP → TLS → Plain)" },
          { value: "tls-first", label: "TLS First (TLS → CredSSP → Plain)" },
          { value: "nla-only", label: "NLA Only" },
          { value: "tls-only", label: "TLS Only" },
          { value: "plain-only", label: "Plain Only (DANGEROUS)" },
        ]}
        onChange={(v) =>
          update({
            negotiationStrategy:
              v as GlobalSettings["rdpDefaults"]["negotiationStrategy"],
          })
        }
        infoTooltip="Determines the order in which security protocols are attempted when negotiating a connection."
      />

      <SettingsSliderRow
        settingKey="maxRetries"
        icon={<Repeat size={16} />}
        label="Max retries"
        value={rdp.maxRetries ?? 3}
        min={1}
        max={10}
        onChange={(v) => update({ maxRetries: v })}
        infoTooltip="Maximum number of connection attempts before giving up on a failed negotiation."
      />

      <SettingsSliderRow
        settingKey="retryDelayMs"
        icon={<Timer size={16} />}
        label="Retry delay"
        value={rdp.retryDelayMs ?? 1000}
        min={100}
        max={5000}
        step={100}
        unit="ms"
        onChange={(v) => update({ retryDelayMs: v })}
        infoTooltip="Wait time in milliseconds between consecutive connection retry attempts."
      />
    </Card>
  </div>
);

export default NegotiationDefaults;
