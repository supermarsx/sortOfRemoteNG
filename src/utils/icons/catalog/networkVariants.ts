import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const symbol = (name: string, ...paths: string[]) =>
  createLucideIcon(
    name,
    paths.map((d, index) => ["path", { d, key: `part-${index}` }]),
  );

/** Pure network marks: no folder, server or other composite role frame. */
export const NETWORK_VARIANT_ICONS = [
  defineIcon(
    "wireless-signal",
    "Wireless signal rings",
    "network",
    symbol(
      "WirelessSignalRings",
      "M10 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M7 13a7 7 0 0 1 10 0M4 10a11 11 0 0 1 16 0M1 7a16 16 0 0 1 22 0",
    ),
    ["wireless", "wifi", "signal", "rings"],
  ),
  defineIcon(
    "wireless-antenna",
    "Wireless antenna",
    "network",
    symbol(
      "WirelessAntenna",
      "M12 8v14M8 22h8M10 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0M6 2a7 7 0 0 0 0 9M18 2a7 7 0 0 1 0 9M3 1a11 11 0 0 0 0 13M21 1a11 11 0 0 1 0 13",
    ),
    ["wireless", "wifi", "antenna", "radio"],
  ),
  defineIcon(
    "router-modular",
    "Modular rack router",
    "network",
    symbol(
      "ModularRackRouter",
      "M2 5h20v14H2ZM2 10h20M5 7h.01M9 7h.01M5 14h4v5H5ZM15 14h4v5h-4ZM5 2v3M19 2v3M6 21h12",
    ),
    ["router", "rack", "modular", "routing", "ethernet"],
  ),
  defineIcon(
    "router-core",
    "Core router",
    "network",
    symbol(
      "CoreRouter",
      "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18ZM12 3v7M9 7l3 3 3-3M12 21v-7M9 17l3-3 3 3M3 12h6M6 9l3 3-3 3M21 12h-6M18 9l-3 3 3 3",
    ),
    ["router", "core", "routing", "backbone"],
  ),
  defineIcon(
    "network-ring",
    "Ring network",
    "network",
    symbol(
      "RingNetwork",
      "M8 4H4v4h4ZM20 4h-4v4h4ZM8 16H4v4h4ZM20 16h-4v4h4ZM8 6h8M18 8v8M16 18H8M6 16V8",
    ),
    ["network", "ring", "topology", "nodes"],
  ),
  defineIcon(
    "network-star",
    "Star network",
    "network",
    symbol(
      "StarNetwork",
      "M9 9h6v6H9ZM12 9V5M12 15v4M9 12H5M15 12h4M10 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0M10 21a2 2 0 1 0 4 0 2 2 0 1 0-4 0M1 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M19 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    ),
    ["network", "star", "topology", "hub"],
  ),
  defineIcon(
    "web-browser",
    "Web browser window",
    "network",
    symbol(
      "WebBrowserWindow",
      "M2 3h20v18H2ZM2 8h20M5 5h.01M8 5h.01M11 5h.01M12 10a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9ZM8 14.5h8M12 10c-3 2-3 7 0 9 3-2 3-7 0-9Z",
    ),
    ["web", "browser", "website", "https", "internet"],
  ),
  defineIcon(
    "web-orbit",
    "Web globe and orbit",
    "network",
    symbol(
      "WebGlobeOrbit",
      "M12 5a7 7 0 1 0 0 14 7 7 0 1 0 0-14ZM5 12h14M12 5c-4 3-4 11 0 14 4-3 4-11 0-14Z",
      "M5 5C-3 7 1 24 12 22M19 19C27 17 23 0 12 2M10 1l2 1-1 2M14 23l-2-1 1-2",
    ),
    ["web", "globe", "orbit", "world wide web", "internet"],
  ),
  defineIcon(
    "wired-plug",
    "Wired Ethernet plug",
    "network",
    symbol(
      "WiredEthernetPlug",
      "M5 2h14v12l-4 4H9l-4-4ZM9 2v5M12 2v5M15 2v5M8 10h8M12 18v4",
    ),
    ["wired", "connection", "ethernet", "plug", "rj45", "cable"],
  ),
  defineIcon(
    "wired-ports",
    "Wired connected ports",
    "network",
    symbol(
      "WiredConnectedPorts",
      "M2 2h7v7H2ZM15 15h7v7h-7ZM4 2v3M7 2v3M17 19v3M20 19v3M5 9v7a3 3 0 0 0 3 3h7M9 5h7a3 3 0 0 1 3 3v7",
    ),
    ["wired", "connection", "ports", "ethernet", "link", "cable"],
  ),
  defineIcon(
    "gateway-bridge",
    "Network gateway bridge",
    "network",
    symbol(
      "NetworkGatewayBridge",
      "M2 18h20M5 18V6M19 18V6M5 7c4 8 10 8 14 0M9 13v5M15 13v5M2 15l3 3-3 3M22 15l-3 3 3 3",
    ),
    ["gateway", "bridge", "network", "gateway connection"],
  ),
  defineIcon(
    "gateway-portal",
    "Gateway portal",
    "network",
    symbol(
      "GatewayPortal",
      "M6 22V7a6 6 0 0 1 12 0v15M9 22V7a3 3 0 0 1 6 0v15M2 14h20M19 11l3 3-3 3M2 19h20M5 16l-3 3 3 3",
    ),
    ["gateway", "portal", "network", "entry", "exit"],
  ),
] as const;
