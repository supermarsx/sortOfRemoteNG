import { createLucideIcon } from "lucide-react";

/**
 * App-authored geometric identifiers, NOT official brand logos. No font, image,
 * or external request is needed. Catalog descriptions disclose the distinction.
 * Keep outside BRAND_ICONS: these are distinct, searchable fallback symbols.
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
  ["path", { d: "M3 19V5h7M3 11h6M14 19V5h3a4 4 0 0 1 0 8h-3", key: "fp" }],
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
export const grandstream = createLucideIcon("GrandstreamIdentifier", [
  [
    "path",
    {
      d: "M10 6H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h4v-6H7M21 6h-4a3 3 0 0 0 0 6h1a3 3 0 0 1 0 6h-4",
      key: "grandstream-gs",
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
export const draytek = createLucideIcon("DrayTekIdentifier", [
  [
    "path",
    {
      d: "M3 4v16h4a8 8 0 0 0 0-16H3ZM13 4h9M17.5 4v16M14 21h7",
      key: "draytek-identifier",
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

export const meo = createLucideIcon("MEOIdentifier", [
  [
    "path",
    {
      d: "M1.5 17V7l3 5 3-5v10M15 7h-5v10h5M10 12h4M18 9a2 2 0 0 1 4.5 0v6a2 2 0 0 1-4.5 0Z",
      strokeWidth: "1.5",
      key: "meo-identifier",
    },
  ],
]);
export const uzo = createLucideIcon("UZOIdentifier", [
  [
    "path",
    {
      d: "M1.5 7v7a3 3 0 0 0 6 0V7M10 7h5l-5 10h5M18 9a2 2 0 0 1 4.5 0v6a2 2 0 0 1-4.5 0Z",
      strokeWidth: "1.5",
      key: "uzo-identifier",
    },
  ],
]);
export const hurricaneelectric = createLucideIcon(
  "HurricaneElectricIdentifier",
  [
    [
      "path",
      {
        d: "M3 4v16M3 12h7M10 4v16M21 4h-7v16h7M14 12h5",
        key: "hurricaneelectric-identifier",
      },
    ],
  ],
);
export const viva = createLucideIcon("VivaIdentifier", [
  [
    "path",
    {
      d: "M1 7l2.5 10L6 7M9 7v10M12 7l2.5 10L17 7M18.5 17l2.25-10L23 17M19.5 13h2.5",
      strokeWidth: "1.5",
      key: "viva-identifier",
    },
  ],
]);

export const ddwrt = createLucideIcon("DDWRTIdentifier", [
  [
    "path",
    {
      d: "M2 5h4a5 7 0 0 1 0 14H2V5M14 5h3a5 7 0 0 1 0 14h-3V5",
      key: "ddwrt-identifier",
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

/** Every explicitly nonofficial brand identifier, for source and uniqueness tests. */
export const APP_AUTHORED_IDENTIFIER_ICONS = {
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
