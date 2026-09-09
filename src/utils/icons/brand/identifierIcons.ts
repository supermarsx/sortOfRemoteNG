import { createLucideIcon } from "lucide-react";

/**
 * Geometric identifiers and the explicitly documented publisher retraces below.
 * No font, image, or external request is needed. Catalog descriptions disclose
 * neutral identifiers, normalized publisher vectors, and local traces.
 * The historical module/registry names remain stable for existing consumers.
 */
export const dlinkIdentifier = createLucideIcon("DLinkIdentifier", [
  ["path", { d: "M3 5v14h3a7 7 0 0 0 0-14H3M16 5v14h5", key: "dl" }],
]);

export const leveloneIdentifier = createLucideIcon("LevelOneIdentifier", [
  ["path", { d: "M3 5v14h7M14 8l3-3v14M14 19h7", key: "l1" }],
]);

export const aristaIdentifier = createLucideIcon("AristaIdentifier", [
  ["path", { d: "m3 19 7-14 7 14M6 13h8M19 4v6M16 7h6", key: "a-network" }],
]);

export const freepbxIdentifier = createLucideIcon("FreePBXIdentifier", [
  // Compact monochrome trace: FreePBX/framework release/17.0 admin/images/freepbx.png.
  [
    "path",
    {
      d: "M5.5 8.4V5.8C5.5 1.1 10.7.8 12 4.1c1.5-3.3 6.5-3 6.5 1.7v2.6c2 .9 3.7 2.4 4 4.3-1.5 1.2-2.5 3-3.4 4.5-1.7 3-4.4 4.4-7.6 4.3C6.9 21.4 2.2 18 .8 14.1c.4-2.6 2.4-4.4 4.7-5.7ZM8 6.1v2.1c0 1.5 2 1.5 2 0V6.1c0-1.6-2-1.6-2 0Zm6 0v2.1c0 1.5 2 1.5 2 0V6.1c0-1.6-2-1.6-2 0Zm-3.9 8.8c2.2 1.1 5.7 1.3 8.2-2.6-.4 3.9-2.4 6.4-4.9 6-1.3-.3-2.3-1.6-3.3-3.4Z",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "freepbx-frog",
    },
  ],
]);

export const brother = createLucideIcon("BrotherIdentifier", [
  [
    "path",
    {
      d: "M5 4h7a4 4 0 0 1 0 8H5V4Zm0 8h8a4 4 0 0 1 0 8H5v-8M20 5v14",
      key: "brother-b",
    },
  ],
]);
export const yealink = createLucideIcon("YealinkIdentifier", [
  [
    "path",
    {
      d: "m4 4 6 8 6-8M10 12v8M17 12a5 5 0 0 1 0 8M19 9a8 8 0 0 1 0 14",
      key: "yealink-y",
    },
  ],
]);
export const clevo = createLucideIcon("ClevoIdentifier", [
  [
    "path",
    {
      d: "M11 5H7a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h4M13 5l4 14 4-14",
      key: "clevo-cv",
    },
  ],
]);
export const grandstream = createLucideIcon("GrandstreamEmblemTrace", [
  [
    "path",
    {
      d: "M2.1 2.3C7.2-.1 13.5 1.2 20.1 5.1 14.4 3.6 8.7 4 5.5 6.9c2.9 6.1 8.1 9.3 14.8 9.2-2.6 2.7-5.7 4.5-9.4 5.9C6.5 18.1 3.4 9.5 2.1 2.3Z",
      fill: "currentColor",
      stroke: "none",
      key: "grandstream-swoosh",
    },
  ],
  [
    "path",
    {
      d: "M13.1 9.1c4.6.8 8 2.9 8.8 5.1.5 1.4-.7 2.7-2.3 3.6l.7-1.7c-1.3-2.8-3.8-4.9-7.2-7Z",
      fill: "currentColor",
      stroke: "none",
      opacity: "0.65",
      key: "grandstream-arrow",
    },
  ],
]);
export const freshtomato = createLucideIcon("FreshTomatoIdentifier", [
  [
    "path",
    {
      d: "M8 8c-4-2-6 1-6 5 0 5 4 8 10 8s10-3 10-8c0-4-2-7-6-5M12 3v6M7 4l5 3 5-3M8 10l4-3 4 3",
      key: "tomato",
    },
  ],
]);
export const meshcentral = createLucideIcon("MeshCentralIdentifier", [
  [
    "path",
    {
      d: "M5 16V8l7 6 7-6v8M5 4h.01M19 4h.01M12 20h.01M5 4l7 16 7-16H5Z",
      key: "mesh-m",
    },
  ],
]);
export const suricata = createLucideIcon("SuricataIdentifier", [
  [
    "path",
    {
      d: "M16 4H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H8M3 18l3 3 3-3M15 21h6",
      key: "suricata-s-sensor",
    },
  ],
]);
export const zeek = createLucideIcon("ZeekIdentifier", [
  [
    "path",
    { d: "M5 5h14L5 19h14M2 9h5L5 7M17 15h5l-2 2", key: "zeek-z-traffic" },
  ],
]);
export const postfix = createLucideIcon("PostfixIdentifier", [
  [
    "path",
    {
      d: "M3 16V4h4a3 3 0 0 1 0 6H3M15 16V4h6M15 10h5M3 20h18m-4-3 4 3-4 3",
      key: "postfix-pf",
    },
  ],
]);

