import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Zap, ToggleLeft } from "lucide-react";
import { Connection } from "../../../types/connection";
import { NegotiationStrategies } from "../../../types/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
const NegotiationSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => (
  <Section
    title="Connection Negotiation"
    icon={<Zap size={14} className="text-amber-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.negotiation?.autoDetect ?? false} onChange={(v: boolean) => updateRdp("negotiation", { autoDetect: v })} className="CSS.checkbox" />
      <span className="font-medium">Auto-detect negotiation</span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 -mt-1">
      Automatically try different protocol combinations (CredSSP, TLS,
      plain) until a working one is found.
    </p>

    {(rdp.negotiation?.autoDetect ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Negotiation Strategy
          </label>
          <Select value={rdp.negotiation?.strategy ?? "nla-first"} onChange={(v: string) =>
              updateRdp("negotiation", {
                strategy: v as (typeof NegotiationStrategies)[number],
              })} options={[...NegotiationStrategies.map((s) => ({ value: s, label: s === "auto"
                  ? "Auto (try all combinations)"
                  : s === "nla-first"
                    ? "NLA First (CredSSP → TLS → Plain)"
                    : s === "tls-first"
                      ? "TLS First (TLS → CredSSP → Plain)"
                      : s === "nla-only"
                        ? "NLA Only (fail if unavailable)"
                        : s === "tls-only"
                          ? "TLS Only (no CredSSP)"
                          : "Plain Only (no security — DANGEROUS)" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Max Retries: {rdp.negotiation?.maxRetries ?? 3}
          </label>
          <Slider value={rdp.negotiation?.maxRetries ?? 3} onChange={(v: number) => updateRdp("negotiation", {
                maxRetries: v,
              })} min={1} max={10} variant="full" />
          <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
            <span>1</span>
            <span>10</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Retry Delay: {rdp.negotiation?.retryDelayMs ?? 1000}ms
          </label>
          <Slider value={rdp.negotiation?.retryDelayMs ?? 1000} onChange={(v: number) => updateRdp("negotiation", {
                retryDelayMs: v,
              })} min={100} max={5000} variant="full" step={100} />
          <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
            <span>100ms</span>
            <span>5000ms</span>
          </div>
        </div>
      </div>
    )}

    {/* Load Balancing */}
    <div className="pt-3 mt-2 border-t border-[var(--color-border)]/60">
      <div className="flex items-center gap-2 mb-2 text-sm text-[var(--color-textSecondary)]">
        <ToggleLeft size={14} className="text-blue-400" />
        <span className="font-medium">Load Balancing</span>
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Load Balancing Info
        </label>
        <input
          type="text"
          value={rdp.negotiation?.loadBalancingInfo ?? ""}
          onChange={(e) =>
            updateRdp("negotiation", { loadBalancingInfo: e.target.value })
          }
          className={CSS.input}
          placeholder="e.g. tsv://MS Terminal Services Plugin.1.Farm1"
        />
        <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
          Sent during X.224 negotiation for RDP load balancers / Session
          Brokers.
        </p>
      </div>

      <label className={`${CSS.label} mt-2`}>
        <Checkbox checked={rdp.negotiation?.useRoutingToken ?? false} onChange={(v: boolean) => updateRdp("negotiation", { useRoutingToken: v })} className="CSS.checkbox" />
        <span>Use routing token format (instead of cookie)</span>
      </label>
    </div>
  </Section>
);

export default NegotiationSection;
