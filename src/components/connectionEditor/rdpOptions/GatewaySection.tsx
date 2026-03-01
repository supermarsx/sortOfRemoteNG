import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Network } from "lucide-react";
import { GatewayAuthMethods, GatewayCredentialSources, GatewayTransportModes } from "../../../types/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, NumberInput, Select } from "../../ui/forms";
const GatewaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="RDP Gateway"
    icon={<Network size={14} className="text-cyan-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.gateway?.enabled ?? false} onChange={(v: boolean) => updateRdp("gateway", { enabled: v })} className="CSS.checkbox" />
      <span className="font-medium">Enable RDP Gateway</span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 -mt-1">
      Tunnel the RDP session through an RD Gateway (HTTPS transport).
    </p>

    {(rdp.gateway?.enabled ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Gateway Hostname
          </label>
          <input
            type="text"
            value={rdp.gateway?.hostname ?? ""}
            onChange={(e) =>
              updateRdp("gateway", { hostname: e.target.value })
            }
            className={CSS.input}
            placeholder="gateway.example.com"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Gateway Port: {rdp.gateway?.port ?? 443}
          </label>
          <NumberInput value={rdp.gateway?.port ?? 443} onChange={(v: number) => updateRdp("gateway", { port: v })} className="CSS.input" min={1} max={65535} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Authentication Method
          </label>
          <Select value={rdp.gateway?.authMethod ?? "ntlm"} onChange={(v: string) =>
              updateRdp("gateway", {
                authMethod: v as (typeof GatewayAuthMethods)[number],
              })} options={[...GatewayAuthMethods.map((m) => ({ value: m, label: m === "ntlm"
                  ? "NTLM"
                  : m === "basic"
                    ? "Basic"
                    : m === "digest"
                      ? "Digest"
                      : m === "negotiate"
                        ? "Negotiate (Kerberos/NTLM)"
                        : "Smart Card" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Credential Source
          </label>
          <Select value={rdp.gateway?.credentialSource ?? "same-as-connection"} onChange={(v: string) =>
              updateRdp("gateway", {
                credentialSource: v as (typeof GatewayCredentialSources)[number],
              })} options={[...GatewayCredentialSources.map((s) => ({ value: s, label: s === "same-as-connection"
                  ? "Same as connection"
                  : s === "separate"
                    ? "Separate credentials"
                    : "Ask on connect" }))]} className={CSS.select} />
        </div>

        {rdp.gateway?.credentialSource === "separate" && (
          <div className="space-y-2 pl-2 border-l-2 border-[var(--color-border)]">
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Username
              </label>
              <input
                type="text"
                value={rdp.gateway?.username ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { username: e.target.value })
                }
                className={CSS.input}
                placeholder="DOMAIN\user"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Password
              </label>
              <input
                type="password"
                value={rdp.gateway?.password ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { password: e.target.value })
                }
                className={CSS.input}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Domain
              </label>
              <input
                type="text"
                value={rdp.gateway?.domain ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { domain: e.target.value })
                }
                className={CSS.input}
                placeholder="DOMAIN"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Transport Mode
          </label>
          <Select value={rdp.gateway?.transportMode ?? "auto"} onChange={(v: string) =>
              updateRdp("gateway", {
                transportMode: v as (typeof GatewayTransportModes)[number],
              })} options={[...GatewayTransportModes.map((m) => ({ value: m, label: m === "auto" ? "Auto" : m === "http" ? "HTTP" : "UDP" }))]} className={CSS.select} />
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.gateway?.bypassForLocal ?? true} onChange={(v: boolean) => updateRdp("gateway", { bypassForLocal: v })} className="CSS.checkbox" />
          <span>Bypass gateway for local addresses</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Access Token (optional)
          </label>
          <input
            type="text"
            value={rdp.gateway?.accessToken ?? ""}
            onChange={(e) =>
              updateRdp("gateway", {
                accessToken: e.target.value || undefined,
              })
            }
            className={CSS.input}
            placeholder="Azure AD / OAuth token"
          />
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            For token-based gateway authentication (e.g. Azure AD).
          </p>
        </div>
      </div>
    )}
  </Section>
);

export default GatewaySection;
