import React from "react";
import { Shield, Globe, Terminal, Wifi, Network, Layers } from "lucide-react";
import type {
  TunnelType,
  TunnelChainLayer,
} from "../../../types/connection/connection";
import {
  EXECUTABLE_VPN_PROVIDERS,
  resolveTunnelLayerVpnProfileId,
  type ExecutableVpnType,
} from "../../../utils/network/vpnProviderCatalog";

// ── Tunnel type metadata ────────────────────────────────────────

const VPN_ICONS: Record<ExecutableVpnType, React.ReactNode> = {
  openvpn: <Shield size={12} />,
  wireguard: <Shield size={12} />,
  tailscale: <Wifi size={12} />,
  zerotier: <Globe size={12} />,
};

export const TUNNEL_TYPE_OPTIONS: {
  value: TunnelType;
  label: string;
  icon: React.ReactNode;
  category: string;
}[] = [
  ...EXECUTABLE_VPN_PROVIDERS.map((provider) => ({
    value: provider.type,
    label: provider.label,
    icon: VPN_ICONS[provider.type],
    category: "VPN",
  })),
  {
    value: "proxy",
    label: "Proxy",
    icon: <Network size={12} />,
    category: "Proxy",
  },
  {
    value: "shadowsocks",
    label: "Shadowsocks",
    icon: <Network size={12} />,
    category: "Proxy",
  },
  { value: "tor", label: "Tor", icon: <Globe size={12} />, category: "Proxy" },
  {
    value: "ssh-jump",
    label: "SSH Jump Host",
    icon: <Terminal size={12} />,
    category: "SSH",
  },
  {
    value: "ssh-tunnel",
    label: "SSH Tunnel",
    icon: <Terminal size={12} />,
    category: "SSH",
  },
  {
    value: "ssh-proxycmd",
    label: "SSH ProxyCommand",
    icon: <Terminal size={12} />,
    category: "SSH",
  },
  {
    value: "ssh-stdio",
    label: "SSH Stdio",
    icon: <Terminal size={12} />,
    category: "SSH",
  },
  {
    value: "stunnel",
    label: "Stunnel",
    icon: <Shield size={12} />,
    category: "Tunnel",
  },
  {
    value: "chisel",
    label: "Chisel",
    icon: <Network size={12} />,
    category: "Tunnel",
  },
  {
    value: "ngrok",
    label: "ngrok",
    icon: <Globe size={12} />,
    category: "Tunnel",
  },
  {
    value: "cloudflared",
    label: "Cloudflare",
    icon: <Globe size={12} />,
    category: "Tunnel",
  },
];

export function getTypeIcon(type: TunnelType): React.ReactNode {
  return (
    TUNNEL_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? (
      <Layers size={12} />
    )
  );
}

export function getTypeLabel(type: TunnelType): string {
  return TUNNEL_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

// ── Profile config summary ──────────────────────────────────────

export function getProfileConfigSummary(layer: TunnelChainLayer): string {
  switch (layer.type) {
    case "proxy":
    case "shadowsocks":
    case "tor": {
      const p = layer.proxy;
      if (!p) return layer.type;
      return `${p.proxyType}://${p.host || "..."}:${p.port}`;
    }
    case "ssh-jump":
    case "ssh-tunnel":
    case "ssh-proxycmd":
    case "ssh-stdio": {
      const s = layer.sshTunnel;
      if (!s) return layer.type;
      return `${s.username || "..."}@${s.host || "..."}:${s.port ?? 22}`;
    }
    case "openvpn":
    case "wireguard":
    case "tailscale":
    case "zerotier": {
      return resolveTunnelLayerVpnProfileId(layer) || layer.type;
    }
    default: {
      const t = layer.tunnel;
      if (!t) return layer.type;
      return t.serverUrl || layer.type;
    }
  }
}
