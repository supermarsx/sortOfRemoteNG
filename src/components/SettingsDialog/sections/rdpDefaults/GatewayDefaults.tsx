import type { SectionProps } from "./selectClass";
import React from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import { Network, Shuffle, Globe, KeyRound, Cable } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import {
  SettingsHostRow,
  SettingsPortRow,
} from "../../../ui/settings/NetworkPrimitives";

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
          description="Route connections through an RD Gateway server for access behind firewalls."
          infoTooltip="Routes RDP connections through an RD Gateway server, enabling access to remote machines behind firewalls."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            gwOn ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsHostRow
            settingKey="gatewayHostname"
            icon={<Globe size={16} />}
            label="Default gateway hostname"
            value={rdp.gatewayHostname ?? ""}
            placeholder="gateway.example.com"
            onChange={(v) => update({ gatewayHostname: v })}
            infoTooltip="The fully qualified domain name or IP address of the RD Gateway server."
          />

          <SettingsPortRow
            settingKey="gatewayPort"
            label="Default gateway port"
            value={rdp.gatewayPort ?? 443}
            onChange={(v) => update({ gatewayPort: v })}
            infoTooltip="The TCP port used to connect to the RD Gateway server. Default is 443 (HTTPS)."
          />

          <SettingsSelectRow
            settingKey="gatewayAuthMethod"
            icon={<KeyRound size={16} />}
            label="Authentication method"
            value={rdp.gatewayAuthMethod ?? "ntlm"}
            options={[
              { value: "ntlm", label: "NTLM" },
              { value: "basic", label: "Basic" },
              { value: "digest", label: "Digest" },
              { value: "negotiate", label: "Negotiate (Kerberos/NTLM)" },
              { value: "smartcard", label: "Smart Card" },
            ]}
            onChange={(v) =>
              update({
                gatewayAuthMethod:
                  v as GlobalSettings["rdpDefaults"]["gatewayAuthMethod"],
              })
            }
            infoTooltip="The authentication protocol used when connecting to the RD Gateway server."
          />

          <SettingsSelectRow
            settingKey="gatewayTransportMode"
            icon={<Cable size={16} />}
            label="Transport mode"
            value={rdp.gatewayTransportMode ?? "auto"}
            options={[
              { value: "auto", label: "Auto" },
              { value: "http", label: "HTTP" },
              { value: "udp", label: "UDP" },
            ]}
            onChange={(v) =>
              update({
                gatewayTransportMode:
                  v as GlobalSettings["rdpDefaults"]["gatewayTransportMode"],
              })
            }
            infoTooltip="The network transport used for gateway communication. Auto selects the best available option."
          />

          <Toggle
            checked={rdp.gatewayBypassLocal ?? true}
            onChange={(v) => update({ gatewayBypassLocal: v })}
            icon={<Shuffle size={16} />}
            label="Bypass gateway for local addresses"
            description="Skip the gateway when reaching machines on the local network."
            infoTooltip="Skips the gateway when connecting to machines on the local network for better performance."
          />
        </div>
      </Card>
    </div>
  );
};

export default GatewayDefaults;
