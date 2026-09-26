import { createLucideIcon, Share2, type LucideIcon } from "lucide-react";
import { google, hpe } from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// Two drive bays above a network link distinguish this storage collection
// from the existing three-bay NAS appliance emblem.
const NetworkStorage = createLucideIcon("FolderNetworkStorageEmblem", [
  [
    "rect",
    { x: "3", y: "2", width: "18", height: "14", rx: "2", key: "chassis" },
  ],
  ["path", { d: "M12 2v14M7 11v1M17 11v1", key: "drive-bays" }],
  ["path", { d: "M12 16v5M3 21h18", key: "network-link" }],
]);

// Share the exact emblem between both states, using the existing role frames.
const VARIANTS = [
  [
    "folder-ilo",
    "iLO connections folder",
    hpe,
    [
      "ilo",
      "hpe",
      "hp",
      "integrated lights out",
      "remote management",
      "bmc",
      "connections",
    ],
  ],
  [
    "folder-google-services",
    "Google services folder",
    google,
    ["google", "services", "workspace", "gmail", "drive", "gcp", "cloud"],
  ],
  [
    "folder-social-media",
    "Social media folder",
    Share2,
    [
      "social",
      "media",
      "social networks",
      "sharing",
      "community",
      "facebook",
      "instagram",
      "mastodon",
    ],
  ],
  [
    "folder-nas-storage",
    "NAS storage folder",
    NetworkStorage,
    [
      "nas",
      "storage",
      "network attached storage",
      "file shares",
      "synology",
      "qnap",
      "truenas",
      "smb",
      "nfs",
    ],
  ],
] as const;

export const SERVICE_COLLECTION_FOLDER_ICONS = VARIANTS.map(
  ([key, label, glyph, keywords]) =>
    defineIcon(key, label, "folders", createRoleIcon(key, "folder", glyph), [
      ...keywords,
      "folder",
      "folders",
      "collection",
      "collections",
    ]),
);

export const SERVICE_COLLECTION_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    VARIANTS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof VARIANTS)[number][0], LucideIcon>>;