export const apc = createLucideIcon("APCIdentifier", [
  [
    "path",
    { d: "m2 19 4-14 4 14M3.5 14h5M14 19V5h3a4 4 0 0 1 0 8h-3", key: "apc-ap" },
  ],
]);
export const eaton = createLucideIcon("EatonIdentifier", [
  [
    "path",
    { d: "M14 4H4v16h10M4 12h8M21 4l-4 8h4l-4 8", key: "eaton-e-power" },
  ],
]);
export const cyberpower = createLucideIcon("CyberPowerIdentifier", [
  [
    "path",
    {
      d: "M10 5H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h4M14 19V5h3a4 4 0 0 1 0 8h-3",
      key: "cyberpower-cp",
    },
  ],
]);
export const tripplite = createLucideIcon("TrippLiteIdentifier", [
  ["path", { d: "M2 5h10M7 5v14M15 5v14h7", key: "tripplite-tl" }],
]);
export const sonoff = createLucideIcon("SonoffIdentifier", [
  [
    "path",
    {
      d: "M15 4H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H9M20 3v5M3 16v5",
      key: "sonoff-s-switch",
    },
  ],
]);
export const tuya = createLucideIcon("TuyaIdentifier", [
  [
    "path",
    {
      d: "M6 9h12M12 9v10M6 19a4 4 0 0 1-3-6 5 5 0 0 1 6-7 5 5 0 0 1 9 2 5 5 0 0 1 0 11",
      key: "tuya-t-cloud",
    },
  ],
]);

export const primavera = createLucideIcon("PrimaveraIdentifier", [
  [
    "path",
    {
      d: "M3 20V4h5a4 4 0 0 1 0 8H3M14 20V4h3a4 4 0 0 1 0 8h-3m3 0 5 8",
      key: "primavera-identifier",
    },
  ],
]);
export const bind = createLucideIcon("BINDIdentifier", [
  [
    "path",
    {
      d: "M4 4h5a4 4 0 0 1 0 8H4V4Zm0 8h6a4 4 0 0 1 0 8H4v-8M17 3v18M20 7h2M20 12h2M20 17h2",
      key: "bind-identifier",
    },
  ],
]);
export const sqlpad = createLucideIcon("SQLPadIdentifier", [
  [
    "path",
    {
      d: "M4 3h16v18H4V3Zm3 4h10M7 11h3l-3 3h3M14 11v5h3M7 18h10",
      key: "sqlpad-identifier",
    },
  ],
]);
export const openssh = createLucideIcon("OpenSSHIdentifier", [
  [
    "path",
    {
      d: "M3 7h18v13H3V7Zm4 4 3 3-3 3M13 17h4M8 7V5a4 4 0 0 1 8 0",
      key: "openssh-identifier",
    },
  ],
]);
export const lxd = createLucideIcon("LXDIdentifier", [
  [
    "path",
    { d: "M3 4v13h7M13 4l8 13M21 4l-8 13M3 21h18", key: "lxd-identifier" },
  ],
]);
export const incus = createLucideIcon("IncusIdentifier", [
  [
    "path",
    {
      d: "M3 5h18v4H3V5Zm4 4v7l-3 4h16l-3-4V9M10 12h4",
      key: "incus-identifier",
    },
  ],
]);
export const samba = createLucideIcon("SambaIdentifier", [
  [
    "path",
    {
      d: "M7 3h10v5H7V3ZM3 16h7v5H3v-5Zm11 0h7v5h-7v-5ZM12 8v4M6 16v-4h12v4",
      key: "samba-identifier",
    },
  ],
]);
export const openldap = createLucideIcon("OpenLDAPIdentifier", [
  [
    "path",
    {
      d: "M3 4h8v5H3V4Zm10 11h8v5h-8v-5ZM7 9v8h6M15 3v7M19 6l-4 4-4-4",
      key: "openldap-identifier",
    },
  ],
]);
export const keepass = createLucideIcon("KeePassIdentifier", [
  [
    "path",
    {
      d: "M4 4v16M4 12l8-8M4 12l8 8M20 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm-3 3v6m0-3h4",
      key: "keepass-identifier",
    },
  ],
]);
export const keepassx = createLucideIcon("KeePassXIdentifier", [
  [
    "path",
    {
      d: "M3 4v16M3 12l7-8M3 12l7 8M14 6l7 12M21 6l-7 12",
      key: "keepassx-identifier",
    },
  ],
]);
export const mailcow = createLucideIcon("MailcowIdentifier", [
  [
    "path",
    {
      d: "M5 7 2 3l1 7M19 7l3-4-1 7M5 7h14v13H5V7Zm0 6 7 4 7-4M8 10h.01M16 10h.01",
      key: "mailcow-identifier",
    },
  ],
]);
export const osticket = createLucideIcon("OsTicketIdentifier", [
  [
    "path",
    {
      d: "M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm10 0v3m0 3v2m0 3v1M6 9h3v6H6V9Z",
      key: "osticket-identifier",
    },
  ],
]);

