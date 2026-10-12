import { createLucideIcon } from "lucide-react";

/** App-authored identifiers, NOT official logos. Never include in BRAND_ICONS.
 * Publisher lookups and the terms that ruled out each official mark:
 * docs/connection-icon-brands.md. Initials are drawn as paths, not fonts; they
 * neither trace raster artwork nor reuse any publisher lettering or symbol.
 */
const identifier = (name: string, d: string) =>
  createLucideIcon(name, [["path", { d, key: "identifier" }]]);

export const autoridadeTributariaIdentifier = identifier(
  "AutoridadeTributariaIdentifier",
  "M2 19 6.5 5 11 19M3.6 14h5.8M13 5h9M17.5 5v14",
);
// Rounded letterforms on purpose: two plain S initials, never angular strokes.
export const segurancaSocialIdentifier = identifier(
  "SegurancaSocialIdentifier",
  "M11 5H6.5a3.5 3.5 0 0 0 0 7h1a3.5 3.5 0 0 1 0 7H2M22 5h-4.5a3.5 3.5 0 0 0 0 7h1a3.5 3.5 0 0 1 0 7H13",
);
export const irnIdentifier = identifier(
  "IrnIdentifier",
  "M2 5v14M6 19V5h2.75a3.25 3.25 0 0 1 0 6.5H6M8.75 11.5 12 19M16 19V5l6 14V5",
);
// ER initials, not the publisher's lowercase "e" symbol.
export const eRedesIdentifier = identifier(
  "ERedesIdentifier",
  "M9 5H3v14h6M3 12h5M13.5 19V5h4a3.5 3.5 0 0 1 0 7h-4m4 0 3.5 7",
);
export const imtIdentifier = identifier(
  "ImtIdentifier",
  "M2 5v14M6 19V5l3.5 7L13 5v14M17 5h5M19.5 5v14",
);
// Two separate upright initials, not the publisher's single tick-shaped symbol.
export const viaVerdeIdentifier = identifier(
  "ViaVerdeIdentifier",
  "M2 5l4 14 4-14M14 5l4 14 4-14",
);
// ZB initials without a tile: neither the boxed wordmark nor its favicon Z.
export const zabbixIdentifier = identifier(
  "ZabbixIdentifier",
  "M3 5h7L3 19h7M14 12h4a3.5 3.5 0 0 0 0-7h-4v14h4.5a3.5 3.5 0 0 0 0-7",
);
// L with code chevrons, not the publisher's heart-shaped logomark.
export const lovableIdentifier = identifier(
  "LovableIdentifier",
  "M3 4v16h4.5M14.5 7 11 12l3.5 5M18.5 7l3.5 5-3.5 5",
);

/** Keyed by the catalog key each identifier is registered under. */
export const APPLICATION_PORTAL_IDENTIFIER_ICONS = {
  "autoridade-tributaria": autoridadeTributariaIdentifier,
  "seguranca-social": segurancaSocialIdentifier,
  irn: irnIdentifier,
  "e-redes": eRedesIdentifier,
  imt: imtIdentifier,
  "via-verde": viaVerdeIdentifier,
  zabbix: zabbixIdentifier,
  lovable: lovableIdentifier,
} as const;
export type ApplicationPortalIdentifierIconKey =
  keyof typeof APPLICATION_PORTAL_IDENTIFIER_ICONS;
