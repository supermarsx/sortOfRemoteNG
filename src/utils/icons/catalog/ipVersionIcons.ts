import { createLucideIcon, type IconNode } from "lucide-react";
import { defineIcon } from "./types";

const networkGlobe: IconNode = [
  ["circle", { cx: "7", cy: "12", r: "5", key: "network-globe" }],
  [
    "path",
    {
      d: "M2 12h10M7 7c-3 3-3 7 0 10m0-10c3 3 3 7 0 10",
      key: "network-meridians",
    },
  ],
];
const IPv4 = createLucideIcon("IPv4", [
  ...networkGlobe,
  ["path", { d: "m19 6-5 8h8M19 6v12", key: "version-four" }],
]);
const IPv6 = createLucideIcon("IPv6", [
  ...networkGlobe,
  [
    "path",
    { d: "M21 6c-5-1-7 3-7 7 0 7 8 7 8 2 0-4-5-5-8-2", key: "version-six" },
  ],
]);
export const IP_VERSION_ICONS = [
  defineIcon(
    "ipv4",
    "IPv4",
    "network",
    IPv4,
    [
      "ipv4",
      "ip v4",
      "ip version 4",
      "internet protocol version 4",
      "32 bit",
      "ip address",
      "network",
    ],
    "Generic Internet Protocol version 4 globe and vector numeral; not a connection capability claim.",
  ),
  defineIcon(
    "ipv6",
    "IPv6",
    "network",
    IPv6,
    [
      "ipv6",
      "ip v6",
      "ip version 6",
      "internet protocol version 6",
      "128 bit",
      "ip address",
      "network",
    ],
    "Generic Internet Protocol version 6 globe and vector numeral; not a connection capability claim.",
  ),
] as const;