export const mremoteng = createLucideIcon("MRemoteNGIdentifier", [
  [
    "path",
    {
      d: "M3 18V5l5 7 5-7v13M17 5h4v13h-4V5ZM3 22h18",
      key: "mremoteng-identifier",
    },
  ],
]);
// Italic wordmark hand-traced from draytek.de/tl_files/cto_layout/img/logo.png.
const DRAYTEK_DRAY =
  "M5 1H14C29 1 27 24 11 24H0L5 1Zm5 5L7 19h4c9 0 11-13 3-13h-4Zm18 3h6l-.6 3c2-3 4-4 7-3l-1 6c-5-2-7 1-8 9h-6l2.6-15Zm25 0h6l-3 15h-6l.4-2c-7 6-15 0-12-8 2-7 10-8 14-3L53 9Zm-8 6c-1 6 6 6 7 0 1-5-6-5-7 0Zm14-6h6l2 8 5-8h7L63 31h-7l6-9-3-13Z";
const DRAYTEK_TEK =
  "M77 1h24l-1 5h-2l-.5-3h-6l-4 19 4 1-.3 1H77l.3-1 4-1 4-19h-6l-2 3h-2l2-5Zm24 15c-2 9 3 9 7 5l1 1c-7 7-15 2-12-6 2-6 8-10 12-6 4 4-3 7-8 6Zm0-2c4 0 8-4 5-4-2 0-4 2-5 4Zm16-14h6l-3 15 7-5-2-1 .2-1h10l-.2 1-4 1-6 5 4 7 3 1-.2 1h-8l-4-8-2 8h-5l5-22-2-1 .2-1Z";
export const draytek = createLucideIcon("DrayTekWordmarkTrace", [
  [
    "path",
    {
      d: DRAYTEK_DRAY,
      transform: "translate(1 9.4) scale(.163 .163)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "draytek-wordmark",
    },
  ],
  [
    "path",
    {
      d: DRAYTEK_TEK,
      transform: "translate(1 9.4) scale(.163 .163)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "draytek-tek",
    },
  ],
]);
// The same letterforms stacked only for tiny appliance badges. Not a separate logo.
export const draytekBadge = createLucideIcon("DrayTekCompactBadge", [
  [
    "path",
    {
      d: DRAYTEK_DRAY,
      transform: "translate(1 1.5) scale(.28)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "draytek-badge-dray",
    },
  ],
  [
    "path",
    {
      d: DRAYTEK_TEK,
      transform: "translate(-23 13) scale(.32)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "draytek-badge-tek",
    },
  ],
]);

