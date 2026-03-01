import { inputClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings";
import { Network } from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";

const GatewayDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Network className="w-4 h-4 text-cyan-400" />
      RDP Gateway Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.gatewayEnabled ?? false} onChange={(v: boolean) => update({ gatewayEnabled: v })} />
      <span className="sor-toggle-label">
        Enable RDP Gateway by default
      </span>
    </label>

    {(rdp.gatewayEnabled ?? false) && (
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Gateway Hostname
          </label>
          <input
            type="text"
            value={rdp.gatewayHostname ?? ""}
            onChange={(e) => update({ gatewayHostname: e.target.value })}
            className={inputClass}
            placeholder="gateway.example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Gateway Port
          </label>
          <NumberInput value={rdp.gatewayPort ?? 443} onChange={(v: number) => update({ gatewayPort: v })} className="inputClass" min={1} max={65535} />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Authentication Method
          </label>
          <Select value={rdp.gatewayAuthMethod ?? "ntlm"} onChange={(v: string) => update({
                gatewayAuthMethod: e.target
                  .value as GlobalSettings["rdpDefaults"]["gatewayAuthMethod"],
              })} options={[{ value: "ntlm", label: "NTLM" }, { value: "basic", label: "Basic" }, { value: "digest", label: "Digest" }, { value: "negotiate", label: "Negotiate (Kerberos/NTLM)" }, { value: "smartcard", label: "Smart Card" }]} className="selectClass" />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Transport Mode
          </label>
          <Select value={rdp.gatewayTransportMode ?? "auto"} onChange={(v: string) => update({
                gatewayTransportMode: e.target
                  .value as GlobalSettings["rdpDefaults"]["gatewayTransportMode"],
              })} options={[{ value: "auto", label: "Auto" }, { value: "http", label: "HTTP" }, { value: "udp", label: "UDP" }]} className="selectClass" />
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={rdp.gatewayBypassLocal ?? true} onChange={(v: boolean) => update({ gatewayBypassLocal: v })} />
          <span className="sor-toggle-label">
            Bypass gateway for local addresses
          </span>
        </label>
      </div>
    )}
  </div>
);

export default GatewayDefaults;
