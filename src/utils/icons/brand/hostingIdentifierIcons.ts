import { createLucideIcon } from "lucide-react";

/** App-authored identifiers, NOT official logos. Never include in BRAND_ICONS.
 * Publisher identity checks and unavailable artwork: docs/connection-icon-brands.md.
 * Small initials are drawn as paths, not fonts; these do not trace raster logos.
 */
const identifier = (name: string, d: string) =>
  createLucideIcon(name, [["path", { d, key: "identifier" }]]);

export const dnsptIdentifier = identifier(
  "DnsPtIdentifier",
  "M2 19h.01M6 19V5h4a4 4 0 0 1 0 8H6M15 5h8M19 5v14",
);
export const time4vpsIdentifier = identifier(
  "Time4VpsIdentifier",
  "M12 2a10 10 0 1 0 10 10M15 3l-6 10h10M16 8v12",
);
export const networksolutionsIdentifier = identifier(
  "NetworkSolutionsIdentifier",
  "M2 19V5l8 14V5M22 5h-6a3.5 3.5 0 0 0 0 7h3a3.5 3.5 0 0 1 0 7h-6",
);