export const dameware = createLucideIcon("DamewareIdentifier", [
  [
    "path",
    {
      d: "M2 5v14h3a7 7 0 0 0 0-14H2ZM12 5l2 14 3-9 3 9 2-14",
      key: "dameware-dw",
    },
  ],
]);

// Publisher vector: conteudos.meo.pt/Style Library/consumo/images/logo-meo.svg.
// The three bars are transparent knockouts instead of a fixed white fill.
export const meo = createLucideIcon("MEORoundel", [
  [
    "path",
    {
      d: "M96 48a48 48 0 0 1-29.631 44.346 48 48 0 0 1-52.31-10.405A48 48 0 0 1 .922 57.364a48 48 0 0 1 2.731-27.733A48 48 0 0 1 48 0a48 48 0 0 1 48 48z M30.693 26.921l-5.4 39.9c-.3 2.22 7.65 3.3 7.95 1.086l5.4-39.9c.3-2.223-7.65-3.3-7.95-1.083z m13.295 1.119V68.27c0 2.241 8.021 2.241 8.021 0V28.043c0-2.236-8.021-2.236-8.021 0z m13.365-.039l5.4 39.9c.3 2.22 8.25 1.134 7.95-1.086l-5.4-39.9c-.3-2.223-8.25-1.14-7.95 1.083z",
      transform: "translate(1 1) scale(.229166667)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "meo-roundel",
    },
  ],
]);
// Publisher vector: conteudos.uzo.pt/Style Library/uzo/resources/images/logo/uzo-logo.svg.
export const uzo = createLucideIcon("UZOWordmark", [
  [
    "path",
    {
      d: "M149.47,24.72h8.62v110.91c0,24.6-8.31,45.42-24.07,60.03-14.19,13.14-33.64,20.4-54.88,20.4C41.18,216.06.18,190.94.18,135.64V24.72h34.9l.53,110.91c0,31.75,21.87,46.05,43.63,46.05s43.84-14.19,43.84-46.05V24.72h26.39ZM519,119.45c.11,25.97-9.88,50.46-27.97,68.65-17.87,17.87-41.63,27.75-67.07,27.75-53.2,0-94.93-42.37-94.93-96.41s42.58-96.72,94.93-96.72,95.04,43.42,95.04,96.72ZM483.78,119.45c0-35.11-26.28-62.55-59.82-62.55s-59.82,27.44-59.82,62.55,26.28,62.34,59.82,62.34,59.93-27.44,59.82-62.34ZM324.61,24.72h-143.19v33.85h96.3l-96.09,118.59v37.01h12.41L324.61,55.84v-31.12ZM217.91,214.17h106.71v-33.85h-78.74l-27.96,33.85Z",
      transform: "translate(1 6.94) scale(.04238921)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "uzo-wordmark",
    },
  ],
]);
export const hurricaneelectric = createLucideIcon(
  "HurricaneElectricMonogramTrace",
  [
    // Publisher reference: https://he.net/images/helogo.gif; compact circled HE.
    [
      "circle",
      { cx: "12", cy: "12", r: "10", strokeWidth: "1.3", key: "he-ring" },
    ],
    [
      "path",
      {
        d: "M6.3 6h4v.5H9v3.8h4V6.5h-1.3V6h4v.5h-1.3v8.1h1.3v.5h-4v-.5H13v-3.8H9v3.8h1.3v.5h-4v-.5h1.3V6.5H6.3V6ZM11.3 10.8H18l.2 2.1h-.5c-.3-1.4-.8-1.6-2.5-1.6h-1.5v3h1.4c1.1 0 1.3-.3 1.4-1.2h.5v3h-.5c-.1-1-.3-1.3-1.4-1.3h-1.4v3.5h1.9c1.7 0 2.2-.6 2.6-2h.5l-.5 2.5h-6.9v-.5h1.1v-7h-1.1v-.5Z",
        fill: "currentColor",
        stroke: "none",
        key: "he-serif-monogram",
      },
    ],
  ],
);
export const viva = createLucideIcon("VivaIdentifier", [
  [
    "path",
    {
      d: "M1 7h1.8l1.7 7 1.7-7H8l-2.6 10H3.6L1 7Zm7.8 0h1.8v10H8.8V7Zm2.8 0h1.8l1.7 7 1.7-7h1.8L16 17h-1.8L11.6 7Zm6.5 10 2.6-10h1.8l2.6 10h-1.9l-.4-2h-2.4l-.4 2h-1.9Zm2.7-3.8h1.6l-.8-3.5-.8 3.5Z",
      transform: "translate(.13 0) scale(.91 1)",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      key: "viva-identifier",
    },
  ],
]);

