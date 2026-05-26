import React from "react";
import {
  Shield,
  FolderCog,
  Settings2,
  Activity,
  Terminal,
  Box,
  Network,
  Globe,
  Timer,
  FolderOpen,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { GlobalSettings } from "../../../types/settings/settings";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsTextRow,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../ui/settings/SettingsPrimitives";

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

  const pickBinary = async (
    title: string,
    apply: (path: string) => void,
  ) => {
    try {
      const result = await openDialog({
        directory: false,
        multiple: false,
        title,
        filters:
          // On Windows, restrict to .exe by default but allow All Files fallback.
          typeof navigator !== "undefined" &&
          /windows/i.test(navigator.userAgent)
            ? [
                { name: "Executables", extensions: ["exe"] },
                { name: "All Files", extensions: ["*"] },
              ]
            : undefined,
      });
      if (result && typeof result === "string") apply(result);
    } catch (error) {
      console.error("Failed to pick binary:", error);
    }
  };

  const BrowseButton: React.FC<{ onClick: () => void; label: string }> = ({
    onClick,
    label,
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors flex-shrink-0"
    >
      <FolderOpen size={14} />
    </button>
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Shield className="w-5 h-5 text-primary" />}
        title="VPN"
        description="Configure VPN binary paths, default type, and DNS handling."
      />

      {/* Binary Paths */}
      <div className="space-y-4">
        <SectionHeader
          icon={<FolderCog className="w-4 h-4 text-primary" />}
          title="Binary Paths"
        />
        <Card>
          <SettingsTextRow
            label="OpenVPN Binary Path"
            icon={<Terminal size={16} />}
            value={vpn.openvpnBinaryPath ?? ""}
            placeholder="Uses system PATH"
            onChange={(v) => update({ openvpnBinaryPath: v })}
            settingKey="vpnSettings.openvpnBinaryPath"
            infoTooltip="Absolute path to the openvpn executable. Leave blank to use whichever openvpn is found on the system PATH at launch."
            trailing={
              <BrowseButton
                label="Browse for OpenVPN binary"
                onClick={() =>
                  pickBinary("Select OpenVPN Binary", (path) =>
                    update({ openvpnBinaryPath: path }),
                  )
                }
              />
            }
          />

          <SettingsTextRow
            label="WireGuard Binary Path"
            icon={<Box size={16} />}
            value={vpn.wireguardBinaryPath ?? ""}
            placeholder="Uses system PATH"
            onChange={(v) => update({ wireguardBinaryPath: v })}
            settingKey="vpnSettings.wireguardBinaryPath"
            infoTooltip="Absolute path to the wg / wireguard-go executable. Leave blank to use whichever WireGuard is found on the system PATH."
            trailing={
              <BrowseButton
                label="Browse for WireGuard binary"
                onClick={() =>
                  pickBinary("Select WireGuard Binary", (path) =>
                    update({ wireguardBinaryPath: path }),
                  )
                }
              />
            }
          />
        </Card>
      </div>

      {/* Defaults */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Settings2 className="w-4 h-4 text-primary" />}
          title="Defaults"
        />
        <Card>
          <SettingsSelectRow
            label="Default VPN Type"
            icon={<Network size={16} />}
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
            infoTooltip="Pre-selected VPN type when you open the new-connection dialog. Individual connections can still override this."
          />

          <SettingsSelectRow
            label="DNS Handling"
            icon={<Globe size={16} />}
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
            infoTooltip="VPN DNS: route lookups through the VPN's DNS servers. System DNS: keep using the OS resolver (may leak). Both: try VPN first, fall back to system."
          />
        </Card>
      </div>

      {/* Runtime */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Activity className="w-4 h-4 text-primary" />}
          title="Runtime"
        />
        <Card>
          <SettingsNumberRow
            label="Status Polling Interval"
            icon={<Timer size={16} />}
            value={vpn.statusPollingIntervalMs ?? 5000}
            min={1000}
            max={60000}
            step={1000}
            unit="ms"
            onChange={(v) => update({ statusPollingIntervalMs: v })}
            settingKey="vpnSettings.statusPollingIntervalMs"
            infoTooltip="How often the VPN status indicator refreshes (handshake, bytes, peer health). Lower = more responsive, higher = lighter on CPU and battery."
          />
        </Card>
      </div>
    </div>
  );
};

export default VpnSettings;
