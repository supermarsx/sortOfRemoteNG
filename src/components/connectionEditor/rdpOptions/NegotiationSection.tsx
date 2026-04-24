import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Zap, ToggleLeft, Info } from "lucide-react";
import { Connection } from "../../../types/connection/connection";
import { NegotiationStrategies } from "../../../types/connection/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
const NegotiationSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => (
  <Section
    title="Connection Negotiation"
    icon={<Zap size={14} className="text-warning" />}
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 font-medium flex items-center gap-1">Auto-detect negotiation <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Automatically try different protocol combinations (CredSSP, TLS, plain) until a working one is found." /></label>
      <Select value={rdp.negotiation?.autoDetect === undefined ? "" : rdp.negotiation.autoDetect ? "true" : "false"} onChange={(v: string) => updateRdp("negotiation", { autoDetect: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
      <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
        Automatically try different protocol combinations (CredSSP, TLS,
        plain) until a working one is found.
      </p>
    </div>

    {rdp.negotiation?.autoDetect === true && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
            Negotiation Strategy
            <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Order in which security protocols are attempted. NLA First is most secure; Plain Only offers no encryption." />
          </label>
          <Select value={rdp.negotiation?.strategy ?? ""} onChange={(v: string) =>
              updateRdp("negotiation", {
                strategy: v === "" ? undefined : (v as (typeof NegotiationStrategies)[number]),
              })} options={[{ value: "", label: "Use global default" }, ...NegotiationStrategies.map((s) => ({ value: s, label: s === "auto"
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
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
            Max Retries{rdp.negotiation?.maxRetries != null ? `: ${rdp.negotiation.maxRetries}` : ""}
            <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Maximum number of connection attempts before giving up. Each retry tries the next protocol in the strategy." />
          </label>
          <label className="flex items-center gap-2 mb-1">
            <Checkbox checked={rdp.negotiation?.maxRetries != null} onChange={(v: boolean) => updateRdp("negotiation", { maxRetries: v ? 3 : undefined })} className={CSS.checkbox} />
            <span className="text-xs text-[var(--color-textMuted)]">Override (uncheck to use global default)</span>
          </label>
          {rdp.negotiation?.maxRetries != null && (
          <>
          <Slider value={rdp.negotiation?.maxRetries ?? 3} onChange={(v: number) => updateRdp("negotiation", {
                maxRetries: v,
              })} min={1} max={10} variant="full" />
          <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
            <span>1</span>
            <span>10</span>
          </div>
          </>
          )}
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
            Retry Delay{rdp.negotiation?.retryDelayMs != null ? `: ${rdp.negotiation.retryDelayMs}ms` : ""}
            <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Milliseconds to wait between retry attempts. Increase if the server needs time to reset after a failed attempt." />
          </label>
          <label className="flex items-center gap-2 mb-1">
            <Checkbox checked={rdp.negotiation?.retryDelayMs != null} onChange={(v: boolean) => updateRdp("negotiation", { retryDelayMs: v ? 1000 : undefined })} className={CSS.checkbox} />
            <span className="text-xs text-[var(--color-textMuted)]">Override (uncheck to use global default)</span>
          </label>
          {rdp.negotiation?.retryDelayMs != null && (
          <>
          <Slider value={rdp.negotiation?.retryDelayMs ?? 1000} onChange={(v: number) => updateRdp("negotiation", {
                retryDelayMs: v,
              })} min={100} max={5000} variant="full" step={100} />
          <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
            <span>100ms</span>
            <span>5000ms</span>
          </div>
          </>
          )}
        </div>
      </div>
    )}

    {/* Load Balancing */}
    <div className="pt-3 mt-2 border-t border-[var(--color-border)]/60">
      <div className="flex items-center gap-2 mb-2 text-sm text-[var(--color-textSecondary)]">
        <ToggleLeft size={14} className="text-primary" />
        <span className="font-medium">Load Balancing</span>
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Load Balancing Info
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Token sent during X.224 negotiation for RDP load balancers or Session Brokers to route to the correct farm." />
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
        <Checkbox checked={rdp.negotiation?.useRoutingToken ?? false} onChange={(v: boolean) => updateRdp("negotiation", { useRoutingToken: v })} className={CSS.checkbox} />
        <span>Use routing token format (instead of cookie)</span>
      </label>
    </div>
  </Section>
);

export default NegotiationSection;