// Rounded lowercase wordmark retraced from the publisher header; .com omitted.
export const ddwrt = createLucideIcon("DDWRTWordmarkTrace", [
  [
    "path",
    {
      d: "M4.6 6v10H2.9C.4 16 .4 11 2.9 11h1.7M9.5 6v10H7.8c-2.5 0-2.5-5 0-5h1.7M10.9 12.8h1.5M13.4 11l1.1 5 1.3-4.1 1.3 4.1 1.1-5M19.3 16v-3c0-1.4.7-2 2-2M22.3 7.7v6.7c0 1.3.5 1.6 1.4 1.6M21.6 11h2.1",
      transform: "translate(.2 0) scale(.95 1)",
      strokeWidth: "1.25",
      key: "ddwrt-wordmark",
    },
  ],
]);
export const nomachine = createLucideIcon("NoMachineNXIdentifier", [
  [
    "path",
    { d: "M2 19V5l8 14V5M14 5l8 14M22 5l-8 14", key: "nomachine-identifier" },
  ],
]);
export const x2go = createLucideIcon("X2GoIdentifier", [
  [
    "path",
    {
      d: "M2 5l6 14M8 5 2 19M12 8c0-4 9-4 9 0 0 3-9 5-9 10h9M18 15l3 3-3 3",
      key: "x2go-identifier",
    },
  ],
]);
export const haproxy = createLucideIcon("HAProxyIdentifier", [
  [
    "path",
    {
      d: "M3 4v16M10 4v16M3 12h7M15 7h6M18 4l3 3-3 3M21 17h-6M18 14l-3 3 3 3",
      key: "haproxy-identifier",
    },
  ],
]);
export const hikvision = createLucideIcon("HikvisionIdentifier", [
  [
    "path",
    {
      d: "M3 4v16M9 4v16M3 12h6M14 4v16M22 4l-8 8 8 8",
      key: "hikvision-identifier",
    },
  ],
]);
export const dahua = createLucideIcon("DahuaIdentifier", [
  [
    "path",
    {
      d: "M3 5h4a5 7 0 0 1 0 14H3V5M14 19l4-14 4 14M16 13h4",
      key: "dahua-identifier",
    },
  ],
]);
export const hanwha = createLucideIcon("HanwhaVisionIdentifier", [
  [
    "path",
    { d: "M2 4v16M8 4v16M2 12h6M13 5l4 14 5-14", key: "hanwha-identifier" },
  ],
]);
export const amcrest = createLucideIcon("AmcrestIdentifier", [
  [
    "path",
    {
      d: "M2 19 7 5l5 14M4 13h6M22 7a6 7 0 1 0 0 10",
      key: "amcrest-identifier",
    },
  ],
]);

/** App-authored SE/ethernet identifier; not the SoftEther project's raster logo. */
export const softether = createLucideIcon("SoftEtherIdentifier", [
  [
    "path",
    {
      d: "M10 5H6a3 3 0 0 0 0 6h1a3 3 0 0 1 0 6H3M21 5h-6v12h6M15 11h5M9 21h9M12 18v3M18 19v2",
      key: "softether-identifier",
    },
  ],
]);

/** Historical compatibility group, including later publisher-derived retraces.
 * This name is not an artwork-provenance or license classification.
 */
export const APP_AUTHORED_IDENTIFIER_ICONS = {
  softether,
  ddwrt,
  nomachine,
  x2go,
  haproxy,
  hikvision,
  dahua,
  hanwha,
  amcrest,
  meo,
  uzo,
  hurricaneelectric,
  viva,
  dameware,
  mremoteng,
  draytek,
  primavera,
  bind,
  sqlpad,
  openssh,
  lxd,
  incus,
  samba,
  openldap,
  keepass,
  keepassx,
  mailcow,
  osticket,
  dlink: dlinkIdentifier,
  levelone: leveloneIdentifier,
  arista: aristaIdentifier,
  freepbx: freepbxIdentifier,
  brother,
  yealink,
  clevo,
  grandstream,
  freshtomato,
  meshcentral,
  suricata,
  zeek,
  postfix,
  apc,
  eaton,
  cyberpower,
  tripplite,
  sonoff,
  tuya,
} as const;
