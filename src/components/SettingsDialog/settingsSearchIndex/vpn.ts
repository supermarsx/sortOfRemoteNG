import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `vpn` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * The tab had **no entries at all** before t75: `wireguard` and `openvpn`, two
 * of the most obvious queries a sysadmin would type, returned nothing. The
 * option lists live in module-level consts (`VPN_TYPE_OPTIONS`,
 * `DNS_HANDLING_OPTIONS`), which the AST guard cannot read, so the `values`
 * below are transcribed by hand and must be kept in step with
 * `sections/VpnSettings.tsx`. No label here comes from `t()`.
 */
export const VPN_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Binary paths ───────────────────────────────────────────────
  {
    key: "vpnSettings.openvpnBinaryPath",
    label: "OpenVPN Binary Path",
    description:
      "Absolute path to the openvpn executable. Leave blank to use whichever openvpn is found on the system PATH at launch.",
    tags: ["openvpn", "vpn", "binary", "path", "executable", "ovpn"],
    synonyms: ["openvpn executable", "openvpn.exe", "vpn client path"],
    section: "vpn",
    sectionLabel: "VPN",
  },
  {
    key: "vpnSettings.wireguardBinaryPath",
    label: "WireGuard Binary Path",
    description:
      "Absolute path to the wg / wireguard-go executable. Leave blank to use whichever WireGuard is found on the system PATH.",
    tags: ["wireguard", "vpn", "binary", "path", "executable", "wg"],
    synonyms: ["wireguard-go", "wg.exe", "wg quick", "vpn client path"],
    section: "vpn",
    sectionLabel: "VPN",
  },

  // ─── Defaults ───────────────────────────────────────────────────
  {
    key: "vpnSettings.defaultVpnType",
    label: "Default VPN Type",
    description:
      "Pre-selected VPN type when you open the new-connection dialog. Individual connections can still override this.",
    tags: [
      "vpn",
      "type",
      "default",
      "openvpn",
      "wireguard",
      "tailscale",
      "zerotier",
      "protocol",
    ],
    synonyms: ["vpn protocol", "default tunnel", "mesh vpn"],
    section: "vpn",
    sectionLabel: "VPN",
    values: [
      "openvpn",
      "OpenVPN",
      "wireguard",
      "WireGuard",
      "tailscale",
      "Tailscale",
      "zerotier",
      "ZeroTier",
    ],
  },
  {
    key: "vpnSettings.dnsHandling",
    label: "DNS Handling",
    description:
      "VPN DNS: route lookups through the VPN's DNS servers. System DNS: keep using the OS resolver (may leak). Both: try VPN first, fall back to system.",
    tags: ["dns", "resolver", "lookup", "leak", "vpn", "system"],
    synonyms: ["dns leak", "name resolution", "split dns"],
    section: "vpn",
    sectionLabel: "VPN",
    values: ["vpn-dns", "VPN DNS", "system-dns", "System DNS", "both", "Both"],
  },

  // ─── Runtime ────────────────────────────────────────────────────
  {
    key: "vpnSettings.statusPollingIntervalMs",
    label: "Status Polling Interval",
    description:
      "How often the VPN status indicator refreshes (handshake, bytes, peer health). Lower = more responsive, higher = lighter on CPU and battery.",
    tags: ["polling", "interval", "status", "refresh", "handshake", "peer"],
    synonyms: ["poll interval", "status refresh", "vpn status"],
    section: "vpn",
    sectionLabel: "VPN",
  },
];
