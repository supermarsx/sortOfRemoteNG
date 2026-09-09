import {
  Cable,
  FileLock2,
  KeyRound,
  Link2,
  LockKeyhole,
  ShieldEllipsis,
  createLucideIcon,
} from "lucide-react";

import {
  nebula,
  netbird,
  softether,
  tailscale,
  twingate,
  zerotier,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

const LayerTwoTunnel = createLucideIcon("LayerTwoTunnel", [
  [
    "path",
    {
      d: "M6 3h12a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4ZM6 7h12v10H6ZM1 10h8M6 8l3 2-3 2M23 14h-8M18 12l-3 2 3 2",
      key: "nested-tunnel-flows",
    },
  ],
]);
const KeyExchange = createLucideIcon("IKEv2KeyExchange", [
  ["circle", { cx: "5", cy: "6", r: "3", key: "first-peer" }],
  ["circle", { cx: "19", cy: "18", r: "3", key: "second-peer" }],
  [
    "path",
    {
      d: "M8 6h13M17 3l4 3-4 3M16 18H3M7 15l-4 3 4 3M9 13a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 10V2M12 4h3M12 7h2",
      key: "exchange-key",
    },
  ],
]);

/** Identifiers for saved VPN assets; listing a type does not enable or endorse it. */
export const VPN_TYPE_ICONS = [
  defineIcon(
    "l2tp-tunnel",
    "L2TP layered tunnel",
    "network",
    LayerTwoTunnel,
    ["l2tp", "layer two tunneling protocol", "layer 2", "tunnel", "vpn"],
    "Generic L2TP asset marker; not a protocol implementation or security recommendation.",
  ),
  defineIcon(
    "ikev2-exchange",
    "IKEv2 key exchange",
    "network",
    KeyExchange,
    ["ikev2", "ike v2", "internet key exchange", "ipsec", "vpn", "keys"],
    "Generic IKEv2 key-exchange asset marker; not a live VPN provider.",
  ),
  defineIcon(
    "pptp",
    "PPTP",
    "network",
    Cable,
    ["pptp", "point to point tunneling protocol", "legacy vpn"],
    "Generic PPTP identifier for legacy assets, not a security recommendation.",
  ),
  defineIcon(
    "pptp-server",
    "PPTP server",
    "network",
    createRoleIcon("PPTPServer", "server", Cable),
    ["pptp server", "pptpserver", "legacy vpn server"],
  ),
  defineIcon(
    "pptp-vpn",
    "PPTP VPN",
    "network",
    createRoleIcon("PPTPVPN", "vpn", Cable),
    ["pptp vpn", "pptpvpn", "legacy vpn", "tunnel"],
  ),
  defineIcon("ipsec", "IPsec", "network", ShieldEllipsis, [
    "ipsec",
    "ip sec",
    "ip security",
    "vpn",
    "tunnel",
  ]),
  defineIcon(
    "ipsec-server",
    "IPsec server",
    "network",
    createRoleIcon("IPsecServer", "server", ShieldEllipsis),
    ["ipsec server", "ip sec server", "ipsec vpn", "vpn server"],
  ),
  defineIcon("l2tp", "L2TP", "network", Link2, [
    "l2tp",
    "layer two tunneling protocol",
    "layer 2",
    "vpn",
  ]),
  defineIcon(
    "l2tp-server",
    "L2TP server",
    "network",
    createRoleIcon("L2TPServer", "server", Link2),
    ["l2tp server", "l2tp vpn", "vpn server"],
  ),
  defineIcon("ikev2", "IKEv2", "network", KeyRound, [
    "ikev2",
    "ike v2",
    "internet key exchange",
    "vpn",
  ]),
  defineIcon(
    "ikev2-server",
    "IKEv2 server",
    "network",
    createRoleIcon("IKEv2Server", "server", KeyRound),
    ["ikev2 server", "ike v2 server", "ikev2 vpn", "vpn server"],
  ),
  defineIcon("sstp", "SSTP", "network", LockKeyhole, [
    "sstp",
    "secure socket tunneling protocol",
    "vpn",
  ]),
  defineIcon(
    "sstp-server",
    "SSTP server",
    "network",
    createRoleIcon("SSTPServer", "server", LockKeyhole),
    ["sstp server", "sstp vpn", "vpn server"],
  ),
  defineIcon("ssl-vpn", "SSL / TLS VPN", "network", FileLock2, [
    "ssl vpn",
    "tls vpn",
    "ssl tls vpn",
    "encrypted tunnel",
  ]),
  defineIcon(
    "ssl-vpn-server",
    "SSL / TLS VPN server",
    "network",
    createRoleIcon("SSLVPNServer", "server", FileLock2),
    ["ssl vpn server", "tls vpn server", "ssl tls vpn server", "vpn server"],
  ),
  defineIcon("zerotier", "ZeroTier", "network", zerotier, [
    "zerotier",
    "zero tier",
    "overlay network",
    "vpn",
    "virtual network",
  ]),
  defineIcon(
    "zerotier-vpn",
    "ZeroTier VPN",
    "network",
    createRoleIcon("ZeroTierVPN", "vpn", zerotier),
    ["zerotier vpn", "zero tier vpn", "overlay network"],
  ),
  defineIcon("tailscale", "Tailscale", "network", tailscale, [
    "tailscale",
    "tail scale",
    "mesh vpn",
    "wireguard overlay",
  ]),
  defineIcon(
    "tailscale-vpn",
    "Tailscale VPN",
    "network",
    createRoleIcon("TailscaleVPN", "vpn", tailscale),
    ["tailscale vpn", "tail scale vpn", "mesh vpn"],
  ),
  defineIcon("netbird", "NetBird", "network", netbird, [
    "netbird",
    "net bird",
    "mesh vpn",
    "wireguard overlay",
  ]),
  defineIcon(
    "netbird-vpn",
    "NetBird VPN",
    "network",
    createRoleIcon("NetBirdVPN", "vpn", netbird),
    ["netbird vpn", "net bird vpn", "mesh vpn"],
  ),
  defineIcon("twingate", "Twingate", "network", twingate, [
    "twingate",
    "twin gate",
    "zero trust access",
    "vpn",
  ]),
  defineIcon(
    "twingate-vpn",
    "Twingate VPN",
    "network",
    createRoleIcon("TwingateVPN", "vpn", twingate),
    ["twingate vpn", "twin gate vpn", "zero trust access"],
  ),
  defineIcon("nebula", "Nebula VPN", "network", nebula, [
    "nebula",
    "nebula vpn",
    "defined networking",
    "slack nebula",
    "mesh network",
  ]),
  defineIcon(
    "nebula-vpn",
    "Nebula VPN appliance",
    "network",
    createRoleIcon("NebulaVPN", "vpn", nebula),
    ["nebula vpn", "nebula appliance", "defined networking", "mesh vpn"],
  ),
  defineIcon(
    "softether",
    "SoftEther",
    "network",
    softether,
    ["softether", "soft ether", "vpn", "multi protocol vpn"],
    "SoftEther choice using an app-authored SE/ethernet identifier, not an official SoftEther logo.",
  ),
  defineIcon(
    "softether-vpn",
    "SoftEther VPN",
    "network",
    createRoleIcon("SoftEtherVPN", "vpn", softether),
    ["softether vpn", "soft ether vpn", "multi protocol vpn"],
    "SoftEther VPN with an app-authored SE/ethernet identifier and VPN frame, not an official SoftEther logo.",
  ),
] as const;
