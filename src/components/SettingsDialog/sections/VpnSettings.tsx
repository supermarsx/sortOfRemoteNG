import React from "react";
import { Shield } from "lucide-react";
import type { GlobalSettings } from "../../../types/settings/settings";
import SectionHeading from "../../ui/SectionHeading";
import {
  SettingsCard,
  SettingsTextRow,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../ui/settings";

interface VpnSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const VPN_TYPE_OPTIONS = [
  { value: "openvpn", label: "OpenVPN" },
  { value: "wireguard", label: "WireGuard" },
  { value: "tailscale", label: "Tailscale" },
  { value: "zerotier", label: "ZeroTier" },
];

const DNS_HANDLING_OPTIONS = [
  { value: "vpn-dns", label: "VPN DNS" },
  { value: "system-dns", label: "System DNS" },
  { value: "both", label: "Both" },
];

const updateVpn =
  (
    settings: GlobalSettings,
    updateSettings: (updates: Partial<GlobalSettings>) => void,
  ) =>
  (patch: Partial<NonNullable<GlobalSettings["vpnSettings"]>>) => {
    updateSettings({
      vpnSettings: { ...settings.vpnSettings, ...patch },
    });
  };

export const VpnSettings: React.FC<VpnSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const vpn = settings.vpnSettings ?? {};
  const update = updateVpn(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Shield className="w-5 h-5" />}
        title="VPN"
        description="Configure VPN binary paths, default type, and DNS handling."
      />

      <SettingsCard>
        <div className="space-y-4">
          <SettingsTextRow
            label="OpenVPN Binary Path"
            value={vpn.openvpnBinaryPath ?? ""}
            placeholder="Uses system PATH"
            onChange={(v) => update({ openvpnBinaryPath: v })}
            settingKey="vpnSettings.openvpnBinaryPath"
          />

          <SettingsTextRow
            label="WireGuard Binary Path"
            value={vpn.wireguardBinaryPath ?? ""}
            placeholder="Uses system PATH"
            onChange={(v) => update({ wireguardBinaryPath: v })}
            settingKey="vpnSettings.wireguardBinaryPath"
          />

          <SettingsSelectRow
            label="Default VPN Type"
            value={vpn.defaultVpnType ?? "openvpn"}
            options={VPN_TYPE_OPTIONS}
            onChange={(v) =>
              update({
                defaultVpnType: v as NonNullable<
                  GlobalSettings["vpnSettings"]
                >["defaultVpnType"],
              })
            }
            settingKey="vpnSettings.defaultVpnType"
          />

          <SettingsNumberRow
            label="Status Polling Interval"
            value={vpn.statusPollingIntervalMs ?? 5000}
            min={1000}
            max={60000}
            step={1000}
            unit="ms"
            onChange={(v) => update({ statusPollingIntervalMs: v })}
            settingKey="vpnSettings.statusPollingIntervalMs"
          />

          <SettingsSelectRow
            label="DNS Handling"
            value={vpn.dnsHandling ?? "vpn-dns"}
            options={DNS_HANDLING_OPTIONS}
            onChange={(v) =>
              update({
                dnsHandling: v as NonNullable<
                  GlobalSettings["vpnSettings"]
                >["dnsHandling"],
              })
            }
            settingKey="vpnSettings.dnsHandling"
          />
        </div>
      </SettingsCard>
    </div>
  );
};

export default VpnSettings;
