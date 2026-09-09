import { createLucideIcon } from "lucide-react";

/** App-authored identifiers, NOT official logos. Never include in BRAND_ICONS.
 * Publisher identity checks and unavailable artwork: docs/connection-icon-brands.md.
 * Small initials are drawn as paths, not fonts; these do not trace raster logos.
 */
const identifier = (name: string, d: string) =>
  createLucideIcon(name, [["path", { d, key: "identifier" }]]);

export const hostgatorIdentifier = identifier(
  "HostGatorIdentifier",
  "M2 4v16M9 4v16M2 12h7M22 5h-4a5 5 0 0 0-5 5v5a5 5 0 0 0 5 5h4v-7h-4",
);

export const dnsptIdentifier = identifier(
  "DnsPtIdentifier",
  "M2 19h.01M6 19V5h4a4 4 0 0 1 0 8H6M15 5h8M19 5v14",
);
export const ptispIdentifier = identifier(
  "PtispIdentifier",
  "M3 20V4h4a4 4 0 0 1 0 8H3M14 4h7M17.5 4v16M14 20h7",
);
export const ptservidorIdentifier = identifier(
  "PtServidorIdentifier",
  "M2 18V4h4a3 3 0 0 1 0 6H2M21 4h-6a3 3 0 0 0 0 6h3a3 3 0 0 1 0 6h-6M2 21h20M6 18v3M18 18v3",
);
export const webtugaIdentifier = identifier(
  "WebtugaIdentifier",
  "m2 5 3 14 3-9 3 9 3-14M16 5h7M19.5 5v14",
);
export const time4vpsIdentifier = identifier(
  "Time4VpsIdentifier",
  "M12 2a10 10 0 1 0 10 10M15 3l-6 10h10M16 8v12",
);
export const networksolutionsIdentifier = identifier(
  "NetworkSolutionsIdentifier",
  "M2 19V5l8 14V5M22 5h-6a3.5 3.5 0 0 0 0 7h3a3.5 3.5 0 0 1 0 7h-6",
);
