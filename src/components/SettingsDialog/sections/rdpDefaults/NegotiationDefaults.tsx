import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings";
import { Zap } from "lucide-react";
import { Checkbox, Select, Slider } from "../../../ui/forms";

const NegotiationDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Zap className="w-4 h-4 text-amber-400" />
      Connection Negotiation Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.autoDetect ?? false} onChange={(v: boolean) => update({ autoDetect: v })} />
      <span className="sor-toggle-label">
        Enable auto-detect negotiation by default
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
      Automatically tries different protocol combinations until a working one is
      found.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Strategy
      </label>
      <Select value={rdp.negotiationStrategy ?? "nla-first"} onChange={(v: string) => update({
            negotiationStrategy: e.target
              .value as GlobalSettings["rdpDefaults"]["negotiationStrategy"],
          })} options={[{ value: "auto", label: "Auto (try all combinations)" }, { value: "nla-first", label: "NLA First (CredSSP → TLS → Plain)" }, { value: "tls-first", label: "TLS First (TLS → CredSSP → Plain)" }, { value: "nla-only", label: "NLA Only" }, { value: "tls-only", label: "TLS Only" }, { value: "plain-only", label: "Plain Only (DANGEROUS)" }]} className="selectClass" />
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Max Retries: {rdp.maxRetries ?? 3}
      </label>
      <Slider value={rdp.maxRetries ?? 3} onChange={(v: number) => update({ maxRetries: v })} min={1} max={10} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1</span>
        <span>10</span>
      </div>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Retry Delay: {rdp.retryDelayMs ?? 1000}ms
      </label>
      <Slider value={rdp.retryDelayMs ?? 1000} onChange={(v: number) => update({ retryDelayMs: v })} min={100} max={5000} variant="full" step={100} />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>100ms</span>
        <span>5000ms</span>
      </div>
    </div>
  </div>
);

export default NegotiationDefaults;
