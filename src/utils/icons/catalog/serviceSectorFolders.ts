import { createLucideIcon, type LucideIcon } from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// Provenance: every emblem is original, app-authored geometry drawn for this
// catalog on Lucide's 24-unit stroke grid (2026-10-13; government 2026-10-28).
// They trace no logo, seal or coat of arms, copy no Lucide glyph and name no
// brand. Each stays within three strokes so it reads in the 7 px badge of a
// 16 px tree folder.

/**
 * Domed capitol over a colonnade: a seat of public administration. Drawn
 * apart from Lucide's pedimented `Landmark`, which already badges the company
 * finance folder.
 */
const GovernmentEmblem = createLucideIcon("FolderGovernmentEmblem", [
  ["path", { d: "M12 2v3M7 10a5 5 0 0 1 10 0", key: "dome" }],
  ["path", { d: "M3 10h18M3 21h18", key: "entablature-and-base" }],
  ["path", { d: "M6 12v7M10 12v7M14 12v7M18 12v7", key: "columns" }],
]);

/** Globe with two rising carrier-signal bars: internet access sold by an operator. */
const IspEmblem = createLucideIcon("FolderIspEmblem", [
  ["circle", { cx: "8", cy: "14", r: "6.5", key: "globe" }],
  ["path", { d: "M1.5 14h13M8 7.5c-2.6 3.8-2.6 9.2 0 13", key: "graticule" }],
  ["path", { d: "M18 22v-7M22 22V3", key: "signal-bars" }],
]);

/** Open shopping basket with two handles; deliberately not a cart or a bag. */
const ShoppingEmblem = createLucideIcon("FolderShoppingEmblem", [
  ["path", { d: "M2 10h20l-3 11H5Z", key: "basket" }],
  ["path", { d: "m6 10 4-7M18 10l-4-7", key: "handles" }],
]);

// One emblem source drives both states; saved keys never change on expansion.
const VARIANTS = [
  [
    "folder-government",
    "Government folder",
    GovernmentEmblem,
    [
      "government",
      "governments",
      "gov",
      "govt",
      "public sector",
      "public administration",
      "public services",
      "civic",
      "civil service",
      "municipal",
      "municipality",
      "city hall",
      "town hall",
      "council",
      "state",
      "federal",
      "agency",
      "agencies",
      "ministry",
      "authority",
      "parliament",
      "capitol",
      "governo",
      "administração pública",
      "câmara municipal",
      "setor público",
      "gobierno",
      "sector público",
      "ayuntamiento",
      "gouvernement",
      "secteur public",
      "mairie",
      "regierung",
      "behörde",
      "öffentlicher dienst",
    ],
    "App-authored folder emblem of a domed capitol over columns; generic, not a brand or any government's seal or coat of arms.",
  ],
  [
    "folder-isp",
    "ISPs folder",
    IspEmblem,
    [
      "isp",
      "isps",
      "internet service provider",
      "internet service providers",
      "internet provider",
      "internet",
      "provider",
      "providers",
      "operator",
      "operators",
      "carrier",
      "telecom",
      "telecommunications",
      "telco",
      "broadband",
      "fibre",
      "fiber",
      "dsl",
      "cable internet",
      "mobile operator",
      "operadora",
      "operadoras",
      "fornecedor de internet",
      "prestador de internet",
      "telecomunicações",
      "proveedor de internet",
      "fournisseur d'accès",
      "internetanbieter",
    ],
    "App-authored folder emblem of a globe with two carrier-signal bars; generic, not a brand or operator logo.",
  ],
  [
    "folder-shopping",
    "Shopping folder",
    ShoppingEmblem,
    [
      "shopping",
      "shop",
      "shops",
      "store",
      "stores",
      "online store",
      "online shopping",
      "cart",
      "basket",
      "bag",
      "retail",
      "ecommerce",
      "e-commerce",
      "marketplace",
      "orders",
      "purchases",
      "compras",
      "loja",
      "lojas",
      "loja online",
      "tienda",
      "einkaufen",
      "achats",
    ],
    "App-authored folder emblem of an open shopping basket; generic, not a brand or store logo.",
  ],
] as const;

export const SERVICE_SECTOR_FOLDER_ICONS = VARIANTS.map(
  ([key, label, glyph, keywords, description]) =>
    defineIcon(
      key,
      label,
      "folders",
      createRoleIcon(key, "folder", glyph),
      [...keywords, "folder", "folders", "collection", "collections"],
      description,
    ),
);

export const SERVICE_SECTOR_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    VARIANTS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof VARIANTS)[number][0], LucideIcon>>;
