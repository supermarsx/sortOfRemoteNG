import { inputClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import { Network, Globe, Shuffle } from "lucide-react";
import { NumberInput, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const GatewayDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const gwOn = rdp.gatewayEnabled ?? false;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Network className="w-4 h-4 text-primary" />}
        title="RDP Gateway Defaults"
      />

      <Card>
        <Toggle
          checked={gwOn}
          onChange={(v) => update({ gatewayEnabled: v })}
          icon={<Network size={16} />}
          label="Enable RDP Gateway by default"
          description="Route connections through an RD Gateway server for access behind firewalls"
          infoTooltip="Routes RDP connections through an RD Gateway server, enabling access to remote machines behind firewalls."
        />

        <div
          className={`space-y-3 ${!gwOn ? "opacity-50 pointer-events-none" : ""}`}
        >
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Default Gateway Hostname{" "}
              <InfoTooltip text="The fully qualified domain name or IP address of the RD Gateway server." />
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
              Default Gateway Port{" "}
              <InfoTooltip text="The TCP port used to connect to the RD Gateway server. Default is 443 (HTTPS)." />
            </label>
            <NumberInput
              value={rdp.gatewayPort ?? 443}
              onChange={(v: number) => update({ gatewayPort: v })}
              className="inputClass"
              min={1}
              max={65535}
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method{" "}
              <InfoTooltip text="The authentication protocol used when connecting to the RD Gateway server." />
            </label>
            <Select
              value={rdp.gatewayAuthMethod ?? "ntlm"}
              onChange={(v: string) =>
                update({
                  gatewayAuthMethod:
                    v as GlobalSettings["rdpDefaults"]["gatewayAuthMethod"],
                })
              }
              options={[
                { value: "ntlm", label: "NTLM" },
                { value: "basic", label: "Basic" },
                { value: "digest", label: "Digest" },
                { value: "negotiate", label: "Negotiate (Kerberos/NTLM)" },
                { value: "smartcard", label: "Smart Card" },
              ]}
              className="selectClass"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Transport Mode{" "}
              <InfoTooltip text="The network transport used for gateway communication. Auto selects the best available option." />
            </label>
            <Select
              value={rdp.gatewayTransportMode ?? "auto"}
              onChange={(v: string) =>
                update({
                  gatewayTransportMode:
                    v as GlobalSettings["rdpDefaults"]["gatewayTransportMode"],
                })
              }
              options={[
                { value: "auto", label: "Auto" },
                { value: "http", label: "HTTP" },
                { value: "udp", label: "UDP" },
              ]}
              className="selectClass"
            />
          </div>

          <Toggle
            checked={rdp.gatewayBypassLocal ?? true}
            onChange={(v) => update({ gatewayBypassLocal: v })}
            icon={<Shuffle size={16} />}
            label="Bypass gateway for local addresses"
            description="Skip the gateway when reaching machines on the local network"
            infoTooltip="Skips the gateway when connecting to machines on the local network for better performance."
          />
        </div>
      </Card>
    </div>
  );
};

export default GatewayDefaults;
